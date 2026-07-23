// ============================================================
// [PROBE] 사용자 리포트 질문의 실제 라우팅 경로 시뮬레이션
// ------------------------------------------------------------
// server.mjs 를 안 띄우고, Tier 1 휴리스틱 분류기에 사용자 질문을 그대로 넣어
// 어느 intent 로 갈지 결정론적으로 재현.
// (Tier 2 LLM 은 확률적이지만, Tier 1 이 non-null 을 반환하면 Tier 2 는 실행 안 함)
//
// [PR #255] 확장 — hasAnalysisSignal + Tier 1 exclusion 반영 검증.
//   기대 결과 매트릭스:
//     | 질문                                       | Tier 1 결과            | 분석 신호 |
//     |---------------------------------------------|------------------------|-----------|
//     | reported (산식+상관관계)                    | null (Tier 2 위임)     | true      |
//     | no-formula (순수 상관관계)                  | null (Tier 2 위임)     | true      |
//     | pure-metric (영업이익율 산식이 뭐야?)       | metric_lookup          | false     |
//     | formula-only (영업이익율 어떻게 계산해?)    | metric_lookup          | false     |
//     | why-decrease (왜 매출 줄었어?)              | troubleshooting/null   | true      |
//     | trend (매출 추세)                           | null (Tier 2 위임)     | true      |
// ============================================================
import {
  classifyConversationalIntentHeuristic,
  hasAnalysisSignal,
  INTENT_LABELS,
} from './conversational-intent.mjs';

const QUERIES = [
  // 사용자 리포트의 원본 질문 (사진 [1])
  {
    tag: 'reported',
    q: 'PS사업부 거래처별 영업이익율과 판매관리비 중 지급수수료(변동비)의 원단위간의 상관관계를 분석해 줘. 지급수수료 원단위는 "지급수수료(변동)/판매중량(kg)"으로 계산하고, 영업이익율은 "영업이익/순매출"로 계산함. 이 질문에 대한 결과를 같이 알려줘',
    expectTier1: null,              // metric_lookup 취소 → Tier 2 위임
    expectAnalysisSignal: true,
  },
  // 같은 의도지만 산식 언급 없이
  {
    tag: 'no-formula',
    q: 'PS사업부 거래처별 영업이익율과 지급수수료 원단위의 상관관계를 분석해줘',
    expectTier1: null,              // 산식 관련 정규식 아예 매치 안 됨
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
  // 증감 원인 질문
  {
    tag: 'why-decrease',
    q: '왜 매출이 줄었어?',
    // troubleshooting 정규식(/왜.{0,15}(안|못|없|실패|에러|오류|0건|결과)/) 에는
    // "줄" 이 매치되지 않음 → null 이 정상 (Tier 2 위임)
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

console.log('\n===== Tier 1 휴리스틱 분류기 프로브 (PR #255 반영) =====\n');
console.log('  분류 규칙: heuristic (질문 문자열 정규식 매칭)');
console.log('  이 함수가 non-null 을 반환하면 Tier 2 LLM 은 스킵됨.');
console.log('  metric_lookup 규칙이 매치되어도 hasAnalysisSignal(q)=true 이면 null 반환.\n');

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

// 어느 정규식이 매치되는지 상세 추적 (사용자 원본 질문에 대해서만)
console.log('\n===== 사용자 원본 질문 정규식 매치 추적 =====\n');
const q = QUERIES[0].q;

const checks = [
  { name: '4-a) 산식|공식|formula … 뭐|무엇|어떻게|어떤|보여|알려',
    re: /(산식|공식|formula).{0,10}(뭐|무엇|어떻게|어떤|보여|알려)/i },
  { name: '4-b) 어떻게 … 계산|구해|산출',
    re: /어떻게.{0,5}(계산|구해|산출)/ },
  { name: '4-c) 계산 … 방법|식|공식',
    re: /계산.{0,5}(방법|식|공식)/ },
  { name: '4-d) 정의|뜻|의미 … 뭐|무엇 (도메인/영역 제외)',
    re: /(정의|뜻|의미).{0,10}(뭐|무엇)/,
    extraExclude: /도메인|영역/i },
  { name: '4-e) metric|지표|kpi … 뭐|무엇|정의|설명',
    re: /\b(metric|지표|kpi).{0,10}(뭐|무엇|정의|설명)/i },
  { name: '4-f) 영업이익|매출|roic|… + 산식|공식|어떻게|계산|뭐|정의  ← 유력 용의자',
    re: /(영업이익|매출|roic|roe|roa|ebitda|margin).{0,8}(산식|공식|어떻게|계산|뭐|정의)/i },
];

let anyMatch = false;
for (const c of checks) {
  const m = q.match(c.re);
  const excluded = c.extraExclude && c.extraExclude.test(q);
  const status = m
    ? (excluded ? '  MATCH (하지만 exclude 조건 걸림)' : '  ★ MATCH — metric_lookup 정규식 트리거')
    : '  no match';
  console.log(`  ${c.name}`);
  console.log(`    ${status}`);
  if (m && !excluded) {
    console.log(`    매치된 부분: "${m[0]}"`);
    anyMatch = true;
  }
  console.log('');
}

console.log(`\n===== PR #255 exclusion 로직 검증 =====`);
console.log(`  정규식 매치 여부:        ${anyMatch}`);
console.log(`  hasAnalysisSignal(q):    ${hasAnalysisSignal(q)}`);
console.log(`  최종 Tier 1 반환:        ${classifyConversationalIntentHeuristic(q, [])}`);
console.log(`  → 정규식이 매치되어도 분석 신호가 있어 null 을 반환하여 Tier 2 LLM 에 위임됨.\n`);

process.exit(fail > 0 ? 1 : 0);
