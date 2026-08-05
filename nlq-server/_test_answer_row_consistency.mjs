// ============================================================
// [Task E — 자연어 질의 상단 답변과 표 결과 불일치 수정] 회귀 테스트 (PR #346)
// ============================================================
// 실행: node _test_answer_row_consistency.mjs
//
// 검증 범위:
//   1) computeRowStats — 총 행 수, 사업부별 행 수, 표시용 라벨
//      - DIVISION 코드 기반 (표준)
//      - DIVISION_NM 기반 (fallback)
//      - 빈 결과
//      - 여러 코드 (10, 20, 30)
//   2) detectAnswerTruncationHallucination — hallucination 문구 감지
//      - "결과가 끊겼다"
//      - "확인할 수 없다"
//      - "중간에 끊겨"
//      - false positive 방지 (정상 답변)
//   3) buildFallbackAnswer — 검증된 고정 요약 생성
//      - 사업부 breakdown 있는 경우
//      - 단일 사업부
//      - 총 행 수 0
//   4) truncateAnswerAtSentenceBoundary — 문장 경계 truncate
//      - 짧은 텍스트는 그대로
//      - 긴 텍스트는 마지막 완결 문장에서 자른 뒤 '...'
//      - 문장 경계 없으면 공백에서 자름
//
// 로딩 방식: server.mjs 는 최상위 side effect 가 있으므로
//            대상 함수 소스만 정규식으로 추출 → vm.runInContext 로 격리 실행.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, 'server.mjs');
const src = fs.readFileSync(SERVER_PATH, 'utf8');

// ------------------------------------------------------------
// helper: 함수 소스 블록 추출 (문자열/정규식 리터럴/주석 고려)
// ------------------------------------------------------------
function extractFn(fnName) {
  const startRe = new RegExp(`function\\s+${fnName}\\s*\\(`, 'g');
  const m = startRe.exec(src);
  if (!m) throw new Error(`function ${fnName} not found in server.mjs`);
  const braceStart = src.indexOf('{', m.index);
  if (braceStart < 0) throw new Error(`opening brace not found for ${fnName}`);

  let depth = 0;
  let mode = 'code';
  let j;
  function prevNonSpace(idx) {
    for (let k = idx - 1; k >= 0; k--) {
      const c = src[k];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
      return c;
    }
    return '';
  }
  function couldStartRegex(idx) {
    const c = prevNonSpace(idx);
    if (c === '') return true;
    if (/[)\]\w$]/.test(c)) return false;
    return true;
  }
  for (j = braceStart; j < src.length; j++) {
    const ch = src[j];
    const next = src[j + 1];
    if (mode === 'lineC') { if (ch === '\n') mode = 'code'; continue; }
    if (mode === 'blockC') { if (ch === '*' && next === '/') { mode = 'code'; j++; } continue; }
    if (mode === 'sqStr') { if (ch === '\\') { j++; continue; } if (ch === "'") mode = 'code'; continue; }
    if (mode === 'dqStr') { if (ch === '\\') { j++; continue; } if (ch === '"') mode = 'code'; continue; }
    if (mode === 'tplStr') { if (ch === '\\') { j++; continue; } if (ch === '`') mode = 'code'; continue; }
    if (mode === 'regex') {
      if (ch === '\\') { j++; continue; }
      if (ch === '[') { mode = 'regexClass'; continue; }
      if (ch === '/') { mode = 'code'; while (j + 1 < src.length && /[gimsuy]/.test(src[j + 1])) j++; }
      continue;
    }
    if (mode === 'regexClass') { if (ch === '\\') { j++; continue; } if (ch === ']') mode = 'regex'; continue; }
    if (ch === '/' && next === '/') { mode = 'lineC'; j++; continue; }
    if (ch === '/' && next === '*') { mode = 'blockC'; j++; continue; }
    if (ch === '/' && couldStartRegex(j)) { mode = 'regex'; continue; }
    if (ch === "'") { mode = 'sqStr'; continue; }
    if (ch === '"') { mode = 'dqStr'; continue; }
    if (ch === '`') { mode = 'tplStr'; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { depth--; if (depth === 0) { j++; break; } continue; }
  }
  return src.slice(m.index, j);
}

// 상수도 함께 추출 (DIVISION_CODE_TO_LABEL_FOR_ANSWER, ANSWER_TRUNCATION_HALLUCINATION_PATTERNS)
function extractConstBlock(name) {
  const startRe = new RegExp(`const\\s+${name}\\s*=`, 'g');
  const m = startRe.exec(src);
  if (!m) throw new Error(`const ${name} not found in server.mjs`);
  // 대괄호 or 중괄호 시작
  let openIdx = -1, openCh = null, closeCh = null;
  for (let k = m.index; k < src.length; k++) {
    if (src[k] === '{') { openIdx = k; openCh = '{'; closeCh = '}'; break; }
    if (src[k] === '[') { openIdx = k; openCh = '['; closeCh = ']'; break; }
  }
  if (openIdx < 0) throw new Error(`opening bracket not found for ${name}`);
  let depth = 0, mode = 'code';
  let j;
  for (j = openIdx; j < src.length; j++) {
    const ch = src[j], next = src[j + 1];
    if (mode === 'sqStr') { if (ch === '\\') { j++; continue; } if (ch === "'") mode = 'code'; continue; }
    if (mode === 'dqStr') { if (ch === '\\') { j++; continue; } if (ch === '"') mode = 'code'; continue; }
    if (mode === 'tplStr') { if (ch === '\\') { j++; continue; } if (ch === '`') mode = 'code'; continue; }
    if (mode === 'regex') {
      if (ch === '\\') { j++; continue; }
      if (ch === '[') { mode = 'regexClass'; continue; }
      if (ch === '/') { mode = 'code'; while (j + 1 < src.length && /[gimsuy]/.test(src[j + 1])) j++; }
      continue;
    }
    if (mode === 'regexClass') { if (ch === '\\') { j++; continue; } if (ch === ']') mode = 'regex'; continue; }
    if (mode === 'lineC') { if (ch === '\n') mode = 'code'; continue; }
    if (mode === 'blockC') { if (ch === '*' && next === '/') { mode = 'code'; j++; } continue; }
    if (ch === '/' && next === '/') { mode = 'lineC'; j++; continue; }
    if (ch === '/' && next === '*') { mode = 'blockC'; j++; continue; }
    if (ch === "'") { mode = 'sqStr'; continue; }
    if (ch === '"') { mode = 'dqStr'; continue; }
    if (ch === '`') { mode = 'tplStr'; continue; }
    if (ch === openCh) { depth++; continue; }
    if (ch === closeCh) { depth--; if (depth === 0) { j++; break; } continue; }
  }
  // 세미콜론까지 포함
  while (j < src.length && src[j] !== ';' && src[j] !== '\n') j++;
  if (src[j] === ';') j++;
  return src.slice(m.index, j);
}

const bundle = [
  extractConstBlock('DIVISION_CODE_TO_LABEL_FOR_ANSWER'),
  extractConstBlock('ANSWER_TRUNCATION_HALLUCINATION_PATTERNS'),
  extractFn('computeRowStats'),
  extractFn('detectAnswerTruncationHallucination'),
  extractFn('buildFallbackAnswer'),
  extractFn('truncateAnswerAtSentenceBoundary'),
].join('\n\n');

const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
};
vm.createContext(sandbox);
vm.runInContext(bundle, sandbox);
vm.runInContext(`
  globalThis.__exports = {
    computeRowStats,
    detectAnswerTruncationHallucination,
    buildFallbackAnswer,
    truncateAnswerAtSentenceBoundary,
  };
`, sandbox);
const {
  computeRowStats,
  detectAnswerTruncationHallucination,
  buildFallbackAnswer,
  truncateAnswerAtSentenceBoundary,
} = sandbox.__exports;

// ------------------------------------------------------------
// 테스트 러너
// ------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = typeof actual === 'string' ? actual : JSON.stringify(actual);
  const e = typeof expected === 'string' ? expected : JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    failures.push({ label, expected: e, actual: a });
    console.log(`  ❌ ${label}`);
    console.log(`      expected: ${e}`);
    console.log(`      actual  : ${a}`);
  }
}

function truthy(actual, label) {
  if (actual) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push({ label, expected: 'truthy', actual: JSON.stringify(actual) }); console.log(`  ❌ ${label} (got: ${JSON.stringify(actual)})`); }
}

function falsy(actual, label) {
  if (!actual) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push({ label, expected: 'falsy', actual: JSON.stringify(actual) }); console.log(`  ❌ ${label} (got: ${JSON.stringify(actual)})`); }
}

// ============================================================
// 테스트 1: computeRowStats
// ============================================================
console.log('\n[1] computeRowStats — 행 수 통계');

{
  // PS 5행 + HL 5행 (실제 버그 시나리오)
  const rows = [
    ...Array(5).fill(0).map((_, i) => ({ DIVISION: '10', DIVISION_NM: '페이퍼솔루션', SKU: `PS-${i}` })),
    ...Array(5).fill(0).map((_, i) => ({ DIVISION: '20', DIVISION_NM: '홈앤라이프', SKU: `HL-${i}` })),
  ];
  const s = computeRowStats(rows);
  eq(s.total, 10, 'PS5+HL5: total=10');
  eq(s.byDivision, { '10': 5, '20': 5 }, 'PS5+HL5: byDivision');
  eq(s.divisionSummary, 'PS 5행, HL 5행', 'PS5+HL5: divisionSummary');
  truthy(s.hasDivisionBreakdown, 'PS5+HL5: hasDivisionBreakdown=true');
}

{
  // 단일 사업부(PS만) — breakdown 없어야 함
  const rows = Array(5).fill(0).map((_, i) => ({ DIVISION: '10' }));
  const s = computeRowStats(rows);
  eq(s.total, 5, 'PS only: total=5');
  eq(s.byDivision, { '10': 5 }, 'PS only: byDivision');
  eq(s.divisionSummary, 'PS 5행', 'PS only: divisionSummary');
  falsy(s.hasDivisionBreakdown, 'PS only: hasDivisionBreakdown=false');
}

{
  // 빈 결과
  const s = computeRowStats([]);
  eq(s.total, 0, 'empty: total=0');
  eq(s.byDivision, {}, 'empty: byDivision');
  eq(s.divisionSummary, '', 'empty: divisionSummary');
  falsy(s.hasDivisionBreakdown, 'empty: hasDivisionBreakdown=false');
}

{
  // 3개 사업부 (10, 20, 30) — 정렬 확인
  const rows = [
    { DIVISION: '30' },
    { DIVISION: '10' }, { DIVISION: '10' },
    { DIVISION: '20' }, { DIVISION: '20' }, { DIVISION: '20' },
  ];
  const s = computeRowStats(rows);
  eq(s.total, 6, '3div: total=6');
  eq(s.byDivision, { '10': 2, '20': 3, '30': 1 }, '3div: byDivision');
  // '30' 은 라벨 매핑 없으므로 코드 그대로
  eq(s.divisionSummary, 'PS 2행, HL 3행, 30 1행', '3div: divisionSummary (unmapped code=code)');
  truthy(s.hasDivisionBreakdown, '3div: hasDivisionBreakdown=true');
}

{
  // DIVISION 컬럼이 없고 DIVISION_NM 만 있는 경우 (fallback)
  const rows = [
    { DIVISION_NM: 'PS' }, { DIVISION_NM: 'PS' },
    { DIVISION_NM: 'HL' }, { DIVISION_NM: 'HL' }, { DIVISION_NM: 'HL' },
  ];
  const s = computeRowStats(rows);
  eq(s.total, 5, 'NM-only: total=5');
  eq(s.byDivision, {}, 'NM-only: byDivision empty');
  eq(s.byDivisionNm, { 'PS': 2, 'HL': 3 }, 'NM-only: byDivisionNm');
  // 정렬 순: 알파벳 오름차순 → HL, PS
  eq(s.divisionSummary, 'HL 3행, PS 2행', 'NM-only: divisionSummary uses NM fallback');
  truthy(s.hasDivisionBreakdown, 'NM-only: hasDivisionBreakdown=true');
}

{
  // DIVISION 이 숫자 타입인 경우 (숫자 → 문자열 정규화)
  const rows = [
    { DIVISION: 10 }, { DIVISION: 10 },
    { DIVISION: 20 }, { DIVISION: 20 }, { DIVISION: 20 },
  ];
  const s = computeRowStats(rows);
  eq(s.byDivision, { '10': 2, '20': 3 }, 'numeric-DIV: normalized to strings');
  eq(s.divisionSummary, 'PS 2행, HL 3행', 'numeric-DIV: label mapping works');
}

{
  // null / undefined 안전성
  eq(computeRowStats(null).total, 0, 'null input: total=0');
  eq(computeRowStats(undefined).total, 0, 'undefined input: total=0');
  eq(computeRowStats('not-array').total, 0, 'string input: total=0');
}

// ============================================================
// 테스트 2: detectAnswerTruncationHallucination
// ============================================================
console.log('\n[2] detectAnswerTruncationHallucination — hallucination 문구 감지');

{
  // 실제 버그 문구 (사용자 스크린샷 원문)
  truthy(
    detectAnswerTruncationHallucination('PS는 Greyback 350GSM 0800*1200 Bulk (2) 가 356,911,952원으로 1위였고, ... 순입니다. 다만 제공된 결과가 중간에 끊겨 PS 5위와 HL 상위 5개는 확인할 수 없습니다.'),
    'real bug: 결과가 중간에 끊겨 → hallucination'
  );
  truthy(detectAnswerTruncationHallucination('결과가 끊겼습니다.'), '결과가 끊겼습니다 → detected');
  truthy(detectAnswerTruncationHallucination('중간에 끊겨 확인이 어렵습니다.'), '중간에 끊겨 → detected');
  truthy(detectAnswerTruncationHallucination('나머지는 확인할 수 없습니다.'), '확인할 수 없다 → detected');
  truthy(detectAnswerTruncationHallucination('나머지는 확인할 수 없어요.'), '확인할 수 없어요 → detected');
  truthy(detectAnswerTruncationHallucination('일부 데이터는 확인이 불가합니다.'), '확인이 불가 → detected');
  truthy(detectAnswerTruncationHallucination('데이터가 일부만 표시됩니다.'), '데이터가 일부만 → detected');
  truthy(detectAnswerTruncationHallucination('제공된 결과가 일부이므로 자세한 것은 표를 참조하세요.'), '제공된 결과가 일부 → detected');

  // false positive 방지: 정상 답변
  falsy(detectAnswerTruncationHallucination('2026년 6월 기준 PS와 HL의 SKU별 매출 TOP5를 각각 조회했습니다. PS 5개, HL 5개로 총 10개 SKU가 포함되었습니다.'),
        '정상 답변: false');
  falsy(detectAnswerTruncationHallucination('총 45,409,440,210원의 매출이 발생했습니다.'),
        '단순 매출 답변: false');
  falsy(detectAnswerTruncationHallucination('페이퍼솔루션 사업부의 결과를 조회했습니다.'),
        '사업부명 언급 답변: false');
  falsy(detectAnswerTruncationHallucination(''), '빈 문자열: false');
  falsy(detectAnswerTruncationHallucination(null), 'null: false');
  falsy(detectAnswerTruncationHallucination(undefined), 'undefined: false');
}

// ============================================================
// 테스트 3: buildFallbackAnswer
// ============================================================
console.log('\n[3] buildFallbackAnswer — 검증된 고정 요약');

{
  // PS 5행 + HL 5행 (실제 버그 시나리오의 정상 대체 답변)
  const stats = computeRowStats([
    ...Array(5).fill(0).map(() => ({ DIVISION: '10' })),
    ...Array(5).fill(0).map(() => ({ DIVISION: '20' })),
  ]);
  const dc = { latestLabel: '2026년 6월', prevLabel: '2026년 5월' };
  const answer = buildFallbackAnswer(stats, dc, 'PS, HL SKU별 매출 TOP5');
  eq(answer, '**2026년 6월** 기준 조회 결과 PS 5행, HL 5행으로 총 10개 항목이 포함되었습니다.',
     'PS5+HL5+date: 사업부별 breakdown 포함 fallback');
}

{
  // 단일 사업부 (breakdown 없음) — 총계만
  const stats = computeRowStats(Array(5).fill(0).map(() => ({ DIVISION: '10' })));
  const dc = { latestLabel: '2026년 6월', prevLabel: '2026년 5월' };
  const answer = buildFallbackAnswer(stats, dc, 'PS SKU별 매출 TOP5');
  eq(answer, '**2026년 6월** 기준 조회 결과 총 5개 항목이 포함되었습니다.',
     'single division: 총계만 포함');
}

{
  // dateContext 없음
  const stats = computeRowStats([{ DIVISION: '10' }, { DIVISION: '10' }, { DIVISION: '20' }]);
  const answer = buildFallbackAnswer(stats, null, '테스트');
  eq(answer, '조회 결과 PS 2행, HL 1행으로 총 3개 항목이 포함되었습니다.',
     'no dateContext: 날짜 라벨 생략');
}

{
  // 빈 결과
  const stats = computeRowStats([]);
  const answer = buildFallbackAnswer(stats, null, '테스트');
  eq(answer, '조회 결과가 없습니다. 조건을 다시 확인해 주세요.', 'empty: 조회 결과 없음 안내');
}

// ============================================================
// 테스트 4: truncateAnswerAtSentenceBoundary
// ============================================================
console.log('\n[4] truncateAnswerAtSentenceBoundary — 문장 경계 truncate');

{
  // 짧은 텍스트: 그대로 반환
  const t = '2026년 6월 조회 결과 총 10개 항목입니다.';
  eq(truncateAnswerAtSentenceBoundary(t, 500), t, '짧은 텍스트: unchanged');
}

{
  // 긴 텍스트: 마지막 완결 문장에서 자르고 '...' 추가
  const t = '첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장은 아주 길어서 뒤에 잘리게 될 것입니다.';
  const result = truncateAnswerAtSentenceBoundary(t, 40);
  truthy(result.endsWith(' ...'), '긴 텍스트: ... 로 끝남');
  truthy(result.length <= 45, '긴 텍스트: 지정 길이 근처');
  // 문장 경계에서 자른 결과는 "다." 로 끝나야 함 (마침표 + ...)
  truthy(/다\.\s*\.\.\.$/.test(result), '긴 텍스트: 완결 문장 경계에서 자름');
}

{
  // 매우 긴 텍스트 (500자 이상)
  const long = 'PS는 매출 1위입니다. '.repeat(50);  // 대략 900자
  const result = truncateAnswerAtSentenceBoundary(long, 500);
  truthy(result.length <= 505, 'very long: 500자+... 정도');
  truthy(result.endsWith(' ...'), 'very long: ... 로 끝남');
  truthy(/다\.\s*\.\.\.$/.test(result), 'very long: 완결 문장에서 자름');
}

{
  // 빈 문자열 / null / undefined
  eq(truncateAnswerAtSentenceBoundary('', 500), '', 'empty string');
  eq(truncateAnswerAtSentenceBoundary(null, 500), '', 'null');
  eq(truncateAnswerAtSentenceBoundary(undefined, 500), '', 'undefined');
}

// ============================================================
// 테스트 5: 통합 시나리오 — 실제 버그 상황 end-to-end
// ============================================================
console.log('\n[5] 통합 — 실제 버그 시나리오 end-to-end');

{
  // 사용자 스크린샷과 동일한 상황:
  //   - PS 5행 + HL 5행 = 10행이 실제로 존재
  //   - LLM 이 "결과가 중간에 끊겨 ... 확인할 수 없습니다" 라고 잘못 답변
  //   → 검증에서 hallucination 감지 → fallback 으로 대체
  const rows = [
    ...Array(5).fill(0).map((_, i) => ({ DIVISION: '10', SKU: `PS-${i}` })),
    ...Array(5).fill(0).map((_, i) => ({ DIVISION: '20', SKU: `HL-${i}` })),
  ];
  const badLLMAnswer = 'PS는 Greyback 350GSM 0800*1200 Bulk (2) 가 356,911,952원으로 1위였고, ... 순입니다. 다만 제공된 결과가 중간에 끊겨 PS 5위와 HL 상위 5개는 확인할 수 없습니다.';
  const stats = computeRowStats(rows);
  const isHallucination = detectAnswerTruncationHallucination(badLLMAnswer);
  truthy(isHallucination, 'end-to-end: LLM hallucination 감지됨');
  eq(stats.total, 10, 'end-to-end: 총 10행 확인');
  eq(stats.byDivision['10'], 5, 'end-to-end: PS=5행 확인');
  eq(stats.byDivision['20'], 5, 'end-to-end: HL=5행 확인');

  const dc = { latestLabel: '2026년 6월', prevLabel: '2026년 5월' };
  const fallback = buildFallbackAnswer(stats, dc, 'PS, HL SKU별 매출 TOP5');
  eq(fallback, '**2026년 6월** 기준 조회 결과 PS 5행, HL 5행으로 총 10개 항목이 포함되었습니다.',
     'end-to-end: fallback 답변 = 사용자 예시와 유사');

  // fallback 답변 자체는 hallucination 이 아님
  falsy(detectAnswerTruncationHallucination(fallback),
        'end-to-end: fallback 은 hallucination 아님');
}

{
  // 편집: LLM 이 정상 답변한 경우 → hallucination 아니므로 fallback 사용 안 함
  const goodLLMAnswer = '**2026년 6월** 기준 PS와 HL의 SKU별 매출 TOP5를 각각 조회했습니다. PS 5개, HL 5개로 총 10개 SKU가 포함되었습니다.';
  falsy(detectAnswerTruncationHallucination(goodLLMAnswer),
        'end-to-end: 정상 답변은 fallback 트리거 안 됨');
}

// ------------------------------------------------------------
// 최종 결과
// ------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log(`[Task E — 답변/표 행수 일치] 결과: ${pass} passed, ${fail} failed`);
console.log('='.repeat(60));
if (fail > 0) {
  console.log('\n실패 상세:');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
    console.log(`      expected: ${f.expected}`);
    console.log(`      actual  : ${f.actual}`);
  }
  process.exit(1);
} else {
  console.log('✅ 모든 회귀 테스트 통과.');
  process.exit(0);
}
