#!/usr/bin/env python3
"""
SAP RFC → MariaDB bw_profitability_data 동기화 스크립트
------------------------------------------------------
사용법:
  python3 sap_rfc_sync.py 202604          # 특정 월 동기화
  python3 sap_rfc_sync.py 202604 --dry-run  # RFC 호출만 (DB INSERT 안 함)
  python3 sap_rfc_sync.py 202604 --replace   # 해당 월 기존 데이터 DELETE 후 INSERT

RFC 함수: Z_BI_WEB_EX_BL
  입력: I_CMONTH (YYYYMM)
  출력: T_DATA (테이블)

대상 DB: MariaDB integration (10.2.14.247:3306)
대상 테이블: bw_profitability_data
"""

import sys
import os
import argparse
import time
import traceback
from datetime import datetime

# ============================================================
# 설정
# ============================================================
SAP_CONFIG = {
    'ashost': '10.2.14.220',     # 어플리케이션 서버
    'sysnr': '01',               # 인스턴스 번호
    'sysid': 'BWP',              # 시스템 ID
    'client': '100',             # 클라이언트 (만트) - 확인 필요
    'user': 'ITM120',
    'passwd': 'kleannara123@',
    'lang': 'KO',
}

DB_CONFIG = {
    'host': '10.2.14.247',
    'port': 3306,
    'user': 'appuser',
    'password': 'Kleannara12#',
    'database': 'integration',
    'charset': 'utf8mb4',
}

TABLE_NAME = 'bw_profitability_data'
RFC_FUNCTION = 'Z_BI_WEB_EX_BL'

# bw_profitability_data 컬럼 (SEQ 제외, 순서대로)
DB_COLUMNS = [
    'CALYEAR', 'CALMONTH', 'CALDAY',
    'CO_AREA', 'CO_AREA_NM',
    'PROFIT_CTR', 'PROFIT_CTR_NM',
    'DIVISION', 'DIVISION_NM',
    'PLANT', 'PLANT_NM',
    'DISTR_CHAN', 'DISTR_CHAN_NM',
    'ZDISTCHAN', 'ZORG_TEAM',
    'SALES_OFF', 'SALES_OFF_NM',
    'MATL_TYPE', 'MATL_TYPE_NM',
    'MATL_GROUP', 'MATL_GROUP_NM',
    'PRODH1', 'PRODH1_NM',
    'PRODH2', 'PRODH2_NM',
    'PRODH3', 'PRODH3_NM',
    'PRODH4', 'PRODH4_NM',
    'ZJPCODE', 'ZJPCODE_NM',
    'ZBRAND', 'ZBRAND_NM',
    'ZSBRAND', 'ZSBRAND_NM',
    'BILL_TYPE', 'BILL_TYPE_NM',
    'INCOTERMS', 'INCOTERMS_NM',
    'CUST_GROUP', 'CUST_GROUP_NM',
    'CUST_GRP1', 'CUST_GRP1_NM',
    'COUNTRY', 'COUNTRY_NM',
    'ZKUNN2', 'ZKUNN2_NM',
    'CUSTOMER', 'CUSTOMER_NM',
    'MATERIAL', 'MATERIAL_NM',
    'ZBOXUNIT', 'ZBAGUNIT', 'ZUNIT', 'CURRENCY',
    'ZQTY_BOX', 'ZQTY_BAG', 'ZQTY_KE',
    'ZAMT001', 'ZAMT002', 'ZAMT003', 'ZAMT004', 'ZAMT005',
    'ZAMT006', 'ZAMT007', 'ZAMT008', 'ZAMT009', 'ZAMT010',
    'ZAMT011', 'ZAMT012', 'ZAMT013', 'ZAMT014', 'ZAMT015',
    'ZAMT016', 'ZAMT017', 'ZAMT018', 'ZAMT019', 'ZAMT020',
    'ZAMT021', 'ZAMT022', 'ZAMT023', 'ZAMT024', 'ZAMT025',
    'ZAMT026', 'ZAMT027', 'ZAMT028', 'ZAMT029', 'ZAMT030',
    'ZAMT031', 'ZAMT032', 'ZAMT033', 'ZAMT034', 'ZAMT035',
    'ZAMT036', 'ZAMT037', 'ZAMT038', 'ZAMT039', 'ZAMT040',
    'ZAMT041', 'ZAMT042', 'ZAMT043', 'ZAMT044', 'ZAMT045',
    'ZAMT046', 'ZAMT047', 'ZAMT048', 'ZAMT049', 'ZAMT050',
    'ZAMT051', 'ZAMT052', 'ZAMT053', 'ZAMT054', 'ZAMT055',
    'ZAMT056', 'ZAMT057', 'ZAMT058', 'ZAMT059', 'ZAMT060',
    'ZAMT061', 'ZAMT062', 'ZAMT063', 'ZAMT064',
]

# 숫자형 컬럼 (decimal / bigint)
NUMERIC_COLUMNS = {
    'ZQTY_BOX', 'ZQTY_BAG', 'ZQTY_KE',
    *(f'ZAMT{i:03d}' for i in range(1, 65)),
}

# ============================================================
# RFC 호출
# ============================================================
def call_rfc(cmonth):
    """SAP RFC Z_BI_WEB_EX_BL 호출하여 T_DATA 반환"""
    try:
        from pyrfc import Connection
    except ImportError as e:
        msg = ("[ERROR] pyrfc 모듈이 설치되어 있지 않습니다.\n"
               "  설치 방법:\n"
               "  1. SAP NW RFC SDK를 /usr/local/sap/nwrfcsdk 에 설치\n"
               "  2. pip install pyrfc\n"
               f"  상세: {e}")
        print(msg)
        print(msg, file=sys.stderr)
        sys.exit(1)

    print(f"[RFC] 연결 중... {SAP_CONFIG['ashost']}:{SAP_CONFIG['sysnr']} (SID: {SAP_CONFIG['sysid']})")
    conn = Connection(**SAP_CONFIG)
    print(f"[RFC] 연결 성공!")

    print(f"[RFC] {RFC_FUNCTION} 호출 (I_CMONTH={cmonth})...")
    start = time.time()
    result = conn.call(RFC_FUNCTION, I_CMONTH=cmonth)
    elapsed = time.time() - start
    print(f"[RFC] 호출 완료 ({elapsed:.1f}초)")

    t_data = result.get('T_DATA', [])
    print(f"[RFC] T_DATA: {len(t_data)} rows")

    conn.close()
    return t_data


# ============================================================
# T_DATA → DB 행 변환
# ============================================================
def convert_row(sap_row):
    """SAP T_DATA 행을 DB INSERT용 tuple로 변환"""
    values = []
    for col in DB_COLUMNS:
        val = sap_row.get(col, None)

        # SAP는 빈 문자열을 사용하므로 변환
        if val is None or (isinstance(val, str) and val.strip() == ''):
            if col in NUMERIC_COLUMNS:
                val = 0
            else:
                val = None
        elif col in NUMERIC_COLUMNS:
            # 숫자형: SAP에서 문자열로 올 수 있음
            try:
                val = float(str(val).replace(',', '').strip())
                # bigint 컬럼은 정수로
                if col != 'ZQTY_BOX' and col != 'ZQTY_KE':
                    val = int(val)
            except (ValueError, TypeError):
                val = 0
        else:
            # 문자형: strip
            if isinstance(val, str):
                val = val.strip()

        values.append(val)
    return tuple(values)


# ============================================================
# DB INSERT
# ============================================================
def insert_to_db(rows, cmonth, replace=False):
    """MariaDB bw_profitability_data에 INSERT"""
    try:
        import pymysql
    except ImportError:
        try:
            import mariadb as pymysql
        except ImportError:
            print("[ERROR] pymysql 또는 mariadb 모듈이 필요합니다.")
            print("  pip install pymysql  또는  pip install mariadb")
            sys.exit(1)

    print(f"\n[DB] 연결 중... {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
    conn = pymysql.connect(**DB_CONFIG)
    cursor = conn.cursor()

    # --replace 옵션: 해당 월 기존 데이터 삭제
    if replace:
        calmonth = str(cmonth)
        print(f"[DB] CALMONTH={calmonth} 기존 데이터 삭제 중...")
        cursor.execute(f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE CALMONTH = %s", (calmonth,))
        existing = cursor.fetchone()[0]
        cursor.execute(f"DELETE FROM {TABLE_NAME} WHERE CALMONTH = %s", (calmonth,))
        conn.commit()
        print(f"[DB] {existing}건 삭제 완료")

    # INSERT 구문 생성
    col_list = ', '.join(DB_COLUMNS)
    placeholders = ', '.join(['%s'] * len(DB_COLUMNS))
    sql = f"INSERT INTO {TABLE_NAME} ({col_list}) VALUES ({placeholders})"

    # 배치 INSERT (1000건씩)
    batch_size = 1000
    total = len(rows)
    inserted = 0
    print(f"[DB] {total}건 INSERT 시작...")

    for i in range(0, total, batch_size):
        batch = rows[i:i + batch_size]
        cursor.executemany(sql, batch)
        conn.commit()
        inserted += len(batch)
        pct = inserted / total * 100
        print(f"  [{inserted}/{total}] ({pct:.0f}%)")

    cursor.close()
    conn.close()
    print(f"[DB] INSERT 완료: {inserted}건")
    return inserted


# ============================================================
# Main
# ============================================================
def main():
    parser = argparse.ArgumentParser(description='SAP RFC → MariaDB bw_profitability_data 동기화')
    parser.add_argument('cmonth', help='입력 년월 (YYYYMM, 예: 202604)')
    parser.add_argument('--dry-run', action='store_true', help='RFC 호출만 (DB INSERT 안 함)')
    parser.add_argument('--replace', action='store_true', help='해당 월 기존 데이터 DELETE 후 INSERT')
    parser.add_argument('--client', default=SAP_CONFIG['client'], help='SAP 클라이언트 번호 (기본: 100)')
    parser.add_argument('--show-columns', action='store_true', help='T_DATA 컬럼명 출력 후 종료')
    args = parser.parse_args()

    # 년월 유효성 검사
    cmonth = args.cmonth
    if len(cmonth) != 6 or not cmonth.isdigit():
        print(f"[ERROR] 유효하지 않은 년월: {cmonth} (YYYYMM 형식)")
        sys.exit(1)

    SAP_CONFIG['client'] = args.client

    print("=" * 60)
    print(f"  SAP RFC → bw_profitability_data 동기화")
    print(f"  시간: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  대상 월: {cmonth}")
    print(f"  RFC 함수: {RFC_FUNCTION}")
    print(f"  SAP: {SAP_CONFIG['ashost']} (SID: {SAP_CONFIG['sysid']}, 인스턴스: {SAP_CONFIG['sysnr']})")
    print(f"  DB: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
    print(f"  모드: {'DRY RUN' if args.dry_run else ('REPLACE' if args.replace else 'APPEND')}")
    print("=" * 60)

    # 1. RFC 호출
    t_data = call_rfc(cmonth)

    if len(t_data) == 0:
        print("\n[WARN] T_DATA가 비어있습니다. 종료합니다.")
        sys.exit(0)

    # T_DATA 컬럼 확인
    if args.show_columns or True:  # 항상 컬럼 출력
        sample = t_data[0]
        sap_cols = list(sample.keys())
        print(f"\n[INFO] T_DATA 컬럼 ({len(sap_cols)}개): {sap_cols[:10]}...")

        # DB 컬럼과 비교
        sap_set = set(c.upper() for c in sap_cols)
        db_set = set(DB_COLUMNS)
        missing_in_sap = db_set - sap_set
        extra_in_sap = sap_set - db_set
        if missing_in_sap:
            print(f"[WARN] DB에는 있지만 T_DATA에 없는 컬럼: {missing_in_sap}")
        if extra_in_sap:
            print(f"[INFO] T_DATA에는 있지만 DB에 없는 컬럼: {extra_in_sap}")

    if args.show_columns:
        print(f"\n전체 T_DATA 컬럼: {sap_cols}")
        sys.exit(0)

    # 2. 데이터 변환
    print(f"\n[변환] {len(t_data)}건 변환 중...")
    converted = [convert_row(row) for row in t_data]
    print(f"[변환] 완료")

    # 샘플 출력
    if len(converted) > 0:
        sample_row = t_data[0]
        print(f"\n[샘플 1행] CALMONTH={sample_row.get('CALMONTH')}, "
              f"PROFIT_CTR={sample_row.get('PROFIT_CTR')}, "
              f"MATERIAL={sample_row.get('MATERIAL')}, "
              f"ZAMT001={sample_row.get('ZAMT001')}")

    # 3. DB INSERT (dry-run이 아닐 때만)
    if args.dry_run:
        print(f"\n[DRY RUN] DB INSERT 건너뜀. 총 {len(converted)}건이 INSERT될 예정.")
    else:
        insert_to_db(converted, cmonth, replace=args.replace)

    print(f"\n{'=' * 60}")
    print(f"  완료! T_DATA: {len(t_data)} rows")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        # 예상치 못한 에러를 stdout + stderr 모두에 출력
        err_msg = f"[FATAL] 예상치 못한 오류: {e}\n{traceback.format_exc()}"
        print(err_msg)
        print(err_msg, file=sys.stderr)
        sys.exit(1)
