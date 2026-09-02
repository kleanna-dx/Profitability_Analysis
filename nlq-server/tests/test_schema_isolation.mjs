// [2026-09-02 PR #408] Phase 5 — 스키마 격리(schema isolation) 회귀 테스트
//
// 목적:
//   analyticsdev req-20260902-142729-2a0cfe 회귀 재발 방지.
//   - manufacturing-cost SQL (FROM sys_aimd_cot043) 에 수익성분석 컬럼 (ZAMT001 등)
//     이 섞이면 반드시 valid:false, unknownCols 반환
//   - 정상 SQL (SUM(AMOUNT)) 은 valid:true 반환
//   - 역방향: profitability SQL (FROM bw_profitability_data) 에 AMOUNT/ZCOSTCOMP_NM
//     이 섞이면 valid:false 반환 (요구사항 #4)
//   - 안전한 스킵: 대상 테이블 미참조·복수 대상 테이블·CTE 등은 valid:true 로 통과
//     (오탐으로 정상 SQL 이 재생성 루프에 빠지는 것 방지)
//
// 실행: node tests/test_schema_isolation.mjs

import { readFileSync } from 'node:fs';

const serverMjsPath = '/home/user/webapp/nlq-server/server.mjs';
const serverMjs = readFileSync(serverMjsPath, 'utf8').split('\n');

function findLine(pattern) {
  for (let i = 0; i < serverMjs.length; i++) {
    if (serverMjs[i].includes(pattern)) return i + 1;
  }
  return -1;
}
function extractByLines(startLineOneBased, endLineOneBased) {
  return serverMjs.slice(startLineOneBased - 1, endLineOneBased).join('\n');
}

// _validateSqlColumnsAgainstSchema 함수 라인 추출
const valStart = findLine('function _validateSqlColumnsAgainstSchema(sql) {');
if (valStart === -1) throw new Error('_validateSqlColumnsAgainstSchema not found');
// 함수 종료 지점: 다음 "function applyForcedCostCompFilter" 앞의 } 라인
const nextFn = findLine('function applyForcedCostCompFilter(inputSql, forcedCostComp) {');
if (nextFn === -1) throw new Error('applyForcedCostCompFilter not found');
let valEnd = -1;
for (let i = nextFn - 2; i >= valStart; i--) {
  if (serverMjs[i - 1].trim() === '}') { valEnd = i; break; }
}
if (valEnd === -1) throw new Error('_validateSqlColumnsAgainstSchema end brace not found');
const validateSrc = extractByLines(valStart, valEnd);

// 캐시 변수도 함께 노출 (테스트에서 주입)
const cacheSrc = `
const _TABLE_COL_WHITELIST_CACHE = new Map();
${validateSrc}
globalThis._TABLE_COL_WHITELIST_CACHE = _TABLE_COL_WHITELIST_CACHE;
globalThis._validateSqlColumnsAgainstSchema = _validateSqlColumnsAgainstSchema;
`;
eval(cacheSrc);
const cache = globalThis._TABLE_COL_WHITELIST_CACHE;
const validate = globalThis._validateSqlColumnsAgainstSchema;
if (typeof validate !== 'function') throw new Error('_validateSqlColumnsAgainstSchema is not a function');

// 스키마 캐시 주입 (실제 DB 조회 없이 mock)
//   sys_aimd_cot043: 제조원가 세부업무영역 컬럼 (AMOUNT 이 measure)
cache.set('sys_aimd_cot043', new Set([
  'CALMONTH', 'AMOUNT', 'ZCOSTCOMP_NM', 'COSTELMNT_NM',
  'COSTCENTER', 'COSTCENTER_NM', 'MATERIAL', 'MATERIAL_NM',
]));
//   bw_profitability_data: 수익성분석 컬럼 (ZAMT001~ZAMT033 이 measure)
cache.set('bw_profitability_data', new Set([
  'CALMONTH', 'DIVISION', 'PROFIT_CTR', 'MATERIAL', 'MATERIAL_NM',
  'ZAMT001', 'ZAMT002', 'ZAMT003', 'ZAMT049',
]));

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
function assertTrue(label, cond, detail) {
  console.log(`${cond ? '✓ PASS' : '❌ FAIL'}  ${label}`);
  if (cond) passed++; else {
    failed++;
    if (detail !== undefined) console.log(`         detail: ${JSON.stringify(detail)}`);
  }
}

console.log('\n=== 그룹 1: analyticsdev 실 오류 재현 (sys_aimd_cot043 + ZAMT001) ===');
{
  // req-20260902-142729-2a0cfe 실 SQL 재현
  const sql = `SELECT SUM(ZAMT001) AS '2026년 7월 베트남지사 인건비 합계(원)' FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '인건비' AND CALMONTH = '202607' AND COSTCENTER_NM LIKE '%베트남지사%'`;
  const r = validate(sql);
  assertEq('valid=false 반환', r.valid, false);
  assertTrue('targetTable=sys_aimd_cot043',  r.targetTable === 'sys_aimd_cot043', r);
  assertTrue('unknownCols 에 ZAMT001 포함',   r.unknownCols && r.unknownCols.includes('ZAMT001'), r);
  assertTrue('tableCols 에 AMOUNT 포함(힌트)', r.tableCols && r.tableCols.includes('AMOUNT'), r);
}

console.log('\n=== 그룹 2: 정상 SQL (sys_aimd_cot043 + AMOUNT) 통과 ===');
{
  const sql = `SELECT SUM(AMOUNT) AS '2026년 7월 베트남지사 인건비 합계(원)' FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '인건비' AND CALMONTH = '202607' AND COSTCENTER_NM LIKE '%베트남지사%'`;
  const r = validate(sql);
  assertEq('valid=true 반환', r.valid, true);
}
{
  const sql = `SELECT COSTCENTER_NM, FORMAT(SUM(AMOUNT), 0) AS '금액' FROM sys_aimd_cot043 WHERE CALMONTH = '202607' GROUP BY COSTCENTER_NM ORDER BY SUM(AMOUNT) DESC LIMIT 10`;
  const r = validate(sql);
  assertEq('그룹별 집계 SQL 통과', r.valid, true);
}

console.log('\n=== 그룹 3: 역방향 (bw_profitability_data + AMOUNT/ZCOSTCOMP_NM) — 요구사항 #4 ===');
{
  const sql = `SELECT SUM(AMOUNT) AS '매출' FROM bw_profitability_data WHERE CALMONTH = '202607'`;
  const r = validate(sql);
  assertEq('valid=false 반환', r.valid, false);
  assertTrue('targetTable=bw_profitability_data', r.targetTable === 'bw_profitability_data', r);
  assertTrue('unknownCols 에 AMOUNT 포함',        r.unknownCols && r.unknownCols.includes('AMOUNT'), r);
}
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE ZCOSTCOMP_NM = '인건비'`;
  const r = validate(sql);
  assertEq('valid=false 반환 (ZCOSTCOMP_NM 유출)', r.valid, false);
  assertTrue('unknownCols 에 ZCOSTCOMP_NM 포함',    r.unknownCols && r.unknownCols.includes('ZCOSTCOMP_NM'), r);
}
{
  const sql = `SELECT SUM(ZAMT001) AS '매출' FROM bw_profitability_data WHERE CALMONTH = '202607'`;
  const r = validate(sql);
  assertEq('정상 profitability SQL 통과', r.valid, true);
}

console.log('\n=== 그룹 4: 안전한 스킵 (오탐 방지) ===');
{
  // 대상 테이블이 FROM 에 없음
  const sql = `SELECT * FROM some_other_table WHERE ZAMT001 = 1`;
  const r = validate(sql);
  assertEq('대상 테이블 미참조 → skip(valid=true)', r.valid, true);
}
{
  // 복수 대상 테이블 (JOIN)
  const sql = `SELECT a.AMOUNT, b.ZAMT001 FROM sys_aimd_cot043 a JOIN bw_profitability_data b ON a.CALMONTH = b.CALMONTH`;
  const r = validate(sql);
  assertEq('복수 대상 테이블 → skip(valid=true)', r.valid, true);
}
{
  // CTE / WITH 시작
  const sql = `WITH tmp AS (SELECT * FROM sys_aimd_cot043) SELECT SUM(ZAMT001) FROM tmp`;
  const r = validate(sql);
  assertEq('WITH 시작 SQL → skip(valid=true)', r.valid, true);
}
{
  // 빈 SQL
  assertEq('빈 문자열 → valid=true', validate('').valid, true);
  assertEq('null → valid=true',     validate(null).valid, true);
  assertEq('undefined → valid=true', validate(undefined).valid, true);
}

console.log('\n=== 그룹 5: 문자열 리터럴 오탐 방지 ===');
{
  // '베트남지사' 같은 한글 리터럴은 대문자 식별자 패턴에 안 걸리지만,
  // 영문 리터럴이 컬럼처럼 보이면 오탐 가능 → strip 로 방어
  const sql = `SELECT SUM(AMOUNT) FROM sys_aimd_cot043 WHERE COSTCENTER_NM = 'VIETNAM_BRANCH' AND ZCOSTCOMP_NM = 'LABOR_COST'`;
  const r = validate(sql);
  assertEq("문자열 리터럴 안의 대문자 식별자 무시 → valid=true", r.valid, true);
}
{
  // 별칭 (짧은 이름) 은 예약어 목록·짧은-별칭 필터로 걸러짐 - 두 글자 별칭 T1 을 우선 시도
  const sql = `SELECT T1.AMOUNT FROM sys_aimd_cot043 T1 WHERE T1.CALMONTH = '202607'`;
  const r = validate(sql);
  // 참고: T1 은 스킵되지만, "AMOUNT" 는 스키마에 있으므로 통과해야 함
  assertEq('짧은 별칭 T1 무시 → valid=true', r.valid, true);
}

console.log('\n=== 그룹 6: 실제 오류 SQL — applyForcedCostCompFilter 이후 형태 ===');
{
  // req-20260902-142729-2a0cfe 라인 166 의 정확한 실패 SQL
  const sql = `SELECT SUM(ZAMT001) AS '2026년 7월 베트남지사 인건비 합계(원)'\nFROM sys_aimd_cot043\nWHERE ZCOSTCOMP_NM = '인건비' AND (COSTCENTER NOT IN ('0001220010', '0001220020') AND (CALMONTH = '202607'\n  AND COSTCENTER_NM LIKE '%베트남지사%'\n  ))`;
  const r = validate(sql);
  assertEq('실제 실패 SQL: valid=false', r.valid, false);
  assertTrue('ZAMT001 감지', r.unknownCols && r.unknownCols.includes('ZAMT001'), r);
  // COSTCENTER, ZCOSTCOMP_NM, CALMONTH, COSTCENTER_NM 은 정상 컬럼 → unknown 에 없어야 함
  assertTrue('정상 컬럼 COSTCENTER 는 unknown 에 없음',
    r.unknownCols && !r.unknownCols.includes('COSTCENTER'), r);
  assertTrue('정상 컬럼 ZCOSTCOMP_NM 는 unknown 에 없음',
    r.unknownCols && !r.unknownCols.includes('ZCOSTCOMP_NM'), r);
  assertTrue('정상 컬럼 CALMONTH 는 unknown 에 없음',
    r.unknownCols && !r.unknownCols.includes('CALMONTH'), r);
  assertTrue('정상 컬럼 COSTCENTER_NM 는 unknown 에 없음',
    r.unknownCols && !r.unknownCols.includes('COSTCENTER_NM'), r);
}

console.log('\n=== 그룹 7: 캐시 비어있을 때 안전 스킵 ===');
{
  // 캐시를 임시로 비우고 확인
  const backup = new Map(cache);
  cache.clear();
  const sql = `SELECT SUM(ZAMT001) FROM sys_aimd_cot043`;
  const r = validate(sql);
  assertEq('캐시 empty → skip(valid=true)', r.valid, true);
  // 복원
  for (const [k, v] of backup) cache.set(k, v);
}

console.log(`\n=== 결과 ===`);
console.log(`✓ 통과: ${passed}`);
console.log(`❌ 실패: ${failed}`);
if (failed > 0) process.exit(1);
console.log('\n모든 테스트 통과');
