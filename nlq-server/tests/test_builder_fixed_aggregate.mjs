// ============================================================
// test_builder_fixed_aggregate.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #548):
//   제조원가 VQB 조회필드에서 아래 22개 컬럼의 집계 함수 드롭박스
//   (원본/SUM/AVG/MIN/MAX/COUNT)를 완전히 숨기고 "SUM" 텍스트만 표시.
//
//   대상 22개 (sys_aimd_cot015 테이블):
//     - 원가요소 20개 (KST001~KST039)
//     - 표준가 2개 (TOTAL1 현재월 표준가, TOTAL2 이전월 표준가)
//
//   제외 (드롭박스 유지, 사용자 명시 "22개만"):
//     - TOTAL (원가 합계금액)
//     - KST_V (변동비 합계), KST_F (고정비 합계)
//     - LBKUM (생산수량)
//
// 이유:
//   - 금액/수량 컬럼은 분석 상 거의 100% 합계(SUM)만 사용
//   - 사용자가 실수로 AVG 등을 선택하면 집계 왜곡 발생
//   - UI 단순화 (드롭박스 없이 "SUM" 텍스트만 표시)
//
// 설계 (설정 테이블 패턴, PR #542/#546/#547 과 통일):
//   const _MFG_FIXED_AGG_COLUMNS = new Set([
//     'KST001','KST002',...,'KST039',  // 20개
//     'TOTAL1','TOTAL2',                 // 2개
//   ]);
//   영역 가드: renderSelectedFields 에서 manufacturing-cost 전용
//   수익성분석(profitability) 영역은 기존 드롭박스 그대로 유지
//
// 수정 지점:
//   1. _MFG_FIXED_AGG_COLUMNS 상수 신설 (라인 ~1915)
//   2. .agg-fixed CSS 스타일 추가 (라인 ~349)
//   3. renderSelectedFields() 안에 _isFixedAgg 분기 추가 (라인 ~2946)
//      - 22개 컬럼 + 제조원가 영역이면 <span class="agg-fixed">SUM</span>
//      - 그 외는 기존 <select class="agg-select"> 드롭박스
//   4. getDefaultAggregate() 는 수정 X (여전히 'SUM' 반환, SQL 생성 영향 없음)
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
// 1. _MFG_FIXED_AGG_COLUMNS 상수 신설 검증
// ============================================================

// 1-1: 상수 선언 (Set 구조로 O(1) 조회)
assertMatch(htmlSrc,
    /const\s+_MFG_FIXED_AGG_COLUMNS\s*=\s*new\s+Set\s*\(\s*\[/,
    '1-1: _MFG_FIXED_AGG_COLUMNS = new Set([...]) 상수 선언됨 (Set 구조)');

// 1-2: 22개 컬럼 전수 등록 검증
const FIXED_AGG_COLS = [
    // 원가요소 20개 (KST001~KST039)
    'KST001','KST002','KST004','KST006','KST008',
    'KST010','KST012','KST014','KST015','KST017',
    'KST019','KST021','KST025','KST027','KST029',
    'KST031','KST033','KST035','KST037','KST039',
    // 표준가 2개
    'TOTAL1','TOTAL2',
];
assert(FIXED_AGG_COLS.length === 22, `1-2a: 테스트 리스트가 22개 (실제: ${FIXED_AGG_COLS.length})`);

FIXED_AGG_COLS.forEach((col, i) => {
    assertMatch(htmlSrc,
        new RegExp(`_MFG_FIXED_AGG_COLUMNS[\\s\\S]{0,3000}['"]${col}['"]`),
        `1-2-${String(i + 1).padStart(2, '0')}: ${col} 가 _MFG_FIXED_AGG_COLUMNS 에 등록됨`);
});

// 1-3: 제외 컬럼은 _MFG_FIXED_AGG_COLUMNS 에 **포함되지 않아야** 함
//      (사용자 명시 "22개만" — TOTAL/KST_V/KST_F/LBKUM 등은 드롭박스 유지)
//      regex: Set 블록 안에서 'TOTAL' 바로 다음에 숫자가 아닌 경우(즉 'TOTAL' 단독)
const _mfgFixedBlock = htmlSrc.match(/_MFG_FIXED_AGG_COLUMNS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]*?\]\s*\)/);
assert(!!_mfgFixedBlock, '1-3-0: _MFG_FIXED_AGG_COLUMNS 블록 추출됨');
const _mfgFixedBlockSrc = _mfgFixedBlock ? _mfgFixedBlock[0] : '';

assertNoMatch(_mfgFixedBlockSrc,
    /['"]TOTAL['"](?!\d)/,  // 'TOTAL' 바로 뒤에 숫자가 없으면 TOTAL(합계금액)
    '1-3a: TOTAL (원가 합계금액) 은 _MFG_FIXED_AGG_COLUMNS 에서 제외됨 (드롭박스 유지)');

assertNoMatch(_mfgFixedBlockSrc,
    /['"]KST_V['"]/,
    '1-3b: KST_V (변동비 합계) 는 _MFG_FIXED_AGG_COLUMNS 에서 제외됨 (드롭박스 유지)');

assertNoMatch(_mfgFixedBlockSrc,
    /['"]KST_F['"]/,
    '1-3c: KST_F (고정비 합계) 는 _MFG_FIXED_AGG_COLUMNS 에서 제외됨 (드롭박스 유지)');

assertNoMatch(_mfgFixedBlockSrc,
    /['"]LBKUM['"]/,
    '1-3d: LBKUM (생산수량) 은 _MFG_FIXED_AGG_COLUMNS 에서 제외됨 (드롭박스 유지)');

// 1-4: 상수 근처에 설계 메모 주석 (사용자 의도, 영역 가드, 22개 명시)
assertMatch(htmlSrc,
    /_MFG_FIXED_AGG_COLUMNS[\s\S]{0,3000}(22\uac1c|manufacturing-cost|\uc9d1\uacc4 \uc65c\uace1|SUM \uace0\uc815|\ub4dc\ub86d\ubc15\uc2a4)/,
    '1-4: _MFG_FIXED_AGG_COLUMNS 근처에 설계 메모 주석 (22개 / manufacturing-cost / 집계 왜곡 / SUM 고정 / 드롭박스)');

// ============================================================
// 2. CSS .agg-fixed 스타일 신설 검증
// ============================================================

// 2-1: .agg-fixed CSS 셀렉터 존재
assertMatch(htmlSrc,
    /\.selected-field\s+\.agg-fixed\s*\{/,
    '2-1: .selected-field .agg-fixed CSS 스타일 신설됨');

// 2-2: cursor:help 로 "변경 불가" 느낌 명시 (사용자 UX 가이드)
assertMatch(htmlSrc,
    /\.selected-field\s+\.agg-fixed[\s\S]{0,500}cursor\s*:\s*help/,
    '2-2: .agg-fixed 에 cursor:help 지정 (변경 불가 시각 신호)');

// 2-3: 회색 배경 (기존 흰색 .agg-select 와 구분)
assertMatch(htmlSrc,
    /\.selected-field\s+\.agg-fixed[\s\S]{0,500}background\s*:\s*#f3f4f6/,
    '2-3: .agg-fixed 에 회색 배경(#f3f4f6) 지정 (드롭박스와 시각적 구분)');

// ============================================================
// 3. renderSelectedFields() 분기 수정 검증
// ============================================================

// renderSelectedFields 함수 블록 추출
const renderSelMatch = htmlSrc.match(/function\s+renderSelectedFields\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!renderSelMatch, '3-0: renderSelectedFields() 함수 블록 추출됨');
const renderSelSrc = renderSelMatch ? renderSelMatch[0] : '';

// 3-1: renderSelectedFields 안에서 _MFG_FIXED_AGG_COLUMNS 참조
assertMatch(renderSelSrc,
    /_MFG_FIXED_AGG_COLUMNS/,
    '3-1: renderSelectedFields 안에서 _MFG_FIXED_AGG_COLUMNS 상수 참조');

// 3-2: 영역 가드 — _currentBuilderArea() === 'manufacturing-cost' 체크
assertMatch(renderSelSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"]/,
    '3-2: 영역 가드 — _currentBuilderArea() === "manufacturing-cost" 체크 존재');

// 3-3: _isFixedAgg 변수로 조건 조합 (영역 + 컬럼 리스트)
assertMatch(renderSelSrc,
    /_isFixedAgg[\s\S]{0,500}_MFG_FIXED_AGG_COLUMNS\.has/,
    '3-3: _isFixedAgg 조건 — 영역 가드 + Set.has(f.column) 결합');

// 3-4: 고정 집계일 때 <span class="agg-fixed"> 렌더링
assertMatch(renderSelSrc,
    /_isFixedAgg[\s\S]{0,1000}<span\s+class="agg-fixed"/,
    '3-4: _isFixedAgg 분기에서 <span class="agg-fixed"> 렌더링');

// 3-5: 고정 집계 표시 텍스트에 'SUM' 포함 (f.aggregate || 'SUM')
assertMatch(renderSelSrc,
    /<span\s+class="agg-fixed"[\s\S]{0,500}f\.aggregate\s*\|\|\s*['"]SUM['"]/,
    '3-5: 고정 집계 표시 — f.aggregate || "SUM" (기본 SUM, aggregate 값 있으면 그대로)');

// 3-6: title 속성에 "SUM 고정" 안내 문구 (hover tooltip)
assertMatch(renderSelSrc,
    /<span\s+class="agg-fixed"\s+title=["'][^"']{0,200}(SUM|\ud569\uacc4|\uace0\uc815)/,
    '3-6: .agg-fixed title 속성에 "SUM/합계/고정" 안내 문구 포함 (hover tooltip)');

// 3-7: 기존 <select class="agg-select"> 분기 보존 (수익성분석/제조원가의 다른 컬럼)
assertMatch(renderSelSrc,
    /<select\s+class="agg-select"[\s\S]{0,500}setAggregate/,
    '3-7: 기존 <select class="agg-select"> 분기 보존 (수익성분석/제조원가 비-22개 컬럼)');

// 3-8: 기존 6개 집계 옵션 (원본/SUM/AVG/MAX/MIN/COUNT) 보존
assertMatch(renderSelSrc,
    /option\s+value="SUM"[\s\S]{0,200}option\s+value="AVG"[\s\S]{0,200}option\s+value="MAX"[\s\S]{0,200}option\s+value="MIN"[\s\S]{0,200}option\s+value="COUNT"/,
    '3-8: 기존 6개 집계 옵션 (SUM/AVG/MAX/MIN/COUNT) 보존 (회귀 방지)');

// ============================================================
// 4. getDefaultAggregate 는 수정하지 않음 (SQL 생성 영향 없음)
// ============================================================

// 4-1: getDefaultAggregate 함수 블록 발췌
const getDefMatch = htmlSrc.match(/function\s+getDefaultAggregate\s*\(\s*col\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!getDefMatch, '4-0: getDefaultAggregate() 함수 블록 추출됨');
const getDefSrc = getDefMatch ? getDefMatch[0] : '';

// 4-1: amount/quantity 카테고리면 여전히 'SUM' 반환 (기존 로직 유지)
assertMatch(getDefSrc,
    /col\.category\s*===\s*['"]amount['"][\s\S]{0,100}['"]quantity['"][\s\S]{0,100}return\s+['"]SUM['"]/,
    '4-1: getDefaultAggregate 는 amount/quantity → "SUM" 반환 그대로 유지 (SQL 생성 영향 없음)');

// 4-2: _MFG_FIXED_AGG_COLUMNS 는 getDefaultAggregate 에서 참조되지 않음
//      (UI 숨김만 처리, 기본 aggregate 값은 그대로 'SUM' 세팅)
assertNoMatch(getDefSrc,
    /_MFG_FIXED_AGG_COLUMNS/,
    '4-2: getDefaultAggregate 는 _MFG_FIXED_AGG_COLUMNS 참조 안 함 (UI 숨김만, 로직 영향 X)');

// ============================================================
// 5. 영역 격리 — 수익성분석 완전 무영향 검증
// ============================================================

// 5-1: _MFG_FIXED_AGG_COLUMNS 사용은 반드시 manufacturing-cost 영역 가드 뒤에서
assertMatch(htmlSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"][\s\S]{0,2000}_MFG_FIXED_AGG_COLUMNS/,
    '5-1: _MFG_FIXED_AGG_COLUMNS 사용은 반드시 manufacturing-cost 영역 가드 뒤');

// 5-2: 상수 참조는 최소 2곳 (선언 + renderSelectedFields 안)
const fixedAggRefs = (htmlSrc.match(/_MFG_FIXED_AGG_COLUMNS/g) || []).length;
assert(fixedAggRefs >= 2 && fixedAggRefs <= 5,
    `5-2: _MFG_FIXED_AGG_COLUMNS 참조는 선언 + 사용 (총 ${fixedAggRefs}회, 2~5 범위)`);

// ============================================================
// 6. 회귀 방지 — PR #542/#543/#544/#545/#546/#547 보존
// ============================================================

// 6-1: PR #543 UNIT_COST 보존
assertMatch(htmlSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES[\s\S]{0,2000}['"]UNIT_COST['"]/,
    '6-1: PR #543 UNIT_COST metric_code 보존');

// 6-2: PR #546 MFG_COLUMN_FIELD_DEPENDENCIES 보존
assertMatch(htmlSrc,
    /const\s+MFG_COLUMN_FIELD_DEPENDENCIES\s*=\s*\{/,
    '6-2: PR #546 MFG_COLUMN_FIELD_DEPENDENCIES 상수 보존');

// 6-3: PR #547 _MFG_COST_ELEMENT_DEPS 에 MATERIAL_NM 포함 보존
assertMatch(htmlSrc,
    /_MFG_COST_ELEMENT_DEPS\s*=\s*\[\s*['"]CALMONTH['"]\s*,\s*['"]PLANT['"]\s*,\s*['"]MATERIAL_NM['"]/,
    '6-3: PR #547 _MFG_COST_ELEMENT_DEPS 에 MATERIAL_NM 포함 보존 (v4)');

// 6-4: PR #544 __GROUP__PLANT_PAIR 보존
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,2000}['"]__GROUP__PLANT_PAIR['"]/,
    '6-4: PR #544 __GROUP__PLANT_PAIR 보존');

// 6-5: PR #545 __GROUP__DIVISION_PAIR 보존
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,2000}['"]__GROUP__DIVISION_PAIR['"]/,
    '6-5: PR #545 __GROUP__DIVISION_PAIR 보존');

// ============================================================
// 결과 출력
// ============================================================
console.log('\n========================================');
console.log(`PASS: ${PASS}`);
console.log(`FAIL: ${FAIL}`);
console.log('========================================');
if (FAIL > 0) {
    console.log('\n실패한 assertion 목록:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
}
process.exit(0);
