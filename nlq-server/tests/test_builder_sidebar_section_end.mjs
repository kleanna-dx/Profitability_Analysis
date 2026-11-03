// ============================================================
// test_builder_sidebar_section_end.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #556, 2026-11-02):
//   비주얼쿼리빌더 필드목록 "기타(other)" 섹션 안 순서를
//     현재월 표준가(TOTAL1) → 이전월 표준가(TOTAL2) → 통화 코드(CURRENCY)
//   로 재정렬. 즉 CURRENCY 를 섹션 안 "맨 뒤" 로 밀어내기.
//
//   배경 (PR #555):
//     CURRENCY 를 category=other 로 override 했지만, grouped[cat] 배열이
//     allColumns 입력 순서대로 push 되어 CURRENCY 가 TOTAL1/TOTAL2 앞에 왔음.
//     → 섹션 안에서도 맨 뒤로 재정렬 필요.
//
// 설계 (설정 테이블 패턴, PR #555 와 통일):
//   const _MFG_SIDEBAR_SECTION_END_FIELDS = new Set(['CURRENCY']);
//     → 포함된 컬럼은 해당 섹션 배열의 맨 뒤로 재정렬.
//   영역 가드: _isMfgArea (제조원가에서만 적용).
//   원본 참조 보존: grouped[cat] 배열만 재정렬, allColumns 불변.
//
// 영역 격리:
//   - 제조원가 (manufacturing-cost) 영역만 적용
//   - 수익성분석 (profitability) 영역: _isMfgArea 가드 → 완전 무영향
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
// 1. _MFG_SIDEBAR_SECTION_END_FIELDS 상수 신설
// ============================================================

// 1-1: 상수 선언 존재 (Set 사용)
assertMatch(rflSrc,
    /const\s+_MFG_SIDEBAR_SECTION_END_FIELDS\s*=\s*new\s+Set\s*\(/,
    '1-1: const _MFG_SIDEBAR_SECTION_END_FIELDS = new Set([...]) 상수 선언됨');

// 1-2: Set 안에 'CURRENCY' 포함
assertMatch(rflSrc,
    /_MFG_SIDEBAR_SECTION_END_FIELDS\s*=\s*new\s+Set\s*\(\s*\[\s*['"]CURRENCY['"]/,
    "1-2: _MFG_SIDEBAR_SECTION_END_FIELDS 에 'CURRENCY' 포함 (사용자 요구: 섹션 안 맨 뒤)");

// 1-3: 상수 선언 주변에 PR #556 설계 메모
assertMatch(rflSrc,
    /PR #556[\s\S]{0,500}(\uc139\uc158 \uc548 \ub9e8 \ub4a4|SECTION_END|\ub9e8 \ub4a4\ub85c)/,
    '1-3: PR #556 설계 메모 (섹션 안 맨 뒤 / SECTION_END)');

// ============================================================
// 2. 섹션 재정렬 로직 삽입
// ============================================================

// 2-1: _isMfgArea 가드 안에서만 재정렬 (영역 격리)
assertMatch(rflSrc,
    /if\s*\(\s*_isMfgArea\s*\)\s*\{[\s\S]{0,1500}_MFG_SIDEBAR_SECTION_END_FIELDS/,
    '2-1: if (_isMfgArea) { ... _MFG_SIDEBAR_SECTION_END_FIELDS } — 영역 가드 안에서만 재정렬');

// 2-2: Object.keys(grouped).forEach 로 모든 섹션 순회
assertMatch(rflSrc,
    /Object\.keys\s*\(\s*grouped\s*\)\.forEach/,
    '2-2: Object.keys(grouped).forEach(...) — 모든 섹션 순회');

// 2-3: endFields vs normalFields 분리 (SECTION_END 포함 여부)
assertMatch(rflSrc,
    /_MFG_SIDEBAR_SECTION_END_FIELDS\.has\s*\(\s*u\s*\)/,
    '2-3: _MFG_SIDEBAR_SECTION_END_FIELDS.has(u) 체크 (대소문자 정규화된 이름)');

// 2-4: 재정렬 — normalFields + endFields 순서로 재할당
assertMatch(rflSrc,
    /grouped\s*\[\s*cat\s*\]\s*=\s*\[\s*\.\.\.normalFields\s*,\s*\.\.\.endFields\s*\]/,
    '2-4: grouped[cat] = [...normalFields, ...endFields] — SECTION_END 를 맨 뒤로');

// 2-5: endFields.length > 0 체크로 불필요한 재할당 방지
assertMatch(rflSrc,
    /if\s*\(\s*endFields\.length\s*>\s*0\s*\)/,
    '2-5: if (endFields.length > 0) 체크 — 재정렬이 필요한 섹션만 재할당');

// 2-6: 섹션 재정렬이 grouped push 로직 "뒤" 에 와야 함 (push 먼저, 재정렬 나중)
const pushIdx = rflSrc.indexOf('grouped[c.category].push(c)');
const reorderIdx = rflSrc.search(/if\s*\(\s*_isMfgArea\s*\)\s*\{[\s\S]{0,1500}_MFG_SIDEBAR_SECTION_END_FIELDS/);
assert(pushIdx > 0 && reorderIdx > pushIdx,
    `2-6: 섹션 재정렬 로직(idx=${reorderIdx}) 이 grouped push(idx=${pushIdx}) 뒤에 위치 — 재정렬 순서 보장`);

// ============================================================
// 3. 영역 격리 — 수익성분석 완전 무영향
// ============================================================

// 3-1: _isMfgArea 가드 뒤에서만 _MFG_SIDEBAR_SECTION_END_FIELDS 참조
//      _isMfgArea 선언 (라인 2개가 있음 — override 분기 선언 + 재정렬 분기에서 재참조 여부 확인)
const _isMfgAreaRefs = [...rflSrc.matchAll(/_isMfgArea/g)];
assert(_isMfgAreaRefs.length >= 2,
    `3-1: _isMfgArea 가 renderFieldList 안에서 2회 이상 참조 (실제: ${_isMfgAreaRefs.length}) — override + 재정렬 분기`);

// 3-2: _MFG_SIDEBAR_SECTION_END_FIELDS 참조는 반드시 _isMfgArea 체크 뒤에서
const sefRefIdx = rflSrc.indexOf('_MFG_SIDEBAR_SECTION_END_FIELDS.has');
const lastMfgAreaIdx = rflSrc.lastIndexOf('_isMfgArea', sefRefIdx);
assert(lastMfgAreaIdx > 0 && lastMfgAreaIdx < sefRefIdx,
    `3-2: _MFG_SIDEBAR_SECTION_END_FIELDS.has 호출(idx=${sefRefIdx}) 직전의 _isMfgArea 참조(idx=${lastMfgAreaIdx}) 가 가드 역할 — 영역 격리 보장`);

// 3-3: grouped[cat] 배열만 재정렬 — allColumns 자체 변경 없음
//      → "allColumns.sort" 같은 원본 변경 패턴이 없어야 함
const forbiddenPattern = /allColumns\.(sort|reverse|splice|push|pop|shift|unshift)/;
assert(!forbiddenPattern.test(rflSrc),
    '3-3: renderFieldList 안에서 allColumns 자체 변경 없음 (sort/reverse/splice/push/pop/shift/unshift) — 자동 추가 로직 보존');

// ============================================================
// 4. 안전 체크 — Array.isArray + length <= 1 skip
// ============================================================

// 4-1: Array.isArray 안전 체크
assertMatch(rflSrc,
    /Array\.isArray\s*\(\s*arr\s*\)/,
    '4-1: Array.isArray(arr) 안전 체크 (grouped[cat] 가 undefined 인 경우 skip)');

// 4-2: length <= 1 skip (단일 요소 섹션은 재정렬 불필요)
assertMatch(rflSrc,
    /arr\.length\s*<=\s*1/,
    '4-2: arr.length <= 1 skip (단일 요소 섹션은 재정렬 불필요 — 성능 최적화)');

// ============================================================
// 5. 기존 PR #555 로직 보존 (CURRENCY category override + 사이드바 숨김)
// ============================================================

// 5-1: _MFG_SIDEBAR_CATEGORY_OVERRIDE 보존 (PR #555)
assertMatch(rflSrc,
    /_MFG_SIDEBAR_CATEGORY_OVERRIDE\s*=\s*\{[\s\S]{0,200}['"]CURRENCY['"]\s*:\s*['"]other['"]/,
    "5-1: _MFG_SIDEBAR_CATEGORY_OVERRIDE['CURRENCY'] = 'other' 보존 (PR #555)");

// 5-2: _MFG_HIDDEN_SIDEBAR_FIELDS 보존 (PR #555 — ZCGUBUN_D/ZCGUBUN 숨김)
assertMatch(htmlSrc,
    /_MFG_HIDDEN_SIDEBAR_FIELDS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,300}['"]ZCGUBUN_D['"]/,
    '5-2: _MFG_HIDDEN_SIDEBAR_FIELDS (ZCGUBUN_D) 보존 (PR #555)');

// ============================================================
// 결과 출력
// ============================================================
console.log('');
console.log('==================================================');
console.log(`BUILDER SIDEBAR SECTION END TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
