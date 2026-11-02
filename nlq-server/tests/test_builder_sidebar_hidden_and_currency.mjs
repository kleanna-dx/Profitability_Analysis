// ============================================================
// test_builder_sidebar_hidden_and_currency.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #555, 2026-11-02):
//   1) "표준원가추정(대구분)"(ZCGUBUN_D), "원가구분(구분)"(ZCGUBUN) 2개를
//      제조원가 사이드바에서 숨김 (사용자: "일부러 필드 목록에서는 지웠어!
//      다른 필드 더블클릭했을때 자동으로 들어가는 필드니깐")
//   2) "통화 코드"(CURRENCY) 를 필드목록 맨 하단으로 이동 (제조원가만)
//
// 사용자 승인 조합:
//   Q1(a): 자동 추가 유지 — allColumns 자체는 변경 없음, UI 만 숨김
//   Q2(a): 조회필드에서는 평소대로 표시 (자동 추가된 상태로)
//   Q3(b): 필터조건 드롭다운에서는 유지 — _renderFieldComboItems() 는
//          isHiddenInBuilderSidebar() 를 호출하지 않으므로 자동 충족
//
// 설계 (설정 테이블 패턴, PR #542~#554 와 통일):
//   - _MFG_HIDDEN_SIDEBAR_FIELDS = new Set(['ZCGUBUN_D', 'ZCGUBUN'])
//     → isHiddenInBuilderSidebar() 의 제조원가 분기에서 체크
//   - _MFG_SIDEBAR_CATEGORY_OVERRIDE = { 'CURRENCY': 'other' }
//     → renderFieldList() 안에서 category 재분류 (얕은 복사로 원본 보존)
//     → 'other' 섹션이 CATEGORY_ORDER 맨 뒤 → 자연스럽게 맨 하단 노출
//
// 영역 격리:
//   - 제조원가 (manufacturing-cost) 영역만 적용
//   - 수익성분석 (profitability) 영역: _isMfgArea 가드 → 완전 무영향
//   - 필터조건 드롭다운(_renderFieldComboItems): isHiddenInBuilderSidebar 미호출 → 자동 유지
//   - 자동 추가(addField): allColumns 를 그대로 참조 → ZCGUBUN_D/ZCGUBUN 메타 조회 성공 → 보존
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
function assertNoMatch(src, re, msg) {
    const ok = !re.test(src);
    if (ok) { PASS++; }
    else { FAIL++; failures.push(`${msg}\n  regex: ${re}`); console.log('FAIL:', msg, '\n  regex:', re); }
}

// ============================================================
// 1. _MFG_HIDDEN_SIDEBAR_FIELDS 상수 신설 (ZCGUBUN_D / ZCGUBUN)
// ============================================================

// 1-1: 상수 선언 존재
assertMatch(htmlSrc,
    /const\s+_MFG_HIDDEN_SIDEBAR_FIELDS\s*=\s*new\s+Set\s*\(/,
    '1-1: const _MFG_HIDDEN_SIDEBAR_FIELDS = new Set([...]) 상수 선언됨');

// 1-2: Set 안에 ZCGUBUN_D 포함
assertMatch(htmlSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,300}['"]ZCGUBUN_D['"]/,
    "1-2: _MFG_HIDDEN_SIDEBAR_FIELDS 에 'ZCGUBUN_D' 포함");

// 1-3: Set 안에 ZCGUBUN 포함
assertMatch(htmlSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,300}['"]ZCGUBUN['"]/,
    "1-3: _MFG_HIDDEN_SIDEBAR_FIELDS 에 'ZCGUBUN' 포함");

// 1-4: 상수 선언 위쪽 주석에 PR #555 설계 메모
const _declIdx = htmlSrc.indexOf('const _MFG_HIDDEN_SIDEBAR_FIELDS');
const _declPrelude = _declIdx >= 0 ? htmlSrc.substring(Math.max(0, _declIdx - 2000), _declIdx) : '';
assertMatch(_declPrelude,
    /PR #555|\uc0ac\uc774\ub4dc\ubc14 \uc804\uc6a9|\uc790\ub3d9 \ucd94\uac00/,
    '1-4: _MFG_HIDDEN_SIDEBAR_FIELDS 선언 위쪽 주석에 PR #555 / 사이드바 전용 / 자동 추가 명시');

// ============================================================
// 2. isHiddenInBuilderSidebar() 함수 안에서 _MFG_HIDDEN_SIDEBAR_FIELDS 참조
// ============================================================

// isHiddenInBuilderSidebar 함수 블록 추출
const fnMatch = htmlSrc.match(/function\s+isHiddenInBuilderSidebar\s*\(\s*name\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!fnMatch, '2-0: isHiddenInBuilderSidebar 함수 블록 추출됨');
const fnSrc = fnMatch ? fnMatch[0] : '';

// 2-1: 함수 안에서 _MFG_HIDDEN_SIDEBAR_FIELDS 참조
assertMatch(fnSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS/,
    '2-1: isHiddenInBuilderSidebar 안에서 _MFG_HIDDEN_SIDEBAR_FIELDS 참조');

// 2-2: has(u) 체크로 숨김 판정
assertMatch(fnSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS\.has\s*\(\s*u\s*\)/,
    '2-2: _MFG_HIDDEN_SIDEBAR_FIELDS.has(u) 체크 (대소문자 정규화된 이름)');

// 2-3: 영역 가드 — manufacturing-cost 안에서만 체크
assertMatch(fnSrc,
    /_area\s*===\s*['"]manufacturing-cost['"][\s\S]{0,500}_MFG_HIDDEN_SIDEBAR_FIELDS/,
    '2-3: _MFG_HIDDEN_SIDEBAR_FIELDS 체크는 manufacturing-cost 영역 가드 안에서만 (수익성분석 영역 격리)');

// ============================================================
// 3. _MFG_SIDEBAR_CATEGORY_OVERRIDE 신설 (CURRENCY → 'other')
// ============================================================

// 3-1: 상수 선언 존재 (renderFieldList 안)
assertMatch(htmlSrc,
    /_MFG_SIDEBAR_CATEGORY_OVERRIDE\s*=\s*\{[\s\S]{0,200}['"]CURRENCY['"]\s*:\s*['"]other['"]/,
    "3-1: _MFG_SIDEBAR_CATEGORY_OVERRIDE = { 'CURRENCY': 'other' } 신설 (CURRENCY 를 other 섹션으로)");

// 3-2: renderFieldList 함수 안에 위치
const rflMatch = htmlSrc.match(/function\s+renderFieldList\s*\(\s*cols\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!rflMatch, '3-2a: renderFieldList(cols) 함수 블록 추출됨');
const rflSrc = rflMatch ? rflMatch[0] : '';
assertMatch(rflSrc,
    /_MFG_SIDEBAR_CATEGORY_OVERRIDE/,
    '3-2b: renderFieldList 함수 안에서 _MFG_SIDEBAR_CATEGORY_OVERRIDE 참조');

// 3-3: 얕은 복사 (...c) 패턴으로 원본 객체 보존 — allColumns 참조 불변 보장
assertMatch(rflSrc,
    /\{\s*\.\.\.c\s*,\s*category\s*:\s*_MFG_SIDEBAR_CATEGORY_OVERRIDE/,
    '3-3: { ...c, category: _MFG_SIDEBAR_CATEGORY_OVERRIDE[u] } 얕은 복사 — 원본 보존');

// 3-4: 영역 가드 — _isMfgArea 또는 _currentBuilderArea() 체크
assertMatch(rflSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"]/,
    '3-4: renderFieldList 안에서 _currentBuilderArea() === "manufacturing-cost" 영역 가드');

// 3-5: _overriddenCols 변수에 결과 할당 (후속 grouped 로직 재사용)
assertMatch(rflSrc,
    /_overriddenCols[\s\S]{0,500}grouped/,
    '3-5: _overriddenCols 변수를 grouped 집계 로직에 전달');

// ============================================================
// 4. 영역 격리 — 수익성분석 완전 무영향 재검증
// ============================================================

// 4-1: _MFG_HIDDEN_SIDEBAR_FIELDS 실제 호출(.has) 이 반드시 manufacturing-cost 영역 가드 뒤에서
//      주석 내 상수명 언급은 무시하고 "실제 .has() 호출" 위치만 비교.
//      → _area === 'manufacturing-cost' 체크 다음에 _MFG_HIDDEN_SIDEBAR_FIELDS.has() 호출이 와야 함
const _areaCheckIdx = fnSrc.indexOf("_area === 'manufacturing-cost'");
const _hiddenCallIdx = fnSrc.search(/_MFG_HIDDEN_SIDEBAR_FIELDS\.has\s*\(/);
assert(_areaCheckIdx > 0 && _hiddenCallIdx > _areaCheckIdx,
    `4-1: _area === 'manufacturing-cost' 체크(idx=${_areaCheckIdx}) 가 _MFG_HIDDEN_SIDEBAR_FIELDS.has() 호출(idx=${_hiddenCallIdx}) 보다 앞 — 영역 가드 보장 (주석 언급 제외)`);

// 4-2: _MFG_SIDEBAR_CATEGORY_OVERRIDE 사용은 반드시 _isMfgArea 체크 뒤에서
const _isMfgCheckIdx = rflSrc.indexOf('_isMfgArea');
const _overrideRefIdx = rflSrc.indexOf('_MFG_SIDEBAR_CATEGORY_OVERRIDE');
assert(_isMfgCheckIdx > 0 && _overrideRefIdx > _isMfgCheckIdx,
    `4-2: _isMfgArea 체크(idx=${_isMfgCheckIdx}) 가 _MFG_SIDEBAR_CATEGORY_OVERRIDE 참조(idx=${_overrideRefIdx}) 보다 앞 — 영역 가드 보장`);

// 4-3: 얕은 복사 사용 — 원본 cols/allColumns 변경 없음 (map() 반환값이 새 배열)
assertMatch(rflSrc,
    /visibleColsForSidebar\.map/,
    '4-3: visibleColsForSidebar.map(...) 사용 — 새 배열 반환 (원본 cols 변경 없음)');

// 4-4: _isMfgArea 가 false 일 때 fallback: 원본 visibleColsForSidebar 그대로 사용
assertMatch(rflSrc,
    /_isMfgArea\s*\?\s*visibleColsForSidebar\.map[\s\S]{0,300}:\s*visibleColsForSidebar/,
    '4-4: _isMfgArea ? visibleColsForSidebar.map(...) : visibleColsForSidebar (수익성분석 fallback)');

// ============================================================
// 5. 필터조건 드롭다운 유지 확인 (Q3(b)) — _renderFieldComboItems 가 isHiddenInBuilderSidebar 미호출
// ============================================================

// 5-1: _renderFieldComboItems 함수 블록 추출
const comboMatch = htmlSrc.match(/function\s+_renderFieldComboItems\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
assert(!!comboMatch, '5-1a: _renderFieldComboItems 함수 블록 추출됨');
const comboSrc = comboMatch ? comboMatch[0] : '';

// 5-2: _renderFieldComboItems 안에서 isHiddenInBuilderSidebar 호출 안 함
assertNoMatch(comboSrc,
    /isHiddenInBuilderSidebar/,
    '5-2: _renderFieldComboItems 는 isHiddenInBuilderSidebar 를 호출하지 않음 → 필터조건에선 ZCGUBUN_D/ZCGUBUN 유지 (Q3(b))');

// 5-3: _renderFieldComboItems 안에서 _MFG_HIDDEN_SIDEBAR_FIELDS 참조 안 함 (추가 안전 체크)
assertNoMatch(comboSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS/,
    '5-3: _renderFieldComboItems 는 _MFG_HIDDEN_SIDEBAR_FIELDS 를 참조하지 않음 → 필터조건에선 완전히 유지 (Q3(b))');

// ============================================================
// 6. 자동 추가(addField) 유지 확인 (Q1(a)) — allColumns 자체 변경 없음
// ============================================================

// 6-1: addField 함수 블록 추출
const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '6-1a: addField(colName) 함수 블록 추출됨');
const addFieldSrc = addFieldMatch ? addFieldMatch[0] : '';

// 6-2: addField 는 allColumns.find 로 메타 조회 (사이드바 UI 와 무관)
assertMatch(addFieldSrc,
    /allColumns\.find\s*\(\s*c\s*=>\s*c\.name\s*===/,
    '6-2: addField 가 allColumns.find() 로 메타 조회 → 사이드바 숨김과 무관 (자동 추가 보존)');

// 6-3: addField 는 _MFG_HIDDEN_SIDEBAR_FIELDS / isHiddenInBuilderSidebar 를 참조하지 않음
//      (= 숨김 처리가 자동 추가에 영향 없음)
assertNoMatch(addFieldSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS|isHiddenInBuilderSidebar/,
    '6-3: addField 는 _MFG_HIDDEN_SIDEBAR_FIELDS / isHiddenInBuilderSidebar 를 참조 안 함 → 자동 추가 100% 보존 (Q1(a))');

// ============================================================
// 7. CATEGORY_ORDER 안에 'other' 섹션이 맨 뒤에 있음 — CURRENCY override 가 맨 하단 노출 보장
// ============================================================

// 7-1: CATEGORY_ORDER 의 마지막 요소가 'other'
assertMatch(htmlSrc,
    /const\s+CATEGORY_ORDER\s*=\s*\[[^\]]*['"]other['"]\s*\]/,
    "7-1: CATEGORY_ORDER 의 마지막 요소가 'other' (= CURRENCY 가 자동으로 맨 하단 노출)");

// ============================================================
// 결과 출력
// ============================================================
console.log('');
console.log('==================================================');
console.log(`BUILDER SIDEBAR HIDDEN & CURRENCY TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
