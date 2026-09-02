// validateAndSanitizeCostCompOutput 함수 유닛 테스트
//   - Fix 2 (post-SQL 오염 감지 & 정정) 의 정확성 검증
//   - 사용자 요구사항 #7 반영 재현: alias/explanation 에 이전 turn 어휘 유입 감지

import { readFileSync } from 'node:fs';

const serverMjsPath = '/home/user/webapp/nlq-server/server.mjs';
const serverMjs = readFileSync(serverMjsPath, 'utf8').split('\n');

// 라인 기반 함수 추출 (brace-count 방식은 주석·문자열의 중괄호 오탐 발생하므로 사용 안 함)
function extractByLines(startLineOneBased, endLineOneBased) {
  return serverMjs.slice(startLineOneBased - 1, endLineOneBased).join('\n');
}

function findLine(pattern) {
  for (let i = 0; i < serverMjs.length; i++) {
    if (serverMjs[i].includes(pattern)) return i + 1;
  }
  return -1;
}

// escapeRegex: 3줄 (function 선언 + return + })
const escStart = findLine('function escapeRegex(str) {');
if (escStart === -1) throw new Error('escapeRegex not found');
const escapeSrc = extractByLines(escStart, escStart + 2);

// validateAndSanitizeCostCompOutput 시작
const valStart = findLine('function validateAndSanitizeCostCompOutput({');
if (valStart === -1) throw new Error('validateAndSanitizeCostCompOutput not found');
// 함수 종료는 다음 "// ============================================================" 헤더 앞의 } 라인.
// 실제로는 함수 정의 뒤 바로 "// ============================================================" 가 옴 (L8123).
// 함수 마지막 } 는 그 앞 라인.
const nextHeader = findLine('// [★★★ 사업부 명칭 고정 매핑 규칙 (2026-07-03) ★★★]');
if (nextHeader === -1) throw new Error('next header not found');
// nextHeader 위쪽으로 올라가면서 // ==== 헤더 라인을 찾음.
let valEnd = -1;
for (let i = nextHeader - 2; i >= valStart; i--) {
  if (serverMjs[i - 1].trim() === '}') { valEnd = i; break; }
}
if (valEnd === -1) throw new Error('validateAndSanitizeCostCompOutput end brace not found');
const validateSrc = extractByLines(valStart, valEnd);

// 두 함수를 함께 eval — escapeRegex 를 lexical scope 에 두고 validateAndSanitizeCostCompOutput 이 참조
const combined = `
${escapeSrc}
${validateSrc}
globalThis.validateAndSanitizeCostCompOutput = validateAndSanitizeCostCompOutput;
`;
eval(combined);
const validate = globalThis.validateAndSanitizeCostCompOutput;
if (typeof validate !== 'function') throw new Error('validate is not a function');

let passed = 0, failed = 0;
function assertEq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓ PASS' : '❌ FAIL'}  ${label}`);
  if (!ok) {
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
    failed++;
  } else passed++;
}
function assertTrue(label, cond) {
  console.log(`${cond ? '✓ PASS' : '❌ FAIL'}  ${label}`);
  if (cond) passed++; else failed++;
}

console.log('\n=== 그룹 1: no-op — forcedCostComp 없거나 비어있음 ===');
{
  const r = validate({
    sql: `SELECT * FROM sys_aimd_cot043`,
    explanation: '아무거나',
    query: '2026년 7월 통신비 우편/택배 알려줘',
    forcedCostComp: null,
  });
  assertEq('forcedCostComp=null → no-op', r.contaminated, false);
}
{
  const r = validate({
    sql: `SELECT * FROM sys_aimd_cot043`,
    explanation: '아무거나',
    query: '2026년 7월 통신비 우편/택배 알려줘',
    forcedCostComp: { values: [], op: '=' },
  });
  assertEq('values=[] → no-op', r.contaminated, false);
}

console.log('\n=== 그룹 2: 정상 케이스 — 현재 질의 어휘만 사용됨 ===');
{
  const r = validate({
    sql: `SELECT COSTCENTER, SUM(AMOUNT) AS '인건비 원가 합계' FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '인건비' AND CALMONTH='202607' GROUP BY COSTCENTER`,
    explanation: 'CALMONTH=202607 에서 ZCOSTCOMP_NM=인건비 로 필터링했습니다.',
    query: '2026년 7월 AX운영팀의 인건비를 알려줘',
    forcedCostComp: { values: ['인건비'], op: '=' },
  });
  assertEq('정상 SQL → 오염 없음', r.contaminated, false);
  assertEq('정상 SQL → SQL 그대로', r.sql.includes(`ZCOSTCOMP_NM = '인건비'`), true);
}

console.log('\n=== 그룹 3: 버그 재현 — 이전 turn 의 "통신비 우편/택배" 유입 ===');
{
  const buggySql = `SELECT
    COSTCENTER AS '부서코드',
    MAX(COSTCENTER_NM) AS '부서명',
    SUM(AMOUNT) AS '통신비 우편/택배 원가 합계(원)'
FROM sys_aimd_cot043
WHERE ZCOSTCOMP_NM = '인건비'
    AND CALMONTH = '202607'
GROUP BY COSTCENTER
ORDER BY SUM(AMOUNT) DESC`;
  const buggyExpl = `sys_aimd_cot043 테이블에서 2026년 7월(CALMONTH='202607') 데이터를 대상으로 원가 구성요소명이 '통신비 우편/택배'를 포함하는 항목을 필터링한 뒤 부서코드별로 원가 금액을 합산했습니다.`;
  const r = validate({
    sql: buggySql,
    explanation: buggyExpl,
    query: '2026년 7월 AX운영팀의 인건비를 알려줘',
    forcedCostComp: { values: ['인건비'], op: '=' },
  });
  assertTrue('오염 감지 됨 (contaminated=true)', r.contaminated === true);
  assertTrue('"통신비 우편/택배" 가 leakedTerms 에 포함', r.leakedTerms.includes('통신비 우편/택배'));
  assertTrue('SQL alias 에서 "통신비 우편/택배" 제거', !r.sql.includes('통신비 우편/택배'));
  assertTrue('SQL alias 에 forced 값 "인건비" 반영', r.sql.includes(`'인건비 원가 합계(원)'`));
  assertTrue('explanation 재작성됨 (원본 폐기)', !r.explanation.includes('통신비 우편/택배를 포함하는 항목을 필터링'));
  assertTrue('재작성된 explanation 이 "인건비" 명시', r.explanation.includes('인건비'));
  assertTrue('SQL WHERE 절 그대로 유지', r.sql.includes(`ZCOSTCOMP_NM = '인건비'`));
}

console.log('\n=== 그룹 4: 여러 어휘 동시 유출 ===');
{
  const r = validate({
    sql: `SELECT SUM(AMOUNT) AS '전력비 및 통신비 합계' FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '인건비'`,
    explanation: '전력비 및 통신비 관련 항목을 필터링했습니다.',
    query: '2026년 7월 AX운영팀의 인건비를 알려줘',
    forcedCostComp: { values: ['인건비'], op: '=' },
  });
  assertTrue('오염 감지', r.contaminated === true);
  assertTrue('전력비 감지', r.leakedTerms.includes('전력비'));
  assertTrue('통신비 감지', r.leakedTerms.includes('통신비'));
}

console.log('\n=== 그룹 5: 현재 질의에 원가구성요소 여러 어휘가 있는 경우 (오탐 방지) ===');
{
  const r = validate({
    sql: `SELECT SUM(AMOUNT) AS '통신비 원가 합계' FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '통신비'`,
    explanation: '통신비 관련 항목을 필터링했습니다.',
    query: '2026년 7월 AX운영팀의 통신비를 알려줘',
    forcedCostComp: { values: ['통신비'], op: '=' },
  });
  assertEq('현재 질의에 있는 어휘 → 오탐 없음', r.contaminated, false);
}

console.log('\n=== 그룹 6: IN 다중 선택 ===');
{
  const r = validate({
    sql: `SELECT SUM(AMOUNT) AS '전력비 원가 합계' FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM IN ('인건비','인건비_경비')`,
    explanation: '전력비 관련 항목을 필터링했습니다.',
    query: '2026년 7월 AX운영팀의 인건비를 알려줘',
    forcedCostComp: { values: ['인건비', '인건비_경비'], op: 'IN' },
  });
  assertTrue('IN 케이스 오염 감지', r.contaminated === true);
  assertTrue('전력비 → leakedTerms 포함', r.leakedTerms.includes('전력비'));
  assertTrue('SQL alias 에 forced 조합 반영', r.sql.includes('인건비, 인건비_경비'));
}

console.log('\n=== 그룹 7: forcedCostComp 값 자체가 감지 리스트에 있어도 오탐하지 않음 ===');
{
  // 예: forced=['인건비'], 현재 질의 "인건비 알려줘". SQL/explanation 에 "인건비" 만 있으므로 오염 없음.
  const r = validate({
    sql: `SELECT SUM(AMOUNT) AS '인건비 원가' FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '인건비'`,
    explanation: '인건비 조건으로 필터링했습니다.',
    query: '인건비 알려줘',
    forcedCostComp: { values: ['인건비'], op: '=' },
  });
  assertEq('forced 값 자체는 오탐하지 않음', r.contaminated, false);
}

console.log('\n=== 결과 ===');
console.log(`총 ${passed + failed} 케이스: PASS=${passed}, FAIL=${failed}`);
if (failed > 0) process.exit(1);
console.log('✓ 모든 테스트 통과');
