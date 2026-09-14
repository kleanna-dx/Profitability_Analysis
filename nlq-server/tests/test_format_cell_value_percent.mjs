// ============================================================
// formatCellValue — 비율 컬럼 셀 값 뒤에 '%' 자동 부착 회귀 테스트 (2026-09-14)
// ------------------------------------------------------------
// 배경 (사용자 요청):
//   비율/률/% 성격 컬럼의 셀 값 뒤에 '%' 접미사가 없어 판독이 불편.
//   예: 스크린샷에서 "-5" 만 표시 → "-5%" 로 보여줘야 함.
//
// 이 PR 이 도입:
//   nlq-server/public/index.html: formatCellValue 의 비율 분기에
//     - 숫자 값이면 '%' 부착 (예: -5 → "-5%")
//     - 이미 '%' 로 끝나는 문자열은 중복 부착 안 함
//     - 숫자 아님 ('-', 'N/A' 등) 은 원본 유지
//     - SQL alias 에 (%) 접미사가 있든 없든 무관
//
// 판정 (isRatioColumn):
//   - positive keyword: 율|률|비율|%|이익률|성장률|퍼센트|rate|ratio 등
//   - negative override 없음 (isRatioColumn 자체는 positive-only)
// ============================================================

import { readFileSync } from 'node:fs';

const src = readFileSync('/home/user/webapp/nlq-server/public/index.html', 'utf8');

// ── 순수 함수 추출 유틸 ──
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

// 대상: formatCellValue + 의존 헬퍼들
const targets = [
  { header: 'function _parseNumericLoose(v) {', name: '_parseNumericLoose' },
  { header: 'function isCalendarColumn(col, label) {', name: 'isCalendarColumn' },
  { header: 'function isCodeColumn(col, label) {', name: 'isCodeColumn' },
  { header: 'function isRatioColumn(col, label) {', name: 'isRatioColumn' },
  { header: 'function isMoneyColumn(col, label) {', name: 'isMoneyColumn' },
  { header: 'function formatCellValue(v, col, label) {', name: 'formatCellValue' },
];

let bootstrap = '';

// esc 함수는 브라우저 전용 (document.createElement) — 테스트용 shim 로 대체
// 실제 프로덕션 esc 는 HTML entity escape 를 하지만, 테스트에서는 결과 문자열의
// 순수 텍스트만 검증하므로 identity 로 대체해도 안전 (HTML entity 없는 값만 사용)
bootstrap += `globalThis.esc = function esc(s) { return String(s); };\n`;

for (const t of targets) {
  const fnSrc = extractFunctionSource(src, t.header);
  bootstrap += fnSrc.replace(`function ${t.name}`, `globalThis.${t.name} = function `) + '\n';
}

eval(bootstrap);

const { formatCellValue, isRatioColumn } = globalThis;

// ── 테스트 러너 ──
let passed = 0;
let failed = 0;
const failures = [];

function assertEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++; failures.push({ label, expected, actual });
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
  }
}

function assert(label, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else {
    failed++; failures.push({ label, extra });
    console.log(`  ✗ ${label}`);
    if (extra) console.log(`      ${extra}`);
  }
}

// ============================================================
// [Preflight]
// ============================================================
console.log('\n[Preflight] 헬퍼 로드');
assert('formatCellValue 로드됨', typeof formatCellValue === 'function');
assert('isRatioColumn 로드됨', typeof isRatioColumn === 'function');

// ============================================================
// [Unit 1] isRatioColumn — 판정 정확성 (기존 동작 유지 검증)
// ============================================================
console.log('\n[Unit 1] isRatioColumn (기존 동작)');

assert('positive: 영업이익률(%)', isRatioColumn(null, '영업이익률(%)'));
assert('positive: 영업이익률 (synonym)', isRatioColumn(null, '영업이익률'));
assert('positive: 매출총이익률', isRatioColumn(null, '매출총이익률'));
assert('positive: 판매비율', isRatioColumn(null, '판매비율'));
assert('positive: 성장률', isRatioColumn(null, '성장률'));
assert('positive: 점유율', isRatioColumn(null, '점유율'));
assert('positive: 마진율', isRatioColumn(null, '마진율'));
assert('positive: 원가율', isRatioColumn(null, '원가율'));
assert('positive: %  포함', isRatioColumn(null, '비중(%)'));
assert('positive: col 이 RATIO 로 끝남', isRatioColumn('PROFIT_RATIO', ''));
assert('positive: col 이 RATE 로 끝남', isRatioColumn('GROWTH_RATE', ''));
assert('positive: col 이 PCT 로 끝남', isRatioColumn('MARGIN_PCT', ''));

// negative — 비율 아님
assert('negative: 총매출', !isRatioColumn(null, '총매출'));
assert('negative: 판매관리비', !isRatioColumn(null, '판매관리비'));
assert('negative: 매출총이익', !isRatioColumn(null, '매출총이익'));
assert('negative: BOX수량', !isRatioColumn(null, 'BOX수량'));
assert('negative: 인건비합계', !isRatioColumn(null, '인건비합계'));

// ============================================================
// [Unit 2] formatCellValue — 비율 컬럼 % 자동 부착 (핵심 신규 동작)
// ============================================================
console.log('\n[Unit 2] formatCellValue 비율 컬럼 % 자동 부착');

// 정수 값
assertEq('사용자 재현: -5 → "-5%"',
  formatCellValue(-5, null, '영업이익률'), '-5%');
assertEq('정수 19 → "19%"',
  formatCellValue(19, null, '영업이익률(%)'), '19%');
assertEq('정수 0 → "0%"',
  formatCellValue(0, null, '이익률'), '0%');
assertEq('음수 -100 → "-100%"',
  formatCellValue(-100, null, '성장률'), '-100%');

// 문자열로 온 숫자 값 (서버가 문자열로 보낸 경우)
assertEq('문자열 "-5" → "-5%"',
  formatCellValue('-5', null, '영업이익률'), '-5%');
assertEq('문자열 "19" → "19%"',
  formatCellValue('19', null, '영업이익률(%)'), '19%');

// 소수 값 (ROUND 후처리 안 된 경우 대비)
assertEq('소수 -5.4257 → "-5.4257%"',
  formatCellValue(-5.4257, null, '영업이익률'), '-5.4257%');
assertEq('소수 19.0407 → "19.0407%"',
  formatCellValue(19.0407, null, '영업이익률'), '19.0407%');

// 이미 % 로 끝나는 문자열 — 중복 부착 방지
assertEq('이미 "-5%" → "-5%" (중복 방지)',
  formatCellValue('-5%', null, '영업이익률'), '-5%');
assertEq('이미 "19.5%" → "19.5%" (중복 방지)',
  formatCellValue('19.5%', null, '영업이익률'), '19.5%');
assertEq('공백 있는 "-5 %" → "-5 %" (중복 방지)',
  formatCellValue('-5 %', null, '영업이익률'), '-5 %');

// null/빈값/'-' 처리
assertEq('null → "-"', formatCellValue(null, null, '영업이익률'), '-');
assertEq('undefined → "-"', formatCellValue(undefined, null, '영업이익률'), '-');
assertEq('빈문자열 → "-"', formatCellValue('', null, '영업이익률'), '-');

// 숫자 아닌 문자열 — % 강제 부착 안 함 (원본 유지)
assertEq('"-" → "-" (숫자 아님)',
  formatCellValue('-', null, '영업이익률'), '-');
assertEq('"N/A" → "N/A" (숫자 아님)',
  formatCellValue('N/A', null, '영업이익률'), 'N/A');

// ============================================================
// [Unit 3] formatCellValue — 비율 아닌 컬럼은 % 부착 안 함 (회귀 방지)
// ============================================================
console.log('\n[Unit 3] 비율 아닌 컬럼은 % 부착 안 함');

// 금액 컬럼 — 콤마 O, % X
assertEq('금액 컬럼: 총매출 = 23044958105',
  formatCellValue(23044958105, null, '총매출(원)'), '23,044,958,105');
assertEq('금액 컬럼: 판매관리비',
  formatCellValue(1000000, null, '판매관리비'), '1,000,000');
assertEq('금액 컬럼: 매출액 (액 접미사)',
  formatCellValue(500000, null, '매출액'), '500,000');

// 금액 컬럼 값 뒤에 % 없어야 함
{
  const result = formatCellValue(1234, null, '총매출(원)');
  assert('금액 컬럼 값 뒤에 % 없음', !result.endsWith('%'));
}
{
  const result = formatCellValue(500000, null, '영업이익');
  assert('영업이익 (률 아님) 값 뒤에 % 없음', !result.endsWith('%'));
}

// 코드 컬럼 — 콤마 X, % X
assertEq('코드 컬럼: 사업부코드 100',
  formatCellValue('100', 'BUKRS', '사업부코드'), '100');

// 시간축 컬럼
assertEq('시간축 컬럼: 202601', formatCellValue(202601, 'CALMONTH', '연월'), '202601');

// 기타 숫자 — 콤마 O, % X
{
  const result = formatCellValue(1234, null, '알수없음');
  assert('기타 숫자: % 없음', !result.endsWith('%'));
}

// ============================================================
// [Unit 4] formatCellValue — 우선순위 (비율 > 금액)
// ============================================================
console.log('\n[Unit 4] 우선순위 검증');

// 라벨에 "이익률" 있으면 비율 우선 (금액 아님)
assertEq('영업이익률 값 -5 → "-5%" (금액 라벨 매칭 있어도 비율 우선)',
  formatCellValue(-5, null, '영업이익률'), '-5%');

// "이익률" 은 이익(금액 시그널) + 률(비율 시그널) 인데
// formatCellValue 순서상 비율 판정이 먼저 → 비율로 처리됨
assertEq('마진율 값 12 → "12%"',
  formatCellValue(12, null, '마진율'), '12%');

// ============================================================
// [Integration] 사용자 스크린샷 재현 시나리오
// ============================================================
console.log('\n[Integration] 사용자 스크린샷 재현');

{
  // 스크린샷: 영업이익률 컬럼 값 -5 → "-5%"
  const result = formatCellValue(-5, null, '영업이익률');
  assertEq('스크린샷 재현: 영업이익률 -5 → -5%', result, '-5%');
  assert('스크린샷 재현: % 접미사 있음', result.endsWith('%'));
  assert('스크린샷 재현: 값 부호 유지', result.startsWith('-'));
}

{
  // canonical name 인 경우도 동일하게 % 부착
  const result = formatCellValue(-5, null, '영업이익률(%)');
  assertEq('canonical name: -5 → -5%', result, '-5%');
  assert('canonical name: 이중 % 없음', !result.includes('%%'));
}

// ============================================================
// [Integration] 이중 실행 안전 (idempotent)
// ============================================================
console.log('\n[Integration] 이중 실행 안전성');

{
  const once = formatCellValue(-5, null, '영업이익률');
  const twice = formatCellValue(once, null, '영업이익률');
  assertEq('이중 실행: 한 번 실행 결과', once, '-5%');
  assertEq('이중 실행: 두 번째 실행도 동일 (% 중복 방지)', twice, '-5%');
}

// ============================================================
// 결과 요약
// ============================================================
console.log('\n============================================================');
console.log(`[Test Result] passed=${passed}  failed=${failed}  total=${passed + failed}`);
console.log('============================================================');

if (failed > 0) {
  console.log('\n[Failures]');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
    if (f.expected !== undefined) {
      console.log(`      expected: ${JSON.stringify(f.expected)}`);
      console.log(`      actual:   ${JSON.stringify(f.actual)}`);
    }
    if (f.extra) console.log(`      ${f.extra}`);
  }
  process.exit(1);
}
process.exit(0);
