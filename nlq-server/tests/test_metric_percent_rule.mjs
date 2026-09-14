// ============================================================
// Metric 비율/% 규칙 + Synonym/Fuzzy Matching 회귀 테스트 (2026-09-14)
// ------------------------------------------------------------
// 배경 (사용자 재현 버그):
//   PR #447 이후 SQL 은 정상 SUM 감쌌지만, 분석질문에서
//   "영업이익률" 결과값이 현황집계와 100배 차이. 원인:
//     - DB metric.description = "영업이익률(%)" (formula 에 *100 포함)
//     - DB metric_synonym    = "영업이익률"
//     - LLM plan.metrics[0].name = "영업이익률" + formula 에서 *100 누락
//     - enforceCanonicalMetricsInPlan 은 canonicalMap["영업이익률"] 미존재로 매칭 실패
//       → LLM 이 만든 (SUM(A)/SUM(B)) 그대로 통과 → 비율만 반환 (%아님)
//
// 사용자 확정 원칙 [비율/률/% 계산 규칙 — 현황집계/분석질문 모두 해당]:
//   1) 학습관리 Metric 에 등록된 canonical formula 가 있으면 그대로 사용.
//      LLM/SQL Builder 가 *100 을 추가/제거하지 않음.
//   2) 미등록 신규 계산 + "비율/률/%" 요청 → 자동 *100 부착
//   3) 우선순위:
//      - 등록 Metric 존재 → canonical formula 그대로
//      - 등록 Metric 없음 + 비율/률/% 요청 → LLM 계산식 + *100
//
// 이 PR 이 도입:
//   - loadMetricMap 이 metric_synonym 도 로드 → { synonyms: [...] }
//   - buildCanonicalMetricSqlMap 이 synonym 도 canonicalMap key 로 등록
//   - normalizeMetricName + lookupCanonicalMetric — 접미사/공백 흡수 fuzzy match
//   - enforceCanonicalMetricsInPlan 이 name 도 canonical description 으로 교정
//   - applyPercentUnitRuleIfNeeded — 미등록 비율에 *100 자동 부착
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

function extractConstDecl(source, header) {
  const startIdx = source.indexOf(header);
  if (startIdx === -1) throw new Error(`상수 시작점 없음: ${header}`);
  const endIdx = source.indexOf(');', startIdx);
  if (endIdx === -1) throw new Error(`상수 종료점 없음: ${header}`);
  return source.slice(startIdx, endIdx + 2);
}

// PERCENT_KEYWORD_PATTERN 은 const 이지만 정규식이므로 별도 추출
function extractSingleLineConst(source, header) {
  const startIdx = source.indexOf(header);
  if (startIdx === -1) throw new Error(`상수 미발견: ${header}`);
  const endIdx = source.indexOf('\n', startIdx);
  return source.slice(startIdx, endIdx);
}

// __CANONICAL_BY_NORMALIZED Symbol 도 필요
const symbolDecl = "const __CANONICAL_BY_NORMALIZED = Symbol('canonicalDescByNormalized');";

let bootstrap = '';
bootstrap += extractConstDecl(src, "const AGGREGATE_FUNCTIONS = new Set(['SUM'") + '\n';
bootstrap += extractConstDecl(src, "const SCALAR_FUNCTIONS = new Set([") + '\n';
bootstrap += extractSingleLineConst(src, "const PERCENT_KEYWORD_PATTERN =") + '\n';
bootstrap += symbolDecl + '\n';

const targets = [
  { header: 'function tokenizeSqlExpression(expr) {', name: 'tokenizeSqlExpression' },
  { header: 'function classifyMetricFormula(formula) {', name: 'classifyMetricFormula' },
  { header: 'function resolveCanonicalMetricExpression(metric, opts = {}) {', name: 'resolveCanonicalMetricExpression' },
  { header: 'function normalizeMetricName(name) {', name: 'normalizeMetricName' },
  { header: 'function lookupCanonicalMetric(canonicalMap, canonicalDescByNormalized, name) {', name: 'lookupCanonicalMetric' },
  { header: 'function buildCanonicalMetricSqlMap(metricMap, traceCtx) {', name: 'buildCanonicalMetricSqlMap' },
  { header: 'function getCanonicalNormalizedIndex(canonicalMap) {', name: 'getCanonicalNormalizedIndex' },
  { header: 'function formulaHasMultiplyByHundred(formula) {', name: 'formulaHasMultiplyByHundred' },
  { header: 'function applyPercentUnitRuleIfNeeded(metric, opts = {}) {', name: 'applyPercentUnitRuleIfNeeded' },
  { header: 'function normalizeMetricFormula(formula) {', name: 'normalizeMetricFormula' },
  { header: 'function areFormulasEquivalent(a, b) {', name: 'areFormulasEquivalent' },
  { header: 'function enforceCanonicalMetricsInPlan(plan, canonicalMap, traceCtx) {', name: 'enforceCanonicalMetricsInPlan' },
];

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
  normalizeMetricName,
  lookupCanonicalMetric,
  buildCanonicalMetricSqlMap,
  formulaHasMultiplyByHundred,
  applyPercentUnitRuleIfNeeded,
  enforceCanonicalMetricsInPlan,
} = globalThis;

// ── 테스트 러너 ──
let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, extra = '') {
  if (cond) { passed++; origLog(`  ✓ ${label}`); }
  else { failed++; failures.push({ label, extra }); origLog(`  ✗ ${label}`); if (extra) origLog(`      ${extra}`); }
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
origLog('\n[Preflight] 헬퍼 함수 로드');
assert('normalizeMetricName 로드됨', typeof normalizeMetricName === 'function');
assert('lookupCanonicalMetric 로드됨', typeof lookupCanonicalMetric === 'function');
assert('formulaHasMultiplyByHundred 로드됨', typeof formulaHasMultiplyByHundred === 'function');
assert('applyPercentUnitRuleIfNeeded 로드됨', typeof applyPercentUnitRuleIfNeeded === 'function');
assert('enforceCanonicalMetricsInPlan 로드됨', typeof enforceCanonicalMetricsInPlan === 'function');

// ============================================================
// [Unit 1] normalizeMetricName
// ============================================================
origLog('\n[Unit 1] normalizeMetricName');

assertEq('접미사(%) 제거', normalizeMetricName('영업이익률(%)'), '영업이익률');
assertEq('접미사(원) 제거', normalizeMetricName('총매출(원)'), '총매출');
assertEq('접미사(BOX) 제거', normalizeMetricName('평균단가(BOX)'), '평균단가');
assertEq('접미사(제품) 제거', normalizeMetricName('매출원가(제품)'), '매출원가');
assertEq('접미사 앞 공백 제거', normalizeMetricName('영업이익률 (%)'), '영업이익률');
assertEq('복수 괄호 제거', normalizeMetricName('평균단가(원)(BOX)'), '평균단가');
assertEq('중간 공백 제거', normalizeMetricName('매출원가 계'), '매출원가계');
assertEq('접미사 없는 이름 유지', normalizeMetricName('판매관리비'), '판매관리비');
assertEq('영문 소문자화', normalizeMetricName('Total Sales'), 'totalsales');
assertEq('null 안전', normalizeMetricName(null), '');
assertEq('빈 문자열 안전', normalizeMetricName(''), '');

// ============================================================
// [Unit 2] formulaHasMultiplyByHundred
// ============================================================
origLog('\n[Unit 2] formulaHasMultiplyByHundred');

assert('*100 있음', formulaHasMultiplyByHundred('SUM(A)/SUM(B)*100'));
assert('* 100 공백 있음', formulaHasMultiplyByHundred('SUM(A)/SUM(B) * 100'));
assert('괄호 앞 *100', formulaHasMultiplyByHundred('(SUM(A)/SUM(B))*100'));
assert('*100 없음 → false', !formulaHasMultiplyByHundred('SUM(A)/SUM(B)'));
assert('*10 이지만 *100 아님', !formulaHasMultiplyByHundred('SUM(A)*10'));
assert('*1000 도 *100 아님 (숫자 경계)', !formulaHasMultiplyByHundred('SUM(A)*1000'));
assert('null 안전', !formulaHasMultiplyByHundred(null));
assert('빈 문자열 안전', !formulaHasMultiplyByHundred(''));

// ============================================================
// [Unit 3] applyPercentUnitRuleIfNeeded
// ============================================================
origLog('\n[Unit 3] applyPercentUnitRuleIfNeeded');

// 이름에 "률" 있고 *100 없음 → 부착
{
  const r = applyPercentUnitRuleIfNeeded(
    { name: '이익률', formula: 'SUM(A)/NULLIF(SUM(B),0)' }
  );
  assert('률 + *100 없음 → 부착', r.modified === true);
  assertEq('부착된 formula', r.formula, '(SUM(A)/NULLIF(SUM(B),0)) * 100');
}

// 이름에 "비율" 있고 *100 없음 → 부착
{
  const r = applyPercentUnitRuleIfNeeded(
    { name: '수량비율', formula: 'SUM(X)/SUM(Y)' }
  );
  assert('비율 + *100 없음 → 부착', r.modified);
  assertEq('부착된 formula', r.formula, '(SUM(X)/SUM(Y)) * 100');
}

// 이름에 "%" 있고 *100 없음 → 부착
{
  const r = applyPercentUnitRuleIfNeeded(
    { name: '점유율(%)', formula: 'A/B' }
  );
  assert('% + *100 없음 → 부착', r.modified);
}

// 이름에 "률" 있지만 formula 에 *100 이미 있음 → no-op
{
  const original = 'SUM(A)/NULLIF(SUM(B),0)*100';
  const r = applyPercentUnitRuleIfNeeded(
    { name: '이익률', formula: original }
  );
  assert('률 + *100 있음 → no-op', r.modified === false);
  assertEq('formula 그대로', r.formula, original);
}

// 이름에 비율/률/% 없음 → no-op
{
  const r = applyPercentUnitRuleIfNeeded(
    { name: '순매출', formula: 'ZAMT001-ZAMT002' }
  );
  assert('비율 키워드 없음 → no-op', r.modified === false);
  assertEq('formula 그대로', r.formula, 'ZAMT001-ZAMT002');
}

// 이름에 "rate" (영문) 있음 → 부착
{
  const r = applyPercentUnitRuleIfNeeded(
    { name: 'growth rate', formula: '(A-B)/B' }
  );
  assert('rate + *100 없음 → 부착', r.modified);
}

// null 안전
{
  const r = applyPercentUnitRuleIfNeeded(null);
  assert('null 안전', r.modified === false);
}

// ============================================================
// [Unit 4] buildCanonicalMetricSqlMap + synonym 지원
// ============================================================
origLog('\n[Unit 4] buildCanonicalMetricSqlMap + synonym');

{
  const metricMap = {
    OPERATING_PROFIT_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100',
      description: '영업이익률(%)',
      synonyms: ['영업이익률'],
    },
    GROSS_PROFIT_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(ZAMT035) / NULLIF(SUM(ZAMT003),0) * 100',
      description: '매출총이익률(%)',
      synonyms: ['매출총이익률', '매출이익률'],
    },
    NET_SALES: {
      aggregation: 'SUM',
      formula: 'ZAMT003',
      description: '순매출',
      synonyms: ['순매출액', '판매액'],
    },
  };
  const canonical = buildCanonicalMetricSqlMap(metricMap);

  // description key (기존)
  assert('description key: 영업이익률(%)',
    canonical['영업이익률(%)'] === 'SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100');
  assert('description key: 매출총이익률(%)',
    canonical['매출총이익률(%)'] === 'SUM(ZAMT035) / NULLIF(SUM(ZAMT003),0) * 100');
  assert('description key: 순매출',
    canonical['순매출'] === 'SUM(ZAMT003)');

  // synonym key (신규)
  assert('synonym key: 영업이익률',
    canonical['영업이익률'] === canonical['영업이익률(%)']);
  assert('synonym key: 매출총이익률',
    canonical['매출총이익률'] === canonical['매출총이익률(%)']);
  assert('synonym key: 매출이익률',
    canonical['매출이익률'] === canonical['매출총이익률(%)']);
  assert('synonym key: 순매출액',
    canonical['순매출액'] === canonical['순매출']);
  assert('synonym key: 판매액',
    canonical['판매액'] === canonical['순매출']);

  // synonyms 배열 없는 metric 도 정상 처리
  const mmap2 = { X: { aggregation: 'SUM', formula: 'A', description: 'X_desc' } };
  const c2 = buildCanonicalMetricSqlMap(mmap2);
  assert('synonyms 없어도 안전', c2['X_desc'] === 'SUM(A)');
}

// ============================================================
// [Unit 5] lookupCanonicalMetric (exact → fuzzy fallback)
// ============================================================
origLog('\n[Unit 5] lookupCanonicalMetric');

{
  const metricMap = {
    OP_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(A)/SUM(B)*100',
      description: '영업이익률(%)',
      synonyms: ['영업이익률'],
    },
    UNIT_PRICE: {
      aggregation: 'CALC',
      formula: 'SUM(A)/SUM(B)',
      description: '평균단가(BOX)',
      synonyms: [],
    },
  };
  const canonical = buildCanonicalMetricSqlMap(metricMap);
  const idx = canonical[Object.getOwnPropertySymbols(canonical)[0]];

  // exact — canonical description
  {
    const r = lookupCanonicalMetric(canonical, idx, '영업이익률(%)');
    assert('exact match: 영업이익률(%)', r && r.found);
    assertEq('canonicalName 그대로', r.canonicalName, '영업이익률(%)');
  }
  // exact — synonym
  {
    const r = lookupCanonicalMetric(canonical, idx, '영업이익률');
    assert('exact synonym match: 영업이익률', r && r.found);
    // ★ synonym 으로 매칭돼도 canonicalName 은 canonical description 으로 정규화 반환
    //   (표시 일관성 확보)
    assertEq('synonym → canonical description 반환', r.canonicalName, '영업이익률(%)');
  }
  // fuzzy — 접미사가 아예 없는 케이스 (synonym 도 없음)
  {
    // 평균단가 synonym 미등록 상태에서 "평균단가" 로 lookup
    const r = lookupCanonicalMetric(canonical, idx, '평균단가');
    assert('fuzzy match: 평균단가 → 평균단가(BOX)', r && r.found);
    assertEq('fuzzy canonicalName', r.canonicalName, '평균단가(BOX)');
  }
  // fuzzy — 공백/괄호 변형
  {
    const r = lookupCanonicalMetric(canonical, idx, '영업이익률 (%)');   // 공백 있음
    assert('fuzzy match: 공백 흡수', r && r.found);
  }
  // 매칭 실패
  {
    const r = lookupCanonicalMetric(canonical, idx, '존재하지않는이름xyz');
    assert('매칭 실패: null', r === null);
  }
}

// ============================================================
// [Integration] 사용자 재현 버그 시나리오 (핵심 회귀)
// ------------------------------------------------------------
// 실제 DB: metric.description = "영업이익률(%)", synonym = "영업이익률"
// LLM plan: name="영업이익률", formula = "SUM(...)/NULLIF(SUM(...),0)" (*100 누락)
// 기대: enforceCanonicalMetricsInPlan 이 canonical 로 강제 대체 + name 을 "영업이익률(%)" 로 교정
// ============================================================
origLog('\n[Integration] 사용자 재현 버그 시나리오');

{
  const metricMap = {
    OPERATING_PROFIT_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100',
      description: '영업이익률(%)',
      synonyms: ['영업이익률'],
    },
  };
  const canonicalMap = buildCanonicalMetricSqlMap(metricMap);

  // LLM 이 만든 plan (버그 재현)
  const plan = {
    metrics: [
      {
        name: '영업이익률',   // ← canonical description ("영업이익률(%)") 이 아닌 synonym
        formula: 'SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0)',   // ← *100 누락
      },
    ],
  };

  const { plan: fixedPlan, changes } = enforceCanonicalMetricsInPlan(plan, canonicalMap);

  // formula 는 canonical 로 강제 대체 (*100 복원)
  assertEq('버그 재현 → formula 복원',
    fixedPlan.metrics[0].formula,
    'SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100'
  );
  // name 은 canonical description 으로 교정
  assertEq('버그 재현 → name 교정',
    fixedPlan.metrics[0].name,
    '영업이익률(%)'
  );
  // changes 배열에 canonical-formula, canonical-name 둘 다 기록
  assert('changes: canonical-formula 기록',
    changes.some(c => c.kind === 'canonical-formula'));
  assert('changes: canonical-name 기록',
    changes.some(c => c.kind === 'canonical-name'));
}

// ============================================================
// [Integration] 사용자 원칙 우선순위 검증
// ============================================================
origLog('\n[Integration] 사용자 원칙 우선순위');

// 원칙 1: 등록 Metric formula 는 훼손하지 않음
{
  const metricMap = {
    OP_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(A)/NULLIF(SUM(B),0)*100',   // 이미 *100 있음
      description: '영업이익률(%)',
      synonyms: ['영업이익률'],
    },
  };
  const canonicalMap = buildCanonicalMetricSqlMap(metricMap);

  // LLM 이 실수로 *100 을 두 번 넣었어도 canonical 로 대체 (원본 그대로)
  const plan = {
    metrics: [{ name: '영업이익률', formula: 'SUM(A)/NULLIF(SUM(B),0)*100*100' }],   // 이중 *100
  };
  const { plan: fixed } = enforceCanonicalMetricsInPlan(plan, canonicalMap);
  assertEq('원칙 1: 등록 formula 훼손 없음 (LLM 이중 *100 → canonical 1개로 복원)',
    fixed.metrics[0].formula, 'SUM(A)/NULLIF(SUM(B),0)*100');
}

// 원칙 2: 미등록 신규 계산 + 비율/률/% → *100 부착
{
  const canonicalMap = buildCanonicalMetricSqlMap({});   // 빈 map (등록된 metric 없음)
  const plan = {
    metrics: [
      { name: '판매비율', formula: 'SUM(X)/NULLIF(SUM(Y),0)' },
      { name: '증감률', formula: '(SUM(A)-SUM(B))/NULLIF(SUM(B),0)' },
    ],
  };
  const { plan: fixed, changes } = enforceCanonicalMetricsInPlan(plan, canonicalMap);
  assertEq('원칙 2-a: 판매비율 → *100 부착',
    fixed.metrics[0].formula, '(SUM(X)/NULLIF(SUM(Y),0)) * 100');
  assertEq('원칙 2-b: 증감률 → *100 부착',
    fixed.metrics[1].formula, '((SUM(A)-SUM(B))/NULLIF(SUM(B),0)) * 100');
  assert('changes 에 percent-unit-rule 기록',
    changes.filter(c => c.kind === 'percent-unit-rule').length === 2);
}

// 원칙 3-a: 등록 Metric 이 있으면 canonical 우선 (percent rule 무시)
{
  const metricMap = {
    OP_RATE: {
      aggregation: 'CALC',
      formula: 'SUM(A)/NULLIF(SUM(B),0)*100',
      description: '영업이익률(%)',
      synonyms: ['영업이익률'],
    },
  };
  const canonicalMap = buildCanonicalMetricSqlMap(metricMap);
  const plan = {
    metrics: [{ name: '영업이익률', formula: 'SUM(A)/NULLIF(SUM(B),0)' }],
  };
  const { plan: fixed } = enforceCanonicalMetricsInPlan(plan, canonicalMap);
  // percent rule 로 (SUM(A)/NULLIF(SUM(B),0))*100 이 되는 게 아니라
  // canonical 로 SUM(A)/NULLIF(SUM(B),0)*100 로 대체됨 (괄호 없음)
  assertEq('원칙 3-a: 등록 Metric 우선 (canonical formula 로 대체)',
    fixed.metrics[0].formula, 'SUM(A)/NULLIF(SUM(B),0)*100');
  assert('원칙 3-a: 이중 wrapping 없음',
    !fixed.metrics[0].formula.startsWith('(') || !fixed.metrics[0].formula.endsWith(')*100'));
}

// 원칙 3-b: 미등록 + 비율 → percent rule 적용
{
  const canonicalMap = buildCanonicalMetricSqlMap({});
  const plan = { metrics: [{ name: '반품률', formula: 'SUM(RETURN)/SUM(SALES)' }] };
  const { plan: fixed } = enforceCanonicalMetricsInPlan(plan, canonicalMap);
  assertEq('원칙 3-b: 미등록 비율 → *100', fixed.metrics[0].formula,
    '(SUM(RETURN)/SUM(SALES)) * 100');
}

// ============================================================
// [Integration] 회귀 방지 — 순매출/판매관리비 (비율 아님)
// ============================================================
origLog('\n[Integration] 비율 아닌 metric 회귀 방지');

{
  const metricMap = {
    NET_SALES:  { aggregation: 'SUM', formula: 'ZAMT003', description: '순매출', synonyms: ['순매출액', '판매액'] },
    SGA:        { aggregation: 'CALC', formula: 'ZAMT037+ZAMT038+ZAMT039', description: '판매관리비', synonyms: ['판관비'] },
    GROSS_PROF: { aggregation: 'CALC', formula: 'ZAMT001-ZAMT002', description: '매출총이익', synonyms: [] },
  };
  const canonicalMap = buildCanonicalMetricSqlMap(metricMap);

  // Plan 에 정상 metric 들
  const plan = {
    metrics: [
      { name: '순매출', formula: 'ZAMT003' },
      { name: '판매관리비', formula: 'ZAMT037+ZAMT038+ZAMT039' },
      { name: '매출총이익', formula: 'ZAMT001-ZAMT002' },
    ],
  };
  const { plan: fixed } = enforceCanonicalMetricsInPlan(plan, canonicalMap);

  assertEq('순매출 → SUM(ZAMT003)', fixed.metrics[0].formula, 'SUM(ZAMT003)');
  assertEq('판매관리비 → SUM(...)', fixed.metrics[1].formula, 'SUM(ZAMT037+ZAMT038+ZAMT039)');
  assertEq('매출총이익 → SUM(...)', fixed.metrics[2].formula, 'SUM(ZAMT001-ZAMT002)');

  // 어떤 것도 *100 이 부착되면 안 됨
  for (const m of fixed.metrics) {
    assert(`${m.name}: *100 부착 없음`, !m.formula.includes('*100') && !m.formula.includes('* 100'));
  }
}

// synonym 을 통한 매칭도 정상 동작
{
  const metricMap = {
    SGA: { aggregation: 'CALC', formula: 'ZAMT037+ZAMT038', description: '판매관리비', synonyms: ['판관비'] },
  };
  const canonicalMap = buildCanonicalMetricSqlMap(metricMap);
  const plan = {
    metrics: [{ name: '판관비', formula: 'ZAMT037+ZAMT038' }],
  };
  const { plan: fixed } = enforceCanonicalMetricsInPlan(plan, canonicalMap);
  assertEq('synonym "판관비" → canonical formula', fixed.metrics[0].formula, 'SUM(ZAMT037+ZAMT038)');
  assertEq('synonym "판관비" → canonical name "판매관리비"', fixed.metrics[0].name, '판매관리비');
}

// ============================================================
// [Integration] 원본 DB formula 불변 확인 (사용자 원칙 1)
// ============================================================
origLog('\n[Integration] 원본 formula 불변');

{
  const metric = {
    aggregation: 'CALC',
    formula: 'SUM(A)/NULLIF(SUM(B),0)*100',
    description: '영업이익률(%)',
    synonyms: ['영업이익률'],
  };
  const before = metric.formula;

  buildCanonicalMetricSqlMap({ M: metric });
  const canonicalMap = buildCanonicalMetricSqlMap({ M: metric });
  const plan = { metrics: [{ name: '영업이익률', formula: 'wrong' }] };
  enforceCanonicalMetricsInPlan(plan, canonicalMap);

  assertEq('원본 metric.formula 불변', metric.formula, before);
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
