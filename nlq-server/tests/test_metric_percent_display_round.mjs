// ============================================================
// 비율/률/% 결과값 표시용 정수 반올림 규칙 회귀 테스트 (2026-09-14)
// ------------------------------------------------------------
// 사용자 확정 원칙 [비율/률/% 계열 결과값 소수점 반올림 처리]:
//   1) 학습관리 Metric 의 canonical formula 원본 자체는 수정하지 않음
//   2) *100 포함 여부 등 기존 산식은 그대로 유지 —
//      최종 사용자 노출값에만 ROUND(..., 0) 적용
//   3) 내부 분석/비교/정렬 등 계산에는 원래 정밀값을 유지하고,
//      화면 표 및 최종 답변에 표시할 때만 정수 반올림
//   4) TRUNCATE/절삭이 아니라 ROUND 반올림 (SQL 의 half-away-from-zero:
//      -5.6 → -6, 5.6 → 6, -5.4257 → -5, 19.0407 → 19)
//   5) 현황집계 / 분석질문 모두 동일 적용
//
// 이 PR 이 도입:
//   1. isPercentAlias                — alias 가 비율/률/% 성격인지 판정
//   2. wrapWithDisplayRounding       — 표현식에 ROUND(..., 0) 감쌈 (idempotent)
//   3. applyPercentDisplayRoundingToSql — SQL 후처리 (top-level SELECT 만)
//
// 적용 지점 (양쪽 경로 공통):
//   - applyMetricFormulaReplacement  → 현황집계 경로 모든 SQL 실행 직전
//   - executeAnalysisPlan            → 분석질문 경로 SQL 실행 직전
// ============================================================

import { readFileSync } from 'node:fs';

const src = readFileSync('/home/user/webapp/nlq-server/server.mjs', 'utf8');

function extractFunctionSource(source, header) {
  const startIdx = source.indexOf(header);
  if (startIdx === -1) throw new Error(`함수 시작점 없음: ${header}`);
  let cursor = startIdx + header.length;
  let depth = 1;
  while (cursor < source.length && depth > 0) {
    const ch = source[cursor];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    cursor++;
  }
  return source.slice(startIdx, cursor);
}

function extractSingleLineConst(source, header) {
  const startIdx = source.indexOf(header);
  if (startIdx === -1) throw new Error(`상수 미발견: ${header}`);
  const endIdx = source.indexOf('\n', startIdx);
  return source.slice(startIdx, endIdx);
}

const targets = [
  { header: 'function isPercentAlias(alias) {', name: 'isPercentAlias' },
  { header: 'function wrapWithDisplayRounding(expr) {', name: 'wrapWithDisplayRounding' },
  { header: 'function applyPercentDisplayRoundingToSql(sql) {', name: 'applyPercentDisplayRoundingToSql' },
];

let bootstrap = '';
// 3개 정규식 상수도 함께 로드
bootstrap += extractSingleLineConst(src, 'const PERCENT_ALIAS_POSITIVE_RE =') + '\n';
bootstrap += extractSingleLineConst(src, 'const PERCENT_ALIAS_NEGATIVE_RE =') + '\n';
bootstrap += extractSingleLineConst(src, 'const PERCENT_ALIAS_LIQUID_SUFFIX_RE =') + '\n';

for (const t of targets) {
  const fnSrc = extractFunctionSource(src, t.header);
  bootstrap += fnSrc.replace(`function ${t.name}`, `globalThis.${t.name} = function `) + '\n';
}

// 로그 노이즈 억제
const origWarn = console.warn;
const origError = console.error;
const origLog = console.log;
console.warn = () => {};
console.error = () => {};

eval(bootstrap);

const {
  isPercentAlias,
  wrapWithDisplayRounding,
  applyPercentDisplayRoundingToSql,
} = globalThis;

// ── 테스트 러너 ──
let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, extra = '') {
  if (cond) { passed++; origLog(`  ✓ ${label}`); }
  else {
    failed++; failures.push({ label, extra });
    origLog(`  ✗ ${label}`);
    if (extra) origLog(`      ${extra}`);
  }
}
function assertEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { passed++; origLog(`  ✓ ${label}`); }
  else {
    failed++; failures.push({ label, expected, actual });
    origLog(`  ✗ ${label}`);
    origLog(`      expected: ${JSON.stringify(expected)}`);
    origLog(`      actual:   ${JSON.stringify(actual)}`);
  }
}

// ============================================================
// [Preflight]
// ============================================================
origLog('\n[Preflight] 헬퍼 로드');
assert('isPercentAlias 로드됨', typeof isPercentAlias === 'function');
assert('wrapWithDisplayRounding 로드됨', typeof wrapWithDisplayRounding === 'function');
assert('applyPercentDisplayRoundingToSql 로드됨', typeof applyPercentDisplayRoundingToSql === 'function');

// ============================================================
// [Unit 1] isPercentAlias — 판정 규칙
// ============================================================
origLog('\n[Unit 1] isPercentAlias');

// positive
assert('positive: 영업이익률(%)', isPercentAlias('영업이익률(%)'));
assert('positive: 매출총이익률(%)', isPercentAlias('매출총이익률(%)'));
assert('positive: 영업이익률 (synonym, 접미사 없음)', isPercentAlias('영업이익률'));
assert('positive: 매출총이익률', isPercentAlias('매출총이익률'));
assert('positive: 판매비율', isPercentAlias('판매비율'));
assert('positive: 성장률', isPercentAlias('성장률'));
assert('positive: 증감률', isPercentAlias('증감률'));
assert('positive: 반품률', isPercentAlias('반품률'));
assert('positive: 점유율(%)', isPercentAlias('점유율(%)'));
assert('positive: growth rate', isPercentAlias('growth rate'));
assert('positive: conversion ratio', isPercentAlias('conversion ratio'));
assert('positive: PERCENT (대문자)', isPercentAlias('PERCENT VALUE'));

// negative — positive keyword 없음
assert('negative: 총매출', !isPercentAlias('총매출'));
assert('negative: 순매출', !isPercentAlias('순매출'));
assert('negative: 판매관리비', !isPercentAlias('판매관리비'));
assert('negative: 매출총이익', !isPercentAlias('매출총이익'));
assert('negative: 영업이익', !isPercentAlias('영업이익'));
assert('negative: 평균단가(BOX)', !isPercentAlias('평균단가(BOX)'));

// negative override — positive keyword 있어도 금액/수량 접미사 있음
assert('negative override: 매출액 (액 접미사)', !isPercentAlias('매출액'));
assert('negative override: 판매액', !isPercentAlias('판매액'));
assert('negative override: 판매관리비(원)', !isPercentAlias('판매관리비(원)'));
assert('negative override: 인건비합계', !isPercentAlias('인건비합계'));
assert('negative override: 합계금액', !isPercentAlias('합계금액'));
assert('negative override: 평균단가(원/BOX)', !isPercentAlias('평균단가(원/BOX)'));

// edge
assert('edge: 빈 문자열', !isPercentAlias(''));
assert('edge: null', !isPercentAlias(null));
assert('edge: undefined', !isPercentAlias(undefined));
assert('edge: 숫자', !isPercentAlias(123));

// ============================================================
// [Unit 2] wrapWithDisplayRounding — idempotent
// ============================================================
origLog('\n[Unit 2] wrapWithDisplayRounding');

assertEq('신규 wrap: 단순 식',
  wrapWithDisplayRounding('SUM(A)/SUM(B)*100'),
  'ROUND(SUM(A)/SUM(B)*100, 0)');

assertEq('신규 wrap: 공백 있음',
  wrapWithDisplayRounding('  SUM(A)/SUM(B)*100  '),
  'ROUND(SUM(A)/SUM(B)*100, 0)');

// 이미 ROUND 로 시작 → no-op
assertEq('idempotent: ROUND(...) 유지',
  wrapWithDisplayRounding('ROUND(SUM(A)/SUM(B)*100, 2)'),
  'ROUND(SUM(A)/SUM(B)*100, 2)');

// 이미 FORMAT(ROUND(...)) → no-op
assertEq('idempotent: FORMAT(ROUND(...)) 유지',
  wrapWithDisplayRounding('FORMAT(ROUND(SUM(A), 1), 1)'),
  'FORMAT(ROUND(SUM(A), 1), 1)');

assertEq('빈 문자열 안전', wrapWithDisplayRounding(''), '');
assertEq('null 안전', wrapWithDisplayRounding(null), null);

// ============================================================
// [Unit 3] applyPercentDisplayRoundingToSql — SQL 후처리
// ============================================================
origLog('\n[Unit 3] applyPercentDisplayRoundingToSql');

// 3-1: 사용자 재현 케이스 — 영업이익률 (LLM synonym alias, *100 이미 포함)
{
  const input = `SELECT (SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100) AS \`영업이익률\` FROM bw_profitability_data WHERE CALMONTH='202608'`;
  const expected = `SELECT ROUND((SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100), 0) AS \`영업이익률\` FROM bw_profitability_data WHERE CALMONTH='202608'`;
  assertEq('사용자 재현: 영업이익률 → ROUND(..., 0)', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-2: canonical description ("영업이익률(%)") alias
{
  const input = `SELECT SUM(A)/NULLIF(SUM(B),0)*100 AS '영업이익률(%)' FROM tbl`;
  const expected = `SELECT ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 0) AS '영업이익률(%)' FROM tbl`;
  assertEq('canonical alias: 영업이익률(%)', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-3: 매출총이익률
{
  const input = `SELECT SUM(A)/NULLIF(SUM(B),0)*100 AS '매출총이익률' FROM tbl`;
  const expected = `SELECT ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 0) AS '매출총이익률' FROM tbl`;
  assertEq('매출총이익률 alias', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-4: 여러 metric 함께 — 비율만 wrap, 금액은 유지
{
  const input = `SELECT SUM(ZAMT001) AS '총매출', SUM(A)/NULLIF(SUM(B),0)*100 AS '영업이익률' FROM tbl`;
  const expected = `SELECT SUM(ZAMT001) AS '총매출', ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 0) AS '영업이익률' FROM tbl`;
  assertEq('혼합: 비율만 wrap, 금액 유지', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-5: 이미 ROUND → no-op
{
  const input = `SELECT ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 2) AS '영업이익률(%)' FROM tbl`;
  const expected = input;
  assertEq('이미 ROUND(..., 2) → 존중', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-6: 이미 FORMAT(ROUND(...)) → no-op
{
  const input = `SELECT FORMAT(ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 1), 1) AS '영업이익률(%)' FROM tbl`;
  const expected = input;
  assertEq('이미 FORMAT(ROUND(...)) → 존중', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-7: 금액 metric (원 접미사) → 변경 없음
{
  const input = `SELECT SUM(ZAMT001) AS '총매출(원)', SUM(ZAMT037) AS '판매관리비(원)' FROM tbl`;
  assertEq('금액 metric: 변경 없음', applyPercentDisplayRoundingToSql(input), input);
}

// 3-8: 수량/평균단가 metric — 변경 없음
{
  const input = `SELECT SUM(ZQTY_BOX) AS 'BOX수량', SUM(ZAMT001)/NULLIF(SUM(ZQTY_BOX),0) AS '평균단가(BOX)' FROM tbl`;
  assertEq('수량/단가 metric: 변경 없음', applyPercentDisplayRoundingToSql(input), input);
}

// 3-9: 미등록 비율 계산 (LLM 즉석 산식) — wrap
{
  const input = `SELECT (SUM(RETURN)/NULLIF(SUM(SALES),0))*100 AS '반품률' FROM tbl`;
  const expected = `SELECT ROUND((SUM(RETURN)/NULLIF(SUM(SALES),0))*100, 0) AS '반품률' FROM tbl`;
  assertEq('미등록 반품률 → wrap', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-10: 서브쿼리 안 표현식은 건드리지 않음 (top-level SELECT 만 처리)
{
  const input = `SELECT x.영업이익률 FROM (SELECT SUM(A)/SUM(B)*100 AS '영업이익률' FROM tbl) x`;
  // top-level SELECT 는 x.영업이익률 (alias 없음) — wrap 안 됨
  // 서브쿼리 안은 top-level 이 아니므로 건드리지 않음
  const result = applyPercentDisplayRoundingToSql(input);
  assert('서브쿼리 안 SELECT: 건드리지 않음 (top-level 만)', result === input);
}

// 3-11: WHERE / GROUP BY / ORDER BY 절 — 영향 없음
{
  const input = `SELECT SUM(A)/NULLIF(SUM(B),0)*100 AS '영업이익률' FROM tbl WHERE DIVISION='10' GROUP BY MATERIAL ORDER BY SUM(A)/NULLIF(SUM(B),0) DESC LIMIT 30`;
  const expected = `SELECT ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 0) AS '영업이익률' FROM tbl WHERE DIVISION='10' GROUP BY MATERIAL ORDER BY SUM(A)/NULLIF(SUM(B),0) DESC LIMIT 30`;
  assertEq('WHERE/GROUP BY/ORDER BY 영향 없음', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-12: 백틱 alias
{
  const input = 'SELECT SUM(A)/SUM(B)*100 AS `영업이익률(%)` FROM tbl';
  const expected = 'SELECT ROUND(SUM(A)/SUM(B)*100, 0) AS `영업이익률(%)` FROM tbl';
  assertEq('백틱 alias', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-13: 큰따옴표 alias
{
  const input = `SELECT SUM(A)/SUM(B)*100 AS "이익률" FROM tbl`;
  const expected = `SELECT ROUND(SUM(A)/SUM(B)*100, 0) AS "이익률" FROM tbl`;
  assertEq('큰따옴표 alias', applyPercentDisplayRoundingToSql(input), expected);
}

// 3-14: 매출액 (액 접미사) → 변경 없음
{
  const input = `SELECT SUM(ZAMT001) AS '매출액' FROM tbl`;
  assertEq('매출액: 액 접미사로 비율 아님', applyPercentDisplayRoundingToSql(input), input);
}

// 3-15: 합계 접미사 → 변경 없음 (인건비합계 등)
{
  const input = `SELECT SUM(ZAMT037+ZAMT038) AS '인건비합계' FROM tbl`;
  assertEq('합계 접미사: 변경 없음', applyPercentDisplayRoundingToSql(input), input);
}

// 3-16: 빈 SQL / null 안전
assertEq('빈 문자열 안전', applyPercentDisplayRoundingToSql(''), '');
assertEq('null 안전', applyPercentDisplayRoundingToSql(null), null);

// 3-17: SELECT 없는 문자열 → no-op
{
  const input = `UPDATE tbl SET x=1`;
  assertEq('SELECT 없음: 변경 없음', applyPercentDisplayRoundingToSql(input), input);
}

// 3-18: FROM 없는 SQL (subquery 단독 등) → no-op
{
  const input = `SELECT SUM(A)*100 AS '이익률'`;
  assertEq('FROM 없음: 변경 없음', applyPercentDisplayRoundingToSql(input), input);
}

// ============================================================
// [Integration] 사용자 재현 시나리오 — 두 경로 통과 결과 동일
// ============================================================
origLog('\n[Integration] 사용자 재현 — 현황집계 vs 분석질문 동일 규칙');

{
  // 현황집계 SQL (사용자 예1)
  const sqlAgg = `SELECT SUM(ZAMT001-ZAMT002 + ZAMT004-(ZAMT006+ZAMT007+ZAMT008))/NULLIF(SUM(ZAMT001-ZAMT002),0)*100 AS '영업이익률(%)' FROM bw_profitability_data WHERE DIVISION='10' AND CALMONTH='202608'`;
  const roundedAgg = applyPercentDisplayRoundingToSql(sqlAgg);
  assert('현황집계: ROUND 감쌈', roundedAgg.includes('ROUND('));
  assert('현황집계: *100 유지', roundedAgg.includes('*100'));
  assert('현황집계: alias 유지', roundedAgg.includes(`AS '영업이익률(%)'`));

  // 분석질문 SQL (사용자 예2, synonym alias)
  const sqlAnalysis = `SELECT (SUM(ZAMT001-ZAMT002 + ZAMT004-(ZAMT006+ZAMT007+ZAMT008))/NULLIF(SUM(ZAMT001-ZAMT002),0)*100) AS \`영업이익률\` FROM bw_profitability_data WHERE DIVISION='10' AND CALMONTH='202608'`;
  const roundedAnalysis = applyPercentDisplayRoundingToSql(sqlAnalysis);
  assert('분석질문: ROUND 감쌈', roundedAnalysis.includes('ROUND('));
  assert('분석질문: *100 유지', roundedAnalysis.includes('*100'));
  assert('분석질문: alias 유지', roundedAnalysis.includes('영업이익률'));
}

// ============================================================
// [Integration] 원본 mutation 없음 (사용자 원칙 1)
// ============================================================
origLog('\n[Integration] 원본 mutation 없음');

{
  const original = `SELECT SUM(A)/SUM(B)*100 AS '이익률' FROM tbl`;
  const originalCopy = original;
  applyPercentDisplayRoundingToSql(original);
  assertEq('원본 문자열 불변 (JS string 은 immutable 이지만 참조 확인)',
    original, originalCopy);
}

// ============================================================
// [Integration] 회귀 방지 — 기존 metric 여러 개 함께
// ============================================================
origLog('\n[Integration] 회귀 방지');

{
  const input = `SELECT
    SUM(ZAMT001) AS '총매출',
    SUM(ZAMT002) AS '판매장려금',
    SUM(ZAMT001-ZAMT002) AS '순매출',
    SUM(ZAMT037+ZAMT038) AS '판매관리비',
    SUM(ZAMT035)/NULLIF(SUM(ZAMT003),0)*100 AS '매출총이익률(%)',
    SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100 AS '영업이익률(%)',
    SUM(ZAMT001)/NULLIF(SUM(ZQTY_BOX),0) AS '평균단가(BOX)'
  FROM bw_profitability_data
  WHERE CALMONTH='202608'`;
  const output = applyPercentDisplayRoundingToSql(input);

  // 비율만 wrap 됐는지 검증
  assert('총매출 unchanged', output.includes(`SUM(ZAMT001) AS '총매출'`));
  assert('판매장려금 unchanged', output.includes(`SUM(ZAMT002) AS '판매장려금'`));
  assert('순매출 unchanged', output.includes(`SUM(ZAMT001-ZAMT002) AS '순매출'`));
  assert('판매관리비 unchanged', output.includes(`SUM(ZAMT037+ZAMT038) AS '판매관리비'`));
  assert('평균단가(BOX) unchanged', output.includes(`SUM(ZAMT001)/NULLIF(SUM(ZQTY_BOX),0) AS '평균단가(BOX)'`));

  // 비율은 ROUND 로 감쌈
  assert('매출총이익률 ROUND 감쌈',
    output.includes(`ROUND(SUM(ZAMT035)/NULLIF(SUM(ZAMT003),0)*100, 0) AS '매출총이익률(%)'`));
  assert('영업이익률 ROUND 감쌈',
    output.includes(`ROUND(SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100, 0) AS '영업이익률(%)'`));

  // 이중 ROUND 없음
  assert('이중 ROUND 없음', !output.includes('ROUND(ROUND'));
}

// ============================================================
// [Integration] 이중 적용 안전성 (idempotent SQL 후처리)
// ============================================================
origLog('\n[Integration] 이중 적용 안전성');

{
  const input = `SELECT SUM(A)/SUM(B)*100 AS '이익률' FROM tbl`;
  const once = applyPercentDisplayRoundingToSql(input);
  const twice = applyPercentDisplayRoundingToSql(once);
  assertEq('이중 적용 안전 (idempotent)', once, twice);
}

// ============================================================
// 결과 요약
// ============================================================
console.warn = origWarn;
console.error = origError;
console.log = origLog;

origLog('\n============================================================');
origLog(`[Test Result] passed=${passed}  failed=${failed}  total=${passed + failed}`);
origLog('============================================================');

if (failed > 0) {
  origLog('\n[Failures]');
  for (const f of failures) {
    origLog(`  - ${f.label}`);
    if (f.expected !== undefined) {
      origLog(`      expected: ${JSON.stringify(f.expected)}`);
      origLog(`      actual:   ${JSON.stringify(f.actual)}`);
    }
    if (f.extra) origLog(`      ${f.extra}`);
  }
  process.exit(1);
}
process.exit(0);
