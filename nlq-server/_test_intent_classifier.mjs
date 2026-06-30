// Phase 1 격리 테스트 — 휴리스틱 분류기 정확도 측정
// LLM 호출 없이 Tier 1만 검증 (Tier 2는 실제 환경에서 보강)

import { classifyConversationalIntentHeuristic, INTENT_LABELS } from './conversational-intent.mjs';

const TESTS = [
  // troubleshooting (5)
  { q: '왜 데이터 있는데 조회 안돼?',           expected: 'troubleshooting' },
  { q: '왜 결과가 0건이야?',                    expected: 'troubleshooting' },
  { q: '왜 데이터 안 나와',                     expected: 'troubleshooting' },
  { q: '조회 실패 원인이 뭐야',                 expected: 'troubleshooting' },
  { q: '데이터 있는데 안 나오는 이유',          expected: 'troubleshooting' },

  // sql_explain (4)
  { q: '방금 SQL 설명해줘',                     expected: 'sql_explain' },
  { q: '이 쿼리 해석해줘',                      expected: 'sql_explain' },
  { q: 'SQL이 무슨 뜻이야',                     expected: 'sql_explain' },
  { q: '위 SQL 풀어줘',                         expected: 'sql_explain' },

  // domain_explain (5)
  { q: '지금 어느 도메인이야?',                 expected: 'domain_explain' },
  { q: '현재 분석 영역 뭐야',                   expected: 'domain_explain' },
  { q: 'PS와 HL 차이가 뭐야',                   expected: 'domain_explain' },
  { q: 'DIVISION이 어떻게 적용되고 있어',       expected: 'domain_explain' },
  { q: '도메인 설명해줘',                       expected: 'domain_explain' },

  // metric_lookup (6)
  { q: 'HL 영업이익 산식이 뭔데?',              expected: 'metric_lookup' },
  { q: 'ROIC 어떻게 계산해?',                   expected: 'metric_lookup' },
  { q: '매출 산식 알려줘',                      expected: 'metric_lookup' },
  { q: 'EBITDA 공식이 뭐야',                    expected: 'metric_lookup' },
  { q: '영업이익률 어떻게 산출',                expected: 'metric_lookup' },
  { q: '영업이익 정의가 뭐야',                  expected: 'metric_lookup' },

  // ontology_lookup (5)
  { q: 'DIVISION 컬럼이 뭐야',                  expected: 'ontology_lookup' },
  { q: 'CALMONTH 무슨 뜻이야',                  expected: 'ontology_lookup' },
  { q: 'PROFIT_CENTER 컬럼 의미',               expected: 'ontology_lookup' },
  { q: '용어 설명해줘',                         expected: 'ontology_lookup' },
  { q: '필드 뜻이 뭐야',                        expected: 'ontology_lookup' },

  // general_chat (5)
  { q: '어떻게 사용해?',                        expected: 'general_chat' },
  { q: '사용법 알려줘',                         expected: 'general_chat' },
  { q: '뭐 할 수 있어?',                        expected: 'general_chat' },
  { q: '도와줘',                                expected: 'general_chat' },
  { q: '질문 예시 보여줘',                      expected: 'general_chat' },
];

let pass = 0, fail = 0;
const failed = [];

for (const t of TESTS) {
  const actual = classifyConversationalIntentHeuristic(t.q);
  const ok = actual === t.expected;
  if (ok) pass++;
  else {
    fail++;
    failed.push({ q: t.q, expected: t.expected, actual });
  }
}

console.log('\n=== Phase 1 Heuristic Classifier — Isolation Test ===');
console.log(`Total: ${TESTS.length}, Pass: ${pass}, Fail: ${fail}`);
console.log(`Accuracy: ${((pass / TESTS.length) * 100).toFixed(1)}%\n`);

if (failed.length > 0) {
  console.log('--- Failures ---');
  for (const f of failed) {
    console.log(`[FAIL] "${f.q}"`);
    console.log(`       expected: ${f.expected}  (${INTENT_LABELS[f.expected]})`);
    console.log(`       actual:   ${f.actual || '(null → LLM 위임)'}`);
  }
}

console.log('\n--- Per-intent breakdown ---');
const byIntent = {};
for (const t of TESTS) {
  byIntent[t.expected] = byIntent[t.expected] || { total: 0, pass: 0 };
  byIntent[t.expected].total++;
  if (classifyConversationalIntentHeuristic(t.q) === t.expected) byIntent[t.expected].pass++;
}
for (const [k, v] of Object.entries(byIntent)) {
  console.log(`  ${k.padEnd(18)} ${v.pass}/${v.total}  (${((v.pass / v.total) * 100).toFixed(0)}%)`);
}

process.exit(fail === 0 ? 0 : 1);
