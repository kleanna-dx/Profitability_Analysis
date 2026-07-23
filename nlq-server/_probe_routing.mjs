// ============================================================
// [PROBE] 사용자 리포트 질문의 실제 라우팅 경로 시뮬레이션 (PR #256)
// ------------------------------------------------------------
// PR #256 정책:
//   Tier 1 metric_lookup 정규식이 매치되면, 분석 신호가 함께 있더라도
//   metric_lookup 을 그대로 반환한다. (실행 경로 변경 없음)
//   분석 신호는 handleMetricLookup 내부에서 suggestAnalysis=true 로만 사용.
//
// 기대 매트릭스:
//   | 질문                                       | Tier 1 결과      | 분석 신호 |
//   |---------------------------------------------|------------------|-----------|
//   | reported (산식+상관관계)                    | metric_lookup    | true      |
//   | no-formula (순수 상관관계)                  | null (→ LLM)     | true      |
//   | pure-metric (영업이익율 산식이 뭐야?)       | metric_lookup    | false     |
//   | formula-only (영업이익율 어떻게 계산해?)    | metric_lookup    | false     |
//   | why-decrease (왜 매출 줄었어?)              | null (→ LLM)     | true      |
//   | trend (매출 추세)                           | null (→ LLM)     | true      |
// ============================================================
import {
  classifyConversationalIntentHeuristic,
  hasAnalysisSignal,
  INTENT_LABELS,
} from './conversational-intent.mjs';

const QUERIES = [
  // 사용자 리포트의 원본 질문 (사진 [1])
  //   PR #256: metric_lookup 정규식이 매치되면 그대로 metric_lookup 확정.
  //   suggestAnalysis 힌트는 handler 내부에서 처리.
  {
    tag: 'reported',
    q: 'PS사업부 거래처별 영업이익율과 판매관리비 중 지급수수료(변동비)의 원단위간의 상관관계를 분석해 줘. 지급수수료 원단위는 "지급수수료(변동)/판매중량(kg)"으로 계산하고, 영업이익율은 "영업이익/순매출"로 계산함. 이 질문에 대한 결과를 같이 알려줘',
    expectTier1: 'metric_lookup',   // PR #256 원복
    expectAnalysisSignal: true,
  },
  // 같은 의도지만 산식 언급 없이 — Tier 1 정규식 자체가 매치 안 됨 → Tier 2 위임
  {
    tag: 'no-formula',
    q: 'PS사업부 거래처별 영업이익율과 지급수수료 원단위의 상관관계를 분석해줘',
    expectTier1: null,
    expectAnalysisSignal: true,
  },
  // 순수 산식 조회
  {
    tag: 'pure-metric',
    q: '영업이익율 산식이 뭐야?',
    expectTier1: 'metric_lookup',
    expectAnalysisSignal: false,
  },
  // 산식만 알려달라
  {
    tag: 'formula-only',
    q: '영업이익율 어떻게 계산해?',
    expectTier1: 'metric_lookup',
    expectAnalysisSignal: false,
  },
  // 증감 원인 질문 — 기존 troubleshooting 정규식은 "줄" 미매치 → Tier 2 위임
  {
    tag: 'why-decrease',
    q: '왜 매출이 줄었어?',
    expectTier1: null,
    expectAnalysisSignal: true,
  },
  // 추세 요청
  {
    tag: 'trend',
    q: '최근 3개월 매출 추세 보여줘',
    expectTier1: null,
    expectAnalysisSignal: true,
  },
];

console.log('\n===== Tier 1 휴리스틱 분류기 프로브 (PR #256) =====\n');
console.log('  정책: metric_lookup 정규식 매치 시 무조건 metric_lookup 반환.');
console.log('  분석 신호는 handler 내부 suggestAnalysis 판단에만 사용.\n');

let pass = 0, fail = 0;
for (const item of QUERIES) {
  const { tag, q, expectTier1, expectAnalysisSignal } = item;
  const result = classifyConversationalIntentHeuristic(q, []);
  const sig = hasAnalysisSignal(q);
  const label = result ? (INTENT_LABELS[result] || result) : '(null → Tier 2 LLM 위임)';

  const tier1Ok = (result === expectTier1);
  const sigOk = (sig === expectAnalysisSignal);
  const ok = tier1Ok && sigOk;
  const mark = ok ? '✅' : '❌';
  if (ok) pass++; else fail++;

  console.log(`${mark} [${tag}]`);
  console.log(`   질문: "${q.slice(0, 90)}${q.length > 90 ? '…' : ''}"`);
  console.log(`   Tier 1: ${result || 'null'}   기대: ${expectTier1 || 'null'}${tier1Ok ? '' : '   ← 불일치'}`);
  console.log(`   분석신호: ${sig}   기대: ${expectAnalysisSignal}${sigOk ? '' : '   ← 불일치'}`);
  console.log(`   라벨: ${label}`);
  console.log('');
}

console.log(`===== 요약: ${pass} pass / ${fail} fail =====\n`);

// 사용자 원본 질문에 대해 (a) Tier 1 이 metric_lookup 반환, (b) 분석 신호 true 임을 확인
console.log('\n===== 사용자 원본 질문 정책 검증 =====\n');
const q = QUERIES[0].q;
console.log(`  Tier 1 반환:              ${classifyConversationalIntentHeuristic(q, [])}`);
console.log(`  hasAnalysisSignal(q):     ${hasAnalysisSignal(q)}`);
console.log(`  → aggregate 모드에서 handleMetricLookup 이 실행되고,`);
console.log(`    suggestAnalysis:true 로 응답이 조립되어 파란 안내 카드가 표시됨.`);
console.log(`    상관분석 SQL 은 생성되지 않으므로 HTTP 400 회귀 없음.\n`);

process.exit(fail > 0 ? 1 : 0);
