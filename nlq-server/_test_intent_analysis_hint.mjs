// ============================================================
// [PR #255] 자연어질의 intent 분류 오류 + 분석 안내 누락 수정 검증
// ------------------------------------------------------------
// 대상:
//   1. hasAnalysisSignal(query)             : 분석 신호 감지
//   2. classifyConversationalIntentHeuristic: Tier 1 metric_lookup exclusion
//   3. buildConversationalResponse           : suggestAnalysis 필드 정규화
// ============================================================
import {
  hasAnalysisSignal,
  classifyConversationalIntentHeuristic,
  buildConversationalResponse,
} from './conversational-intent.mjs';

let pass = 0, fail = 0;
const fails = [];

function assertEq(label, got, want) {
  const ok = (got === want);
  if (ok) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    fails.push({ label, got, want });
    console.log(`  ❌ ${label}`);
    console.log(`     기대: ${JSON.stringify(want)}`);
    console.log(`     실제: ${JSON.stringify(got)}`);
  }
}

// ============================================================
// A. hasAnalysisSignal 단위 테스트
// ============================================================
console.log('\n[A] hasAnalysisSignal(query) — 분석 신호 감지\n');

const signalPositives = [
  // 사용자 리포트 원본
  'PS사업부 거래처별 영업이익율과 판매관리비 중 지급수수료(변동비)의 원단위간의 상관관계를 분석해 줘. 이 질문에 대한 결과를 같이 알려줘',
  // 단순 상관관계
  '두 지표의 상관관계를 계산해줘',
  '상관계수 알려줘',
  'correlation 계산해줘',
  // 분석 요청
  '이 데이터 분석해줘',
  '분석해 주세요',
  // 추세/추이
  '최근 6개월 매출 추세는?',
  '판매량 추이 보여줘',
  // 원인/이유
  '왜 매출이 줄었는지 원인을 알려줘',
  '이유가 뭐야',
  // 시사점/인사이트
  '이번 결과의 시사점은?',
  '인사이트가 필요해',
  // 비교
  '두 사업부 비교해줘',
  // 해석
  '이 결과 해석해줘',
  '어떻게 해석해야 해?',
  // 왜 + 증감
  '왜 매출이 줄었어?',
  '왜 이익이 늘었지?',
  '왜 매출이 감소했어?',
  '왜 이익이 떨어졌어?',
  // 결과 요청
  '결과도 같이 알려줘',
  '결과 보여줘',
];

for (const q of signalPositives) {
  assertEq(`분석 신호=true: "${q.slice(0, 50)}…"`, hasAnalysisSignal(q), true);
}

const signalNegatives = [
  // 순수 산식 조회 (분석 신호 없음)
  '영업이익율 산식이 뭐야?',
  '영업이익율 어떻게 계산해?',
  'ROIC 정의가 뭐야',
  '이 지표는 어떻게 산출해?',
  // 단순 조회
  '이번 달 매출',
  'PS 영업이익 상위 5개',
  // 컬럼 설명
  'DIVISION 컬럼이 뭐야',
  // SQL 설명
  '방금 SQL 설명해줘',
  // 도메인
  '지금 어느 도메인이야',
  // 잘못된 입력
  '',
  null,
  undefined,
  '   ',
];

for (const q of signalNegatives) {
  const preview = (q === null || q === undefined) ? String(q) : `"${q.slice(0, 40)}"`;
  assertEq(`분석 신호=false: ${preview}`, hasAnalysisSignal(q), false);
}

// ============================================================
// B. Tier 1 heuristic — PR #256: metric_lookup 정규식이 매치되면 그대로 반환
//    (분석 신호가 있더라도 실행 경로는 metric_lookup 유지)
// ============================================================
console.log('\n[B] classifyConversationalIntentHeuristic — Tier 1 라우팅 (PR #256)\n');

// 사용자 원본 (산식 + 상관관계) → metric_lookup 유지 (aggregate 경로 안정성)
assertEq(
  '사용자 원본 (산식 + 상관관계): metric_lookup 유지 (실행 경로 안정)',
  classifyConversationalIntentHeuristic(
    'PS사업부 거래처별 영업이익율과 지급수수료의 상관관계를 분석해 줘. 영업이익율은 "영업이익/순매출"로 계산함',
    []
  ),
  'metric_lookup'
);

// 순수 산식 조회 → metric_lookup
assertEq(
  '순수 산식 조회: metric_lookup',
  classifyConversationalIntentHeuristic('영업이익율 산식이 뭐야?', []),
  'metric_lookup'
);

assertEq(
  '어떻게 계산: metric_lookup',
  classifyConversationalIntentHeuristic('영업이익율 어떻게 계산해?', []),
  'metric_lookup'
);

assertEq(
  'ROIC 정의: metric_lookup',
  classifyConversationalIntentHeuristic('ROIC 정의가 뭐야', []),
  'metric_lookup'
);

// 산식 언급 없이 상관관계만 → Tier 2 위임 (metric_lookup 정규식 자체가 안 걸림)
assertEq(
  '산식 없이 상관관계: null (Tier 2 위임)',
  classifyConversationalIntentHeuristic('두 지표의 상관관계를 계산해줘', []),
  null
);

// 산식 언급 없이 분석 요청 → Tier 2 위임
assertEq(
  '데이터 분석 요청: null (Tier 2 위임)',
  classifyConversationalIntentHeuristic('이 데이터 분석해줘', []),
  null
);

// metric 정규식 + 분석 신호가 함께 있어도 metric_lookup 유지
assertEq(
  '"영업이익 산식" + "분석해줘": metric_lookup 유지',
  classifyConversationalIntentHeuristic('영업이익 산식으로 상관관계를 분석해줘', []),
  'metric_lookup'
);

assertEq(
  '"매출 산식이 뭐" 단독: metric_lookup',
  classifyConversationalIntentHeuristic('매출 산식이 뭐야?', []),
  'metric_lookup'
);

// ============================================================
// C. buildConversationalResponse — suggestAnalysis 필드
// ============================================================
console.log('\n[C] buildConversationalResponse — suggestAnalysis 필드\n');

// 기본값 false
const r1 = buildConversationalResponse({
  intent: 'metric_lookup',
  answer: 'foo',
});
assertEq('기본값 suggestAnalysis === false', r1.suggestAnalysis, false);

// 명시 true
const r2 = buildConversationalResponse({
  intent: 'metric_lookup',
  answer: 'foo',
  suggestAnalysis: true,
});
assertEq('명시 suggestAnalysis === true', r2.suggestAnalysis, true);

// 명시 false
const r3 = buildConversationalResponse({
  intent: 'general_chat',
  answer: 'foo',
  suggestAnalysis: false,
});
assertEq('명시 suggestAnalysis === false', r3.suggestAnalysis, false);

// truthy but non-bool → false 로 정규화 (=== true 아닌 경우)
const r4 = buildConversationalResponse({
  intent: 'metric_lookup',
  answer: 'foo',
  suggestAnalysis: 'yes',  // 문자열
});
assertEq('문자열은 false 로 정규화', r4.suggestAnalysis, false);

const r5 = buildConversationalResponse({
  intent: 'metric_lookup',
  answer: 'foo',
  suggestAnalysis: 1,       // 숫자
});
assertEq('숫자 1 은 false 로 정규화 (=== true 만 허용)', r5.suggestAnalysis, false);

// 다른 필드가 보존되는지 회귀 확인
assertEq('intent 필드 보존', r2.intent, 'metric_lookup');
assertEq('intentLabel 필드 보존', r2.intentLabel, 'Metric 산식 조회');
assertEq('explanation 필드 보존', r2.explanation, 'foo');
assertEq('analysisText 필드 보존', r2.analysisText, 'foo');
assertEq('isAnalysisAnswer 필드 보존', r2.isAnalysisAnswer, true);
assertEq('chartType 필드 보존', r2.chartType, 'analysis');

// ============================================================
// D. 회귀 테스트 — 기존 metric_lookup 정규식이 여전히 매치 (분석 신호 없을 때)
// ============================================================
console.log('\n[D] 회귀 — 순수 metric_lookup 경로 유지 확인\n');

// 참고: /\b(metric|지표|kpi)…/ 정규식의 \b 는 한글 경계에서 매치 실패하는
//   기존의 알려진 한계 — 이번 PR 범위 밖. 아래 케이스는 실제 정규식이
//   현재 매치하는 조합만 포함시켜 회귀만 확인.
const pureMetricQueries = [
  ['공식이 뭐야', 'metric_lookup'],
  ['어떻게 계산해', 'metric_lookup'],
  ['계산 방법 알려줘', 'metric_lookup'],
  ['정의가 뭐야', 'metric_lookup'],
  ['metric이 뭐야', 'metric_lookup'],         // 영문 metric 은 \b 매치 OK
  ['영업이익 산식', 'metric_lookup'],
];

for (const [q, expected] of pureMetricQueries) {
  assertEq(`"${q}" → ${expected}`, classifyConversationalIntentHeuristic(q, []), expected);
}

// ============================================================
// 결과 요약
// ============================================================
console.log(`\n===== 결과: ${pass} pass / ${fail} fail =====`);
if (fail > 0) {
  console.log('\n실패한 케이스:');
  for (const f of fails) {
    console.log(`  - ${f.label}`);
    console.log(`    기대: ${JSON.stringify(f.want)}`);
    console.log(`    실제: ${JSON.stringify(f.got)}`);
  }
  process.exit(1);
}
process.exit(0);
