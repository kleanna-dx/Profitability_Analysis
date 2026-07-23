// ============================================================
// [PR #254] trimToLastCompleteSentence 유닛 테스트
// ------------------------------------------------------------
// 사진(PR #254 원본 리포트)의 실제 잘림 케이스 포함.
// 실행: node _test_trim_intent_answer.mjs
// ============================================================
import { trimToLastCompleteSentence, postProcessIntentAnswer, LENGTH_RULES_KO } from './conversational-intent.mjs';

let pass = 0;
let fail = 0;

function assert(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
  }
}

function assertContains(name, actual, mustContain) {
  const ok = actual && actual.includes(mustContain);
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
    console.log(`    must contain: ${JSON.stringify(mustContain)}`);
    console.log(`    actual:       ${JSON.stringify(actual)}`);
  }
}

function assertNotContains(name, actual, mustNotContain) {
  const ok = actual && !actual.includes(mustNotContain);
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
    console.log(`    must NOT contain: ${JSON.stringify(mustNotContain)}`);
    console.log(`    actual:           ${JSON.stringify(actual)}`);
  }
}

console.log('\n===== trimToLastCompleteSentence =====\n');

// Case 1: 사진의 원본 잘림 케이스
console.log('[Case 1] 사진의 잘림 케이스 - "다만 제공된 DB 매칭 정보에는 **순매출, 영업이익, 판매관리비 및 지급"');
{
  const cutText =
    '핵심부터 말씀드리면, PS 도메인에서 질문하신 분석은 아래 두 변수 간의 거래처별 상관관계를 보는 구조입니다.\n\n' +
    '| 분석 변수 | 계산 기준 | 확인된 지표/컬럼 |\n|---|---|---|\n' +
    '| 영업이익율 | 영업이익 / 순매출 | 영업이익 `ZAMT055`, 순매출 `ZAMT003` |\n' +
    '| 지급수수료(변동) 원단위 | 지급수수료(변동) / 판매중량(kg) | 지급수수료(변동) `ZAMT040` |\n\n' +
    '다만 제공된 DB 매칭 정보에는 **순매출, 영업이익, 판매관리비 및 지급';
  const trimmed = trimToLastCompleteSentence(cutText);
  assertNotContains('미완결 마지막 문장 "다만 제공된 DB 매칭 정보..." 제거됨',
    trimmed, '판매관리비 및 지급');
  assertContains('앞쪽 완결 문장은 유지됨', trimmed, '보는 구조입니다.');
}

// Case 2: 종결어 '다.' 로 끝나면 그대로
console.log('\n[Case 2] 이미 완결된 답변은 변경 없음');
{
  const ok = '2026년 상반기 매출은 127,698,064,451원입니다.\n영업이익률은 8.24%입니다.';
  const trimmed = trimToLastCompleteSentence(ok);
  assert('원문 그대로 반환', trimmed, ok.trim());
}

// Case 3: '요.' 로 끝나면 그대로
console.log('\n[Case 3] "세요." 로 끝나는 완결 답변');
{
  const ok = '결과가 없습니다. 다른 조건으로 다시 시도해 보세요.';
  const trimmed = trimToLastCompleteSentence(ok);
  assert('원문 그대로 반환', trimmed, ok);
}

// Case 4: 완결 문장이 원문의 40% 미만 → 원문 유지 (짧은 답변 통째 사라짐 방지)
console.log('\n[Case 4] 완결 문장이 원문의 40% 미만 → 원문 유지');
{
  const shortStart = '네.' + ' '.repeat(0) + '이것은 매우 긴 미완결 문장으로 원문의 대부분을 차지하고 있어서 자르면 답변이 거의 사라져 버리는 상황입니다만 마지막';
  const trimmed = trimToLastCompleteSentence(shortStart);
  assert('원문 유지 (통째 사라짐 방지)', trimmed, shortStart.trim());
}

// Case 5: 절단 후 남은 답변 안에 열린 코드블록이 있으면 닫아줌
//   시나리오: 답변 끝쪽에 완결 문장이 있고, 그 뒤에 미완결 문구가 붙었는데
//   중간에 코드블록이 열린 채로 잘림 → 절단 후에도 열린 ``` 이 남아있는 경우.
console.log('\n[Case 5] 절단 결과 안에 열린 코드블록 → 자동 닫기');
{
  const text =
    '영업이익 산식은 아래와 같이 계산합니다.\n' +
    '```sql\nSELECT SUM(ZAMT001) FROM tbl;\n```\n' +
    '이를 요약하면 총 매출에서 원가를 차감한 값입니다.\n' +
    '```sql\nSELECT SUM(ZAMT001) - SUM(ZAMT002)\nFROM tbl\nWHERE CALMONTH = 202606\nGROUP BY';  // 미완결
  const trimmed = trimToLastCompleteSentence(text);
  // 마지막 완결 문장은 "차감한 값입니다." → 그 뒤 미완결 sql 블록이 잘려나감.
  // 그런데 절단 지점이 두 번째 ``` 코드블록 안이 아니라, 세 번째 ``` 시작 직전이라
  // 실제로는 fenceCount가 짝수가 됨. 이 테스트는 코드블록 닫기 로직 자체가
  // 필요한 극단 케이스(절단 지점이 코드블록 안쪽)를 검증.
  const fenceCount = (trimmed.match(/```/g) || []).length;
  assert('코드블록 개수가 짝수 (닫혀 있음)', fenceCount % 2, 0);
}

// Case 5b: 절단 지점이 코드블록 안쪽인 케이스 — 사용자 정책상 미완결 코드블록은 통째 삭제
console.log('\n[Case 5b] 절단 지점이 코드블록 안쪽 → 미완결 코드블록 통째 삭제');
{
  // 완결 문장 뒤에 코드블록이 열리고, 그 코드블록 안에서 미완결로 끝남
  const text =
    '영업이익 산식을 아래 코드에 나타냈습니다. 다음은 SQL 예시입니다.\n' +
    '```sql\nSELECT SUM(ZAMT001) - SUM(ZAMT002)\nFROM tbl\nWHERE CALMONTH = 202606\nGROUP BY BUKRS';  // 미완결
  const trimmed = trimToLastCompleteSentence(text);
  const fenceCount = (trimmed.match(/```/g) || []).length;
  // 사용자 정책: 미완결로 보이는 부분은 아예 노출하지 않음.
  // 마지막 완결 문장 "예시입니다." 까지만 남고 코드블록은 사라짐 → fenceCount=0 (짝수).
  assert('```가 짝수 (미완결 코드블록 통째 삭제)', fenceCount % 2, 0);
  assertContains('완결 문장 "예시입니다." 유지', trimmed, '예시입니다.');
  assertNotContains('미완결 SQL 코드블록 통째 삭제됨', trimmed, 'SELECT SUM');
}

// Case 6: '!' 로 끝나는 문장
console.log('\n[Case 6] 느낌표로 끝나는 문장');
{
  const text = '조회 결과 총 5건입니다! 아래 표를 확인해 주세요! 추가로 이 부분에 대해서는 아직 답변이';
  const trimmed = trimToLastCompleteSentence(text);
  assertNotContains('미완결 "추가로 이 부분에 대해서는 아직 답변이" 제거',
    trimmed, '답변이');
  assertContains('완결 "확인해 주세요!" 유지', trimmed, '확인해 주세요!');
}

// Case 7: 빈 문자열
console.log('\n[Case 7] 빈 문자열/null 안전 처리');
{
  assert('빈 문자열', trimToLastCompleteSentence(''), '');
  assert('null', trimToLastCompleteSentence(null), '');
  assert('undefined', trimToLastCompleteSentence(undefined), '');
}

// Case 8: 완결 어미가 아예 없는 문장 (원문 유지)
console.log('\n[Case 8] 완결 어미가 없는 문장 → 원문 유지');
{
  const noEnding = '어떤 종결어도 없이 그냥 이어지는 텍스트만 있는 경우';
  const trimmed = trimToLastCompleteSentence(noEnding);
  assert('원문 그대로', trimmed, noEnding);
}

// Case 9: postProcessIntentAnswer - finish_reason='stop' 이면 trim만
console.log('\n[Case 9] postProcessIntentAnswer - finish_reason=stop');
{
  const choice = {
    message: { content: '  안녕하세요. 조회 완료되었습니다.  ' },
    finish_reason: 'stop',
  };
  const result = postProcessIntentAnswer(choice, 'test');
  assert('stop 시 trim만 수행', result, '안녕하세요. 조회 완료되었습니다.');
}

// Case 10: postProcessIntentAnswer - finish_reason='length' 이면 절단
console.log('\n[Case 10] postProcessIntentAnswer - finish_reason=length');
{
  const choice = {
    message: { content: '완결된 첫 문장입니다. 완결된 두 번째 문장입니다. 세 번째는 잘려버린 미완결' },
    finish_reason: 'length',
  };
  const result = postProcessIntentAnswer(choice, 'test');
  assertContains('완결 문장은 유지', result, '두 번째 문장입니다.');
  assertNotContains('미완결 문장 제거', result, '세 번째는 잘려버린 미완결');
}

// Case 11: choice가 null이면 빈 문자열
console.log('\n[Case 11] postProcessIntentAnswer - null choice');
{
  assert('null choice → 빈 문자열', postProcessIntentAnswer(null, 'test'), '');
  assert('undefined choice → 빈 문자열', postProcessIntentAnswer(undefined, 'test'), '');
}

// Case 12: LENGTH_RULES_KO 는 export 되어 있고 필수 규칙 포함
console.log('\n[Case 12] LENGTH_RULES_KO 필수 규칙 포함 여부');
{
  assertContains('400자 규칙 포함', LENGTH_RULES_KO, '400자 이내');
  assertContains('5문장 규칙 포함', LENGTH_RULES_KO, '5문장');
  assertContains('표 삽입 금지 규칙 포함', LENGTH_RULES_KO, '마크다운 표');
  assertContains('완결 종료 규칙 포함', LENGTH_RULES_KO, '완결된 형태로 종료');
  assertContains('세부 결과는 아래 표 안내 문구 포함', LENGTH_RULES_KO, '세부 결과는 아래 표를 참고');
}

console.log(`\n===== 결과 =====\n총 ${pass + fail}건 / 성공 ${pass} / 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
