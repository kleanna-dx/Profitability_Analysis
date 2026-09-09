// ============================================================
// Metric Formula 결정론(Determinism) 회귀 테스트
// ------------------------------------------------------------
// 배경 (사용자 요구사항):
//   학습관리 DB 에 등록된 Metric.formula 는 모든 실행 경로에서
//   항상 동일하게 적용되어야 함. 확률적 LLM 판단으로 변형되면 안 됨.
//
// 이번 PR 로 도입된 헬퍼 검증:
//   - normalizeMetricFormula          : 공백/외곽괄호 차이 허용, 컬럼·구조 차이 감지
//   - areFormulasEquivalent           : 두 formula 구조적 동치 판정
//   - buildCanonicalMetricSqlMap      : loadMetricMap → { description: aggFormula }
//   - enforceCanonicalMetricsInPlan   : plan.metrics[].formula 를 canonical 로 대체
//   - replaceMetricExpressionsInSql   : SQL 안의 metric alias 표현식을 canonical 로 대체
//   - validateAndFixMetricFormulas    : SQL 실행 직전 최종 검증 게이트
//
// 시나리오 (요구사항 #13 의 Case 1~10 + 결정론 20회 반복):
//   Case 1 : 현황집계 + 판매관리비
//   Case 2 : 현황집계 + 마케팅비
//   Case 3 : 현황집계 + 판매관리비/마케팅비 동시 요청 (핵심 재현 케이스)
//   Case 4 : 분석질문 + 판매관리비 (plan.metrics 시나리오)
//   Case 5 : 분석질문 + 마케팅비
//   Case 6 : 분석질문 + 두 Metric 동시
//   Case 7 : replan 시나리오 (plan 재생성)
//   Case 8 : retry 시나리오 (SQL 재생성)
//   Case 9 : 후속질의 (동일 세션 반복)
//   Case 10: 새로운 독립 질의 (state 초기화 확인)
//
// 각 케이스마다 LLM 응답을 확률적 변형된 형태로 mock 하여
// 20회 반복 실행 시 매번 동일한 canonical SQL 이 나오는지 검증.
// ============================================================

import { readFileSync } from 'node:fs';

const src = readFileSync('/home/user/webapp/nlq-server/server.mjs', 'utf8');

// ── 함수 소스 추출 유틸 ──
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

// 대상 헬퍼 함수들 추출 후 globalThis 에 노출
const targets = [
  { header: 'function expandMetricFormula(formula, _metricMap, _visited = new Set(), _depth = 0) {', name: 'expandMetricFormula' },
  { header: 'function buildCanonicalMetricSqlMap(metricMap) {', name: 'buildCanonicalMetricSqlMap' },
  { header: 'function normalizeMetricFormula(formula) {', name: 'normalizeMetricFormula' },
  { header: 'function areFormulasEquivalent(a, b) {', name: 'areFormulasEquivalent' },
  { header: 'function replaceMetricExpressionsInSql(sql, canonicalMap, traceCtx) {', name: 'replaceMetricExpressionsInSql' },
  { header: 'function enforceCanonicalMetricsInPlan(plan, canonicalMap, traceCtx) {', name: 'enforceCanonicalMetricsInPlan' },
  { header: 'function validateAndFixMetricFormulas(sql, canonicalMap, traceCtx) {', name: 'validateAndFixMetricFormulas' },
];

let bootstrap = '';
for (const t of targets) {
  const fnSrc = extractFunctionSource(src, t.header);
  bootstrap += fnSrc.replace(`function ${t.name}`, `globalThis.${t.name} = function `) + '\n';
}

// 로그 노이즈 억제
const origWarn = console.warn;
const origLog = console.log;
console.warn = () => {};
console.log = () => {};

// eval 실행
eval(bootstrap);

const {
  normalizeMetricFormula,
  areFormulasEquivalent,
  buildCanonicalMetricSqlMap,
  replaceMetricExpressionsInSql,
  enforceCanonicalMetricsInPlan,
  validateAndFixMetricFormulas,
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
// [Preflight] 헬퍼 함수 기본 동작 검증
// ============================================================
origLog('\n[Preflight] 헬퍼 함수 기본 동작');

// normalizeMetricFormula — 공백/외곽괄호 차이 허용
assertEq('normalize: 공백 제거', normalizeMetricFormula('A + B'), 'A+B');
assertEq('normalize: 외곽괄호 제거', normalizeMetricFormula('(A+B)'), 'A+B');
assertEq('normalize: 내부괄호 유지', normalizeMetricFormula('(A+B)*C'), '(A+B)*C');
assertEq('normalize: 대소문자 통일', normalizeMetricFormula('zamt037'), 'ZAMT037');
assertEq('normalize: null/빈 문자열', normalizeMetricFormula(null), '');

// areFormulasEquivalent
assert('equiv: 공백만 다름', areFormulasEquivalent('A+B', ' A + B '));
assert('equiv: 외곽괄호만 다름', areFormulasEquivalent('A+B', '(A+B)'));
assert('equiv: 컬럼 다름 → false', !areFormulasEquivalent('A+B', 'A+C'));
assert('equiv: 순서 다름 → false', !areFormulasEquivalent('A+B', 'B+A'));
assert('equiv: 사용자 재현 케이스 감지',
  !areFormulasEquivalent(
    'ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047',
    'ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)'
  )
);

// ============================================================
// [Metric DB Mock] 사용자 재현 케이스의 canonical formula
// ============================================================
const MOCK_METRIC_MAP = {
  METRIC__SGA: {
    aggregation: 'SUM',
    formula: 'ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047',
    description: '판매관리비',
  },
  METRIC__MARKETING: {
    aggregation: 'SUM',
    formula: 'ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054',
    description: '마케팅비',
  },
  METRIC__GROSS_PROFIT: {
    aggregation: 'SUM',
    formula: 'ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)',
    description: '매출총이익',
  },
};

const CANONICAL = buildCanonicalMetricSqlMap(MOCK_METRIC_MAP);
assertEq('canonical: 판매관리비',
  CANONICAL['판매관리비'],
  'SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047)'
);
assertEq('canonical: 마케팅비',
  CANONICAL['마케팅비'],
  'SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)'
);

// ============================================================
// [Case 1~3] 현황집계 경로 — LLM SQL 후처리 (replaceMetricExpressionsInSql)
// ============================================================

origLog('\n[Case 1] 현황집계 + 판매관리비 — 정상 SQL 은 변경 없음');
{
  const goodSql =
    "SELECT SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047) AS '판매관리비' FROM bw_profitability_data WHERE CALMONTH='202608'";
  const result = replaceMetricExpressionsInSql(goodSql, CANONICAL, {});
  assertEq('Case 1: 정상 SQL 은 변경 없음', result.replacements.length, 0);
  assertEq('Case 1: SQL 원문 유지', result.sql, goodSql);
}

origLog('\n[Case 2] 현황집계 + 마케팅비 — 정상 SQL 은 변경 없음');
{
  const goodSql =
    "SELECT SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054) AS '마케팅비' FROM bw_profitability_data WHERE CALMONTH='202608'";
  const result = replaceMetricExpressionsInSql(goodSql, CANONICAL, {});
  assertEq('Case 2: 정상 SQL 은 변경 없음', result.replacements.length, 0);
}

origLog('\n[Case 3] ★ 사용자 재현 케이스 — 판매관리비 안에 마케팅비 산식이 섞여 들어감');
{
  // 사용자가 제보한 정확한 오염 SQL
  const badSql =
    "SELECT " +
    "SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)) AS '판매관리비', " +
    "SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054) AS '마케팅비' " +
    "FROM bw_profitability_data WHERE CALMONTH='202608' AND MATERIAL_NM IS NULL";
  const result = replaceMetricExpressionsInSql(badSql, CANONICAL, { requestId: 'test-case3' });
  assert('Case 3: 오염 감지되어 치환됨', result.replacements.length >= 1);
  // 최종 SQL 에는 canonical 판매관리비 산식이 있어야 하고, ZAMT047 이 포함되어야 함
  assert('Case 3: ZAMT047 이 최종 SQL 에 존재', result.sql.includes('ZAMT047'));
  // 판매관리비 alias 앞의 표현식이 canonical 과 동치인지 확인
  // (canonical 이 SUM(...) 이므로 replace 후 SQL 은 SUM(ZAMT037+...+ZAMT047) AS '판매관리비' 형태)
  // 균형잡힌 괄호로 SUM(...) 감지
  const sgaIdx = result.sql.indexOf("AS '판매관리비'");
  assert('Case 3: 판매관리비 alias 감지됨', sgaIdx >= 0);
  if (sgaIdx >= 0) {
    // 뒤에서 앞으로 균형잡힌 괄호 표현식 추출 (스캔)
    let depth = 0, start = -1;
    for (let j = sgaIdx - 1; j >= 0; j--) {
      const ch = result.sql[j];
      if (ch === ')') depth++;
      else if (ch === '(') {
        depth--;
        if (depth === 0) { /* SUM 이름 앞까지 이어짐 */ }
      }
      if (depth === 0 && (ch === ',' || (j === 0))) {
        start = j === 0 ? 0 : j + 1;
        break;
      }
      if (j === 6 && /^SELECT\s/i.test(result.sql.slice(j-6, j+1))) {
        start = j + 1;
        break;
      }
    }
    // 더 간단: SELECT 부터 판매관리비 alias 까지 slice 하고 SUM 부분만 추출
    const beforeAlias = result.sql.slice(0, sgaIdx).replace(/^SELECT\s+/i, '');
    // beforeAlias 는 "SUM(...) " 형태여야 함
    assert(
      'Case 3: 판매관리비 표현식이 canonical 과 동치',
      areFormulasEquivalent(beforeAlias.trim(), CANONICAL['판매관리비']),
      `  actual: ${beforeAlias.trim()}\n      canonical: ${CANONICAL['판매관리비']}`
    );
  }
}

// ============================================================
// [Case 4~6] 분석질문 경로 — plan.metrics[] 정규화 (enforceCanonicalMetricsInPlan)
// ============================================================

origLog('\n[Case 4] 분석질문 + 판매관리비 (LLM 이 formula 를 잘못 채운 경우)');
{
  const plan = {
    metrics: [
      { name: '판매관리비', formula: 'SUM(ZAMT037+ZAMT038)' }, // ← LLM 이 산식 잘못 채움
    ],
  };
  const result = enforceCanonicalMetricsInPlan(plan, CANONICAL, { requestId: 'test-case4' });
  assertEq('Case 4: 변형 감지', result.changes.length, 1);
  assertEq('Case 4: canonical 로 강제 대체', plan.metrics[0].formula, CANONICAL['판매관리비']);
}

origLog('\n[Case 5] 분석질문 + 마케팅비 (LLM 이 formula 를 완벽하게 채운 경우 — 변경 없음)');
{
  const plan = {
    metrics: [
      { name: '마케팅비', formula: 'SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)' },
    ],
  };
  const result = enforceCanonicalMetricsInPlan(plan, CANONICAL, {});
  assertEq('Case 5: 변형 감지 없음', result.changes.length, 0);
  assertEq('Case 5: canonical 그대로', plan.metrics[0].formula, CANONICAL['마케팅비']);
}

origLog('\n[Case 6] 분석질문 + 두 Metric 동시 (한 개만 오염됨)');
{
  const plan = {
    metrics: [
      { name: '판매관리비', formula: 'SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054))' },
      { name: '마케팅비',   formula: 'SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)' },
    ],
  };
  const result = enforceCanonicalMetricsInPlan(plan, CANONICAL, { requestId: 'test-case6' });
  assertEq('Case 6: 판매관리비 만 변형 감지', result.changes.length, 1);
  assertEq('Case 6: 판매관리비 canonical 대체', plan.metrics[0].formula, CANONICAL['판매관리비']);
  assertEq('Case 6: 마케팅비 그대로', plan.metrics[1].formula, CANONICAL['마케팅비']);
}

// ============================================================
// [Case 7] Replan 시나리오 — 재계획 후에도 canonical 유지
// ============================================================
origLog('\n[Case 7] Replan 시나리오 — 두 번째 plan 도 동일한 canonical');
{
  // 1차 plan
  const plan1 = {
    metrics: [{ name: '판매관리비', formula: 'SUM(ZAMT037+ZAMT038)' }], // LLM 오염
  };
  enforceCanonicalMetricsInPlan(plan1, CANONICAL, {});
  const finalFormula1 = plan1.metrics[0].formula;

  // 2차 plan (replan 시나리오 — LLM 이 또 다른 방식으로 오염)
  const plan2 = {
    metrics: [{ name: '판매관리비', formula: 'SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054))' },
    ],
  };
  enforceCanonicalMetricsInPlan(plan2, CANONICAL, {});
  const finalFormula2 = plan2.metrics[0].formula;

  assertEq('Case 7: 1차/2차 plan 모두 동일 canonical', finalFormula1, finalFormula2);
  assertEq('Case 7: canonical formula 정확', finalFormula1, CANONICAL['판매관리비']);
}

// ============================================================
// [Case 8] Retry — SQL 재생성 후 validateAndFixMetricFormulas 로 최종 검증
// ============================================================
origLog('\n[Case 8] SQL retry 후 validation 게이트에서 자동 치환');
{
  const retriedBadSql =
    "SELECT SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)) AS '판매관리비' FROM bw_profitability_data";
  const result = validateAndFixMetricFormulas(retriedBadSql, CANONICAL, { requestId: 'test-case8' });
  assert('Case 8: validation 게이트에서 자동 치환 발생', result.replaced >= 1);
  assert('Case 8: 최종 SQL 에 canonical ZAMT047 포함', result.sql.includes('ZAMT047'));
  assert('Case 8: ok=true (실행 진행)', result.ok === true);
}

// ============================================================
// [Case 9] 후속질의 — 동일 세션에서 반복 요청 시 동일 결과
// ============================================================
origLog('\n[Case 9] 후속질의 — 동일 요청 5회 반복 시 5번 모두 동일한 canonical');
{
  const results = [];
  for (let i = 0; i < 5; i++) {
    const plan = {
      metrics: [
        // LLM 이 매번 다르게 오염된 formula 를 반환한다고 가정
        { name: '판매관리비', formula: i % 2 === 0
          ? 'SUM(ZAMT037+ZAMT038)'
          : 'SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054))'
        },
      ],
    };
    enforceCanonicalMetricsInPlan(plan, CANONICAL, {});
    results.push(plan.metrics[0].formula);
  }
  const allSame = results.every(r => r === results[0]);
  assert('Case 9: 5회 모두 동일 formula', allSame);
  assertEq('Case 9: canonical 로 통일', results[0], CANONICAL['판매관리비']);
}

// ============================================================
// [Case 10] 새로운 독립 질의 — 이전 state 혼입 방지
// ============================================================
origLog('\n[Case 10] 새로운 독립 질의 — 각 plan 은 독립적으로 canonical 화');
{
  // 이전 질의 (매출총이익)
  const priorPlan = {
    metrics: [{ name: '매출총이익', formula: 'WRONG_FORMULA' }],
    filters: [{ column: 'MATERIAL_NM', op: '=', value: '테스트' }],
  };
  enforceCanonicalMetricsInPlan(priorPlan, CANONICAL, {});

  // 새 질의 (판매관리비만)
  const newPlan = {
    metrics: [{ name: '판매관리비', formula: 'SUM(ZAMT037)' }], // 오염
    filters: [], // 새 질의는 필터 없음
  };
  enforceCanonicalMetricsInPlan(newPlan, CANONICAL, {});

  assertEq('Case 10: 새 plan 의 metric name 은 판매관리비', newPlan.metrics[0].name, '판매관리비');
  assertEq('Case 10: 새 plan formula 는 canonical 판매관리비', newPlan.metrics[0].formula, CANONICAL['판매관리비']);
  assertEq('Case 10: 새 plan 에 이전 매출총이익 metric 이 유입되지 않음', newPlan.metrics.length, 1);
  assertEq('Case 10: 새 plan 에 이전 필터가 유입되지 않음', newPlan.filters.length, 0);
}

// ============================================================
// [Determinism 20회 반복] — 사용자 요구사항 #12
// 같은 질의를 20회 반복 실행하여 매번 동일한 canonical SQL 이 나오는지 검증
// ============================================================
origLog('\n[Determinism] 20회 반복 결정론 검증');
{
  // 매 실행마다 LLM 응답을 다르게 (오염/정상/부분오염) 시뮬레이션
  const llmVariants = [
    // 정상 케이스 — LLM 이 formula 를 정확히 채움
    () => ({
      metrics: [
        { name: '판매관리비', formula: 'SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+ZAMT047)' },
        { name: '마케팅비',   formula: 'SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)' },
      ],
    }),
    // 오염 A — 재현 케이스: ZAMT047 이 마케팅비 산식으로 대체됨
    () => ({
      metrics: [
        { name: '판매관리비', formula: 'SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054))' },
        { name: '마케팅비',   formula: 'SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)' },
      ],
    }),
    // 오염 B — LLM 이 formula 를 아예 비워둠 (name 만)
    () => ({
      metrics: [
        { name: '판매관리비', formula: '' },
        { name: '마케팅비',   formula: null },
      ],
    }),
    // 오염 C — LLM 이 짧은 산식으로 축약
    () => ({
      metrics: [
        { name: '판매관리비', formula: 'SUM(ZAMT037+ZAMT038)' },
        { name: '마케팅비',   formula: 'SUM(ZAMT048+ZAMT049)' },
      ],
    }),
    // 오염 D — 컬럼 순서 뒤바뀜
    () => ({
      metrics: [
        { name: '판매관리비', formula: 'SUM(ZAMT047+ZAMT046+ZAMT045+ZAMT044+ZAMT043+ZAMT042+ZAMT041+ZAMT040+ZAMT039+ZAMT038+ZAMT037)' },
        { name: '마케팅비',   formula: 'SUM(ZAMT054+ZAMT053+ZAMT051+ZAMT050+ZAMT049+ZAMT048)' },
      ],
    }),
  ];

  const expectedSga = CANONICAL['판매관리비'];
  const expectedMkt = CANONICAL['마케팅비'];

  const allResults = [];
  for (let iter = 0; iter < 20; iter++) {
    const variant = llmVariants[iter % llmVariants.length];
    const plan = variant();
    enforceCanonicalMetricsInPlan(plan, CANONICAL, {});
    allResults.push({
      iter,
      sga: plan.metrics[0].formula,
      mkt: plan.metrics[1].formula,
    });
  }

  const allSgaSame = allResults.every(r => r.sga === expectedSga);
  const allMktSame = allResults.every(r => r.mkt === expectedMkt);

  assert(`Determinism: 20회 반복 모두 판매관리비 = canonical`, allSgaSame);
  assert(`Determinism: 20회 반복 모두 마케팅비 = canonical`, allMktSame);

  if (!allSgaSame) {
    origLog(`  실패 상세 (판매관리비):`);
    allResults.forEach(r => {
      if (r.sga !== expectedSga) {
        origLog(`    iter=${r.iter}: ${r.sga}`);
      }
    });
  }
}

// ============================================================
// [Determinism SQL 후처리 20회 반복] — replaceMetricExpressionsInSql
// ============================================================
origLog('\n[Determinism SQL] 20회 반복 SQL 후처리 결정론 검증');
{
  const dirtySql =
    "SELECT " +
    "SUM(ZAMT037+ZAMT038+ZAMT039+ZAMT040+ZAMT041+ZAMT042+ZAMT043+ZAMT044+ZAMT045+ZAMT046+(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054)) AS '판매관리비', " +
    "SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054) AS '마케팅비' " +
    "FROM bw_profitability_data WHERE CALMONTH='202608'";

  const cleanedResults = [];
  for (let i = 0; i < 20; i++) {
    const { sql } = replaceMetricExpressionsInSql(dirtySql, CANONICAL, {});
    cleanedResults.push(sql);
  }
  const allSame = cleanedResults.every(r => r === cleanedResults[0]);
  assert('Determinism SQL: 20회 반복 결과 모두 동일', allSame);
  assert('Determinism SQL: ZAMT047 이 결과에 존재', cleanedResults[0].includes('ZAMT047'));
}

// ============================================================
// [Backward Compat] 학습관리 미등록 metric 은 LLM formula 그대로
// ============================================================
origLog('\n[Backward Compat] DB 미등록 metric 은 LLM formula 유지');
{
  const plan = {
    metrics: [
      { name: '판매관리비', formula: 'SUM(ZAMT037)' },  // 등록됨 → canonical 대체
      { name: '커스텀지표A', formula: 'SUM(ZAMT100+ZAMT101)' }, // 미등록 → 유지
    ],
  };
  enforceCanonicalMetricsInPlan(plan, CANONICAL, {});
  assertEq('Backward: 등록 metric 은 canonical 대체', plan.metrics[0].formula, CANONICAL['판매관리비']);
  assertEq('Backward: 미등록 metric 은 LLM 값 유지', plan.metrics[1].formula, 'SUM(ZAMT100+ZAMT101)');
}

// ============================================================
// [Edge Cases]
// ============================================================
origLog('\n[Edge Cases]');
{
  // 빈 canonicalMap
  const r1 = replaceMetricExpressionsInSql("SELECT 1", {}, {});
  assertEq('Edge: 빈 canonicalMap → 원본 유지', r1.sql, "SELECT 1");

  // canonicalMap 은 있는데 SQL 에 metric alias 없음
  const r2 = replaceMetricExpressionsInSql("SELECT ZAMT037 FROM t", CANONICAL, {});
  assertEq('Edge: metric alias 없는 SQL → 원본 유지', r2.sql, "SELECT ZAMT037 FROM t");

  // plan.metrics 가 undefined
  const p1 = { metrics: undefined };
  enforceCanonicalMetricsInPlan(p1, CANONICAL, {});
  assertEq('Edge: metrics undefined → 안전', p1.metrics, undefined);

  // metric name 이 canonicalMap 에 없음
  const p2 = { metrics: [{ name: '알수없는지표', formula: 'X+Y' }] };
  enforceCanonicalMetricsInPlan(p2, CANONICAL, {});
  assertEq('Edge: 미등록 metric name → formula 유지', p2.metrics[0].formula, 'X+Y');

  // validation on SQL 이 이미 정상이면 replaced=0
  const goodSql = "SELECT SUM(ZAMT048+ZAMT049+ZAMT050+ZAMT051+ZAMT053+ZAMT054) AS '마케팅비' FROM t";
  const vr = validateAndFixMetricFormulas(goodSql, CANONICAL, {});
  assertEq('Edge: 정상 SQL validation → replaced=0', vr.replaced, 0);
  assertEq('Edge: 정상 SQL validation → sql 유지', vr.sql, goodSql);
}

// ============================================================
// 결과
// ============================================================
console.warn = origWarn;
console.log = origLog;

console.log(`\n${'='.repeat(60)}`);
console.log(`테스트 결과: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed > 0) {
  console.log('\n실패한 케이스:');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
    if (f.expected !== undefined) console.log(`      expected: ${JSON.stringify(f.expected)}`);
    if (f.actual !== undefined)   console.log(`      actual:   ${JSON.stringify(f.actual)}`);
    if (f.extra) console.log(`      ${f.extra}`);
  }
  process.exit(1);
}
process.exit(0);
