// ============================================================
// 제조원가 자연어질의 → sys_aimd_cot015 단일 테이블 고정 (2026-09-14)
// ------------------------------------------------------------
// 사용자 확정 정책:
//   1. 자연어질의 > 제조원가에서 sys_aimd_cot043 조회 완전 금지 (보안).
//   2. area='manufacturing-cost' → 항상 targetTable='sys_aimd_cot015'.
//   3. 부서별/호기별 선택 UI (subareaClarification) 제거.
//   4. RAG/schema/context 에서 cot043 제외 (tableWhitelist=['sys_aimd_cot015']).
//   5. LLM 이 cot043 SQL 생성 시:
//      a) 자동 치환 시도 (rewriteMfgSqlToCot015) → retry-once
//      b) 여전히 cot043 → MFG_SQL_SAFETY_VIOLATION 에러
//   6. 이전 conversation state (cost-dept/cost-machine) 무효화 → 강제 cost-product.
//   7. cot015 내부 clarification 은 유지 (필요 시).
//
// 테스트 대상 (server.mjs):
//   - AREA_SUB_TABLE_MAP           : cost-dept/cost-machine 완전 삭제 확인
//   - MFG_ALLOWED_TABLES / MFG_FORBIDDEN_TABLES_RE
//   - resolveAreaContext           : area/subArea → table 매핑
//   - inferManufacturingCostSubArea : 결정론적 cost-product 반환
//   - assertMfgSqlSafety           : cot043 감지 → { safe: false }
//   - rewriteMfgSqlToCot015        : cot043 → cot015 문자열 치환
//
// 회귀 케이스 (사용자 명세):
//   Case 1: "2026년 8월 인건비를 알려줘"       → cot015, subareaClarification 없음
//   Case 2: "인건비 알려줘"                    → cot015
//   Case 3: "부서별 인건비 알려줘"             → cot015 (cot043 라우팅 안 됨)
//   Case 4: "호기별 원가 알려줘"               → cot015 (cot043 라우팅 안 됨)
//   Case 5: 이전 subArea='cost-dept' + 신규 질문 → cot015 (state 무효화)
//   Case 6: LLM SQL 에 `FROM sys_aimd_cot043` → assertMfgSqlSafety 가 detect
//   Case 7: cot015 내부 의미 clarification    → 여전히 가능 (별개 흐름, 영향 없음)
// ============================================================

import { readFileSync } from 'node:fs';

const src = readFileSync('/home/user/webapp/nlq-server/server.mjs', 'utf8');

// ── 함수/상수 추출 유틸 ──
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

function extractConstDecl(source, header, endMarker = '};') {
  const startIdx = source.indexOf(header);
  if (startIdx === -1) throw new Error(`상수 시작점 없음: ${header}`);
  const endIdx = source.indexOf(endMarker, startIdx);
  if (endIdx === -1) throw new Error(`상수 종료점 없음: ${header}`);
  return source.slice(startIdx, endIdx + endMarker.length);
}

function extractSingleLineConst(source, header) {
  const startIdx = source.indexOf(header);
  if (startIdx === -1) throw new Error(`상수 미발견: ${header}`);
  const endIdx = source.indexOf('\n', startIdx);
  return source.slice(startIdx, endIdx);
}

let bootstrap = '';

// eval 안 top-level const 는 globalThis 에 노출되지 않으므로 명시적으로 할당.
// AREA_SUB_TABLE_MAP 은 다층 객체이므로 balanced parse 필요.
bootstrap += extractConstDecl(src, 'const AREA_SUB_TABLE_MAP =', '};\n') + '\n';
bootstrap += 'globalThis.AREA_SUB_TABLE_MAP = AREA_SUB_TABLE_MAP;\n';
bootstrap += extractSingleLineConst(src, 'const MFG_ALLOWED_TABLES =') + '\n';
bootstrap += 'globalThis.MFG_ALLOWED_TABLES = MFG_ALLOWED_TABLES;\n';
bootstrap += extractSingleLineConst(src, 'const MFG_FORBIDDEN_TABLES_RE =') + '\n';
bootstrap += 'globalThis.MFG_FORBIDDEN_TABLES_RE = MFG_FORBIDDEN_TABLES_RE;\n';

const targets = [
  { header: 'function resolveAreaContext(rawArea, rawSubArea) {', name: 'resolveAreaContext' },
  { header: 'async function inferManufacturingCostSubArea(_query, explicitSubArea) {', name: 'inferManufacturingCostSubArea' },
  { header: 'function assertMfgSqlSafety(sql, area) {', name: 'assertMfgSqlSafety' },
  { header: 'function rewriteMfgSqlToCot015(sql) {', name: 'rewriteMfgSqlToCot015' },
];

for (const t of targets) {
  const fnSrc = extractFunctionSource(src, t.header);
  bootstrap += fnSrc.replace(new RegExp(`^(async\\s+)?function\\s+${t.name}`), `globalThis.${t.name} = $1function `) + '\n';
}

// 로그 노이즈 억제
const origWarn = console.warn;
const origError = console.error;
const origLog = console.log;
console.warn = () => {};
console.error = () => {};

eval(bootstrap);

const {
  AREA_SUB_TABLE_MAP,
  MFG_ALLOWED_TABLES,
  MFG_FORBIDDEN_TABLES_RE,
  resolveAreaContext,
  inferManufacturingCostSubArea,
  assertMfgSqlSafety,
  rewriteMfgSqlToCot015,
} = globalThis;

// ── 테스트 러너 ──
let passed = 0;
let failed = 0;
const failures = [];

function assert(label, cond, extra = '') {
  if (cond) { passed++; origLog(`  ✓ ${label}`); }
  else {
    failed++; failures.push({ label, extra });
    origLog(`  ✗ ${label}`);
    if (extra) origLog(`      ${extra}`);
  }
}

function assertEq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { passed++; origLog(`  ✓ ${label}`); }
  else {
    failed++; failures.push({ label, expected, actual });
    origLog(`  ✗ ${label}`);
    origLog(`      expected: ${JSON.stringify(expected)}`);
    origLog(`      actual:   ${JSON.stringify(actual)}`);
  }
}

// ============================================================
// [Preflight] 헬퍼/상수 로드 확인
// ============================================================
origLog('\n[Preflight]');
assert('AREA_SUB_TABLE_MAP 로드됨', typeof AREA_SUB_TABLE_MAP === 'object');
assert('MFG_ALLOWED_TABLES 로드됨', MFG_ALLOWED_TABLES instanceof Set);
assert('MFG_FORBIDDEN_TABLES_RE 로드됨', MFG_FORBIDDEN_TABLES_RE instanceof RegExp);
assert('resolveAreaContext 로드됨', typeof resolveAreaContext === 'function');
assert('inferManufacturingCostSubArea 로드됨', typeof inferManufacturingCostSubArea === 'function');
assert('assertMfgSqlSafety 로드됨', typeof assertMfgSqlSafety === 'function');
assert('rewriteMfgSqlToCot015 로드됨', typeof rewriteMfgSqlToCot015 === 'function');

// ============================================================
// [Unit 1] AREA_SUB_TABLE_MAP — cost-dept/cost-machine 완전 삭제
// ============================================================
origLog('\n[Unit 1] AREA_SUB_TABLE_MAP — cot043 완전 제거');

const mfg = AREA_SUB_TABLE_MAP['manufacturing-cost'];
assert('manufacturing-cost 존재', mfg && typeof mfg === 'object');
assert('defaultSubArea = cost-product', mfg.defaultSubArea === 'cost-product');
assert('subs.cost-product 존재', !!mfg.subs['cost-product']);
assertEq('cost-product.table', mfg.subs['cost-product'].table, 'sys_aimd_cot015');
assert('subs.cost-dept 삭제됨', !('cost-dept' in mfg.subs));
assert('subs.cost-machine 삭제됨', !('cost-machine' in mfg.subs));

// AREA_SUB_TABLE_MAP 전체 문자열에 cot043 없음
const mapStr = JSON.stringify(AREA_SUB_TABLE_MAP);
assert('AREA_SUB_TABLE_MAP 문자열에 cot043 없음', !/cot043/i.test(mapStr));

// MFG_ALLOWED_TABLES / FORBIDDEN
assert('MFG_ALLOWED_TABLES 에 cot015 포함', MFG_ALLOWED_TABLES.has('sys_aimd_cot015'));
assert('MFG_ALLOWED_TABLES 에 cot043 없음', !MFG_ALLOWED_TABLES.has('sys_aimd_cot043'));
assert('MFG_FORBIDDEN_TABLES_RE 가 cot043 매칭', MFG_FORBIDDEN_TABLES_RE.test('FROM sys_aimd_cot043'));
assert('MFG_FORBIDDEN_TABLES_RE 가 cot015 미매칭', !MFG_FORBIDDEN_TABLES_RE.test('FROM sys_aimd_cot015'));

// ============================================================
// [Unit 2] resolveAreaContext — cost-dept/cost-machine 요청 → null 처리
// ============================================================
origLog('\n[Unit 2] resolveAreaContext');

{
  const ctx = resolveAreaContext('manufacturing-cost', 'cost-product');
  assertEq('cost-product → sys_aimd_cot015', ctx.table, 'sys_aimd_cot015');
  assertEq('subArea = cost-product', ctx.subArea, 'cost-product');
}

{
  const ctx = resolveAreaContext('manufacturing-cost', 'cost-dept');
  // subs 에서 삭제됐으므로 매핑 실패 → 하지만 defaultSubArea 는 여전히 cost-product 라
  // resolveAreaContext 는 '__default__' fallback 을 시도하는데 __default__ 도 없음.
  // 따라서 empty 반환.
  assert('cost-dept → table null (subs 미존재)', ctx.table === null);
}

{
  const ctx = resolveAreaContext('manufacturing-cost', 'cost-machine');
  assert('cost-machine → table null (subs 미존재)', ctx.table === null);
}

{
  // subArea 미지정 → defaultSubArea (cost-product) 사용
  const ctx = resolveAreaContext('manufacturing-cost', null);
  assertEq('subArea null + default → cost-product', ctx.subArea, 'cost-product');
  assertEq('subArea null + default → cot015', ctx.table, 'sys_aimd_cot015');
}

// ============================================================
// [Unit 3] inferManufacturingCostSubArea — 결정론적 cost-product 반환
// ============================================================
origLog('\n[Unit 3] inferManufacturingCostSubArea (결정론)');

// Case 1: "2026년 8월 인건비를 알려줘"
{
  const r = await inferManufacturingCostSubArea('2026년 8월 인건비를 알려줘', null);
  assertEq('Case 1: subArea = cost-product', r.subArea, 'cost-product');
  assert('Case 1: ambiguous = false', r.ambiguous === false);
  assertEq('Case 1: source = forced', r.source, 'forced');
}

// Case 2: "인건비 알려줘"
{
  const r = await inferManufacturingCostSubArea('인건비 알려줘', null);
  assertEq('Case 2: subArea = cost-product', r.subArea, 'cost-product');
  assert('Case 2: ambiguous = false', r.ambiguous === false);
}

// Case 3: "부서별 인건비 알려줘" — 규칙 매칭이면 cost-dept 였지만 강제 cost-product
{
  const r = await inferManufacturingCostSubArea('부서별 인건비 알려줘', null);
  assertEq('Case 3: 부서별 → cost-product 강제', r.subArea, 'cost-product');
  assert('Case 3: cot043 라우팅 안 됨', r.subArea !== 'cost-dept');
}

// Case 4: "호기별 원가 알려줘"
{
  const r = await inferManufacturingCostSubArea('호기별 원가 알려줘', null);
  assertEq('Case 4: 호기별 → cost-product 강제', r.subArea, 'cost-product');
  assert('Case 4: cost-machine 라우팅 안 됨', r.subArea !== 'cost-machine');
}

// Case 5: 이전 explicit subArea='cost-dept' 로 재요청 (state 무효화)
{
  const r = await inferManufacturingCostSubArea('총원가', 'cost-dept');
  assertEq('Case 5: explicit cost-dept 무시 → cost-product', r.subArea, 'cost-product');
  assert('Case 5: ambiguous = false', r.ambiguous === false);
}

// Case 5-b: explicit cost-machine 도 무시
{
  const r = await inferManufacturingCostSubArea('총원가', 'cost-machine');
  assertEq('Case 5-b: explicit cost-machine 무시 → cost-product', r.subArea, 'cost-product');
}

// Case 5-c: explicit cost-product (정상 케이스) — 그대로 cost-product
{
  const r = await inferManufacturingCostSubArea('총원가', 'cost-product');
  assertEq('Case 5-c: explicit cost-product → cost-product', r.subArea, 'cost-product');
}

// Case 5-d: explicit 빈 문자열 → cost-product 강제
{
  const r = await inferManufacturingCostSubArea('총원가', '');
  assertEq('Case 5-d: explicit 빈 값 → cost-product', r.subArea, 'cost-product');
}

// ============================================================
// [Unit 4] assertMfgSqlSafety — cot043 감지
// ============================================================
origLog('\n[Unit 4] assertMfgSqlSafety');

// Case 6: LLM SQL 에 FROM sys_aimd_cot043
{
  const badSql = "SELECT * FROM sys_aimd_cot043 WHERE CALMONTH='202608'";
  const r = assertMfgSqlSafety(badSql, 'manufacturing-cost');
  assert('Case 6: cot043 감지 → safe=false', r.safe === false);
  assert('Case 6: reason 메시지 있음', typeof r.reason === 'string' && r.reason.length > 0);
}

// JOIN sys_aimd_cot043 도 감지
{
  const badSql = "SELECT * FROM x JOIN sys_aimd_cot043 y ON x.id=y.id";
  const r = assertMfgSqlSafety(badSql, 'manufacturing-cost');
  assert('JOIN cot043 도 감지', r.safe === false);
}

// 안전한 SQL (cot015 만) → safe=true
{
  const goodSql = "SELECT SUM(TOTAL) FROM sys_aimd_cot015 WHERE CALMONTH='202608'";
  const r = assertMfgSqlSafety(goodSql, 'manufacturing-cost');
  assert('cot015 SQL → safe=true', r.safe === true);
  assert('cot015 SQL → reason=null', r.reason === null);
}

// 다른 area (수익성분석) 는 cot043 있어도 통과 (다른 도메인이라 관련 없음)
{
  const sql = "SELECT * FROM sys_aimd_cot043";
  const r = assertMfgSqlSafety(sql, 'profitability');
  assert('area != mfg → 검증 skip (safe=true)', r.safe === true);
}

// null/빈 SQL 안전
{
  const r = assertMfgSqlSafety(null, 'manufacturing-cost');
  assert('null SQL → safe=true (no-op)', r.safe === true);
}
{
  const r = assertMfgSqlSafety('', 'manufacturing-cost');
  assert('빈 SQL → safe=true (no-op)', r.safe === true);
}

// area 미지정 → 검증 skip
{
  const r = assertMfgSqlSafety("SELECT * FROM sys_aimd_cot043", null);
  assert('area null → safe=true (검증 skip)', r.safe === true);
}

// 대소문자 무관
{
  const upperSql = "SELECT * FROM SYS_AIMD_COT043";
  const r = assertMfgSqlSafety(upperSql, 'manufacturing-cost');
  assert('대문자 cot043 감지', r.safe === false);
}

// ============================================================
// [Unit 5] rewriteMfgSqlToCot015 — 자동 치환
// ============================================================
origLog('\n[Unit 5] rewriteMfgSqlToCot015');

{
  const bad = "SELECT * FROM sys_aimd_cot043 WHERE X=1";
  const fixed = rewriteMfgSqlToCot015(bad);
  assertEq('cot043 → cot015 단일 치환', fixed, "SELECT * FROM sys_aimd_cot015 WHERE X=1");
}

{
  const bad = "SELECT * FROM sys_aimd_cot043 a JOIN sys_aimd_cot043 b";
  const fixed = rewriteMfgSqlToCot015(bad);
  assert('다중 참조도 모두 치환', !/cot043/i.test(fixed));
  assert('cot015 로 치환됨', /cot015/i.test(fixed));
}

// 대소문자 무관
{
  const bad = "SELECT * FROM SYS_AIMD_COT043";
  const fixed = rewriteMfgSqlToCot015(bad);
  assert('대문자 cot043 도 치환', !/cot043/i.test(fixed));
}

// cot015 만 있으면 변경 없음
{
  const good = "SELECT * FROM sys_aimd_cot015";
  const fixed = rewriteMfgSqlToCot015(good);
  assertEq('cot015 SQL 변경 없음', fixed, good);
}

// null/빈 안전
assertEq('null → null', rewriteMfgSqlToCot015(null), null);
assertEq('빈 → 빈', rewriteMfgSqlToCot015(''), '');

// ============================================================
// [Integration] 사용자 명세 회귀 케이스 (Case 1~7)
// ============================================================
origLog('\n[Integration] 사용자 명세 회귀 케이스');

// Case 1: "2026년 8월 인건비를 알려줘"
//   → subArea = cost-product, table = cot015, subareaClarification 없음
{
  const r = await inferManufacturingCostSubArea('2026년 8월 인건비를 알려줘', null);
  const ctx = resolveAreaContext('manufacturing-cost', r.subArea);
  assertEq('Case 1: table = cot015', ctx.table, 'sys_aimd_cot015');
  assert('Case 1: ambiguous 없음 (subareaClarification 미발생)', r.ambiguous === false);
}

// Case 2: "인건비 알려줘" → cot015
{
  const r = await inferManufacturingCostSubArea('인건비 알려줘', null);
  const ctx = resolveAreaContext('manufacturing-cost', r.subArea);
  assertEq('Case 2: table = cot015', ctx.table, 'sys_aimd_cot015');
}

// Case 3: "부서별 인건비 알려줘" → cot015 (cot043 라우팅 안 됨)
{
  const r = await inferManufacturingCostSubArea('부서별 인건비 알려줘', null);
  const ctx = resolveAreaContext('manufacturing-cost', r.subArea);
  assertEq('Case 3: table = cot015 (cot043 아님)', ctx.table, 'sys_aimd_cot015');
  assert('Case 3: cot043 미사용', ctx.table !== 'sys_aimd_cot043');
}

// Case 4: "호기별 원가 알려줘" → cot015
{
  const r = await inferManufacturingCostSubArea('호기별 원가 알려줘', null);
  const ctx = resolveAreaContext('manufacturing-cost', r.subArea);
  assertEq('Case 4: table = cot015', ctx.table, 'sys_aimd_cot015');
}

// Case 5: 이전 subArea='cost-dept' 재사용 방지
{
  const r = await inferManufacturingCostSubArea('총원가', 'cost-dept');
  const ctx = resolveAreaContext('manufacturing-cost', r.subArea);
  assertEq('Case 5: 이전 state 무효화 → cot015', ctx.table, 'sys_aimd_cot015');
}

// Case 6: LLM 이 cot043 SQL 생성 시 assertMfgSqlSafety 감지
{
  const llmSql = "SELECT COSTCENTER, SUM(AMOUNT) FROM sys_aimd_cot043 WHERE CALMONTH='202608' GROUP BY COSTCENTER";
  const safety = assertMfgSqlSafety(llmSql, 'manufacturing-cost');
  assert('Case 6: SQL 실행 차단 (safe=false)', safety.safe === false);
  assert('Case 6: 재생성 시도 가능 (rewriteMfgSqlToCot015)', typeof rewriteMfgSqlToCot015(llmSql) === 'string');
}

// Case 7: cot015 내부 clarification 은 별개 흐름 — inferManufacturingCostSubArea 는 항상 cost-product
//         (실제 cot015 내부 clarification 은 costcompClarification 이지만 cot043 전용이므로
//          현재 정책에서는 dead-path. 별개 clarification 이 추가된다면 그대로 동작 가능한 구조 유지.)
{
  // "인건비" 처럼 cot015 안에 여러 원가구분 해석 가능한 케이스도 여전히 cost-product 로 결정
  const r = await inferManufacturingCostSubArea('인건비', null);
  assertEq('Case 7: cost-product 확정 (cot015 내부 clarification 는 별개)', r.subArea, 'cost-product');
}

// ============================================================
// [Integration] 방어 케이스 — 대소문자/공백/이상한 subArea 값
// ============================================================
origLog('\n[Integration] 방어 케이스');

// explicit 대문자 COST-DEPT
{
  const r = await inferManufacturingCostSubArea('총원가', 'COST-DEPT');
  assertEq('대문자 COST-DEPT → cost-product', r.subArea, 'cost-product');
}

// explicit 공백
{
  const r = await inferManufacturingCostSubArea('총원가', '  cost-dept  ');
  assertEq('공백 포함 cost-dept → cost-product', r.subArea, 'cost-product');
}

// explicit 완전 이상한 값
{
  const r = await inferManufacturingCostSubArea('총원가', 'invalid-xyz');
  assertEq('이상한 subArea → cost-product', r.subArea, 'cost-product');
}

// ============================================================
// 결과 요약
// ============================================================
console.warn = origWarn;
console.error = origError;
console.log = origLog;

origLog('\n============================================================');
origLog(`[Test Result] passed=${passed}  failed=${failed}  total=${passed + failed}`);
origLog('============================================================');

if (failed > 0) {
  origLog('\n[Failures]');
  for (const f of failures) {
    origLog(`  - ${f.label}`);
    if (f.expected !== undefined) {
      origLog(`      expected: ${JSON.stringify(f.expected)}`);
      origLog(`      actual:   ${JSON.stringify(f.actual)}`);
    }
    if (f.extra) origLog(`      ${f.extra}`);
  }
  process.exit(1);
}
process.exit(0);
