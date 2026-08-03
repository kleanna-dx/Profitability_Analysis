#!/usr/bin/env python3
"""
sys_aimd_cot015 실제 DB 시나리오 테스트 (pyrfc 미필요, MariaDB 사용).

검증 시나리오 (사용자 요구사항 9개 중 로컬 DB 만으로 검증 가능한 것):
  3) sys_aimd_cot015 적재 데이터 vs 가짜 T_DATA 비교
  4) seq 자동 생성 확인
  5) 동일 년월 재실행 시 중복 적재 방지 (트랜잭션 DELETE+INSERT)
  6/7) 실제 배치이력(batch_jobs) 은 별도 API 검증 (여기서는 데이터 무결성만)

시나리오 1/2 (실제 RFC 호출) 는 pyrfc + SAP 접근이 필요하여 로컬 sandbox에서 불가.
시나리오 8/9 (NO_DATA, 실패 상태) 는 유닛 테스트에서 이미 검증 (exit code 2).

로컬 DB: mysql -h localhost -u company -pcompany1234! company_board
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
import sap_rfc_sync_mfg_cost as mod

# 로컬 DB 로 override (실제 스크립트의 DB_CONFIG 는 운영 서버용)
mod.DB_CONFIG = {
    'host': 'localhost',
    'port': 3306,
    'user': 'company',
    'password': 'company1234!',
    'database': 'company_board',
    'charset': 'utf8mb4',
}

import pymysql

PASS = 0
FAIL = 0

def assert_eq(actual, expected, name):
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}: expected={expected!r} actual={actual!r}")


# ── 가짜 T_DATA (Z_BI_WEB_EX_BL_4 응답을 시뮬레이션) ──
def make_fake_tdata(cmonth='202606', n_rows=3):
    rows = []
    for i in range(n_rows):
        rows.append({
            'CALMONTH': cmonth,
            'PLANT': f'{1000 + i}',
            'PLANT_NM': f'공장{i+1}',
            'MATERIAL': f'M{i:05d}',
            'MATERIAL_NM': f'자재명{i+1}',
            '/BIC/ZCGUBUN_D': '표준',
            '/BIC/ZCGUBUN': '변동',
            'BASE_UOM': 'EA',
            'LBKUM': f'{100.123 * (i+1):.3f}',
            'CURRENCY': 'KRW',
            'TOTAL': f'{1000000 * (i+1):,}',    # 천 단위 쉼표
            'KST_V': f'{500 * (i+1)}-' if i == 0 else f'{500 * (i+1)}',  # 첫 행에 후행부호
            'KST_F': '',                          # 빈 문자열
            'KST001': '  1,000  ',                # 공백 + 쉼표
            'TOTAL1': '999.9',
            'TOTAL2': None,
        })
    return rows


# ── 준비: 테이블 클리어 (테스트 시작 전 202606 데이터 정리) ──
print("[SETUP] 테스트 시작 전 CALMONTH=202606 정리")
conn = pymysql.connect(**mod.DB_CONFIG)
cur = conn.cursor()
cur.execute("DELETE FROM sys_aimd_cot015 WHERE CALMONTH = '202606'")
conn.commit()
cur.close()
conn.close()


# ── 시나리오 4: seq 자동 생성 확인 ──
print("\n[시나리오 4] seq 자동 생성 확인")
t_data = make_fake_tdata('202606', 3)
converted = [mod.convert_row(r, i+1) for i, r in enumerate(t_data)]
result = mod.insert_to_db(converted, '202606', replace=True)
assert_eq(result['inserted'], 3, '3행 INSERT')
assert_eq(result['deleted'], 0, 'DELETE 0행 (첫 적재라 기존 없음)')

# seq 가 실제로 자동 생성되었는지 DB 에서 확인
conn = pymysql.connect(**mod.DB_CONFIG)
cur = conn.cursor()
cur.execute("SELECT seq, CALMONTH, PLANT, MATERIAL, LBKUM, TOTAL, KST_V, KST_F, KST001 "
            "FROM sys_aimd_cot015 WHERE CALMONTH = '202606' ORDER BY seq ASC")
rows = cur.fetchall()
assert_eq(len(rows), 3, 'DB 에 3행 조회됨')
seqs = [r[0] for r in rows]
assert_eq(len(set(seqs)), 3, 'seq 3개 모두 서로 다름 (AUTO_INCREMENT)')
assert_eq(seqs[1] - seqs[0], 1, 'seq 연속 증가 (1씩)')
print(f"    seq 실제 생성값: {seqs}")


# ── 시나리오 3: T_DATA vs DB 적재 데이터 필드 매핑 검증 ──
print("\n[시나리오 3] T_DATA vs DB 적재 데이터 비교")
# 첫 행 (PLANT=1000) 검증
first = rows[0]
_, calmonth, plant, material, lbkum, total, kst_v, kst_f, kst001 = first
assert_eq(calmonth, '202606', 'CALMONTH 저장 정확')
assert_eq(plant, '1000', 'PLANT 저장 정확')
assert_eq(material, 'M00000', 'MATERIAL 저장 정확')
assert_eq(float(lbkum), 100.123, 'LBKUM 소수 3자리 유지 (100.123)')
assert_eq(int(total), 1000000, 'TOTAL 천단위 쉼표 제거 후 저장 (1000000)')
assert_eq(int(kst_v), -500, 'KST_V 후행 부호 처리 (500- → -500)')
assert_eq(kst_f, 0, 'KST_F 빈 문자열 → 0')
assert_eq(int(kst001), 1000, 'KST001 공백+쉼표 제거 (  1,000   → 1000)')
cur.close()
conn.close()


# ── 시나리오 5: 동일 년월 재실행 시 중복 방지 (트랜잭션 DELETE + INSERT) ──
print("\n[시나리오 5] 동일 CALMONTH 재적재 시 중복 방지")
# 5행짜리 새 T_DATA 로 다시 적재
t_data2 = make_fake_tdata('202606', 5)
converted2 = [mod.convert_row(r, i+1) for i, r in enumerate(t_data2)]
result2 = mod.insert_to_db(converted2, '202606', replace=True)
assert_eq(result2['inserted'], 5, '재적재 5행 INSERT')
assert_eq(result2['deleted'], 3, '기존 3행 DELETE (트랜잭션 내 원자적)')

# 최종 DB 상태 확인 — 총 5행만 있어야 (3+5=8 아님)
conn = pymysql.connect(**mod.DB_CONFIG)
cur = conn.cursor()
cur.execute("SELECT COUNT(*) FROM sys_aimd_cot015 WHERE CALMONTH = '202606'")
cnt = cur.fetchone()[0]
assert_eq(cnt, 5, '최종 DB 에 5행만 존재 (재적재 후 이전 데이터 없음)')

# 다른 CALMONTH 데이터는 영향받지 않는지 확인 — 202605 로 별개 적재
cur.execute("DELETE FROM sys_aimd_cot015 WHERE CALMONTH = '202605'")
conn.commit()
cur.close()
conn.close()

t_data_may = make_fake_tdata('202605', 2)
converted_may = [mod.convert_row(r, i+1) for i, r in enumerate(t_data_may)]
mod.insert_to_db(converted_may, '202605', replace=True)

# 이제 202606 다시 재적재 — 202605 데이터는 그대로 있어야
t_data_jun = make_fake_tdata('202606', 4)
converted_jun = [mod.convert_row(r, i+1) for i, r in enumerate(t_data_jun)]
mod.insert_to_db(converted_jun, '202606', replace=True)

conn = pymysql.connect(**mod.DB_CONFIG)
cur = conn.cursor()
cur.execute("SELECT CALMONTH, COUNT(*) FROM sys_aimd_cot015 "
            "WHERE CALMONTH IN ('202605','202606') GROUP BY CALMONTH ORDER BY CALMONTH")
by_month = {r[0]: r[1] for r in cur.fetchall()}
assert_eq(by_month.get('202605'), 2, '202605 데이터 2행 유지 (202606 재적재 영향 없음)')
assert_eq(by_month.get('202606'), 4, '202606 재적재 후 4행만 존재')
cur.close()
conn.close()


# ── 시나리오 8 (부분): NO_DATA 상태 시뮬레이션 ──
print("\n[시나리오 8] NO_DATA 처리 (실제 스크립트의 EXIT_NO_DATA 사용)")
# 스크립트의 main 을 직접 호출하지 않고, T_DATA 비어있을 때의 흐름만 확인.
# 실제 스크립트에서 T_DATA 가 [] 면 sys.exit(EXIT_NO_DATA=2) 로 종료.
assert_eq(mod.EXIT_NO_DATA, 2, 'EXIT_NO_DATA = 2 (정상 성공과 구분)')
assert_eq(mod.EXIT_SUCCESS, 0, 'EXIT_SUCCESS = 0')
assert_eq(mod.EXIT_FAILED, 1, 'EXIT_FAILED = 1')


# ── 정리 (테스트 데이터 제거) ──
print("\n[TEARDOWN] 테스트 데이터 정리")
conn = pymysql.connect(**mod.DB_CONFIG)
cur = conn.cursor()
cur.execute("DELETE FROM sys_aimd_cot015 WHERE CALMONTH IN ('202605','202606')")
conn.commit()
cur.execute("SELECT COUNT(*) FROM sys_aimd_cot015 WHERE CALMONTH IN ('202605','202606')")
after = cur.fetchone()[0]
assert_eq(after, 0, '테스트 데이터 완전 정리됨')
cur.close()
conn.close()


# ── 결과 ──
print()
print("=" * 60)
if FAIL == 0:
    print(f"  ✅ ALL PASS ({PASS}건)")
    sys.exit(0)
else:
    print(f"  ❌ FAIL {FAIL}건 / PASS {PASS}건")
    sys.exit(1)
