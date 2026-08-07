/**
 * 회귀 테스트: 사업부 표현 정규화 (분석질문 파이프라인)
 *
 * 목적:
 *   사용자 지적사항 — "HL SKU별 매출 TOP5" 와 "HL사업부 SKU별 매출 TOP5"
 *   는 의미가 동일한데 결과가 다르게 나왔음.
 *
 *   본 스크립트는 server.mjs 의 detectDivisionInQuery 정규식과
 *   generateAnalysisPlan 후처리 로직 (plan.domain.value 강제 재작성,
 *   DIVISION filter/dimension 제거) 을 재현하여 아래 5+4=9 표현이
 *   모두 동일한 정규화 결과를 산출하는지 검증한다.
 *
 * 실행:  node _test_division_normalization.mjs
 */

// ── server.mjs 의 detectDivisionInQuery 와 완전히 동일한 정규식 (L6291~6296)
const HL_KOR = /(?<![가-힣])홈앤라이프(?:\s*사업부)?(?![가-힣])/;
const PS_KOR = /(?<![가-힣])페이퍼솔루션(?:\s*사업부)?(?![가-힣])/;
const HL_ENG = /(?<![가-힣A-Za-z0-9])HL(?:\s*사업부)?(?![A-Za-z0-9])/i;
const PS_ENG = /(?<![가-힣A-Za-z0-9])PS(?:\s*사업부)?(?![A-Za-z0-9])/i;

function detectDivisionInQuery(query) {
  const empty = {
    division: null, divisionCode: null, matchedText: null,
    divisions: [], divisionCodes: [], matches: [], isMulti: false,
  };
  if (!query || typeof query !== 'string') return empty;
  const hlMatch = HL_KOR.exec(query) || HL_ENG.exec(query);
  const psMatch = PS_KOR.exec(query) || PS_ENG.exec(query);
  const found = [];
  if (hlMatch) found.push({ code: 'HL', division: '20', text: hlMatch[0], index: hlMatch.index });
  if (psMatch) found.push({ code: 'PS', division: '10', text: psMatch[0], index: psMatch.index });
  found.sort((a, b) => a.index - b.index);
  if (found.length === 0) return empty;
  const first = found[0];
  return {
    division: first.division,
    divisionCode: first.code,
    matchedText: first.text,
    divisions: found.map(f => f.division),
    divisionCodes: found.map(f => f.code),
    matches: found,
    isMulti: found.length >= 2,
  };
}

// ── server.mjs 의 generateAnalysisPlan 후처리 로직 (사업부 감지 후 plan 재작성) 재현
function normalizeAnalysisPlan(query, activeDomain, llmProducedPlan) {
  // LLM 이 만든 plan 을 흉내내는 입력 (예: filter 잘못 넣음, domain 못 채움)
  const plan = JSON.parse(JSON.stringify(llmProducedPlan));  // deep clone
  const dc = activeDomain || 'PS';

  // 기본값 채움
  plan.domain = plan.domain || { value: dc, source: 'UI_FILTER' };
  if (!plan.domain.value) plan.domain.value = dc;

  const divisionDetection = detectDivisionInQuery(query);

  if (divisionDetection && divisionDetection.divisions.length > 0) {
    const canonicalCode = divisionDetection.divisionCodes[0];
    const prevDomain = plan.domain.value;
    if (prevDomain !== canonicalCode) {
      plan.domain = { value: canonicalCode, source: 'USER_QUERY' };
    } else {
      plan.domain.source = 'USER_QUERY';
    }
    // 잘못된 DIVISION/DIVISION_NM filter 제거
    if (Array.isArray(plan.filters)) {
      plan.filters = plan.filters.filter(f => {
        const col = String(f?.column || '').toUpperCase();
        return col !== 'DIVISION' && col !== 'DIVISION_NM';
      });
    }
    // "사업부별" 명시 없으면 DIVISION dimension 제거
    const asksByDivision = /사업부\s*별|각\s*사업부|사업부\s*단위/.test(query || '');
    if (!asksByDivision && Array.isArray(plan.dimensions)) {
      plan.dimensions = plan.dimensions.filter(d => {
        const cols = Array.isArray(d?.columns) ? d.columns.map(c => String(c).toUpperCase()) : [];
        const onlyDivision = cols.length > 0 && cols.every(c => c === 'DIVISION' || c === 'DIVISION_NM');
        return !onlyDivision;
      });
    }
  }

  return { plan, divisionDetection };
}

// ── 테스트 러너
let passed = 0, failed = 0;
const failures = [];

function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    failures.push({ label, actual: a, expected: e });
    console.log(`  ❌ ${label}\n     expected: ${e}\n     actual:   ${a}`);
  }
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[1] detectDivisionInQuery — HL 5 표현 모두 DIVISION=20 매핑');
// ═══════════════════════════════════════════════════════════════════
const hlQueries = [
  'HL SKU별 매출 TOP5',
  'HL사업부 SKU별 매출 TOP5',
  'HL 사업부 SKU별 매출 TOP5',
  '홈앤라이프 SKU별 매출 TOP5',
  '홈앤라이프 사업부 SKU별 매출 TOP5',
];
for (const q of hlQueries) {
  const det = detectDivisionInQuery(q);
  assertEq(
    { code: det.divisionCode, div: det.division },
    { code: 'HL', div: '20' },
    `"${q}" → HL/20`
  );
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[2] detectDivisionInQuery — PS 4 표현 모두 DIVISION=10 매핑');
// ═══════════════════════════════════════════════════════════════════
const psQueries = [
  'PS SKU별 매출 TOP5',
  'PS사업부 SKU별 매출 TOP5',
  'PS 사업부 SKU별 매출 TOP5',
  '페이퍼솔루션 SKU별 매출 TOP5',
];
for (const q of psQueries) {
  const det = detectDivisionInQuery(q);
  assertEq(
    { code: det.divisionCode, div: det.division },
    { code: 'PS', div: '10' },
    `"${q}" → PS/10`
  );
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[3] plan 정규화 — 활성 도메인이 달라도 감지 결과가 우선');
// ═══════════════════════════════════════════════════════════════════
// 시나리오: 활성 도메인이 'PS' 인데 사용자가 "HL사업부 SKU별 매출 TOP5" 물어봄
{
  const llmPlan = {
    // LLM 이 활성도메인 존중하여 잘못된 plan 생성
    domain: { value: 'PS', source: 'UI_FILTER' },
    dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
    metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
    filters: [],
    operations: [
      { type: 'GROUP_BY', dimensions: ['SKU'] },
      { type: 'CALCULATE_METRICS', metrics: ['순매출'] },
      { type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' },
    ],
  };
  const { plan } = normalizeAnalysisPlan('HL사업부 SKU별 매출 TOP5', 'PS', llmPlan);
  assertEq(plan.domain, { value: 'HL', source: 'USER_QUERY' },
    '활성=PS + 질의="HL사업부..." → plan.domain 강제 HL 로 재작성');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[4] plan 정규화 — LLM 이 잘못 넣은 DIVISION filter 자동 제거');
// ═══════════════════════════════════════════════════════════════════
{
  const llmPlan = {
    domain: { value: 'PS', source: 'UI_FILTER' },
    dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
    metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
    filters: [
      // LLM 이 흔히 만드는 잘못된 filter
      { column: 'DIVISION_NM', op: '=', value: 'HL사업부' },
      { column: 'CALMONTH', op: '=', value: '202607' },
    ],
    operations: [],
  };
  const { plan } = normalizeAnalysisPlan('HL사업부 SKU별 매출 TOP5', 'PS', llmPlan);
  assertEq(plan.filters, [{ column: 'CALMONTH', op: '=', value: '202607' }],
    'DIVISION_NM="HL사업부" filter 제거, CALMONTH filter 는 유지');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[5] plan 정규화 — "사업부별" 미언급 시 DIVISION dimension 제거');
// ═══════════════════════════════════════════════════════════════════
{
  const llmPlan = {
    domain: { value: 'PS', source: 'UI_FILTER' },
    dimensions: [
      { name: '사업부', columns: ['DIVISION', 'DIVISION_NM'] },  // 불필요
      { name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] },
    ],
    metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
    filters: [],
    operations: [],
  };
  const { plan } = normalizeAnalysisPlan('HL SKU별 매출 TOP5', 'PS', llmPlan);
  assertEq(plan.dimensions, [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
    '"사업부별" 미언급 → DIVISION dimension 제거, SKU dimension 만 남음');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[6] plan 정규화 — "사업부별" 명시 시 DIVISION dimension 유지');
// ═══════════════════════════════════════════════════════════════════
{
  const llmPlan = {
    domain: { value: 'PS', source: 'UI_FILTER' },
    dimensions: [
      { name: '사업부', columns: ['DIVISION', 'DIVISION_NM'] },
    ],
    metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
    filters: [],
    operations: [],
  };
  const { plan } = normalizeAnalysisPlan('사업부별 매출 TOP5', 'PS', llmPlan);
  assertEq(plan.dimensions.length, 1,
    '"사업부별" 언급 → DIVISION dimension 유지 (그룹핑 축)');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[7] ★ 핵심 회귀 — HL 5 표현이 모두 동일한 정규화 plan 생성');
// ═══════════════════════════════════════════════════════════════════
{
  // LLM 이 만들 법한 plan (표현마다 조금씩 달라질 수 있음)
  const llmPlansForHL = [
    // "HL SKU별 매출 TOP5" — LLM 이 domain 을 HL 로 잘 넣음
    { query: 'HL SKU별 매출 TOP5', plan: {
      domain: { value: 'HL', source: 'USER_QUERY' },
      dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
      metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
      filters: [],
      operations: [{ type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' }],
    }},
    // "HL사업부 SKU별 매출 TOP5" — LLM 이 activeDomain 존중해서 PS 로 오판
    { query: 'HL사업부 SKU별 매출 TOP5', plan: {
      domain: { value: 'PS', source: 'UI_FILTER' },
      dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
      metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
      filters: [],
      operations: [{ type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' }],
    }},
    // "HL 사업부 ..." — LLM 이 DIVISION_NM filter 로 잘못 넣음
    { query: 'HL 사업부 SKU별 매출 TOP5', plan: {
      domain: { value: 'PS', source: 'UI_FILTER' },
      dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
      metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
      filters: [{ column: 'DIVISION_NM', op: '=', value: 'HL 사업부' }],
      operations: [{ type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' }],
    }},
    // "홈앤라이프 ..." — LLM 이 잘 인식
    { query: '홈앤라이프 SKU별 매출 TOP5', plan: {
      domain: { value: 'HL', source: 'USER_QUERY' },
      dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
      metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
      filters: [],
      operations: [{ type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' }],
    }},
    // "홈앤라이프 사업부 ..." — LLM 이 사업부 dimension 잘못 추가
    { query: '홈앤라이프 사업부 SKU별 매출 TOP5', plan: {
      domain: { value: 'HL', source: 'USER_QUERY' },
      dimensions: [
        { name: '사업부', columns: ['DIVISION', 'DIVISION_NM'] },  // 불필요
        { name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] },
      ],
      metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
      filters: [],
      operations: [{ type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' }],
    }},
  ];

  const normalizedPlans = llmPlansForHL.map(({ query, plan }) => {
    const { plan: normalized } = normalizeAnalysisPlan(query, 'PS', plan);
    return { query, normalized };
  });

  // 검증 1: 모두 domain.value === 'HL'
  for (const { query, normalized } of normalizedPlans) {
    assertEq(normalized.domain.value, 'HL', `"${query}" → domain.value='HL'`);
  }

  // 검증 2: DIVISION/DIVISION_NM filter 없음
  for (const { query, normalized } of normalizedPlans) {
    const hasDivFilter = (normalized.filters || []).some(f => {
      const c = String(f.column).toUpperCase();
      return c === 'DIVISION' || c === 'DIVISION_NM';
    });
    assertEq(hasDivFilter, false, `"${query}" → DIVISION filter 없음`);
  }

  // 검증 3: dimension 은 SKU 만 남음
  for (const { query, normalized } of normalizedPlans) {
    const dimNames = (normalized.dimensions || []).map(d => d.name);
    assertEq(dimNames, ['SKU'], `"${query}" → dimensions=[SKU] 만 남음`);
  }
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[8] ★ 핵심 회귀 — PS 4 표현이 모두 동일한 정규화 plan 생성');
// ═══════════════════════════════════════════════════════════════════
{
  const psExpressions = ['PS', 'PS사업부', 'PS 사업부', '페이퍼솔루션'];
  for (const expr of psExpressions) {
    const query = `${expr} SKU별 매출 TOP5`;
    const llmPlan = {
      domain: { value: 'HL', source: 'UI_FILTER' },  // 활성=HL 인데 질의는 PS
      dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
      metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
      filters: [],
      operations: [{ type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' }],
    };
    const { plan } = normalizeAnalysisPlan(query, 'HL', llmPlan);
    assertEq(plan.domain.value, 'PS', `"${query}" (활성=HL) → domain.value='PS'`);
  }
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[9] 사업부 언급 없는 질의 — 활성 도메인 유지');
// ═══════════════════════════════════════════════════════════════════
{
  const llmPlan = {
    domain: { value: 'MGMT', source: 'UI_FILTER' },
    dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
    metrics: [{ name: '순매출', formula: 'SUM(ZAMT001)' }],
    filters: [],
    operations: [],
  };
  // "SKU별 매출 TOP5" 는 사업부 언급이 없음
  const { plan, divisionDetection } = normalizeAnalysisPlan('SKU별 매출 TOP5', 'MGMT', llmPlan);
  assertEq(divisionDetection.divisions, [], '사업부 미언급 → 감지 결과 empty');
  assertEq(plan.domain.value, 'MGMT', '사업부 미언급 → 활성 도메인 유지 (MGMT)');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[10] 복수 사업부 — 첫 번째 감지 값 사용 (등장 순서 우선)');
// ═══════════════════════════════════════════════════════════════════
{
  // "PS 와 HL 매출 비교" → 첫 번째 감지는 PS
  const det1 = detectDivisionInQuery('PS 와 HL 매출 비교');
  assertEq({ first: det1.divisionCodes[0], all: det1.divisionCodes.sort() },
    { first: 'PS', all: ['HL', 'PS'] },
    '"PS 와 HL" → 첫 감지 PS, 전체 [HL, PS]');

  // "HL 과 PS 매출 비교" → 첫 번째 감지는 HL
  const det2 = detectDivisionInQuery('HL 과 PS 매출 비교');
  assertEq({ first: det2.divisionCodes[0], all: det2.divisionCodes.sort() },
    { first: 'HL', all: ['HL', 'PS'] },
    '"HL 과 PS" → 첫 감지 HL, 전체 [HL, PS]');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n[11] 오탐 방지 — 한글 단어 내부의 HL/PS 는 매치되지 않아야 함');
// ═══════════════════════════════════════════════════════════════════
{
  // 예: "APS" (한글 아니지만 영숫자로 붙어 있음) → 매치 안 됨
  const det = detectDivisionInQuery('APS 매출');
  assertEq(det.divisions, [], '"APS 매출" → 사업부 아님 (영숫자로 붙음)');

  // "HLL" 같은 케이스
  const det2 = detectDivisionInQuery('HLL 매출');
  assertEq(det2.divisions, [], '"HLL 매출" → 사업부 아님');
}

// ═══════════════════════════════════════════════════════════════════
console.log('\n─────────────────────────────────────────────────────');
console.log(`결과: ${passed}건 통과 / ${failed}건 실패`);
console.log('─────────────────────────────────────────────────────');
if (failed > 0) {
  console.log('\n실패 내역:');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
    console.log(`      expected: ${f.expected}`);
    console.log(`      actual:   ${f.actual}`);
  }
  process.exit(1);
}
process.exit(0);
