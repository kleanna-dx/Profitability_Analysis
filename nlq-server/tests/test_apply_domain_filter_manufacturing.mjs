// ============================================================
// applyDomainFilter 회귀 테스트 — 제조원가 확장 (PR 후속)
// ------------------------------------------------------------
// 배경:
//   기존 applyDomainFilter 는 bw_profitability_data 참조 SQL 에만
//   DIVISION 필터를 자동 주입했다. PR #419/#421 로 sys_aimd_cot015
//   와 sys_aimd_cot043 에도 DIVISION 컬럼이 추가되면서, 상단 PS/HL
//   선택 시에도 두 제조원가 테이블에는 필터가 걸리지 않는 문제가 있었다.
//
//   본 PR 은 DIVISION_ENABLED_TABLES_RE 를 도입하여 3개 테이블
//   (bw_profitability_data, sys_aimd_cot015, sys_aimd_cot043) 을
//   whitelist 로 확장했다.
//
// 이 테스트는 요구사항 #8 회귀 케이스 A~D 를 커버한다:
//   Case A: cot015 + PS → DIVISION='10'
//   Case B: cot015 + HL → DIVISION='20'
//   Case C: cot043 + PS → DIVISION='10'
//   Case D: 명확화 재요청 흐름 (scrubDivisionFilter → applyDomainFilter) 유지
//
// 그리고 기존 bw_profitability_data 동작 회귀 방지 및
// 통합(MGMT) 모드 no-op, 이미 DIVISION 조건 있을 때 중복 미주입 등을 검증한다.
// ============================================================

import { readFileSync } from 'node:fs';

const serverPath = '/home/user/webapp/nlq-server/server.mjs';
const src = readFileSync(serverPath, 'utf8');

// ── 함수 추출 유틸: 중괄호 뎁스로 함수 본문 슬라이스 ──
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

// DIVISION_ENABLED_TABLES_RE 상수 (server.mjs 에 정의되어 있음)
const reMatch = src.match(/const\s+DIVISION_ENABLED_TABLES_RE\s*=\s*(\/[^;\n]+;)/);
if (!reMatch) throw new Error('DIVISION_ENABLED_TABLES_RE 상수 정의를 찾지 못함');
const enabledReSrc = reMatch[1].replace(/;$/, '');

// 두 함수 본문 추출
const scrubSrc  = extractFunctionSource(src, 'function scrubDivisionFilter(inputSql) {');
const applySrc  = extractFunctionSource(src, 'function applyDomainFilter(inputSql, domainCodeOrCodes) {');

// eval 로 globalThis 에 노출
const bootstrap = `
  const DIVISION_ENABLED_TABLES_RE = ${enabledReSrc};
  ${scrubSrc.replace('function scrubDivisionFilter(inputSql) {', 'globalThis.scrubDivisionFilter = function(inputSql) {')}
  ${applySrc.replace('function applyDomainFilter(inputSql, domainCodeOrCodes) {', 'globalThis.applyDomainFilter = function(inputSql, domainCodeOrCodes) {')}
`;
eval(bootstrap);
const applyDomainFilter    = globalThis.applyDomainFilter;
const scrubDivisionFilter  = globalThis.scrubDivisionFilter;

// ── 로그 노이즈 억제 ──
const origLog = console.log;
console.log = () => {};

// ── 테스트 러너 ──
let passed = 0;
let failed = 0;
const failures = [];

function assertContains(label, sql, needle) {
  if (sql.includes(needle)) {
    passed++;
    origLog(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, expect: `SQL 이 '${needle}' 를 포함해야 함`, got: sql });
    origLog(`  ✗ ${label}`);
    origLog(`      expected contains: ${needle}`);
    origLog(`      got: ${sql}`);
  }
}
function assertNotContains(label, sql, needle) {
  if (!sql.includes(needle)) {
    passed++;
    origLog(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, expect: `SQL 이 '${needle}' 를 포함하지 않아야 함`, got: sql });
    origLog(`  ✗ ${label}`);
    origLog(`      expected NOT contains: ${needle}`);
    origLog(`      got: ${sql}`);
  }
}
function assertEqual(label, actual, expected) {
  if (actual === expected) {
    passed++;
    origLog(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, expect: expected, got: actual });
    origLog(`  ✗ ${label}`);
    origLog(`      expected: ${expected}`);
    origLog(`      got:      ${actual}`);
  }
}

// ============================================================
// [요구사항 #8 Case A] targetTable=sys_aimd_cot015, selectedDivision=PS
//   → SQL 에 DIVISION = '10' 이 포함되어야 함
// ============================================================
origLog('\n[Case A] sys_aimd_cot015 + PS → DIVISION = \'10\'');
{
  const input = `
    SELECT MATERIAL AS '제품코드',
           MAX(MATERIAL_NM) AS '제품명',
           SUM(KST012) AS '인건비 합계(원)'
    FROM sys_aimd_cot015
    WHERE CALMONTH = '202607'
    GROUP BY MATERIAL
    ORDER BY SUM(KST012) DESC
  `.trim();
  const out = applyDomainFilter(input, 'PS');
  assertContains('Case A: DIVISION = \'10\' 자동 주입', out, "DIVISION = '10'");
  assertContains('Case A: 기존 CALMONTH 조건 보존', out, "CALMONTH = '202607'");
  assertContains('Case A: sys_aimd_cot015 참조 유지', out, 'sys_aimd_cot015');
  assertContains('Case A: GROUP BY 순서 유지', out, 'GROUP BY MATERIAL');
}

// ============================================================
// [요구사항 #8 Case B] targetTable=sys_aimd_cot015, selectedDivision=HL
//   → SQL 에 DIVISION = '20' 이 포함되어야 함
// ============================================================
origLog('\n[Case B] sys_aimd_cot015 + HL → DIVISION = \'20\'');
{
  const input = `SELECT SUM(KST002) FROM sys_aimd_cot015 WHERE CALMONTH = '202607'`;
  const out = applyDomainFilter(input, 'HL');
  assertContains('Case B: DIVISION = \'20\' 자동 주입', out, "DIVISION = '20'");
  assertContains('Case B: sys_aimd_cot015 참조 유지', out, 'sys_aimd_cot015');
  assertNotContains('Case B: DIVISION = \'10\' 은 들어가지 않음', out, "DIVISION = '10'");
}

// ============================================================
// [요구사항 #8 Case C] targetTable=sys_aimd_cot043, selectedDivision=PS
//   → SQL 에 DIVISION = '10' 이 포함되어야 함
// ============================================================
origLog('\n[Case C] sys_aimd_cot043 + PS → DIVISION = \'10\'');
{
  const input = `
    SELECT COSTELMNT, COSTELMNT_NM, SUM(AMOUNT)
    FROM sys_aimd_cot043
    WHERE CALMONTH = '202607'
    GROUP BY COSTELMNT, COSTELMNT_NM
  `.trim();
  const out = applyDomainFilter(input, 'PS');
  assertContains('Case C: DIVISION = \'10\' 자동 주입', out, "DIVISION = '10'");
  assertContains('Case C: sys_aimd_cot043 참조 유지', out, 'sys_aimd_cot043');
}

// ============================================================
// [요구사항 #8 Case D] 명확화 재요청 흐름
//   시나리오: 최초 요청에서 DIVISION='10' 이 주입된 SQL 이 이력에 남고,
//             명확화 후 재생성 흐름에서 scrubDivisionFilter → applyDomainFilter
//             재실행 시 새 도메인 코드로 재주입되어야 한다.
// ============================================================
origLog('\n[Case D] 명확화 재요청 — scrubDivisionFilter → applyDomainFilter 재적용');
{
  // 최초 SQL (이미 DIVISION='10' 이 들어있음)
  const priorSql = `SELECT SUM(KST012) FROM sys_aimd_cot015 WHERE DIVISION = '10' AND CALMONTH = '202607'`;

  // (1) 명확화 재요청 시 도메인 유지 (동일 PS): 중복 주입 안 되어야 함
  const rerunSame = applyDomainFilter(priorSql, 'PS');
  assertEqual('Case D-1: 동일 도메인 재적용 시 원본 그대로 (중복 방지)', rerunSame, priorSql);

  // (2) 도메인 변경 (PS → HL) 시나리오 — scrubDivisionFilter 로 먼저 제거 후 applyDomainFilter
  const scrubbed = scrubDivisionFilter(priorSql);
  assertNotContains('Case D-2a: scrub 후 DIVISION = \'10\' 제거됨', scrubbed, "DIVISION = '10'");
  const rerunHL = applyDomainFilter(scrubbed, 'HL');
  assertContains('Case D-2b: scrub 후 HL 적용 → DIVISION = \'20\' 주입', rerunHL, "DIVISION = '20'");
  assertNotContains('Case D-2c: HL 재적용 후 \'10\' 잔재 없음', rerunHL, "DIVISION = '10'");
}

// ============================================================
// [회귀 방지] bw_profitability_data 기존 동작 유지
// ============================================================
origLog('\n[회귀 A] bw_profitability_data + PS 기존 동작 보존');
{
  const input = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH = '202607'`;
  const out = applyDomainFilter(input, 'PS');
  assertContains('회귀 A: bw_profitability_data + PS → DIVISION = \'10\'', out, "DIVISION = '10'");
  assertContains('회귀 A: bw_profitability_data 참조 유지', out, 'bw_profitability_data');
}

origLog('\n[회귀 B] bw_profitability_data + HL 기존 동작 보존');
{
  const input = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH = '202607'`;
  const out = applyDomainFilter(input, 'HL');
  assertContains('회귀 B: bw_profitability_data + HL → DIVISION = \'20\'', out, "DIVISION = '20'");
}

origLog('\n[회귀 C] bw_profitability_data + [PS,HL] 배열 → IN 절');
{
  const input = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH = '202607'`;
  const out = applyDomainFilter(input, ['PS', 'HL']);
  assertContains('회귀 C: DIVISION IN (\'10\',\'20\') 자동 주입', out, "DIVISION IN ('10','20')");
}

// ============================================================
// [정책 준수] 통합(MGMT) 또는 null 도메인 → no-op
// ============================================================
origLog('\n[정책] 통합/MGMT/null 도메인 → no-op');
{
  const sql1 = `SELECT SUM(KST012) FROM sys_aimd_cot015 WHERE CALMONTH = '202607'`;
  assertEqual('정책 1: MGMT → SQL 변경 없음', applyDomainFilter(sql1, 'MGMT'), sql1);
  assertEqual('정책 2: null → SQL 변경 없음', applyDomainFilter(sql1, null), sql1);
  assertEqual('정책 3: 빈 문자열 → SQL 변경 없음', applyDomainFilter(sql1, ''), sql1);
  assertEqual('정책 4: 빈 배열 → SQL 변경 없음', applyDomainFilter(sql1, []), sql1);
  assertEqual('정책 5: 알 수 없는 코드 → SQL 변경 없음', applyDomainFilter(sql1, 'UNKNOWN'), sql1);
}

// ============================================================
// [정책 준수] DIVISION 없는 다른 테이블 → no-op
// ============================================================
origLog('\n[정책] DIVISION 컬럼 없는 테이블은 자동 주입 대상 아님');
{
  // sys_aimd_login_log, batch_jobs 등 DIVISION 이 없는 임의 테이블
  const otherTableSql = `SELECT COUNT(*) FROM sys_aimd_login_log WHERE user_id = 'abc'`;
  assertEqual('정책 6: 미지원 테이블 → 원본 그대로', applyDomainFilter(otherTableSql, 'PS'), otherTableSql);
  const batchSql = `SELECT * FROM batch_jobs WHERE status = 'running'`;
  assertEqual('정책 7: batch_jobs → 원본 그대로', applyDomainFilter(batchSql, 'PS'), batchSql);
}

// ============================================================
// [중복 방지] 이미 DIVISION 조건이 있으면 재주입 안 함
// ============================================================
origLog('\n[중복 방지] 이미 DIVISION 조건이 있는 경우');
{
  const sqlWithDiv = `SELECT SUM(KST012) FROM sys_aimd_cot015 WHERE DIVISION = '10' AND CALMONTH = '202607'`;
  assertEqual('중복 방지 1: 이미 = 10 있으면 그대로', applyDomainFilter(sqlWithDiv, 'PS'), sqlWithDiv);
  const sqlWithIn = `SELECT SUM(KST012) FROM sys_aimd_cot015 WHERE DIVISION IN ('10','20') AND CALMONTH = '202607'`;
  assertEqual('중복 방지 2: 이미 IN 있으면 그대로', applyDomainFilter(sqlWithIn, ['PS','HL']), sqlWithIn);
}

// ============================================================
// [WHERE 없음] WHERE 절이 없는 SQL 에도 정확히 삽입
// ============================================================
origLog('\n[WHERE 없음] FROM 다음에 WHERE 절 신규 삽입');
{
  const input1 = `SELECT * FROM sys_aimd_cot015`;
  const out1 = applyDomainFilter(input1, 'PS');
  assertContains('WHERE 없음 1: sys_aimd_cot015 뒤에 WHERE 신설', out1, "WHERE DIVISION = '10'");

  const input2 = `SELECT COSTELMNT, SUM(AMOUNT) FROM sys_aimd_cot043 GROUP BY COSTELMNT`;
  const out2 = applyDomainFilter(input2, 'HL');
  assertContains('WHERE 없음 2: GROUP BY 앞에 WHERE 삽입', out2, "WHERE DIVISION = '20'");
  assertContains('WHERE 없음 2: GROUP BY 유지', out2, 'GROUP BY COSTELMNT');
}

// ============================================================
// 결과
// ============================================================
console.log = origLog;
console.log(`\n${'='.repeat(60)}`);
console.log(`테스트 결과: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
if (failed > 0) {
  console.log('\n실패한 케이스:');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
    console.log(`      expected: ${f.expect}`);
    console.log(`      got:      ${f.got}`);
  }
  process.exit(1);
}
process.exit(0);
