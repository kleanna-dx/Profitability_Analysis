#!/usr/bin/env python3
"""
sap_rfc_sync_mfg_cost.py 유닛 테스트 (pyrfc / MariaDB 미필요)

검증 대상:
  1. normalize_rfc_keys  — /BIC/ prefix 자동 제거
  2. clean_numeric       — 공백 / 천 단위 쉼표 / 부호 후행 / 형식 오류
  3. convert_row         — T_DATA 한 행 → DB tuple (35 컬럼 순서)
  4. verify_calmonth     — 요청 년월과 응답 CALMONTH 불일치 감지
  5. CONVERSION_ERRORS   — 필드/원본/행번호 기록

사용법:
  python3 _test_sap_rfc_sync_mfg_cost.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

import sap_rfc_sync_mfg_cost as mod

PASS = 0
FAIL = 0

def assert_eq(actual, expected, name):
    global PASS, FAIL
    if actual == expected:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name}")
        print(f"         expected: {expected!r}")
        print(f"         actual:   {actual!r}")


# ── 테스트 1: normalize_rfc_keys ──
print("\n[TEST 1] normalize_rfc_keys — /BIC/ prefix 자동 제거")
row = {
    'CALMONTH': '202606',
    '/BIC/ZCGUBUN': '변동',
    '/BIC/ZCGUBUN_D': '표준',
    'plant': '1000',  # lower case 도 upper 로 정규화
}
n = mod.normalize_rfc_keys(row)
assert_eq(n.get('CALMONTH'), '202606', 'CALMONTH 원본 그대로')
assert_eq(n.get('ZCGUBUN'), '변동', '/BIC/ZCGUBUN → ZCGUBUN')
assert_eq(n.get('ZCGUBUN_D'), '표준', '/BIC/ZCGUBUN_D → ZCGUBUN_D')
assert_eq(n.get('PLANT'), '1000', 'lowercase key uppercased')


# ── 테스트 2: clean_numeric ──
print("\n[TEST 2] clean_numeric — 공백/쉼표/부호 후행/형식 오류 정리")
mod.CONVERSION_ERRORS.clear()
assert_eq(mod.clean_numeric('  1,234,567  ', 'TOTAL', 1), 1234567, '천 단위 쉼표 + 공백')
assert_eq(mod.clean_numeric('999-', 'TOTAL', 2), -999, 'SAP 후행 부호 (999- → -999)')
assert_eq(mod.clean_numeric('', 'TOTAL', 3), 0, '빈 문자열 → 0')
assert_eq(mod.clean_numeric(None, 'TOTAL', 4), 0, 'None → 0')
assert_eq(mod.clean_numeric('100.6', 'TOTAL', 5), 101, 'BIGINT 반올림 (100.6 → 101)')
assert_eq(mod.clean_numeric('100.5', 'LBKUM', 6), 100.5, 'DECIMAL 소수 유지 (LBKUM)')
# 형식 오류 → 0 반환 + CONVERSION_ERRORS 에 기록
assert_eq(mod.clean_numeric('ABC', 'TOTAL', 7), 0, '형식 오류 → 0')
assert_eq(len(mod.CONVERSION_ERRORS), 1, '변환 오류 1건 기록됨')
assert_eq(mod.CONVERSION_ERRORS[0][0], 7, '오류 행 번호 = 7')
assert_eq(mod.CONVERSION_ERRORS[0][1], 'TOTAL', '오류 필드 = TOTAL')
assert_eq(mod.CONVERSION_ERRORS[0][2], 'ABC', '오류 원본 값 = "ABC"')


# ── 테스트 3: convert_row ──
print("\n[TEST 3] convert_row — T_DATA 한 행 → DB tuple (35 컬럼)")
mod.CONVERSION_ERRORS.clear()
sap_row = {
    'CALMONTH': '202606',
    'PLANT': '1000',
    'PLANT_NM': '  광주공장  ',
    'MATERIAL': 'M0001',
    'MATERIAL_NM': '테스트자재',
    '/BIC/ZCGUBUN_D': '표준',
    '/BIC/ZCGUBUN': '변동',
    'BASE_UOM': 'EA',
    'LBKUM': '100.123',
    'CURRENCY': 'KRW',
    'TOTAL': '1,234,567',
    'KST_V': '500-',
    'KST_F': '',
    'KST001': None,
    'TOTAL1': '999.9',
}
result = mod.convert_row(sap_row, 1)
assert_eq(len(result), 35, 'tuple 길이 = 35 (seq 제외)')
# DB_COLUMNS 순서와 일치하는지 확인 (앞 몇 개만 검증)
idx = {name: i for i, name in enumerate(mod.DB_COLUMNS)}
assert_eq(result[idx['CALMONTH']], '202606', 'CALMONTH')
assert_eq(result[idx['PLANT']], '1000', 'PLANT')
assert_eq(result[idx['PLANT_NM']], '광주공장', 'PLANT_NM (strip)')
assert_eq(result[idx['ZCGUBUN']], '변동', 'ZCGUBUN (BIC prefix 제거)')
assert_eq(result[idx['ZCGUBUN_D']], '표준', 'ZCGUBUN_D (BIC prefix 제거)')
assert_eq(result[idx['LBKUM']], 100.123, 'LBKUM 소수 3자리 유지')
assert_eq(result[idx['TOTAL']], 1234567, 'TOTAL 쉼표 제거 후 int')
assert_eq(result[idx['KST_V']], -500, 'KST_V 후행 부호')
assert_eq(result[idx['KST_F']], 0, 'KST_F 빈 문자열 → 0')
assert_eq(result[idx['KST001']], 0, 'KST001 None → 0')
assert_eq(result[idx['TOTAL1']], 1000, 'TOTAL1 반올림 999.9 → 1000 (int(round(...)))')


# ── 테스트 4: verify_calmonth ──
print("\n[TEST 4] verify_calmonth — 요청 년월과 응답 CALMONTH 불일치 감지")
t_data_ok = [
    {'CALMONTH': '202606', 'PLANT': '1000'},
    {'CALMONTH': '202606', 'PLANT': '2000'},
]
assert_eq(mod.verify_calmonth(t_data_ok, '202606'), None, '모두 일치 → None')

t_data_mismatch = [
    {'CALMONTH': '202606', 'PLANT': '1000'},
    {'CALMONTH': '202605', 'PLANT': '2000'},   # 다른 월
    {'CALMONTH': '202606', 'PLANT': '3000'},
]
result = mod.verify_calmonth(t_data_mismatch, '202606')
assert_eq(result, (2, '202605'), '2번째 행에서 202605 불일치 감지')

# CALMONTH 필드 자체가 없거나 공백인 경우
t_data_empty = [{'CALMONTH': '', 'PLANT': '1000'}]
result = mod.verify_calmonth(t_data_empty, '202606')
assert_eq(result, (1, ''), '빈 CALMONTH → 불일치')


# ── 테스트 5: DB_COLUMNS 스키마 정합성 (35개 컬럼, 순서) ──
print("\n[TEST 5] DB_COLUMNS 정합성")
assert_eq(len(mod.DB_COLUMNS), 35, 'DB_COLUMNS 개수 = 35 (seq 제외)')
assert_eq(mod.DB_COLUMNS[0], 'CALMONTH', '첫 컬럼 = CALMONTH')
assert_eq(mod.DB_COLUMNS[-1], 'TOTAL2', '마지막 컬럼 = TOTAL2')
# seq 는 절대 DB_COLUMNS 에 없어야 함
assert_eq('seq' in [c.lower() for c in mod.DB_COLUMNS], False, 'seq 는 DB_COLUMNS 에 없음 (AUTO_INCREMENT)')
# 중복 없음
assert_eq(len(set(mod.DB_COLUMNS)), len(mod.DB_COLUMNS), '중복 컬럼 없음')


# ── 테스트 6: 상수 격리 (수익성 sap_rfc_sync.py 와의 분리 확인) ──
print("\n[TEST 6] 수익성 로직과의 분리")
assert_eq(mod.RFC_FUNCTION, 'Z_BI_WEB_EX_BL_4', 'RFC_FUNCTION = Z_BI_WEB_EX_BL_4 (Z_BI_WEB_EX_BL 아님)')
assert_eq(mod.TABLE_NAME, 'sys_aimd_cot015', 'TABLE_NAME = sys_aimd_cot015 (bw_profitability_data 아님)')
assert_eq(mod.INTERFACE_ID, 'NLP_RFC_002', 'INTERFACE_ID = NLP_RFC_002')
# NUMERIC_COLUMNS 에 ZAMT001~ZAMT064 같은 수익성 필드가 섞여있지 않아야 함
zamt_leak = [c for c in mod.NUMERIC_COLUMNS if c.startswith('ZAMT')]
assert_eq(zamt_leak, [], '수익성 ZAMT* 필드가 제조원가 NUMERIC_COLUMNS 에 섞이지 않음')


# ── 테스트 7: NO_DATA vs SUCCESS vs FAILED exit code ──
print("\n[TEST 7] Exit code 규약 (수익성 상태값과 동일 체계)")
assert_eq(mod.EXIT_SUCCESS, 0, 'EXIT_SUCCESS = 0')
assert_eq(mod.EXIT_FAILED, 1, 'EXIT_FAILED = 1')
assert_eq(mod.EXIT_NO_DATA, 2, 'EXIT_NO_DATA = 2 (T_DATA 비어있을 때)')


# ── 결과 ──
print()
print("=" * 60)
if FAIL == 0:
    print(f"  ✅ ALL PASS ({PASS}건)")
    sys.exit(0)
else:
    print(f"  ❌ FAIL {FAIL}건 / PASS {PASS}건")
    sys.exit(1)
