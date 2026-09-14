// ============================================================
// Metric Aggregation Level Classifier 회귀 테스트 (2026-09-14)
// ------------------------------------------------------------
// 배경 (사용자 요구사항):
//   metric 테이블의 aggregation='CALC' 산식은 두 형태로 혼재:
//     (A) ROW_CALC — row-level 산식 (예: ZAMT001-ZAMT002)
//         → 전체 집계 SQL 에서 SUM(formula) 로 감싸야 함
//     (B) AGG_CALC — 이미 aggregate 까지 포함된 완성형 (예: SUM(A)/SUM(B)*100)
//         → 그대로 사용, 외부 SUM 추가 시 이중 집계 오류
//
// 이 PR 이 도입:
//   1) tokenizeSqlExpression                   : 최소 SQL expression 토크나이저
//   2) classifyMetricFormula                   : ROW_CALC / AGG_CALC / INVALID_MIXED 판정
//   3) resolveCanonicalMetricExpression        : 공통 runtime wrapping resolver
//   4) buildCanonicalMetricSqlMap 재구성       : resolver 사용
//
// 사용자 확정 원칙:
//   1) 학습관리 Metric.formula 원본은 절대 수정하지 않음 (DB 값 불변)
//   2) formula 에 집계함수 없음 → SUM(formula) 로 감쌈
//   3) formula 에 이미 집계함수 있음 → 그대로 사용, 외부 SUM 금지
//   4) DB 값 변경이 아닌 SQL 생성 시점의 runtime wrapping 규칙
//   5) 현황집계 / 분석질문 모두 동일 규칙 사용
//
// 사용자 지정 5 회귀 케이스 + tokenizer/classifier unit 테스트.
// ============================================================

import { readFileSync } from 'node:fs';

const src = readFileSync('/home/user/webapp/nlq-server/server.mjs', 'utf8');

// ── 함수 소스 추출 유틸 (기존 테스트와 동일 패턴) ──
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

// 대상 헬퍼: 신규 3종 + 기존 buildCanonicalMetricSqlMap (통합 확인)
// [2026-09-14] buildCanonicalMetricSqlMap 이 이제 normalizeMetricName 을 내부에서 참조 →
//   normalizeMetricName 도 bootstrap 에 포함 (미포함 시 ReferenceError)
const targets = [
  { header: 'function tokenizeSqlExpression(expr) {', name: 'tokenizeSqlExpression' },
  { header: 'function classifyMetricFormula(formula) {', name: 'classifyMetricFormula' },
  { header: 'function resolveCanonicalMetricExpression(metric, opts = {}) {', name: 'resolveCanonicalMetricExpression' },
  { header: 'function normalizeMetricName(name) {', name: 'normalizeMetricName' },
  { header: 'function buildCanonicalMetricSqlMap(metricMap, traceCtx) {', name: 'buildCanonicalMetricSqlMap' },
  { header: 'function expandMetricFormula(formula, _metricMap, _visited = new Set(), _depth = 0) {', name: 'expandMetricFormula' },
];

// AGGREGATE_FUNCTIONS / SCALAR_FUNCTIONS 상수도 필요 (tokenizeSqlExpression + classifyMetricFormula 가 참조)
// 소스에서 상수 선언 추출
function extractConstDecl(source, header) {
  const startIdx = source.indexOf(header);
  if (startIdx === -1) throw new Error(`상수 시작점 없음: ${header}`);
  // ');' 까지 (Set 생성자)
  const endIdx = source.indexOf(');', startIdx);
  if (endIdx === -1) throw new Error(`상수 종료점 없음: ${header}`);
  return source.slice(startIdx, endIdx + 2);
}

let bootstrap = '';
bootstrap += extractConstDecl(src, "const AGGREGATE_FUNCTIONS = new Set(['SUM'") + '\n';
bootstrap += extractConstDecl(src, "const SCALAR_FUNCTIONS = new Set([") + '\n';
// [2026-09-14] buildCanonicalMetricSqlMap 내부에서 __CANONICAL_BY_NORMALIZED Symbol 참조
bootstrap += "const __CANONICAL_BY_NORMALIZED = Symbol('canonicalDescByNormalized');\n";

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

// eval 실행
eval(bootstrap);

const {
  tokenizeSqlExpression,
  classifyMetricFormula,
  resolveCanonicalMetricExpression,
  buildCanonicalMetricSqlMap,
} = globalThis;

// ── 테스트 러너 ──
let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, extra = '') {
  if (cond) {
    passed++;
    origLog(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, extra });
    origLog(`  ✗ ${label}`);
    if (extra) origLog(`      ${extra}`);
  }
}

function assertEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    origLog(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, expected, actual });
    origLog(`  ✗ ${label}`);
    origLog(`      expected: ${JSON.stringify(expected)}`);
    origLog(`      actual:   ${JSON.stringify(actual)}`);
  }
}

// ============================================================
// [Preflight] 헬퍼 함수 로드 확인
// ============================================================
origLog('\n[Preflight] 헬퍼 함수 로드');
assert('tokenizeSqlExpression 로드됨', typeof tokenizeSqlExpression === 'function');
assert('classifyMetricFormula 로드됨', typeof classifyMetricFormula === 'function');
assert('resolveCanonicalMetricExpression 로드됨', typeof resolveCanonicalMetricExpression === 'function');
assert('buildCanonicalMetricSqlMap 로드됨', typeof buildCanonicalMetricSqlMap === 'function');

// ============================================================
// [Unit 1] tokenizeSqlExpression — 토큰화 정확성
// ============================================================
origLog('\n[Unit 1] tokenizeSqlExpression');

{
  const toks = tokenizeSqlExpression('ZAMT001-ZAMT002');
  assertEq('tokenize 개수: ZAMT001-ZAMT002', toks.length, 3);
  assertEq('tokenize[0] type', toks[0].type, 'IDENT');
  assertEq('tokenize[0] value', toks[0].value, 'ZAMT001');
  assertEq('tokenize[1] type', toks[1].type, 'OP');
  assertEq('tokenize[1] value', toks[1].value, '-');
  assertEq('tokenize[2] value', toks[2].value, 'ZAMT002');
}

{
  const toks = tokenizeSqlExpression('SUM(ZAMT001-ZAMT002)');
  const kinds = toks.map(t => t.type).join(',');
  assertEq('tokenize SUM(...): 토큰 구조', kinds, 'IDENT,LPAREN,IDENT,OP,IDENT,RPAREN');
  assertEq('tokenize SUM 인식', toks[0].upper, 'SUM');
}

{
  const toks = tokenizeSqlExpression('  A  +  B  '); // 공백 다수
  assertEq('공백 다수 처리', toks.length, 3);
  assertEq('공백 다수 - IDENT[0]', toks[0].value, 'A');
  assertEq('공백 다수 - IDENT[2]', toks[2].value, 'B');
}

{
  const toks = tokenizeSqlExpression('SUM(A)/NULLIF(SUM(B),0)*100');
  // SUM(IDENT) ( LPAREN ) A(IDENT) ) RPAREN / OP  NULLIF(IDENT) ( LPAREN
  // SUM(IDENT) ( LPAREN ) B(IDENT) ) RPAREN , COMMA 0 NUMBER ) RPAREN * OP  100 NUMBER = 16
  assertEq('중첩 함수 토큰 개수', toks.length, 16);
  // NULLIF 위치 확인
  const nullifIdx = toks.findIndex(t => t.type === 'IDENT' && t.upper === 'NULLIF');
  assert('NULLIF 인식됨', nullifIdx > 0);
}

{
  const toks = tokenizeSqlExpression("CASE WHEN A=1 THEN 'x' ELSE 'y' END");
  const strToks = toks.filter(t => t.type === 'STRING');
  assertEq('문자열 리터럴 인식 개수', strToks.length, 2);
  assertEq('KEYWORD CASE', toks[0].type, 'KEYWORD');
}

{
  const toks = tokenizeSqlExpression('sum(zamt001)'); // 소문자
  assertEq('소문자 SUM 대문자 정규화', toks[0].upper, 'SUM');
  assertEq('소문자 SUM 원본 보존', toks[0].value, 'sum');
}

{
  const toks = tokenizeSqlExpression('');
  assertEq('빈 문자열 → 빈 토큰 배열', toks.length, 0);
}

{
  const toks = tokenizeSqlExpression(null);
  assertEq('null → 빈 토큰 배열', toks.length, 0);
}

// ============================================================
// [Unit 2] classifyMetricFormula — 3-tier 판정
// ============================================================
origLog('\n[Unit 2] classifyMetricFormula');

// ROW_CALC 케이스
assertEq('ROW_CALC: ZAMT001-ZAMT002',
  classifyMetricFormula('ZAMT001-ZAMT002').kind, 'ROW_CALC');
assertEq('ROW_CALC: 단순 컬럼 하나',
  classifyMetricFormula('ZAMT001').kind, 'ROW_CALC');
assertEq('ROW_CALC: 다중 컬럼 사칙연산',
  classifyMetricFormula('ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047').kind,
  'ROW_CALC');
assertEq('ROW_CALC: 괄호 있는 산식',
  classifyMetricFormula('ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)').kind,
  'ROW_CALC');
assertEq('ROW_CALC: NULLIF (scalar function) 만 있음',
  classifyMetricFormula('NULLIF(ZAMT001,0)').kind,
  'ROW_CALC');
assertEq('ROW_CALC: ROUND (scalar function)',
  classifyMetricFormula('ROUND(ZAMT001*1.1, 2)').kind,
  'ROW_CALC');

// AGG_CALC 케이스
assertEq('AGG_CALC: SUM(ZAMT001)',
  classifyMetricFormula('SUM(ZAMT001)').kind, 'AGG_CALC');
assertEq('AGG_CALC: SUM(A-B)',
  classifyMetricFormula('SUM(ZAMT001-ZAMT002)').kind, 'AGG_CALC');
assertEq('AGG_CALC: SUM(A)/SUM(B)*100 (사용자 예2 영업이익률)',
  classifyMetricFormula('SUM(ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)-(ZAMT037+ZAMT038)) / SUM(ZAMT001-ZAMT002) * 100').kind,
  'AGG_CALC');
assertEq('AGG_CALC: SUM(A)/NULLIF(SUM(B),0)*100',
  classifyMetricFormula('SUM(A)/NULLIF(SUM(B),0)*100').kind,
  'AGG_CALC');
assertEq('AGG_CALC: 소문자 sum()',
  classifyMetricFormula('sum(zamt001)').kind, 'AGG_CALC');
assertEq('AGG_CALC: AVG',
  classifyMetricFormula('AVG(ZAMT001)').kind, 'AGG_CALC');
assertEq('AGG_CALC: COUNT',
  classifyMetricFormula('COUNT(ZAMT001)').kind, 'AGG_CALC');
assertEq('AGG_CALC: MAX/MIN 조합',
  classifyMetricFormula('MAX(A)-MIN(B)').kind, 'AGG_CALC');
assertEq('AGG_CALC: SUM 안에 NULLIF (nested)',
  classifyMetricFormula('SUM(NULLIF(ZAMT001,0))').kind, 'AGG_CALC');

// INVALID_MIXED 케이스
assertEq('INVALID_MIXED: SUM(A)+B',
  classifyMetricFormula('SUM(A)+B').kind, 'INVALID_MIXED');
assertEq('INVALID_MIXED: A+SUM(B)',
  classifyMetricFormula('A+SUM(B)').kind, 'INVALID_MIXED');
assertEq('INVALID_MIXED: SUM(A)-COUNT(B)+C',
  classifyMetricFormula('SUM(A)-COUNT(B)+C').kind, 'INVALID_MIXED');

// Edge cases
assertEq('Edge: 빈 문자열',
  classifyMetricFormula('').kind, 'ROW_CALC');
assertEq('Edge: 공백만',
  classifyMetricFormula('   ').kind, 'ROW_CALC');
assertEq('Edge: 숫자 리터럴만 (raw column 없음)',
  classifyMetricFormula('100').kind, 'ROW_CALC');
assertEq('Edge: null',
  classifyMetricFormula(null).kind, 'ROW_CALC');

// ============================================================
// [Unit 3] resolveCanonicalMetricExpression — runtime wrapping
// ============================================================
origLog('\n[Unit 3] resolveCanonicalMetricExpression');

// ROW_CALC + AGGREGATE → SUM 감쌈
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'ZAMT001-ZAMT002', aggregation: 'CALC', description: '순매출' },
    { queryGrain: 'AGGREGATE' }
  );
  assert('resolve ROW_CALC + AGGREGATE: ok', r.ok);
  assertEq('resolve ROW_CALC + AGGREGATE: kind', r.kind, 'ROW_CALC');
  assertEq('resolve ROW_CALC + AGGREGATE: SUM 감쌈', r.expr, 'SUM(ZAMT001-ZAMT002)');
  assert('resolve ROW_CALC + AGGREGATE: wrapped=true', r.wrapped === true);
}

// ROW_CALC + ROW → 그대로
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'ZAMT001-ZAMT002', aggregation: 'CALC' },
    { queryGrain: 'ROW' }
  );
  assertEq('resolve ROW_CALC + ROW: 그대로', r.expr, 'ZAMT001-ZAMT002');
  assert('resolve ROW_CALC + ROW: wrapped=false', r.wrapped === false);
}

// AGG_CALC → 그대로 (외부 SUM 금지)
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'SUM(A)/NULLIF(SUM(B),0)*100', aggregation: 'CALC', description: '영업이익률' },
    { queryGrain: 'AGGREGATE' }
  );
  assertEq('resolve AGG_CALC: 그대로', r.expr, 'SUM(A)/NULLIF(SUM(B),0)*100');
  assertEq('resolve AGG_CALC: kind', r.kind, 'AGG_CALC');
  assert('resolve AGG_CALC: wrapped=false', r.wrapped === false);
  assert('resolve AGG_CALC: SUM(SUM(...)) 방지 (외부 SUM 없음)', !r.expr.startsWith('SUM(SUM'));
}

// aggregation='SUM' 명시 + formula 는 raw → aggregation 지정대로 감쌈
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'ZAMT001-ZAMT002', aggregation: 'SUM', description: '순매출' },
    { queryGrain: 'AGGREGATE' }
  );
  assertEq('resolve aggregation=SUM + row formula: SUM 감쌈', r.expr, 'SUM(ZAMT001-ZAMT002)');
}

// aggregation='SUM' 명시 + formula 는 이미 AGG → 이중집계 방지 (formula 그대로)
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'SUM(A)/SUM(B)', aggregation: 'SUM', description: '이상케이스' },
    { queryGrain: 'AGGREGATE' }
  );
  assertEq('resolve aggregation=SUM + AGG formula: 이중집계 방지', r.expr, 'SUM(A)/SUM(B)');
  assert('resolve aggregation=SUM + AGG formula: SUM(SUM(...)) 없음', !r.expr.includes('SUM(SUM'));
}

// INVALID_MIXED → formula 그대로 + 에러 로그 (원본 신뢰 원칙)
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'SUM(A)+B', aggregation: 'CALC', description: '잘못된 metric' },
    { queryGrain: 'AGGREGATE' }
  );
  assertEq('resolve INVALID_MIXED: formula 그대로', r.expr, 'SUM(A)+B');
  assertEq('resolve INVALID_MIXED: kind', r.kind, 'INVALID_MIXED');
  // 이중 감쌈이 아니라 = 원본 그대로 = "SUM(SUM(A)+B)" 형태가 아님
  assert('resolve INVALID_MIXED: SUM(SUM(A)+B) 이중 감쌈 없음', !/^SUM\s*\(\s*SUM/.test(r.expr));
  assert('resolve INVALID_MIXED: wrapped=false', r.wrapped === false);
}

// aggregation='AVG'/'COUNT'/'MAX'/'MIN'
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'ZAMT001', aggregation: 'AVG' },
    { queryGrain: 'AGGREGATE' }
  );
  assertEq('resolve aggregation=AVG', r.expr, 'AVG(ZAMT001)');
}
{
  const r = resolveCanonicalMetricExpression(
    { formula: 'ZAMT001', aggregation: 'COUNT' },
    { queryGrain: 'AGGREGATE' }
  );
  assertEq('resolve aggregation=COUNT', r.expr, 'COUNT(ZAMT001)');
}

// 빈 formula
{
  const r = resolveCanonicalMetricExpression(
    { formula: '', aggregation: 'CALC' },
    {}
  );
  assert('resolve empty formula: ok=false', r.ok === false);
}

// ============================================================
// [Integration] 사용자 지정 5 회귀 케이스
// ------------------------------------------------------------
// 이 5 케이스는 사용자가 반드시 통과해야 한다고 명시한 케이스.
// (session 문맥의 "Regression tests (5 cases required)")
// ============================================================
origLog('\n[Integration] 사용자 지정 5 회귀 케이스');

// Case 1: 순매출 (ROW_CALC) → SUM(ZAMT001-ZAMT002)
{
  const metricMap = {
    ZAMT003: {
      aggregation: 'CALC',
      formula: 'ZAMT001-ZAMT002',
      description: '순매출',
    },
  };
  const canonical = buildCanonicalMetricSqlMap(metricMap);
  assertEq('Case 1: 순매출 canonical SQL',
    canonical['순매출'], 'SUM(ZAMT001-ZAMT002)');
}

// Case 2: 판매관리비 (ROW_CALC) → SUM(ZAMT037+...+ZAMT047)
{
  const metricMap = {
    METRIC_SGA: {
      aggregation: 'CALC',
      formula: 'ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047',
      description: '판매관리비',
    },
  };
  const canonical = buildCanonicalMetricSqlMap(metricMap);
  assertEq('Case 2: 판매관리비 canonical SQL',
    canonical['판매관리비'],
    'SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047)');
}

// Case 3: 매출총이익 (ROW_CALC with 괄호) → SUM(<formula>)
{
  const metricMap = {
    ZAMT035: {
      aggregation: 'CALC',
      formula: 'ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)',
      description: '매출총이익',
    },
  };
  const canonical = buildCanonicalMetricSqlMap(metricMap);
  assertEq('Case 3: 매출총이익 canonical SQL',
    canonical['매출총이익'],
    'SUM(ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008))');
}

// Case 4: 영업이익률 (AGG_CALC) → DB formula 그대로, no SUM(SUM(...)/SUM(...)*100)
{
  const opFormula = 'SUM(ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)-(ZAMT037+ZAMT038)) / NULLIF(SUM(ZAMT001-ZAMT002),0) * 100';
  const metricMap = {
    METRIC_OP_RATE: {
      aggregation: 'CALC',
      formula: opFormula,
      description: '영업이익률',
    },
  };
  const canonical = buildCanonicalMetricSqlMap(metricMap);
  assertEq('Case 4: 영업이익률 canonical SQL (그대로)',
    canonical['영업이익률'], opFormula);
  assert('Case 4: 이중 SUM 없음', !canonical['영업이익률'].startsWith('SUM(SUM'));
  assert('Case 4: 시작이 SUM((SUM(...) 형태가 아님',
    !/^SUM\s*\(\s*SUM/.test(canonical['영업이익률']));
}

// Case 5: 동일 metric → buildCanonicalMetricSqlMap 결과가 현황집계/분석질문 경로에서 동일
//   (실제로는 두 경로가 모두 buildCanonicalMetricSqlMap 을 호출하므로, 여기서는 map 결정론성 확인)
{
  const metricMap = {
    ZAMT003: { aggregation: 'CALC', formula: 'ZAMT001-ZAMT002', description: '순매출' },
    METRIC_SGA: { aggregation: 'CALC', formula: 'ZAMT037+ZAMT038', description: '판매관리비' },
    METRIC_OP_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(ZAMT001-ZAMT002-ZAMT037) / SUM(ZAMT001-ZAMT002) * 100',
      description: '영업이익률',
    },
  };
  const c1 = buildCanonicalMetricSqlMap(metricMap);
  const c2 = buildCanonicalMetricSqlMap(metricMap);
  const c3 = buildCanonicalMetricSqlMap(metricMap);
  assertEq('Case 5: 순매출 3회 반복 결정론',
    `${c1['순매출']}|${c2['순매출']}|${c3['순매출']}`,
    'SUM(ZAMT001-ZAMT002)|SUM(ZAMT001-ZAMT002)|SUM(ZAMT001-ZAMT002)');
  assertEq('Case 5: 판매관리비 3회 반복 결정론',
    `${c1['판매관리비']}|${c2['판매관리비']}`,
    'SUM(ZAMT037+ZAMT038)|SUM(ZAMT037+ZAMT038)');
  assertEq('Case 5: 영업이익률 3회 반복 결정론 (AGG_CALC 그대로)',
    `${c1['영업이익률']}|${c2['영업이익률']}`,
    `${metricMap.METRIC_OP_RATE.formula}|${metricMap.METRIC_OP_RATE.formula}`);
  assert('Case 5: 영업이익률에 외부 SUM 이 추가되지 않음',
    !c1['영업이익률'].startsWith('SUM(SUM'));
}

// ============================================================
// [Integration] 사용자 재현 버그 시나리오 — 문서 상단 인용
// ------------------------------------------------------------
// 사용자가 발견한 실제 잘못된 SQL:
//   (ZAMT001-ZAMT002) AS `순매출`,              -- SUM 없음 (ROW_CALC 미판정)
//   (SUM(ZAMT004)) AS `기타매출`,               -- inconsistent
//   (ZAMT001-ZAMT002+...) AS `매출총이익`,      -- SUM 없음
//   (SUM(...)/NULLIF(SUM(...),0)*100) AS `영업이익률`  -- 이건 정상
// FROM ... LIMIT 1
//
// 이 PR 이후: 모든 ROW_CALC 는 SUM 감싸지고, AGG_CALC 는 그대로.
// ============================================================
origLog('\n[Integration] 사용자 재현 버그 시나리오');

{
  const bugFormulaMap = {
    ZAMT003:        { aggregation: 'CALC', formula: 'ZAMT001-ZAMT002', description: '순매출' },
    ZAMT004:        { aggregation: 'SUM',  formula: 'ZAMT004', description: '기타매출' },
    ZAMT035:        { aggregation: 'CALC', formula: 'ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)', description: '매출총이익' },
    METRIC_OP_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(ZAMT001-ZAMT002-ZAMT037)/NULLIF(SUM(ZAMT001-ZAMT002),0)*100',
      description: '영업이익률',
    },
  };
  const canonical = buildCanonicalMetricSqlMap(bugFormulaMap);

  // 순매출: 이제 SUM 감싸짐 (버그 수정)
  assertEq('버그 재현 → 순매출 SUM 감쌈',
    canonical['순매출'], 'SUM(ZAMT001-ZAMT002)');
  // 기타매출: SUM aggregation → SUM(ZAMT004)
  assertEq('버그 재현 → 기타매출 SUM',
    canonical['기타매출'], 'SUM(ZAMT004)');
  // 매출총이익: 이제 SUM 감싸짐 (버그 수정)
  assertEq('버그 재현 → 매출총이익 SUM 감쌈',
    canonical['매출총이익'], 'SUM(ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008))');
  // 영업이익률: 그대로 (버그 없었음, 유지 확인)
  assertEq('버그 재현 → 영업이익률 그대로 유지 (AGG_CALC)',
    canonical['영업이익률'],
    'SUM(ZAMT001-ZAMT002-ZAMT037)/NULLIF(SUM(ZAMT001-ZAMT002),0)*100');

  // 모든 metric 은 결과가 aggregate expression 이어야 함
  // (SELECT 절에 넣었을 때 LIMIT 1 이든 없든 도메인 전체 합계가 나와야 함)
  for (const [desc, expr] of Object.entries(canonical)) {
    assert(`aggregate expression: ${desc}`,
      /^(SUM|AVG|COUNT|MAX|MIN)\s*\(|SUM\s*\(|\)\s*\/\s*NULLIF\s*\(\s*SUM/.test(expr) ||
      expr.includes('SUM(') || expr.includes('AVG(') || expr.includes('COUNT('),
      `expr="${expr}" 에 aggregate function 이 포함되어야 함`
    );
  }
}

// ============================================================
// [Integration] 현황집계/분석질문 동일 규칙 검증
// ------------------------------------------------------------
// 두 경로가 정말 동일 helper 를 통과하는지 확인 —
// 같은 metric 정의를 두 경로가 각각 처리했을 때 결과 표현식이
// 완전 동일해야 함.
// ============================================================
origLog('\n[Integration] 현황집계/분석질문 동일 규칙');

{
  const metrics = [
    { formula: 'ZAMT001-ZAMT002', aggregation: 'CALC', description: '순매출' },
    { formula: 'ZAMT037+ZAMT038+ZAMT039', aggregation: 'CALC', description: '판매관리비' },
    { formula: 'SUM(A)/NULLIF(SUM(B),0)*100', aggregation: 'CALC', description: '영업이익률' },
  ];

  for (const m of metrics) {
    // 경로 1: 현황집계 방식 — buildCanonicalMetricSqlMap 을 통해
    const mMap = { [m.description]: m };
    const canonical = buildCanonicalMetricSqlMap(mMap);
    const viaAggregate = canonical[m.description];

    // 경로 2: 분석질문 방식 — resolveCanonicalMetricExpression 직접 호출
    const resolved = resolveCanonicalMetricExpression(m, { queryGrain: 'AGGREGATE' });
    const viaAnalysis = resolved.expr;

    assertEq(`동일 규칙: ${m.description}`, viaAggregate, viaAnalysis);
  }
}

// ============================================================
// [Integration] LLM guardrail — resolver 는 canonical formula 를 수정하지 않음
// ------------------------------------------------------------
// 원본 formula 는 절대 수정되지 않고, 오직 runtime wrapping 만 함.
// ============================================================
origLog('\n[Integration] LLM guardrail — 원본 formula 불변');

{
  const original = 'ZAMT001-ZAMT002';
  const metric = { formula: original, aggregation: 'CALC', description: '순매출' };
  const before = metric.formula;

  resolveCanonicalMetricExpression(metric, { queryGrain: 'AGGREGATE' });
  resolveCanonicalMetricExpression(metric, { queryGrain: 'ROW' });
  buildCanonicalMetricSqlMap({ M: metric });

  assertEq('원본 formula 불변 (ROW_CALC)', metric.formula, before);
}

{
  const original = 'SUM(A)/SUM(B)*100';
  const metric = { formula: original, aggregation: 'CALC', description: '비율' };
  const before = metric.formula;

  resolveCanonicalMetricExpression(metric, { queryGrain: 'AGGREGATE' });
  buildCanonicalMetricSqlMap({ M: metric });

  assertEq('원본 formula 불변 (AGG_CALC)', metric.formula, before);
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
