// ============================================================
// test_builder_filter_category_order.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #551, 2026-11-02):
//   비주얼쿼리빌더 [필터조건] 드롭다운에서 "자재 코드(MATERIAL) /
//   자재명(MATERIAL_NM)" 을 상단으로 올려서 접근성 개선.
//
//   사용자 승인 조합 (스크린샷 기반):
//     Q1(a): 필터조건 드롭다운만 (조회필드 사이드바는 CATEGORY_ORDER 유지)
//     Q2(a): "자재/제품" 섹션을 "기간" 다음 (2번째) 로 이동
//     Q3(a): 제조원가 영역만 (수익성분석 완전 무영향)
//     Q4(b): 기간 섹션 유지 (CALMONTH 그대로 노출)
//
// 설계 (설정 테이블 패턴, PR #542/#544/#546/#549/#550 과 통일):
//   - 공용 CATEGORY_ORDER (조회필드 + 수익성분석 필터) 은 변경 없음
//   - 신설 _MFG_FILTER_CATEGORY_ORDER = CATEGORY_ORDER 와 동일 원소,
//     product ↔ org 상대 순서만 반전
//   - _renderFieldComboItems() (필터조건 전용 함수) 안에서 영역 분기
//   - manufacturing-cost 영역이면 _MFG_FILTER_CATEGORY_ORDER,
//     아니면 CATEGORY_ORDER 사용
//
// 영역 격리:
//   - 수익성분석(profitability) 영역: CATEGORY_ORDER 그대로 → 완전 무영향
//   - 조회필드 사이드바: _renderFieldComboItems 와 별개 함수 → 완전 무영향
//     (CATEGORY_ORDER 그대로 참조, 사용자 Q1(a) 요구와 일치)
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
// 1. 공용 CATEGORY_ORDER 보존 (수익성분석 + 조회필드 사이드바)
// ============================================================

// 1-1: CATEGORY_ORDER 상수 선언 유지
assertMatch(htmlSrc,
    /const\s+CATEGORY_ORDER\s*=\s*\[/,
    '1-1: 공용 CATEGORY_ORDER 상수 선언 유지됨');

// 1-2: CATEGORY_ORDER 순서 완전 보존 (period → org → product → ...)
//      사용자 Q1(a) 승인: 조회필드 사이드바에는 영향 가면 안 됨
assertMatch(htmlSrc,
    /const\s+CATEGORY_ORDER\s*=\s*\[\s*['"]period['"]\s*,\s*['"]org['"]\s*,\s*['"]product['"]\s*,\s*['"]cost_type['"]\s*,\s*['"]quantity['"]\s*,\s*['"]unit['"]\s*,\s*['"]cost_total['"]\s*,\s*['"]metric['"]\s*,\s*['"]cost['"]\s*,\s*['"]trade['"]\s*,\s*['"]amount['"]\s*,\s*['"]other['"]\s*\]/,
    '1-2: CATEGORY_ORDER 순서 완전 보존 (조회필드/수익성분석 UI 영향 없음)');

// ============================================================
// 2. _MFG_FILTER_CATEGORY_ORDER 신설 (제조원가 필터조건 전용)
// ============================================================

// 2-1: _MFG_FILTER_CATEGORY_ORDER 상수 선언
assertMatch(htmlSrc,
    /const\s+_MFG_FILTER_CATEGORY_ORDER\s*=\s*\[/,
    '2-1: _MFG_FILTER_CATEGORY_ORDER 상수 선언됨 (제조원가 필터조건 전용)');

// 2-2: _MFG_FILTER_CATEGORY_ORDER 정확한 순서
//      사용자 Q2(a) 승인: 기간 다음에 자재/제품 (product), 그 다음 조직/사업부(org)
assertMatch(htmlSrc,
    /const\s+_MFG_FILTER_CATEGORY_ORDER\s*=\s*\[\s*['"]period['"]\s*,\s*['"]product['"]\s*,\s*['"]org['"]\s*,\s*['"]cost_type['"]\s*,\s*['"]quantity['"]\s*,\s*['"]unit['"]\s*,\s*['"]cost_total['"]\s*,\s*['"]metric['"]\s*,\s*['"]cost['"]\s*,\s*['"]trade['"]\s*,\s*['"]amount['"]\s*,\s*['"]other['"]\s*\]/,
    '2-2: _MFG_FILTER_CATEGORY_ORDER = [period, product, org, ...] (사용자 Q2(a) 승인 순서)');

// 2-3: product 가 org 보다 앞에 위치 (핵심 검증)
const mfgOrderMatch = htmlSrc.match(/_MFG_FILTER_CATEGORY_ORDER\s*=\s*\[([^\]]+)\]/);
assert(!!mfgOrderMatch, '2-3a: _MFG_FILTER_CATEGORY_ORDER 블록 추출 가능');
if (mfgOrderMatch) {
    const inner = mfgOrderMatch[1];
    const productIdx = inner.indexOf("'product'") >= 0 ? inner.indexOf("'product'") : inner.indexOf('"product"');
    const orgIdx = inner.indexOf("'org'") >= 0 ? inner.indexOf("'org'") : inner.indexOf('"org"');
    assert(productIdx >= 0 && orgIdx >= 0 && productIdx < orgIdx,
        `2-3b: _MFG_FILTER_CATEGORY_ORDER 안에서 product(${productIdx}) 가 org(${orgIdx}) 보다 앞 — 자재/제품 상단 노출`);
}

// 2-4: _MFG_FILTER_CATEGORY_ORDER 와 CATEGORY_ORDER 원소 집합 동일 (누락/추가 없음)
const commonOrderMatch = htmlSrc.match(/const\s+CATEGORY_ORDER\s*=\s*\[([^\]]+)\]/);
if (commonOrderMatch && mfgOrderMatch) {
    const extractSet = (s) => new Set((s.match(/['"]([a-z_]+)['"]/g) || []).map(x => x.replace(/['"]/g, '')));
    const commonSet = extractSet(commonOrderMatch[1]);
    const mfgSet = extractSet(mfgOrderMatch[1]);
    const sameSize = commonSet.size === mfgSet.size;
    let sameMembers = true;
    for (const k of commonSet) { if (!mfgSet.has(k)) { sameMembers = false; break; } }
    assert(sameSize && sameMembers,
        `2-4: _MFG_FILTER_CATEGORY_ORDER 와 CATEGORY_ORDER 가 동일 원소 집합 (common=${commonSet.size}, mfg=${mfgSet.size}, same=${sameMembers})`);
}

// 2-5: 상수 선언 "위쪽" 주석에 설계 메모 (PR #551 / 사용자 승인 Q1~Q4 / 영역 가드)
//      → 상수 선언 라인 앞 2000자 안에 PR 번호 또는 "필터조건" 등 핵심 키워드가 있어야 함
const _declIdx = htmlSrc.indexOf('const _MFG_FILTER_CATEGORY_ORDER');
const _declPrelude = _declIdx >= 0 ? htmlSrc.substring(Math.max(0, _declIdx - 2000), _declIdx) : '';
assertMatch(_declPrelude,
    /PR #551|\ud544\ud130\uc870\uac74|manufacturing-cost|\uc601\uc5ed \uac00\ub4dc/,
    '2-5: _MFG_FILTER_CATEGORY_ORDER 선언 위쪽 2000자 주석에 설계 메모 (PR #551 / 필터조건 / 영역 가드)');

// ============================================================
// 3. _renderFieldComboItems() 안에서 영역 분기 적용
// ============================================================

// _renderFieldComboItems 함수 블록 추출
const fnMatch = htmlSrc.match(/function\s+_renderFieldComboItems\s*\([^)]*\)\s*\{[\s\S]*?\n\}/);
assert(!!fnMatch, '3-0: _renderFieldComboItems 함수 블록 추출됨');
const fnSrc = fnMatch ? fnMatch[0] : '';

// 3-1: 함수 안에서 _currentBuilderArea() 영역 체크
assertMatch(fnSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"]/,
    '3-1: _renderFieldComboItems 안에서 _currentBuilderArea() === "manufacturing-cost" 체크');

// 3-2: 영역 분기에 따라 _MFG_FILTER_CATEGORY_ORDER 또는 CATEGORY_ORDER 선택
assertMatch(fnSrc,
    /_MFG_FILTER_CATEGORY_ORDER[\s\S]{0,300}CATEGORY_ORDER|CATEGORY_ORDER[\s\S]{0,300}_MFG_FILTER_CATEGORY_ORDER/,
    '3-2: _renderFieldComboItems 안에서 두 상수 모두 참조 (삼항/if 분기)');

// 3-3: 분기 결과를 하나의 변수(_activeOrder 등) 로 받아서 forEach 순회
assertMatch(fnSrc,
    /(?:const|let)\s+(_activeOrder|_order|_catOrder)[\s\S]{0,200}\.forEach/,
    '3-3: 분기 결과를 변수로 받아 forEach 순회 (하드코딩된 CATEGORY_ORDER.forEach 교체)');

// 3-4: typeof 가드로 _currentBuilderArea 함수 존재 체크 (방어적 코딩)
assertMatch(fnSrc,
    /typeof\s+_currentBuilderArea\s*===\s*['"]function['"]/,
    '3-4: typeof _currentBuilderArea === "function" 가드 (방어적 코딩, PR #549 와 통일)');

// 3-5: 기존 "CATEGORY_ORDER.forEach(cat =>" 하드코딩이 교체됨 (영역 분기 없이 바로 CATEGORY_ORDER 쓰면 안 됨)
assertNoMatch(fnSrc,
    /^\s*CATEGORY_ORDER\.forEach\s*\(/m,
    '3-5: _renderFieldComboItems 안에 "CATEGORY_ORDER.forEach(" 하드코딩이 사라짐 (영역 분기로 대체)');

// ============================================================
// 4. 영역 격리 — 수익성분석 영역 완전 무영향
// ============================================================

// 4-1: _MFG_FILTER_CATEGORY_ORDER 사용은 반드시 manufacturing-cost 영역 가드 뒤에서
assertMatch(fnSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"][\s\S]{0,500}_MFG_FILTER_CATEGORY_ORDER/,
    '4-1: _MFG_FILTER_CATEGORY_ORDER 사용은 manufacturing-cost 영역 가드 뒤에서만');

// 4-2: 영역 가드 fallback 으로 CATEGORY_ORDER 사용 (수익성분석에서는 기존대로)
assertMatch(fnSrc,
    /(\?\s*_MFG_FILTER_CATEGORY_ORDER\s*:\s*CATEGORY_ORDER|_MFG_FILTER_CATEGORY_ORDER\s*:\s*CATEGORY_ORDER)/,
    '4-2: 삼항 분기: _isMfgArea ? _MFG_FILTER_CATEGORY_ORDER : CATEGORY_ORDER (수익성분석 fallback)');

// ============================================================
// 5. 조회필드 사이드바 (renderFieldList 등) 무영향 — _MFG_FILTER_CATEGORY_ORDER 미참조
// ============================================================

// renderFieldList 또는 사이드바 렌더링 함수에서 _MFG_FILTER_CATEGORY_ORDER 참조 금지
// → 참조하는 함수가 오직 _renderFieldComboItems 하나뿐임을 확인
const allMfgFilterRefs = [...htmlSrc.matchAll(/_MFG_FILTER_CATEGORY_ORDER/g)];
// 선언 1 + 함수 안 삼항 1 (실질 참조는 2~3회 범위 — 선언 포함)
assert(allMfgFilterRefs.length >= 2 && allMfgFilterRefs.length <= 5,
    `5-1: _MFG_FILTER_CATEGORY_ORDER 참조 횟수 2~5회 범위 (실제: ${allMfgFilterRefs.length}, 선언 + 분기 사용)`);

// 5-2: _MFG_FILTER_CATEGORY_ORDER 가 _renderFieldComboItems 외부(다른 함수)에서 참조되지 않음 — 함수 범위 격리
// 전체 HTML 에서 _MFG_FILTER_CATEGORY_ORDER 등장 위치 모두가 선언 블록 또는 _renderFieldComboItems 블록 안에 있어야 함
const declStart = htmlSrc.indexOf('const _MFG_FILTER_CATEGORY_ORDER');
const declEnd   = declStart >= 0 ? htmlSrc.indexOf('\n', declStart) : -1;
const fnStart   = fnMatch ? htmlSrc.indexOf(fnMatch[0]) : -1;
const fnEnd     = fnStart >= 0 ? fnStart + fnMatch[0].length : -1;
let allInScope = true;
allMfgFilterRefs.forEach(m => {
    const idx = m.index;
    const inDecl = (declStart >= 0 && declEnd >= 0 && idx >= declStart && idx <= declEnd + 50);
    const inFn   = (fnStart >= 0 && fnEnd >= 0 && idx >= fnStart && idx <= fnEnd);
    // 주석 안(설명)에서 언급은 허용 → 간단히 "주석 기호" 뒤 500자 안이면 OK 로 처리
    const near = htmlSrc.substring(Math.max(0, idx - 100), idx);
    const inComment = /\/\/[^\n]*$/.test(near) || /\/\*[\s\S]*$/.test(near);
    if (!inDecl && !inFn && !inComment) {
        allInScope = false;
        console.log('   [debug] _MFG_FILTER_CATEGORY_ORDER 외부 참조 발견 idx=' + idx);
    }
});
assert(allInScope,
    '5-2: _MFG_FILTER_CATEGORY_ORDER 참조는 모두 선언 블록, _renderFieldComboItems 블록, 또는 주석 안 (조회필드 사이드바/다른 함수 침범 없음)');

// ============================================================
// 결과 출력
// ============================================================
console.log('');
console.log('==================================================');
console.log(`BUILDER FILTER CATEGORY ORDER TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
