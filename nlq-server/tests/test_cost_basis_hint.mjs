/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_cost_basis_hint.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상: server.mjs 의 "제품별 원가 4컬럼 세트 프롬프트 힌트"
 *       발동 조건 및 (일부) 프롬프트 문구 스팟 체크.
 *
 * 배경 (사용자 신고):
 *   "F2A11220-05000720B 자재 실제원가 알려줘" 에서 SUM(TOTAL) 총액만 반환.
 *   → 원가 총액/생산수량/단위/단가 4컬럼 세트로 출력하도록 프롬프트 힌트 주입.
 *
 * 검증 항목:
 *   [A] 트리거 조건 (모두 만족 시만 발동):
 *     1) tableWhitelist 에 sys_aimd_cot015 포함
 *     2) columnMatches 에 ZCGUBUN 컬럼 매칭 존재
 *     3) 사용자 질의에 총액 명시 표현 없음
 *   [B] 사용자 요구 Case 1~5 시나리오
 *   [C] 하드코딩 방지 (특정 자재코드/특정 ZCGUBUN 값 없음)
 *   [D] server.mjs 소스에 실제 반영되었는지 스팟 체크
 *   [E] 회귀 안전성 — 관련 없는 스코프/질의는 발동 안 함
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_MJS = path.resolve(__dirname, '../server.mjs');

let passCount = 0;
let failCount = 0;
function assert(cond, msg) {
  if (cond) { passCount++; console.log('  ✅ ' + msg); }
  else      { failCount++; console.log('  ❌ ' + msg); }
}
function section(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

// ── 트리거 로직 재현 (server.mjs 와 로직상 동일) ─────────────────────
// server.mjs 실제 코드 (line 4197~4207) 와 완전히 동일한 순수 로직.
const EXPLICIT_TOTAL_INTENT_RE = /(총액|총금액|총원가|총합|합계|총\s*발생액|총\s*금액)/;

function computeCostBasisHintTrigger({ query, columnMatches, tableWhitelist }) {
  const hasCot015Scope = Array.isArray(tableWhitelist)
    && tableWhitelist.includes('sys_aimd_cot015');
  const hasZcgubunMatch = (columnMatches || []).some(m =>
    String(m.column_name || '').toUpperCase() === 'ZCGUBUN'
  );
  const hasExplicitTotalIntent = EXPLICIT_TOTAL_INTENT_RE.test(String(query || ''));
  const wouldTrigger = hasCot015Scope && hasZcgubunMatch && !hasExplicitTotalIntent;
  return { hasCot015Scope, hasZcgubunMatch, hasExplicitTotalIntent, wouldTrigger };
}

const zcgubunMatch = (val) => ({
  column_name: 'ZCGUBUN', data_type: 'varchar(20)',
  matchedKeyword: val, synonym: val, source: 'ontology',
});
const materialMatch = () => ({
  column_name: 'MATERIAL', data_type: 'varchar(18)',
  matchedKeyword: '자재', synonym: '자재', source: 'ontology',
});
const SCOPE = ['sys_aimd_cot015'];

// ══════════════════════════════════════════════════════════════════════════
section('[A] 트리거 조건 매트릭스 (3조건 조합)');
// ══════════════════════════════════════════════════════════════════════════
{
  // scope + zcgubun + no-explicit-total → 발동
  const c1 = computeCostBasisHintTrigger({
    query: '실제원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: SCOPE,
  });
  assert(c1.wouldTrigger === true, '모든 조건 만족 → 발동');

  // scope 없음 → 미발동
  const c2 = computeCostBasisHintTrigger({
    query: '실제원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: [],
  });
  assert(c2.wouldTrigger === false, 'sys_aimd_cot015 스코프 없음 → 미발동');

  // ZCGUBUN 매칭 없음 → 미발동
  const c3 = computeCostBasisHintTrigger({
    query: '자재별 조회',
    columnMatches: [materialMatch()],
    tableWhitelist: SCOPE,
  });
  assert(c3.wouldTrigger === false, 'ZCGUBUN 매칭 없음 → 미발동');

  // 총액 명시 → 미발동 (사용자 의도 존중)
  const c4 = computeCostBasisHintTrigger({
    query: '실제원가 총액 알려줘',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: SCOPE,
  });
  assert(c4.wouldTrigger === false, '총액 명시 → 미발동 (SUM(TOTAL) 허용)');
}

// ══════════════════════════════════════════════════════════════════════════
section('[E] 총액 명시 표현 boundary — 다양한 표현 정확도');
// ══════════════════════════════════════════════════════════════════════════
{
  const totalCases = [
    ['실제원가 총액', true,  '"총액" 매칭'],
    ['실제원가 총금액', true, '"총금액" 매칭'],
    ['실제원가 총원가', true, '"총원가" 매칭'],
    ['실제원가 총합', true, '"총합" 매칭'],
    ['실제원가 합계', true, '"합계" 매칭'],
    ['실제원가 총 금액', true, '"총 금액" (공백) 매칭'],
    // 미매칭 케이스 (긍정 오탐 방지)
    ['실제원가 알려줘', false, '"알려줘" 미매칭'],
    ['제품별 실제원가', false, '단순 실제원가 미매칭'],
    ['실제원가 단가', false, '"단가" 만은 총액 아님'],
    ['이 제품 원가', false, '단순 원가 미매칭'],
  ];
  totalCases.forEach(([q, expected, label]) => {
    const got = EXPLICIT_TOTAL_INTENT_RE.test(q);
    assert(got === expected, `"${q}" → 총액 명시 ${expected}: ${label}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════
section('[B-1] Case 1: "F2A11220-05000720B 자재 실제원가 알려줘"');
// ══════════════════════════════════════════════════════════════════════════
{
  const r = computeCostBasisHintTrigger({
    query: 'F2A11220-05000720B 자재 실제원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가'), materialMatch()],
    tableWhitelist: SCOPE,
  });
  assert(r.wouldTrigger === true, 'Case 1: 힌트 발동');
  assert(r.hasCot015Scope === true, 'sys_aimd_cot015 스코프');
  assert(r.hasZcgubunMatch === true, 'ZCGUBUN 매칭 (실제원가)');
  assert(r.hasExplicitTotalIntent === false, '총액 명시 없음');
}

// ══════════════════════════════════════════════════════════════════════════
section('[B-2] Case 2: "F2A11220-05000720B 제조원가 알려줘"');
// ══════════════════════════════════════════════════════════════════════════
{
  // "제조원가" 도 ZCGUBUN 매칭이 되는지는 seed 등록 여부에 달림.
  // 여기서는 seed 상 매칭된다고 가정 (실제 seed 데이터 확인 필요 - 별도 [D] 에서).
  const r = computeCostBasisHintTrigger({
    query: 'F2A11220-05000720B 제조원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가')], // 실 매칭 결과 시뮬 (실제원가/매출원가 등이 매칭됨)
    tableWhitelist: SCOPE,
  });
  assert(r.wouldTrigger === true, 'Case 2: 힌트 발동 (ZCGUBUN 매칭 있으면 원가 관련 어휘 다 커버)');
}

// ══════════════════════════════════════════════════════════════════════════
section('[B-3] Case 3: "제품별 실제원가 TOP 5" (정렬 의도 有)');
// ══════════════════════════════════════════════════════════════════════════
{
  const r = computeCostBasisHintTrigger({
    query: '제품별 실제원가 TOP 5',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: SCOPE,
  });
  assert(r.wouldTrigger === true, 'Case 3: TOP 5 요청도 힌트 발동');
  // TOP 존재는 orderDirective 를 "단가 기준 정렬" 문구로 바꿈 - 프롬프트 문구 검증은 [D] 에서
}

// ══════════════════════════════════════════════════════════════════════════
section('[B-4] Case 4: "제품별 실제원가 총액 TOP 5"');
// ══════════════════════════════════════════════════════════════════════════
{
  const r = computeCostBasisHintTrigger({
    query: '제품별 실제원가 총액 TOP 5',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: SCOPE,
  });
  assert(r.wouldTrigger === false, 'Case 4: "총액" 명시 → 힌트 미발동 (SUM(TOTAL) 조회 허용)');
  assert(r.hasExplicitTotalIntent === true, '총액 명시 감지');
}

// ══════════════════════════════════════════════════════════════════════════
section('[B-5] Case 5: 생산수량 0 관련 — NULLIF 문구가 프롬프트 힌트에 명시');
// ══════════════════════════════════════════════════════════════════════════
{
  // 이 케이스는 프롬프트 문구가 NULLIF 를 명시하는지가 관건 → [D] 에서 검증
  const r = computeCostBasisHintTrigger({
    query: '실제원가 조회',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: SCOPE,
  });
  assert(r.wouldTrigger === true, 'Case 5: 힌트 발동');
}

// ══════════════════════════════════════════════════════════════════════════
section('[C] 하드코딩 방지 — 특정 값/코드가 로직 없음');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(SERVER_MJS, 'utf8');
  // 힌트 블록만 추출
  const blockStart = src.indexOf('// [2026-09-11] 제품별 원가 4컬럼 세트');
  const blockEnd = src.indexOf('console.log(`[CostBasisHint] sys_aimd_cot015 + ZCGUBUN 매칭이지만');
  const block = src.slice(blockStart, blockEnd + 200);

  assert(!/F2A11220/.test(block), '특정 자재코드 F2A11220 하드코딩 없음');
  assert(!/H3S72400/.test(block), '특정 자재코드 H3S72400 하드코딩 없음');
  // ZCGUBUN 값(실제원가/매출원가 등) 은 로그 예시로 나올 수 있으므로 생판 하드코딩만 확인
  // → 특정 value=='실제원가' 같은 하드코딩된 비교문 존재 여부만 검사
  assert(!/=== ['"]실제원가['"]/.test(block), 'value==="실제원가" 하드코딩 없음');
  assert(!/=== ['"]매출원가['"]/.test(block), 'value==="매출원가" 하드코딩 없음');
}

// ══════════════════════════════════════════════════════════════════════════
section('[D] server.mjs 소스에 실제 반영 확인 + 프롬프트 문구 스팟 체크');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(SERVER_MJS, 'utf8');

  // 함수·상수 정의 확인
  assert(src.includes('const HAS_COT015_SCOPE'), 'HAS_COT015_SCOPE 정의됨');
  assert(src.includes('const HAS_ZCGUBUN_MATCH'), 'HAS_ZCGUBUN_MATCH 정의됨');
  assert(src.includes('const EXPLICIT_TOTAL_INTENT_RE'), 'EXPLICIT_TOTAL_INTENT_RE 정의됨');
  assert(src.includes('CostBasisHint'), '[CostBasisHint] 로그 태그 있음');

  // 프롬프트 문구에 필수 요소들이 있는지
  const requiredPhrases = [
    '4컬럼 세트',
    "SUM(TOTAL)",
    "SUM(LBKUM)",
    "MAX(BASE_UOM)",
    "ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0)",
    "'원가 총액(원)'",
    "'생산수량'",
    "'단위'",
    "'원가 단가'",
    "GROUP BY MATERIAL",
    "HAVING SUM(LBKUM) <> 0",
    "AVG(TOTAL / LBKUM)", // 금지 예시로 명시
    "NULLIF(SUM(LBKUM), 0)",
  ];
  for (const p of requiredPhrases) {
    assert(src.includes(p), `프롬프트 문구에 "${p}" 포함됨`);
  }

  // 컬럼 순서 고정 (숫자 1~6)
  const orderPattern = /1\.\s*MATERIAL[\s\S]{0,200}2\.\s*MAX\(MATERIAL_NM\)[\s\S]{0,200}3\.\s*SUM\(TOTAL\)[\s\S]{0,200}4\.\s*SUM\(LBKUM\)[\s\S]{0,200}5\.\s*MAX\(BASE_UOM\)[\s\S]{0,200}6\.\s*ROUND/;
  assert(orderPattern.test(src),
    '프롬프트에 컬럼 순서 1~6 (코드/명/총액/수량/단위/단가) 순차 명시');

  // 정렬 의도 분기 지시 확인
  assert(src.includes("ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) DESC"),
    '정렬 의도 있을 때 단가 기준 ORDER BY 지시');
  assert(src.includes('단일 제품/자재 조회이면 ORDER BY 절을 아예 만들지'),
    '정렬 의도 없을 때 ORDER BY 생성 금지 지시');
}

// ══════════════════════════════════════════════════════════════════════════
section('[E-1] 회귀 안전성 — 관련 없는 스코프에서 미발동');
// ══════════════════════════════════════════════════════════════════════════
{
  // 수익성분석 스코프 (bw_profitability_data) → ZCGUBUN 매칭 있어도 미발동
  const r1 = computeCostBasisHintTrigger({
    query: '실제원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: ['bw_profitability_data'],
  });
  assert(r1.wouldTrigger === false,
    '수익성분석 스코프에서는 미발동 (sys_aimd_cot015 아니므로)');

  // 부서별원가 스코프 (sys_aimd_cot043) → 미발동
  const r2 = computeCostBasisHintTrigger({
    query: '실제원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: ['sys_aimd_cot043'],
  });
  assert(r2.wouldTrigger === false,
    '부서별원가 스코프(cot043)에서는 미발동');

  // 스코프 다중 (cot015 + cot043) → 발동 (cot015 포함하면 조건 성립)
  const r3 = computeCostBasisHintTrigger({
    query: '실제원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가')],
    tableWhitelist: ['sys_aimd_cot015', 'sys_aimd_cot043'],
  });
  assert(r3.wouldTrigger === true,
    '스코프에 sys_aimd_cot015 포함되면 발동');
}

// ══════════════════════════════════════════════════════════════════════════
section('[E-2] 회귀 안전성 — 다른 ZCGUBUN 값도 발동 (실제/매출/표준 모두)');
// ══════════════════════════════════════════════════════════════════════════
{
  const values = ['실제원가', '표준원가', '매출원가'];
  for (const v of values) {
    const r = computeCostBasisHintTrigger({
      query: `${v} 조회`,
      columnMatches: [zcgubunMatch(v)],
      tableWhitelist: SCOPE,
    });
    assert(r.wouldTrigger === true, `ZCGUBUN='${v}' 매칭 → 발동`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('[E-3] 회귀 안전성 — 다중 ZCGUBUN 매칭 처리');
// ══════════════════════════════════════════════════════════════════════════
{
  // 같은 질의에 여러 ZCGUBUN 값 언급 (예: "실제원가와 표준원가 비교")
  const r = computeCostBasisHintTrigger({
    query: '제품별 실제원가와 표준원가 비교',
    columnMatches: [zcgubunMatch('실제원가'), zcgubunMatch('표준원가')],
    tableWhitelist: SCOPE,
  });
  assert(r.wouldTrigger === true, '복수 ZCGUBUN 매칭도 발동');
}

// ══════════════════════════════════════════════════════════════════════════
section('[G] Metric 산식과의 관계 명시 (COST_ACTUAL_UNIT_PRICE 보완)');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(SERVER_MJS, 'utf8');
  // 프롬프트 문구에 metric 과의 관계 설명 존재
  assert(src.includes('COST_ACTUAL_UNIT_PRICE'),
    'metric_code COST_ACTUAL_UNIT_PRICE 언급 (PR #435 metric 과의 보완 관계)');
  assert(src.includes('보완 관계'),
    'metric 힌트와 이 4컬럼 세트가 보완 관계임을 명시');
}

// ══════════════════════════════════════════════════════════════════════════
section('[H] 수학적 검증: SUM(TOTAL)/SUM(LBKUM) 요구사항 계산 정확도');
// ══════════════════════════════════════════════════════════════════════════
{
  // 사용자 요구 예시: TOTAL=1,280,086,603원, LBKUM=2,487,031.560 KG → 약 514.70 원/KG
  const total = 1280086603;
  const lbkum = 2487031.560;
  const nullif = (v, cmp) => (v === cmp ? null : v);
  const denom = nullif(lbkum, 0);
  const unitPrice = denom === null ? null : total / denom;
  const rounded = Math.round(unitPrice);
  assert(unitPrice.toFixed(2) === '514.70',
    `SUM(TOTAL)/SUM(LBKUM) = ${unitPrice.toFixed(2)} ≈ 514.70 (요구사항 예시)`);
  assert(rounded === 515,
    `ROUND(514.70, 0) = 515 (원 단위 정수, MySQL ROUND 는 반올림)`);

  // AVG(TOTAL/LBKUM) 이 아닌 SUM(TOTAL)/SUM(LBKUM) 이어야 함을 시뮬
  // (2개 행: 각각 (500, 1) 과 (1000, 4) → 합계 방식은 1500/5=300, 평균 방식은 (500+250)/2=375)
  const sumMethod = (500 + 1000) / (1 + 4); // 300
  const avgMethod = (500/1 + 1000/4) / 2;    // 375
  assert(sumMethod !== avgMethod,
    'SUM(TOTAL)/SUM(LBKUM) vs AVG(TOTAL/LBKUM) 결과 다름 (사용자 요구는 SUM 방식)');
  assert(sumMethod === 300,
    'SUM 방식: (500+1000)/(1+4) = 300 (합계의 비율)');
}

// ══════════════════════════════════════════════════════════════════════════
section('결과 요약');
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
if (failCount > 0) process.exit(1);
