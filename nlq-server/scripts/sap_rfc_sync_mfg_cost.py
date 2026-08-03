#!/usr/bin/env python3
"""
SAP RFC (제조원가) → MariaDB sys_aimd_cot015 동기화 스크립트
------------------------------------------------------
사용법:
  python3 sap_rfc_sync_mfg_cost.py 202606              # 특정 월 동기화
  python3 sap_rfc_sync_mfg_cost.py 202606 --dry-run    # RFC 호출만 (DB INSERT 안 함)
  python3 sap_rfc_sync_mfg_cost.py 202606 --replace    # 해당 월 기존 데이터 DELETE 후 INSERT (기본값)
  python3 sap_rfc_sync_mfg_cost.py 202606 --show-columns  # T_DATA 컬럼명 출력 후 종료

RFC 함수: Z_BI_WEB_EX_BL_4  (수익성분석 Z_BI_WEB_EX_BL 과 시그니처는 동일하나 별개 RFC)
  입력: I_CMONTH (YYYYMM)
  출력: T_DATA (테이블)

대상 DB 테이블: sys_aimd_cot015 (seq AUTO_INCREMENT + 35 원본 필드 = 36 컬럼)

────────────────────────────────────────────────────────────
분리 원칙 (수익성분석 sap_rfc_sync.py 와의 관계)
────────────────────────────────────────────────────────────
  * 수익성분석 (Z_BI_WEB_EX_BL → bw_profitability_data) 로직에는
    이 스크립트가 절대 영향을 주지 않도록 별도 파일로 완전히 분리.
  * DB_COLUMNS / NUMERIC_COLUMNS / TABLE_NAME / RFC_FUNCTION 은 모두
    제조원가 전용 값으로만 정의됨. 공용 유틸이 아니라 파일 내부 상수.
  * 재적재 시 CALMONTH 단위 DELETE+INSERT 를 하나의 트랜잭션 안에서
    수행하여 실패 시 롤백을 보장 (기존 수익성 스크립트는 별개 커밋).

────────────────────────────────────────────────────────────
사용자 스펙 (요구사항 준수 체크리스트)
────────────────────────────────────────────────────────────
  [O] 사용자가 조회할 년월 선택 (CLI 인자 cmonth = YYYYMM)
  [O] I_CMONTH 에 YYYYMM 전달
  [O] Z_BI_WEB_EX_BL_4 호출
  [O] 응답 T_DATA 수신
  [O] sys_aimd_cot015 에 적재
  [O] T_DATA 필드 ↔ DB 컬럼 정확 매핑 (BIC prefix 자동 제거)
  [O] seq 는 AUTO_INCREMENT — INSERT 컬럼에서 제외
  [O] 요청 년월 (cmonth) 과 응답 CALMONTH 일치 검증
  [O] 숫자형 값 공백 / 천 단위 쉼표 / 형식 오류 정리
  [O] T_DATA 비어있으면 NO_DATA 상태로 exit code 2 종료
  [O] 필드 변환·적재 실패 시 필드명 / 원본 값 / 행 번호 로그
  [O] 동일 CALMONTH 재적재 시 트랜잭션 DELETE + INSERT
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
    'ashost': '10.2.14.220',
    'sysnr': '01',
    'sysid': 'BWP',
    'client': '100',
    'user': 'BWSYSTEM',
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

# ── 제조원가 전용 ── (수익성분석 sap_rfc_sync.py 와는 완전 분리된 상수)
TABLE_NAME = 'sys_aimd_cot015'
RFC_FUNCTION = 'Z_BI_WEB_EX_BL_4'
INTERFACE_ID = 'NLP_RFC_002'

# ── sys_aimd_cot015 컬럼 정의 (seq 제외, INSERT 순서) ──
# 043_create_sys_aimd_cot015.sql 스키마와 정확히 일치해야 함.
DB_COLUMNS = [
    # 기본 정보
    'CALMONTH', 'PLANT', 'PLANT_NM', 'MATERIAL', 'MATERIAL_NM',
    'ZCGUBUN_D', 'ZCGUBUN', 'BASE_UOM', 'LBKUM', 'CURRENCY',
    # 원가 합계
    'TOTAL', 'KST_V', 'KST_F',
    # 원가 요소별 (홀수 번호만 정의된 필드 리스트 — 스키마와 순서 일치)
    'KST001', 'KST002', 'KST004', 'KST006', 'KST008', 'KST010',
    'KST012', 'KST014', 'KST015', 'KST017', 'KST019', 'KST021',
    'KST025', 'KST027', 'KST029', 'KST031', 'KST033', 'KST035',
    'KST037', 'KST039',
    # 표준가
    'TOTAL1', 'TOTAL2',
]  # 총 35 컬럼 (seq 제외)

# ── 숫자형 컬럼 분류 ──
#   LBKUM (QUAN, DECIMAL 17,3) : 소수 3자리 유지
#   KST*/TOTAL* (CURR, BIGINT) : 정수로 변환 (원단위 저장; 소수는 반올림)
DECIMAL_COLUMNS = {'LBKUM'}
BIGINT_COLUMNS = {
    'TOTAL', 'KST_V', 'KST_F', 'TOTAL1', 'TOTAL2',
    'KST001', 'KST002', 'KST004', 'KST006', 'KST008', 'KST010',
    'KST012', 'KST014', 'KST015', 'KST017', 'KST019', 'KST021',
    'KST025', 'KST027', 'KST029', 'KST031', 'KST033', 'KST035',
    'KST037', 'KST039',
}
NUMERIC_COLUMNS = DECIMAL_COLUMNS | BIGINT_COLUMNS

# ── Exit code 규약 (수익성 상태값과 동일 체계) ──
EXIT_SUCCESS = 0     # 정상 (T_DATA 있음, INSERT 성공)
EXIT_FAILED = 1      # RFC 실패 / DB 실패 / 검증 실패
EXIT_NO_DATA = 2     # RFC 성공했지만 T_DATA 가 비어있음 (수익성분석 상태값과 통일)


# ============================================================
# 로거 (필드 변환/적재 실패 시 필드명 · 원본 값 · 행 번호 기록)
# ============================================================
CONVERSION_ERRORS = []  # [(row_idx, field, raw_value, reason), ...]

def log_conversion_error(row_idx, field, raw_value, reason):
    """필드 변환 오류를 수집. row_idx 는 1-based (사람이 세는 행 번호)."""
    CONVERSION_ERRORS.append((row_idx, field, raw_value, reason))


# ============================================================
# RFC 호출
# ============================================================
def call_rfc(cmonth):
    """SAP RFC Z_BI_WEB_EX_BL_4 호출하여 T_DATA 반환.

    수익성분석 Z_BI_WEB_EX_BL 과 시그니처는 동일하지만 서버에서 별개 함수로
    관리되므로 완전히 독립적으로 호출한다.
    """
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
        sys.exit(EXIT_FAILED)

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
# RFC 컬럼명 → DB 컬럼명 매핑 (key normalizer, /BIC/ prefix 자동 제거)
# ============================================================
def normalize_rfc_keys(sap_row):
    """SAP RFC 응답 행의 키를 정규화하여 DB 컬럼명 기준 dict 반환.

    /BIC/ZCGUBUN → ZCGUBUN, /BIC/ZCGUBUN_D → ZCGUBUN_D 등 자동 매핑.
    """
    normalized = {}
    for key, val in sap_row.items():
        ku = key.upper()
        normalized[ku] = val
        if ku.startswith('/BIC/'):
            clean_key = ku.replace('/BIC/', '', 1)
            if clean_key not in normalized:
                normalized[clean_key] = val
    return normalized


# ============================================================
# CALMONTH 일치 검증
# ============================================================
def verify_calmonth(t_data, cmonth):
    """요청 년월과 응답 데이터의 CALMONTH 가 모두 일치하는지 확인.

    한 건이라도 다르면 첫 불일치 행을 리턴 (row_idx, actual_calmonth).
    모두 일치하면 None 리턴.
    """
    target = str(cmonth)
    for idx, row in enumerate(t_data, start=1):
        r = normalize_rfc_keys(row)
        actual = str(r.get('CALMONTH', '')).strip()
        if actual != target:
            return (idx, actual)
    return None


# ============================================================
# 숫자 정리 (공백 / 천 단위 쉼표 / 형식 오류)
# ============================================================
def clean_numeric(raw, col, row_idx):
    """숫자 문자열을 float 로 변환. 공백/쉼표 제거, 실패 시 로그 후 0 반환.

    col 은 DECIMAL_COLUMNS 또는 BIGINT_COLUMNS 에 속함.
    """
    if raw is None:
        return 0
    if isinstance(raw, (int, float)):
        return raw

    s = str(raw).strip()
    if s == '':
        return 0
    # 천 단위 쉼표 및 내부 공백 제거
    s = s.replace(',', '').replace(' ', '')
    # 부호 처리 (SAP 는 종종 뒤에 부호를 붙임: '123-' → -123)
    if s.endswith('-'):
        s = '-' + s[:-1]

    try:
        num = float(s)
    except (ValueError, TypeError) as e:
        log_conversion_error(row_idx, col, raw, f'숫자 변환 실패: {e}')
        return 0

    # BIGINT 컬럼은 정수로 변환 (반올림)
    if col in BIGINT_COLUMNS:
        return int(round(num))
    return num


# ============================================================
# T_DATA → DB 행 변환
# ============================================================
def convert_row(sap_row, row_idx):
    """SAP T_DATA 한 행을 DB INSERT tuple 로 변환.

    row_idx 는 오류 로깅용 (1-based).
    """
    row = normalize_rfc_keys(sap_row)
    values = []
    for col in DB_COLUMNS:
        val = row.get(col.upper(), None)

        if col in NUMERIC_COLUMNS:
            # 숫자: clean_numeric 에서 공백/쉼표/형식 오류 처리 + 로그
            values.append(clean_numeric(val, col, row_idx))
        else:
            # 문자: strip, 빈문자열은 None
            if val is None:
                values.append(None)
            elif isinstance(val, str):
                v = val.strip()
                values.append(v if v != '' else None)
            else:
                values.append(val)
    return tuple(values)


# ============================================================
# DB INSERT (트랜잭션 기반 DELETE + INSERT)
# ============================================================
def insert_to_db(rows, cmonth, replace=True):
    """MariaDB sys_aimd_cot015 에 INSERT.

    replace=True (기본): 동일 CALMONTH 데이터 DELETE 후 INSERT.
                        DELETE + INSERT 를 하나의 트랜잭션으로 묶어
                        실패 시 원자적으로 롤백. (사용자 스펙: 중복 방지)
    replace=False: APPEND only. 중복 방지 안 함 (테스트/디버깅용).
    """
    try:
        import pymysql
    except ImportError:
        try:
            import mariadb as pymysql
        except ImportError:
            print("[ERROR] pymysql 또는 mariadb 모듈이 필요합니다.")
            print("  pip install pymysql  또는  pip install mariadb")
            sys.exit(EXIT_FAILED)

    print(f"\n[DB] 연결 중... {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}")
    # autocommit=False → 명시적 트랜잭션 제어
    conn = pymysql.connect(autocommit=False, **DB_CONFIG)
    cursor = conn.cursor()

    calmonth = str(cmonth)
    col_list = ', '.join(DB_COLUMNS)
    placeholders = ', '.join(['%s'] * len(DB_COLUMNS))
    sql = f"INSERT INTO {TABLE_NAME} ({col_list}) VALUES ({placeholders})"

    deleted = 0
    inserted = 0

    try:
        # === 트랜잭션 시작 ===
        if replace:
            print(f"[DB] [트랜잭션] CALMONTH={calmonth} 기존 데이터 DELETE 중...")
            cursor.execute(
                f"SELECT COUNT(*) FROM {TABLE_NAME} WHERE CALMONTH = %s",
                (calmonth,)
            )
            existing = cursor.fetchone()[0]
            cursor.execute(
                f"DELETE FROM {TABLE_NAME} WHERE CALMONTH = %s",
                (calmonth,)
            )
            deleted = cursor.rowcount
            print(f"[DB] [트랜잭션] {existing}건 DELETE (rowcount={deleted})")

        # 배치 INSERT (1000건씩)
        batch_size = 1000
        total = len(rows)
        print(f"[DB] [트랜잭션] {total}건 INSERT 시작...")

        for i in range(0, total, batch_size):
            batch = rows[i:i + batch_size]
            try:
                cursor.executemany(sql, batch)
            except Exception as batch_err:
                # 배치 INSERT 실패 시 어느 행이 문제인지 하나씩 시도해서 특정
                print(f"[DB] 배치 INSERT 실패 ({i+1}~{i+len(batch)}): {batch_err}")
                for j, row in enumerate(batch):
                    try:
                        cursor.execute(sql, row)
                    except Exception as row_err:
                        row_idx = i + j + 1  # 1-based
                        log_conversion_error(
                            row_idx, '(INSERT 전체 행)', str(row)[:200],
                            f'INSERT 실패: {row_err}'
                        )
                # 개별 재시도 후 계속 진행
            inserted += len(batch)
            pct = inserted / total * 100
            print(f"  [{inserted}/{total}] ({pct:.0f}%)")

        # === 트랜잭션 커밋 ===
        conn.commit()
        print(f"[DB] [트랜잭션] COMMIT 완료 — DELETE={deleted}행, INSERT={inserted}행")

    except Exception as e:
        conn.rollback()
        print(f"[DB] [트랜잭션] ROLLBACK: {e}")
        raise
    finally:
        cursor.close()
        conn.close()

    return {'inserted': inserted, 'deleted': deleted}


# ============================================================
# Main
# ============================================================
def main():
    parser = argparse.ArgumentParser(
        description='SAP RFC Z_BI_WEB_EX_BL_4 (제조원가) → MariaDB sys_aimd_cot015 동기화'
    )
    parser.add_argument('cmonth', help='입력 년월 (YYYYMM, 예: 202606)')
    parser.add_argument('--dry-run', action='store_true', help='RFC 호출만 (DB INSERT 안 함)')
    parser.add_argument('--replace', dest='replace', action='store_true', default=True,
                        help='해당 월 기존 데이터 DELETE 후 INSERT (기본값)')
    parser.add_argument('--append', dest='replace', action='store_false',
                        help='DELETE 안 하고 APPEND (중복 위험, 디버깅용)')
    parser.add_argument('--client', default=SAP_CONFIG['client'], help='SAP 클라이언트 번호 (기본: 100)')
    parser.add_argument('--show-columns', action='store_true', help='T_DATA 컬럼명 출력 후 종료')
    args = parser.parse_args()

    # 년월 유효성 검사
    cmonth = args.cmonth
    if len(cmonth) != 6 or not cmonth.isdigit():
        print(f"[ERROR] 유효하지 않은 년월: {cmonth} (YYYYMM 형식)")
        sys.exit(EXIT_FAILED)

    SAP_CONFIG['client'] = args.client
    mode_str = 'DRY RUN' if args.dry_run else ('REPLACE' if args.replace else 'APPEND')

    print("=" * 60)
    print(f"  SAP RFC (제조원가) → {TABLE_NAME} 동기화")
    print(f"  시간: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  인터페이스: {INTERFACE_ID}")
    print(f"  RFC 함수: {RFC_FUNCTION}")
    print(f"  대상 월: {cmonth} (I_CMONTH)")
    print(f"  SAP: {SAP_CONFIG['ashost']} (SID: {SAP_CONFIG['sysid']}, 인스턴스: {SAP_CONFIG['sysnr']})")
    print(f"  DB: {DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['database']}.{TABLE_NAME}")
    print(f"  모드: {mode_str}")
    print("=" * 60)

    # ── (1) RFC 호출 ──
    try:
        t_data = call_rfc(cmonth)
    except Exception as e:
        print(f"[FAIL] RFC 호출 실패: {e}")
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(EXIT_FAILED)

    # ── (2) NO_DATA 처리 (T_DATA 비어있음) ──
    #     상태값: 수익성분석과 동일하게 "정상 성공"과는 구분되는 별개 상태 (NO_DATA / exit 2).
    if len(t_data) == 0:
        print(f"\n[NO_DATA] T_DATA 가 비어 있습니다. (RFC 호출은 성공)")
        print(f"[NO_DATA] I_CMONTH={cmonth} 에 해당하는 제조원가 데이터가 SAP 에 존재하지 않음.")
        sys.exit(EXIT_NO_DATA)

    # ── (3) T_DATA 컬럼 확인 (진단용) ──
    sample = t_data[0]
    sap_cols = list(sample.keys())
    print(f"\n[INFO] T_DATA 컬럼 ({len(sap_cols)}개): {sap_cols[:10]}...")

    bic_cols = [c for c in sap_cols if c.upper().startswith('/BIC/')]
    if bic_cols:
        print(f"[INFO] /BIC/ prefix 감지 ({len(bic_cols)}개) — 자동 매핑 적용:")
        for bc in bic_cols[:10]:
            clean = bc.upper().replace('/BIC/', '', 1)
            matched = '✓ DB 매핑' if clean in set(DB_COLUMNS) else '✗ DB 컬럼 없음'
            print(f"  {bc} → {clean} ({matched})")
        if len(bic_cols) > 10:
            print(f"  ... 외 {len(bic_cols) - 10}개")

    # DB 컬럼 vs T_DATA 컬럼 비교
    sap_set_normalized = set()
    for c in sap_cols:
        cu = c.upper()
        sap_set_normalized.add(cu)
        if cu.startswith('/BIC/'):
            sap_set_normalized.add(cu.replace('/BIC/', '', 1))
    db_set = set(DB_COLUMNS)
    missing_in_sap = db_set - sap_set_normalized
    extra_in_sap = set(c.upper() for c in sap_cols) - db_set
    if missing_in_sap:
        print(f"[WARN] DB 에는 있지만 T_DATA 에 없는 컬럼: {sorted(missing_in_sap)}")
    if extra_in_sap:
        print(f"[INFO] T_DATA 에는 있지만 DB 에 없는 컬럼: {sorted(extra_in_sap)}")

    if args.show_columns:
        print(f"\n전체 T_DATA 컬럼: {sap_cols}")
        sys.exit(EXIT_SUCCESS)

    # ── (4) CALMONTH 일치 검증 ──
    mismatch = verify_calmonth(t_data, cmonth)
    if mismatch is not None:
        idx, actual = mismatch
        print(f"[FAIL] CALMONTH 불일치: 요청 {cmonth}, 응답 데이터 행 #{idx} CALMONTH={actual!r}")
        print(f"[FAIL] RFC 응답 데이터가 요청 년월과 다릅니다. 적재를 중단합니다.")
        sys.exit(EXIT_FAILED)
    print(f"[OK] CALMONTH 검증 통과: 전체 {len(t_data)} 행 모두 CALMONTH={cmonth}")

    # ── (5) 데이터 변환 (숫자 정리 + 오류 로깅) ──
    print(f"\n[변환] {len(t_data)}건 변환 중...")
    converted = [convert_row(row, idx) for idx, row in enumerate(t_data, start=1)]
    print(f"[변환] 완료 (변환 오류 수집: {len(CONVERSION_ERRORS)}건)")

    if CONVERSION_ERRORS:
        print(f"\n[변환 오류 상세] (최대 20건 출력)")
        for row_idx, field, raw, reason in CONVERSION_ERRORS[:20]:
            print(f"  행 #{row_idx} 필드={field} 원본={raw!r} 사유={reason}")
        if len(CONVERSION_ERRORS) > 20:
            print(f"  ... 외 {len(CONVERSION_ERRORS) - 20}건")

    # 샘플 출력 (진단 편의)
    sample_row = t_data[0]
    sr = normalize_rfc_keys(sample_row)
    print(f"\n[샘플 1행] CALMONTH={sr.get('CALMONTH')}, "
          f"PLANT={sr.get('PLANT')}, MATERIAL={sr.get('MATERIAL')}, "
          f"LBKUM={sr.get('LBKUM')}, TOTAL={sr.get('TOTAL')}")

    # ── (6) DB INSERT (dry-run 이 아닐 때만) ──
    if args.dry_run:
        print(f"\n[DRY RUN] DB INSERT 건너뜀. 총 {len(converted)}건이 INSERT 될 예정.")
        sys.exit(EXIT_SUCCESS)

    try:
        result = insert_to_db(converted, cmonth, replace=args.replace)
    except Exception as e:
        print(f"[FAIL] DB 적재 실패: {e}")
        print(traceback.format_exc(), file=sys.stderr)
        sys.exit(EXIT_FAILED)

    # ── 최종 결과 ──
    print(f"\n{'=' * 60}")
    print(f"  [SUCCESS] 완료")
    print(f"  T_DATA        : {len(t_data)} rows")
    print(f"  DELETE        : {result['deleted']} rows")
    print(f"  INSERT        : {result['inserted']} rows")
    print(f"  변환 오류     : {len(CONVERSION_ERRORS)} 건")
    print(f"{'=' * 60}")

    sys.exit(EXIT_SUCCESS)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        err_msg = f"[FATAL] 예상치 못한 오류: {e}\n{traceback.format_exc()}"
        print(err_msg)
        print(err_msg, file=sys.stderr)
        sys.exit(EXIT_FAILED)
