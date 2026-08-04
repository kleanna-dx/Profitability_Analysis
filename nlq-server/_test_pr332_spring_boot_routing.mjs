// ============================================================
// [PR #332] 인터페이스 실행 경로 Spring Boot 통일 검증 테스트
//
// 배경:
//   PR #331 은 NLP_RFC_002 를 Node.js → python3 sap_rfc_sync_mfg_cost.py
//   경로로 실행했으나, 운영 Node.js 서버에는 pyrfc / SAP NWRFCSDK 가
//   설치되어 있지 않아 "No module named 'pyrfc'" 로 항상 실패했다.
//   PR #332 에서는 두 인터페이스 모두 Spring Boot(JCo) 로 통일한다.
//
// 검증 목표:
//   ★ 최종 기준 ★
//   드롭다운에서 'NLP_RFC_002 - 제조원가 RFC' 를 선택하여 예약하면
//   반드시 Z_BI_WEB_EX_BL_4 가 실행되고,
//   T_DATA 결과가 sys_aimd_cot015 에 적재되어야 한다.
//   (실제 SAP 적재는 Spring Boot 재배포 후 수행됨)
//
// 검증 항목:
//   [SEC A] server.mjs 에서 Python 우회 코드 완전 제거 확인
//     A1) executeMfgCostRfc 함수가 존재하지 않음
//     A2) NLP_RFC_002 → executeMfgCostRfc 호출 분기가 존재하지 않음
//     A3) sap_rfc_sync_mfg_cost.py 스크립트 spawn 코드가 존재하지 않음
//     A4) pyrfc 관련 실행 코드가 존재하지 않음 (주석은 무시)
//
//   [SEC B] server.mjs 에서 Spring Boot 통합 실행 경로 확인
//     B1) springReqBody 정의가 존재
//     B2) springReqBody 에 interface_id 포함
//     B3) springReqBody 에 rfc_name 포함
//     B4) springReqBody 에 target_table 포함
//     B5) POST /profit-api/sap-rfc/execute 호출 코드가 존재
//     B6) 실행 경로 로그가 "Spring Boot API (JCo — interface_id=...)" 형태
//
//   [SEC C] PR #331 인프라 유지 확인 (회귀 방지)
//     C1) EXPECTED_INTERFACE_MAPPING 상수 유지
//     C2) NLP_RFC_001 → Z_BI_WEB_EX_BL / bw_profitability_data 매핑 유지
//     C3) NLP_RFC_002 → Z_BI_WEB_EX_BL_4 / sys_aimd_cot015 매핑 유지
//     C4) resolveInterfaceConfigForJob 함수 유지
//     C5) INTERFACE_MAPPING_MISMATCH 매핑 검증 로직 유지
//     C6) batch_master 조회 로직 유지 (m.IFTBL AS target_table)
//
//   [SEC D] batch_master 데이터 상태 (PR #331 반영 상태 유지)
//     D1) NLP_RFC_001 rfc_name / IFTBL 정합성
//     D2) NLP_RFC_002 rfc_name / IFTBL 정합성
//
//   [SEC E] 정적 안전 검증
//     E1) server.mjs 문법 오류 없음
//     E2) 삭제된 테스트 파일 참조 없음
//
// 실행:
//   cd nlq-server && node _test_pr332_spring_boot_routing.mjs
// ============================================================

import fs from 'fs';
import { execSync } from 'child_process';
import mysql from 'mysql2/promise';

const DB = {
  host: 'localhost',
  port: 3306,
  user: 'company',
  password: 'company1234!',
  database: 'company_board',
};

let PASS = 0, FAIL = 0;
function assertTrue(cond, name, detail = '') {
  if (cond) {
    PASS++;
    console.log(`  [PASS] ${name}`);
  } else {
    FAIL++;
    console.log(`  [FAIL] ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function assertEq(actual, expected, name) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    PASS++;
    console.log(`  [PASS] ${name}`);
  } else {
    FAIL++;
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

// server.mjs 를 한 번만 읽어서 재사용 (파일이 크므로 라인 배열도 캐시)
const SERVER_MJS_PATH = new URL('./server.mjs', import.meta.url).pathname;
const SERVER_MJS = fs.readFileSync(SERVER_MJS_PATH, 'utf8');
const SERVER_LINES = SERVER_MJS.split('\n');

/**
 * 실행 코드 라인만 추출 (블록 주석 / 라인 주석 제거).
 * 완벽한 파서는 아니지만 이 테스트가 노리는 "함수 호출·spawn·string literal"
 * 은 실행 코드에만 존재하므로 실전 오탐을 대부분 걸러낼 수 있음.
 */
function stripComments(src) {
  // /* ... */ 다중행 주석 제거
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // 각 라인의 '//' 이후 제거 (문자열 안의 '//' 는 소수 오탐 가능하나
  // 실행 코드 검증 목적에는 충분)
  out = out.split('\n').map(line => {
    const idx = line.indexOf('//');
    return idx >= 0 ? line.slice(0, idx) : line;
  }).join('\n');
  return out;
}
const SERVER_CODE_ONLY = stripComments(SERVER_MJS);

// ============================================================
// [SEC A] server.mjs 에서 Python 우회 코드 완전 제거 확인
// ============================================================
console.log('\n[SEC A] Python 우회 경로 제거 검증');

// A1) executeMfgCostRfc 함수가 존재하지 않음
{
  const hasFn = /(?:^|\s)(async\s+)?function\s+executeMfgCostRfc\s*\(/.test(SERVER_CODE_ONLY);
  assertTrue(!hasFn, 'A1) executeMfgCostRfc 함수 선언이 코드에 없음');
}

// A2) NLP_RFC_002 → executeMfgCostRfc 호출 분기가 존재하지 않음
{
  const hasCall = /executeMfgCostRfc\s*\(/.test(SERVER_CODE_ONLY);
  assertTrue(!hasCall, 'A2) executeMfgCostRfc 호출부가 코드에 없음');
}

// A3) sap_rfc_sync_mfg_cost.py 스크립트 spawn 코드 없음
{
  const hasSpawn = /sap_rfc_sync_mfg_cost\.py/.test(SERVER_CODE_ONLY);
  assertTrue(!hasSpawn, 'A3) sap_rfc_sync_mfg_cost.py 스크립트 참조가 코드에 없음');
}

// A4) 실행 코드에 pyrfc / python3 spawn 없음
{
  const hasPyrfc = /pyrfc/i.test(SERVER_CODE_ONLY);
  const hasPython3Spawn = /\bspawn\b[\s\S]{0,80}python3/.test(SERVER_CODE_ONLY);
  assertTrue(!hasPyrfc, 'A4-1) pyrfc 참조가 코드에 없음');
  assertTrue(!hasPython3Spawn, 'A4-2) spawn(python3) 호출이 코드에 없음');
}

// ============================================================
// [SEC B] Spring Boot 통합 실행 경로 확인
// ============================================================
console.log('\n[SEC B] Spring Boot 통합 실행 경로 검증');

// B1) springReqBody 정의 존재
{
  const hasBody = /const\s+springReqBody\s*=/.test(SERVER_CODE_ONLY);
  assertTrue(hasBody, 'B1) springReqBody 정의 존재');
}

// B2~B4) body 필드 확인
{
  // springReqBody 정의 블록만 추출
  const m = SERVER_CODE_ONLY.match(/const\s+springReqBody\s*=\s*\{[\s\S]*?\};/);
  const bodyBlock = m ? m[0] : '';
  assertTrue(/\binterface_id\s*:/.test(bodyBlock), 'B2) springReqBody 에 interface_id 필드 포함');
  assertTrue(/\brfc_name\s*:/.test(bodyBlock),     'B3) springReqBody 에 rfc_name 필드 포함');
  assertTrue(/\btarget_table\s*:/.test(bodyBlock), 'B4) springReqBody 에 target_table 필드 포함');
}

// B5) Spring Boot execute 엔드포인트 호출
{
  const hasApi = /\/profit-api\/sap-rfc\/execute/.test(SERVER_CODE_ONLY);
  assertTrue(hasApi, 'B5) POST /profit-api/sap-rfc/execute 호출 코드 존재');
}

// B6) 실행 경로 로그 문구가 통합 경로임을 명시
{
  // "Spring Boot API (JCo" 포함 (수익성 전용 문구 아님)
  const hasNewLog = /Spring Boot API \(JCo/.test(SERVER_CODE_ONLY);
  const hasOldLog = /Spring Boot API \(수익성분석 전용\)/.test(SERVER_CODE_ONLY);
  assertTrue(hasNewLog,  'B6-1) 실행 경로 로그가 "Spring Boot API (JCo ..." 로 표시');
  assertTrue(!hasOldLog, 'B6-2) 옛 "수익성분석 전용" 로그가 실행 코드에 남아있지 않음');
}

// ============================================================
// [SEC C] PR #331 인프라 유지 확인
// ============================================================
console.log('\n[SEC C] PR #331 라우팅/검증 인프라 유지 검증');

// C1) EXPECTED_INTERFACE_MAPPING 상수 유지
{
  const has = /const\s+EXPECTED_INTERFACE_MAPPING\s*=\s*\{/.test(SERVER_CODE_ONLY);
  assertTrue(has, 'C1) EXPECTED_INTERFACE_MAPPING 상수 존재');
}

// C2~C3) 매핑 값 확인 (서버 코드에 문자열 리터럴로 존재)
{
  const has001 = /'NLP_RFC_001'\s*:\s*\{[^}]*rfc_name\s*:\s*'Z_BI_WEB_EX_BL'/.test(SERVER_CODE_ONLY);
  const has001Tbl = /'NLP_RFC_001'[\s\S]{0,300}bw_profitability_data/.test(SERVER_CODE_ONLY);
  const has002 = /'NLP_RFC_002'\s*:\s*\{[^}]*rfc_name\s*:\s*'Z_BI_WEB_EX_BL_4'/.test(SERVER_CODE_ONLY);
  const has002Tbl = /'NLP_RFC_002'[\s\S]{0,300}sys_aimd_cot015/.test(SERVER_CODE_ONLY);
  assertTrue(has001,    'C2-1) NLP_RFC_001 → Z_BI_WEB_EX_BL 매핑 유지');
  assertTrue(has001Tbl, 'C2-2) NLP_RFC_001 → bw_profitability_data 매핑 유지');
  assertTrue(has002,    'C3-1) NLP_RFC_002 → Z_BI_WEB_EX_BL_4 매핑 유지');
  assertTrue(has002Tbl, 'C3-2) NLP_RFC_002 → sys_aimd_cot015 매핑 유지');
}

// C4) resolveInterfaceConfigForJob 함수 유지
{
  const has = /(?:^|\s)(async\s+)?function\s+resolveInterfaceConfigForJob\s*\(/.test(SERVER_CODE_ONLY);
  assertTrue(has, 'C4) resolveInterfaceConfigForJob 함수 존재');
}

// C5) INTERFACE_MAPPING_MISMATCH 매핑 검증 로직 유지
{
  const has = /INTERFACE_MAPPING_MISMATCH/.test(SERVER_CODE_ONLY);
  assertTrue(has, 'C5) INTERFACE_MAPPING_MISMATCH 검증 코드 유지');
}

// C6) batch_master 조회 로직 유지 (m.IFTBL AS target_table)
{
  const has = /m\.IFTBL\s+AS\s+target_table/i.test(SERVER_CODE_ONLY);
  assertTrue(has, 'C6) batch_master 조회에 IFTBL AS target_table 유지');
}

// ============================================================
// [SEC D] batch_master 데이터 상태 (DB 실전 검증)
// ============================================================
console.log('\n[SEC D] batch_master 데이터 상태 검증 (DB)');
let pool;
try {
  pool = await mysql.createPool(DB);
  const [rows] = await pool.query(
    "SELECT interface_id, interface_name, rfc_name, IFTBL FROM batch_master WHERE interface_id IN ('NLP_RFC_001','NLP_RFC_002') ORDER BY interface_id"
  );
  const byId = Object.fromEntries(rows.map(r => [r.interface_id, r]));
  const r001 = byId['NLP_RFC_001'];
  const r002 = byId['NLP_RFC_002'];

  assertTrue(!!r001, 'D0-1) batch_master 에 NLP_RFC_001 존재');
  assertTrue(!!r002, 'D0-2) batch_master 에 NLP_RFC_002 존재');
  if (r001) {
    assertEq(r001.rfc_name, 'Z_BI_WEB_EX_BL',        'D1-1) NLP_RFC_001.rfc_name = Z_BI_WEB_EX_BL');
    assertEq(r001.IFTBL,    'bw_profitability_data', 'D1-2) NLP_RFC_001.IFTBL = bw_profitability_data');
  }
  if (r002) {
    assertEq(r002.rfc_name, 'Z_BI_WEB_EX_BL_4', 'D2-1) NLP_RFC_002.rfc_name = Z_BI_WEB_EX_BL_4');
    assertEq(r002.IFTBL,    'sys_aimd_cot015',  'D2-2) NLP_RFC_002.IFTBL = sys_aimd_cot015');
  }
} catch (e) {
  // DB 접속 실패는 스킵 (CI 환경 대비) — 회귀 검증 자체는 실패로 기록
  FAIL++;
  console.log(`  [FAIL] SEC D — DB 접속 실패: ${e.message}`);
} finally {
  if (pool) await pool.end();
}

// ============================================================
// [SEC E] 정적 안전 검증
// ============================================================
console.log('\n[SEC E] 정적 안전 검증');

// E1) server.mjs 문법 오류 없음
{
  try {
    execSync(`node --check "${SERVER_MJS_PATH}"`, { stdio: 'pipe' });
    PASS++;
    console.log('  [PASS] E1) server.mjs 문법 오류 없음');
  } catch (e) {
    FAIL++;
    console.log('  [FAIL] E1) server.mjs 문법 오류 발견: ' + e.message.split('\n')[0]);
  }
}

// E2) 삭제된 테스트 파일 참조 없음
{
  const removed = '_test_live_mfg_rfc_pr331.mjs';
  const stillExists = fs.existsSync(new URL('./' + removed, import.meta.url).pathname);
  assertTrue(!stillExists, `E2-1) ${removed} 파일이 실제로 삭제됨`);
  // package.json 등의 참조도 없어야 함 (있으면 삭제 필요)
  const pkgPath = new URL('./package.json', import.meta.url).pathname;
  const pkgHas = fs.existsSync(pkgPath) && fs.readFileSync(pkgPath, 'utf8').includes(removed);
  assertTrue(!pkgHas, `E2-2) package.json 에 ${removed} 참조 없음`);
}

// ============================================================
// 결과 요약
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`RESULT: PASS=${PASS}  FAIL=${FAIL}  TOTAL=${PASS + FAIL}`);
console.log('='.repeat(60));

if (FAIL > 0) {
  process.exit(1);
}
process.exit(0);
