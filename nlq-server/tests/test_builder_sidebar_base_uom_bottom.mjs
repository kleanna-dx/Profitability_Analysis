// ============================================================
// test_builder_sidebar_base_uom_bottom.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #557, 2026-11-02):
//   "기본 단위(BASE_UOM)" 필드도 사이드바 "맨 밑"으로 이동 (제조원가만).
//
// 배경 (PR #555/#556 보완):
//   PR #555: CURRENCY 를 category=other 로 override (사이드바 섹션 맨 하단)
//   PR #556: CURRENCY 를 '기타' 섹션 안에서도 맨 뒤로 재정렬
//   PR #557 (이번): BASE_UOM 도 동일하게 '기타' 섹션으로 이동 + 맨 뒤 그룹에 포함.
//
// 최종 "기타" 섹션 순서 (사용자 Q(a) 디폴트):
//   1. 현재월 표준가 (TOTAL1)   ← normalFields
//   2. 이전월 표준가 (TOTAL2)   ← normalFields
//   3. 기본 단위 (BASE_UOM)     ← endFields (DB 스키마 54번, CURRENCY 앞)
//   4. 통화 코드 (CURRENCY)     ← endFields (DB 스키마 56번, BASE_UOM 뒤)
//
// DB 스키마 (sql/043_create_sys_aimd_cot015.sql):
//   54: BASE_UOM  VARCHAR(3)  '기본 단위 (UNIT 3)'
//   55: LBKUM     DECIMAL(17,3)
//   56: CURRENCY  VARCHAR(5)  '통화 (CUKY 5)'
//   → allColumns 서버 응답 순서상 BASE_UOM 이 CURRENCY 앞에 옴
//   → endFields 안에서도 입력 순서 유지되므로 사용자 요구 순서 자동 충족
//
// 영역 격리:
//   - 제조원가 (manufacturing-cost) 영역만 적용 (_isMfgArea 가드)
//   - 수익성분석 (profitability) 영역: 완전 무영향
//
// 자동 추가 로직 보존:
//   - PR #553 에서 LBKUM 더블클릭 시 BASE_UOM 이 뒤에 자동 추가되는 POST dependency 유지
//   - 사이드바 UI 위치만 변경 — allColumns 자체는 변경 없음 → MFG_COLUMN_FIELD_POST_DEPENDENCIES 로직 100% 보존
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

// renderFieldList 함수 블록 추출
const rflMatch = htmlSrc.match(/function\s+renderFieldList\s*\(\s*cols\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!rflMatch, '0-1: renderFieldList(cols) 함수 블록 추출됨');
const rflSrc = rflMatch ? rflMatch[0] : '';

// ============================================================
// 1. _MFG_SIDEBAR_CATEGORY_OVERRIDE 에 BASE_UOM 추가
// ============================================================

// 1-1: CATEGORY_OVERRIDE 안에 BASE_UOM: 'other' 매핑
assertMatch(rflSrc,
    /_MFG_SIDEBAR_CATEGORY_OVERRIDE\s*=\s*\{[\s\S]{0,500}['"]BASE_UOM['"]\s*:\s*['"]other['"]/,
    "1-1: _MFG_SIDEBAR_CATEGORY_OVERRIDE['BASE_UOM'] = 'other' 추가 (사이드바 '기타' 섹션으로 이동)");

// 1-2: 기존 CURRENCY: 'other' 매핑 보존 (PR #555)
assertMatch(rflSrc,
    /_MFG_SIDEBAR_CATEGORY_OVERRIDE\s*=\s*\{[\s\S]{0,500}['"]CURRENCY['"]\s*:\s*['"]other['"]/,
    "1-2: 기존 _MFG_SIDEBAR_CATEGORY_OVERRIDE['CURRENCY'] = 'other' 보존 (PR #555)");

// 1-3: PR #557 설계 메모
assertMatch(rflSrc,
    /PR #557[\s\S]{0,500}(BASE_UOM|\uae30\ubcf8 \ub2e8\uc704|\ub9e8 \ubc11)/,
    '1-3: PR #557 설계 메모 (BASE_UOM / 기본 단위 / 맨 밑)');

// ============================================================
// 2. _MFG_SIDEBAR_SECTION_END_FIELDS 에 BASE_UOM 추가
// ============================================================

// 2-1: Set 안에 'BASE_UOM' 포함
assertMatch(rflSrc,
    /_MFG_SIDEBAR_SECTION_END_FIELDS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,500}['"]BASE_UOM['"]/,
    "2-1: _MFG_SIDEBAR_SECTION_END_FIELDS Set 에 'BASE_UOM' 추가 ('기타' 섹션 안 맨 뒤 그룹)");

// 2-2: 기존 'CURRENCY' 보존 (PR #556)
assertMatch(rflSrc,
    /_MFG_SIDEBAR_SECTION_END_FIELDS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,500}['"]CURRENCY['"]/,
    "2-2: 기존 _MFG_SIDEBAR_SECTION_END_FIELDS 안 'CURRENCY' 보존 (PR #556)");

// 2-3: BASE_UOM 과 CURRENCY 모두 Set 안에 있는지 — Set 사용 패턴 확인
const sefMatch = rflSrc.match(/_MFG_SIDEBAR_SECTION_END_FIELDS\s*=\s*new\s+Set\s*\(\s*\[([^\]]+)\]/);
assert(!!sefMatch, '2-3a: _MFG_SIDEBAR_SECTION_END_FIELDS Set 블록 추출됨');
if (sefMatch) {
    const inner = sefMatch[1];
    const hasBase = /['"]BASE_UOM['"]/.test(inner);
    const hasCurr = /['"]CURRENCY['"]/.test(inner);
    assert(hasBase && hasCurr,
        `2-3b: _MFG_SIDEBAR_SECTION_END_FIELDS Set 에 BASE_UOM(${hasBase}) + CURRENCY(${hasCurr}) 둘 다 포함`);
}

// ============================================================
// 3. 재정렬 로직 보존 (PR #556)
// ============================================================

// 3-1: Object.keys(grouped).forEach — 모든 섹션 순회
assertMatch(rflSrc,
    /Object\.keys\s*\(\s*grouped\s*\)\.forEach/,
    '3-1: Object.keys(grouped).forEach(...) — PR #556 재정렬 로직 보존');

// 3-2: endFields vs normalFields 분리 패턴 보존
assertMatch(rflSrc,
    /_MFG_SIDEBAR_SECTION_END_FIELDS\.has\s*\(\s*u\s*\)/,
    '3-2: _MFG_SIDEBAR_SECTION_END_FIELDS.has(u) 체크 (PR #556 재정렬 로직 보존)');

// 3-3: grouped[cat] = [...normalFields, ...endFields] 재할당 보존
assertMatch(rflSrc,
    /grouped\s*\[\s*cat\s*\]\s*=\s*\[\s*\.\.\.normalFields\s*,\s*\.\.\.endFields\s*\]/,
    '3-3: grouped[cat] = [...normalFields, ...endFields] 재할당 보존 (PR #556)');

// ============================================================
// 4. 영역 격리 — _isMfgArea 가드 재사용
// ============================================================

// 4-1: _isMfgArea 가드 안에서만 재정렬 (PR #556 패턴)
assertMatch(rflSrc,
    /if\s*\(\s*_isMfgArea\s*\)\s*\{[\s\S]{0,1500}_MFG_SIDEBAR_SECTION_END_FIELDS/,
    '4-1: if (_isMfgArea) { ... _MFG_SIDEBAR_SECTION_END_FIELDS } — 영역 가드 안에서만 재정렬');

// 4-2: allColumns 자체 변경 없음 — 자동 추가 로직 (PR #553) 보존
const forbiddenPattern = /allColumns\.(sort|reverse|splice|push|pop|shift|unshift)/;
assert(!forbiddenPattern.test(rflSrc),
    '4-2: renderFieldList 안에서 allColumns 자체 변경 없음 (sort/reverse/splice 금지) — PR #553 BASE_UOM 자동 추가 로직 100% 보존');

// ============================================================
// 5. PR #553 BASE_UOM 자동 추가 로직 (POST_DEPENDENCIES) 보존 재확인
// ============================================================

// 5-1: MFG_COLUMN_FIELD_POST_DEPENDENCIES['LBKUM'] = ['BASE_UOM'] 보존
assertMatch(htmlSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES[\s\S]{0,500}['"]LBKUM['"]\s*:\s*\[\s*['"]BASE_UOM['"]\s*\]/,
    "5-1: 기존 MFG_COLUMN_FIELD_POST_DEPENDENCIES['LBKUM'] = ['BASE_UOM'] 보존 (PR #553 — LBKUM 더블클릭 시 BASE_UOM 자동 추가)");

// 5-2: addField 함수 안에서 POST_DEPENDENCIES 참조 보존
const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '5-2a: addField(colName) 함수 블록 추출됨');
const addFieldSrc = addFieldMatch ? addFieldMatch[0] : '';
assertMatch(addFieldSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES\s*\[\s*colName\s*\]/,
    '5-2b: addField 안에서 MFG_COLUMN_FIELD_POST_DEPENDENCIES[colName] 조회 보존 (PR #553)');

// ============================================================
// 6. 기존 PR #555 로직 (사이드바 숨김) 보존
// ============================================================

// 6-1: _MFG_HIDDEN_SIDEBAR_FIELDS (ZCGUBUN_D/ZCGUBUN) 보존
assertMatch(htmlSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,300}['"]ZCGUBUN_D['"]/,
    '6-1: 기존 _MFG_HIDDEN_SIDEBAR_FIELDS (ZCGUBUN_D) 보존 (PR #555)');

// 6-2: 숨김 로직은 BASE_UOM 에 영향 없음 (BASE_UOM 은 숨김 Set 에 없음)
const hidMatch = htmlSrc.match(/_MFG_HIDDEN_SIDEBAR_FIELDS\s*=\s*new\s+Set\s*\(\s*\[([^\]]+)\]/);
if (hidMatch) {
    const hasBaseInHidden = /['"]BASE_UOM['"]/.test(hidMatch[1]);
    assert(!hasBaseInHidden,
        '6-2: BASE_UOM 은 _MFG_HIDDEN_SIDEBAR_FIELDS 에 없음 (사이드바에 노출 유지, 위치만 "기타" 섹션으로 이동)');
}

// ============================================================
// 결과 출력
// ============================================================
console.log('');
console.log('==================================================');
console.log(`BUILDER SIDEBAR BASE_UOM BOTTOM TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
