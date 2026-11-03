// ============================================================
// test_builder_total_sum_dependency.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #554, 2026-11-02):
//   "원가 합계금액"(TOTAL), "변동비 합계"(KST_V), "고정비 합계"(KST_F)
//   3개 컬럼에도 아래 2가지 적용:
//     1) 집계 드롭박스(원본/SUM/MAX) 숨김 + SUM 뱃지 제거
//     2) 더블클릭 시 아래 순서로 조회필드 자동 셋팅:
//        CALMONTH → PLANT → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN → [자신]
//
// 설계:
//   PR #550 (TOTAL1/TOTAL2) 와 완전 동일 패턴 — 뒤쪽 dependency 없음.
//   addField 로직 변경 없이 상수 2곳에 각 3개씩 추가만 하면 됨.
//
//   앞쪽 dependency: MFG_COLUMN_FIELD_DEPENDENCIES['TOTAL']  = _MFG_COST_ELEMENT_DEPS
//                   MFG_COLUMN_FIELD_DEPENDENCIES['KST_V'] = _MFG_COST_ELEMENT_DEPS
//                   MFG_COLUMN_FIELD_DEPENDENCIES['KST_F'] = _MFG_COST_ELEMENT_DEPS
//   SUM 뱃지 제거:   _MFG_FIXED_AGG_COLUMNS 에 'TOTAL', 'KST_V', 'KST_F' 추가
//
// DB 스키마 (sql/043_create_sys_aimd_cot015.sql):
//   TOTAL   BIGINT       COMMENT '합계금액 (CURR 17,2 → BIGINT)'
//   KST_V   BIGINT       COMMENT '변동비 합계 (CURR 17,2 → BIGINT)'
//   KST_F   BIGINT       COMMENT '고정비 합계 (CURR 17,2 → BIGINT)'
//
// 영역 격리:
//   - 제조원가 (manufacturing-cost) 영역만 적용 (기존 addField _isMfgArea 가드 재사용)
//   - 수익성분석 (profitability) 영역: 공통 상수 미참조 + 영역 가드 → 완전 무영향
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '../public/builder.html');
const htmlSrc = readFileSync(HTML_PATH, 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, msg) {
    if (cond) { PASS++; }
    else { FAIL++; failures.push(msg); console.log('FAIL:', msg); }
}
function assertMatch(src, re, msg) {
    const ok = re.test(src);
    if (ok) { PASS++; }
    else { FAIL++; failures.push(`${msg}\n  regex: ${re}`); console.log('FAIL:', msg, '\n  regex:', re); }
}

// ============================================================
// 1. MFG_COLUMN_FIELD_DEPENDENCIES 에 TOTAL/KST_V/KST_F 추가 (앞쪽 5개 dep)
// ============================================================

const TOTAL_SUM_COLS = [
    { name: 'TOTAL',  label: '원가 합계금액 / 합계금액' },
    { name: 'KST_V',  label: '변동비 합계' },
    { name: 'KST_F',  label: '고정비 합계' },
];

TOTAL_SUM_COLS.forEach((col, i) => {
    // 1-N-a: MFG_COLUMN_FIELD_DEPENDENCIES[col] = _MFG_COST_ELEMENT_DEPS 매핑
    assertMatch(htmlSrc,
        new RegExp(`MFG_COLUMN_FIELD_DEPENDENCIES[\\s\\S]{0,4000}['"]${col.name}['"]\\s*:\\s*_MFG_COST_ELEMENT_DEPS`),
        `1-${i+1}-a: MFG_COLUMN_FIELD_DEPENDENCIES['${col.name}'] = _MFG_COST_ELEMENT_DEPS 매핑됨 (${col.label})`);
});

// 1-4: 추가 지점 근처에 PR #554 설계 메모 (사용자 요청 순서 명시)
assertMatch(htmlSrc,
    /MFG_COLUMN_FIELD_DEPENDENCIES[\s\S]{0,4500}(PR #554|\ud569\uacc4 \uae08\uc561 3\uac1c)/,
    '1-4: MFG_COLUMN_FIELD_DEPENDENCIES 에 PR #554 / 합계 금액 3개 추가 주석');

// ============================================================
// 2. _MFG_FIXED_AGG_COLUMNS 에 TOTAL/KST_V/KST_F 추가 (SUM 뱃지 제거)
// ============================================================

TOTAL_SUM_COLS.forEach((col, i) => {
    // 2-N: _MFG_FIXED_AGG_COLUMNS Set 안에 col.name 포함
    assertMatch(htmlSrc,
        new RegExp(`_MFG_FIXED_AGG_COLUMNS\\s*=\\s*new\\s+Set\\s*\\(\\s*\\[[\\s\\S]{0,3000}['"]${col.name}['"]`),
        `2-${i+1}: _MFG_FIXED_AGG_COLUMNS Set 에 '${col.name}' 추가됨 (${col.label} — SUM 고정+뱃지 제거)`);
});

// 2-4: 추가 지점 근처에 PR #554 설계 메모 (사용자 요청 순서 명시)
const _aggIdx = htmlSrc.indexOf('_MFG_FIXED_AGG_COLUMNS');
const _aggSrc = _aggIdx >= 0 ? htmlSrc.substring(_aggIdx, _aggIdx + 2500) : '';
assertMatch(_aggSrc,
    /PR #554|\ud569\uacc4 \uae08\uc561 3\uac1c/,
    '2-4: _MFG_FIXED_AGG_COLUMNS 에 PR #554 / 합계 금액 3개 추가 주석');

// ============================================================
// 3. 공통 상수 재사용 (DRY) — PR #550 패턴과 완전 통일
// ============================================================

// 3-1 [v5]: _MFG_COST_ELEMENT_DEPS 공통 상수 순서 보존 (CALMONTH → PLANT → MATERIAL → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN)
//            v5 (2026-11-03) 사용자 요구: MATERIAL 추가 (MATERIAL_NM 앞)
assertMatch(htmlSrc,
    /_MFG_COST_ELEMENT_DEPS\s*=\s*\[\s*['"]CALMONTH['"]\s*,\s*['"]PLANT['"]\s*,\s*['"]MATERIAL['"]\s*,\s*['"]MATERIAL_NM['"]\s*,\s*['"]ZCGUBUN_D['"]\s*,\s*['"]ZCGUBUN['"]\s*\]/,
    '3-1 [v5]: _MFG_COST_ELEMENT_DEPS 공통 상수 순서 보존 (CALMONTH → PLANT → MATERIAL → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN) — v5 사용자 요구: MATERIAL 추가');

// ============================================================
// 4. 영역 격리 — 수익성분석 완전 무영향 재검증 (기존 addField 로직 재사용)
// ============================================================

// 4-1: addField 함수 안의 _isMfgArea 영역 가드 존재 — 공통 상수 참조는 addField 내부에서만
const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '4-1a: addField(colName) 함수 블록 추출됨');
const addFieldSrc = addFieldMatch ? addFieldMatch[0] : '';

assertMatch(addFieldSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"]/,
    '4-1b: addField 안에 _currentBuilderArea() === "manufacturing-cost" 영역 가드 존재');

// 4-2: TOTAL/KST_V/KST_F 는 MFG_COLUMN_FIELD_DEPENDENCIES 를 통해서만 dependency 처리됨
//      → addField 안의 _isMfgArea && MFG_COLUMN_FIELD_DEPENDENCIES[colName] 체크
assertMatch(addFieldSrc,
    /MFG_COLUMN_FIELD_DEPENDENCIES\s*\[\s*colName\s*\]/,
    '4-2: addField 안에서 MFG_COLUMN_FIELD_DEPENDENCIES[colName] 조회 (기존 로직 재사용)');

// ============================================================
// 5. 기존 상수 보존 (PR #553 까지의 23개 FIXED_AGG + 23개 DEPENDENCIES 안 깨짐)
// ============================================================

// 5-1: 기존 TOTAL1/TOTAL2/LBKUM 매핑 유지 (PR #550/#553 보존)
['TOTAL1', 'TOTAL2', 'LBKUM'].forEach((kept, i) => {
    assertMatch(htmlSrc,
        new RegExp(`MFG_COLUMN_FIELD_DEPENDENCIES[\\s\\S]{0,4000}['"]${kept}['"]\\s*:\\s*_MFG_COST_ELEMENT_DEPS`),
        `5-1-${i+1}: 기존 MFG_COLUMN_FIELD_DEPENDENCIES['${kept}'] 매핑 보존 (PR #550/#553 보존)`);
});

// 5-2: 기존 KST001~KST039 20개 매핑 유지 (sampling 으로 확인)
['KST001', 'KST020', 'KST039'].forEach((kst) => {
    if (kst === 'KST020') return;  // KST020 은 실제로 없음 (KST019 다음 KST021)
});
['KST001', 'KST019', 'KST039'].forEach((kst, i) => {
    assertMatch(htmlSrc,
        new RegExp(`MFG_COLUMN_FIELD_DEPENDENCIES[\\s\\S]{0,4000}['"]${kst}['"]\\s*:\\s*_MFG_COST_ELEMENT_DEPS`),
        `5-2-${i+1}: 기존 MFG_COLUMN_FIELD_DEPENDENCIES['${kst}'] 매핑 보존 (PR #546 보존)`);
});

// 5-3: 기존 _MFG_FIXED_AGG_COLUMNS 안의 TOTAL1/TOTAL2/LBKUM 보존
['TOTAL1', 'TOTAL2', 'LBKUM'].forEach((kept, i) => {
    assertMatch(_aggSrc,
        new RegExp(`['"]${kept}['"]`),
        `5-3-${i+1}: _MFG_FIXED_AGG_COLUMNS 안에 '${kept}' 보존 (PR #548/#549/#553 보존)`);
});

// ============================================================
// 6. 사용자 요구 순서 재검증 (문서화 성격) + 뒤쪽 dependency 없음 확인
// ============================================================

// 6-1: PR #554 블록에 사용자 명시 순서 기록 (CALMONTH → PLANT → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN → [자신])
assertMatch(htmlSrc,
    /PR #554[\s\S]{0,800}CALMONTH\s*(→|->|-->)\s*PLANT\s*(→|->|-->)\s*MATERIAL_NM\s*(→|->|-->)\s*ZCGUBUN_D\s*(→|->|-->)\s*ZCGUBUN/,
    '6-1: PR #554 주석에 사용자 명시 순서 기록 (CALMONTH → PLANT → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN → [자신])');

// 6-2: TOTAL/KST_V/KST_F 는 MFG_COLUMN_FIELD_POST_DEPENDENCIES 에 키 없음 (뒤쪽 dependency 없음 — LBKUM 과 다른 점)
['TOTAL', 'KST_V', 'KST_F'].forEach((col, i) => {
    const re = new RegExp(`MFG_COLUMN_FIELD_POST_DEPENDENCIES\\s*=\\s*\\{[\\s\\S]{0,500}['"]${col}['"]\\s*:`);
    const found = re.test(htmlSrc);
    assert(!found,
        `6-2-${i+1}: MFG_COLUMN_FIELD_POST_DEPENDENCIES 에 '${col}' 키 없음 (뒤쪽 dependency 없음 — LBKUM/BASE_UOM 특수 케이스와 분리)`);
});

// ============================================================
// 결과 출력
// ============================================================
console.log('');
console.log('==================================================');
console.log(`BUILDER TOTAL SUM DEPENDENCY TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
