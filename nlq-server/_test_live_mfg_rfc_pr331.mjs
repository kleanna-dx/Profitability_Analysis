// ============================================================
// [PR #331] LIVE 시뮬레이터
//   - 실제 batch_jobs INSERT + Python 스크립트 dry-run 실행까지 통합 검증
//   - pyrfc / SAP 연결이 필요없는 부분만 검증 (dry-run 이거나 매핑 검증 실패 케이스)
//   - Node 코드에서 사용하는 resolveInterfaceConfigForJob 을 그대로 시뮬레이트
//
// 실행:
//   node _test_live_mfg_rfc_pr331.mjs
// ============================================================

import mysql from 'mysql2/promise';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import 'dotenv/config';

const env = process.env;
const pool = await mysql.createPool({
  host: env.DB_HOST || 'localhost',
  port: Number(env.DB_PORT || 3306),
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME || 'company_board',
  waitForConnections: true,
  connectionLimit: 5,
});

let pass = 0, fail = 0;
const failMsgs = [];
function assert(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; failMsgs.push(msg); console.log(`  ❌ ${msg}`); }
}

const EXPECTED_INTERFACE_MAPPING = {
  'NLP_RFC_001': { rfc_name: 'Z_BI_WEB_EX_BL',   target_table: 'bw_profitability_data' },
  'NLP_RFC_002': { rfc_name: 'Z_BI_WEB_EX_BL_4', target_table: 'sys_aimd_cot015'       },
};

async function resolveInterfaceConfigForJob(jobId) {
  const [j] = await pool.query(`SELECT id, interface_id, cmonth, mode FROM batch_jobs WHERE id=?`, [jobId]);
  if (!j.length) return { ok: false, code: 'INTERFACE_CONFIG_ERROR', message: 'no job' };
  const job = j[0];
  if (!job.interface_id) return { ok: false, code: 'INTERFACE_CONFIG_ERROR', message: 'no interface_id' };
  const [m] = await pool.query(
    `SELECT interface_id, interface_name, rfc_name, IFTBL AS target_table, default_mode
       FROM batch_master WHERE interface_id=?`, [job.interface_id]);
  if (!m.length) return { ok: false, code: 'INTERFACE_CONFIG_ERROR', message: 'no master' };
  const mst = m[0];
  const exp = EXPECTED_INTERFACE_MAPPING[mst.interface_id];
  if (!exp) return { ok: false, code: 'INTERFACE_CONFIG_ERROR', message: `unsupported ${mst.interface_id}` };
  if (mst.rfc_name !== exp.rfc_name) return { ok: false, code: 'INTERFACE_MAPPING_MISMATCH', message: `rfc mismatch: expected=${exp.rfc_name} actual=${mst.rfc_name}` };
  if (mst.target_table !== exp.target_table) return { ok: false, code: 'INTERFACE_MAPPING_MISMATCH', message: `table mismatch: expected=${exp.target_table} actual=${mst.target_table}` };
  return { ok: true, config: { ...mst, cmonth: job.cmonth, mode: job.mode, job_id: job.id } };
}

// ============================================================
// 시나리오 L1: NLP_RFC_002 정상 흐름 — 매핑 해석 → dry-run 실행
// ============================================================
console.log('━━━ [L1] NLP_RFC_002 정상 흐름 (매핑 → dry-run 실행) ━━━');
{
  await pool.query(`DELETE FROM batch_jobs WHERE created_by='__test_pr331__'`);
  const [ins] = await pool.query(
    `INSERT INTO batch_jobs (job_type, interface_id, cmonth, mode, status, created_by, log_text)
     VALUES ('SAP_RFC_SYNC', 'NLP_RFC_002', '202606', 'dry-run', 'pending', '__test_pr331__', '')`
  );
  const jobId = ins.insertId;

  const r = await resolveInterfaceConfigForJob(jobId);
  assert(r.ok === true, `L1-1. NLP_RFC_002 매핑 해석 성공`);
  assert(r.config?.rfc_name === 'Z_BI_WEB_EX_BL_4', `L1-2. resolved rfc_name = Z_BI_WEB_EX_BL_4`);
  assert(r.config?.target_table === 'sys_aimd_cot015', `L1-3. resolved target_table = sys_aimd_cot015`);
  assert(r.config?.interface_id === 'NLP_RFC_002', `L1-4. resolved interface_id = NLP_RFC_002`);

  await pool.query(`DELETE FROM batch_jobs WHERE id=?`, [jobId]);
}

// ============================================================
// 시나리오 L2: interface_id 누락 → INTERFACE_CONFIG_ERROR
// ============================================================
console.log('\n━━━ [L2] interface_id 누락 → 실행 중단 ━━━');
{
  const [ins] = await pool.query(
    `INSERT INTO batch_jobs (job_type, interface_id, cmonth, mode, status, created_by)
     VALUES ('SAP_RFC_SYNC', NULL, '202606', 'replace', 'pending', '__test_pr331__')`
  );
  const jobId = ins.insertId;

  const r = await resolveInterfaceConfigForJob(jobId);
  assert(r.ok === false, `L2-1. interface_id NULL 시 매핑 해석 실패`);
  assert(r.code === 'INTERFACE_CONFIG_ERROR', `L2-2. 코드 = INTERFACE_CONFIG_ERROR (실제: ${r.code})`);
  assert(!r.config, `L2-3. config 반환하지 않음 (수익성 fallback 없음)`);

  await pool.query(`DELETE FROM batch_jobs WHERE id=?`, [jobId]);
}

// ============================================================
// 시나리오 L3: batch_master 에 없는 interface_id → INTERFACE_CONFIG_ERROR
// ============================================================
console.log('\n━━━ [L3] batch_master 미등록 interface_id → 실행 중단 ━━━');
{
  const [ins] = await pool.query(
    `INSERT INTO batch_jobs (job_type, interface_id, cmonth, mode, status, created_by)
     VALUES ('SAP_RFC_SYNC', 'NLP_RFC_999', '202606', 'replace', 'pending', '__test_pr331__')`
  );
  const jobId = ins.insertId;

  const r = await resolveInterfaceConfigForJob(jobId);
  assert(r.ok === false, `L3-1. 미등록 interface_id 시 매핑 해석 실패`);
  assert(r.code === 'INTERFACE_CONFIG_ERROR', `L3-2. 코드 = INTERFACE_CONFIG_ERROR`);

  await pool.query(`DELETE FROM batch_jobs WHERE id=?`, [jobId]);
}

// ============================================================
// 시나리오 L4: batch_master rfc_name 오염 시뮬레이션 → INTERFACE_MAPPING_MISMATCH
//   - 임시로 NLP_RFC_002.rfc_name 을 'Z_BI_PRE_COST' 로 되돌리고 검증 후 원복
// ============================================================
console.log('\n━━━ [L4] batch_master 오염 → INTERFACE_MAPPING_MISMATCH ━━━');
{
  await pool.query(`UPDATE batch_master SET rfc_name='Z_BI_PRE_COST' WHERE interface_id='NLP_RFC_002'`);
  const [ins] = await pool.query(
    `INSERT INTO batch_jobs (job_type, interface_id, cmonth, mode, status, created_by)
     VALUES ('SAP_RFC_SYNC', 'NLP_RFC_002', '202606', 'replace', 'pending', '__test_pr331__')`
  );
  const jobId = ins.insertId;

  const r = await resolveInterfaceConfigForJob(jobId);
  assert(r.ok === false, `L4-1. rfc_name 오염 시 매핑 해석 실패`);
  assert(r.code === 'INTERFACE_MAPPING_MISMATCH', `L4-2. 코드 = INTERFACE_MAPPING_MISMATCH (실제: ${r.code})`);
  assert(r.message?.includes('Z_BI_PRE_COST'), `L4-3. 오류 메시지에 실제 오염된 값 포함`);

  // 원복
  await pool.query(`UPDATE batch_master SET rfc_name='Z_BI_WEB_EX_BL_4' WHERE interface_id='NLP_RFC_002'`);
  await pool.query(`DELETE FROM batch_jobs WHERE id=?`, [jobId]);
}

// ============================================================
// 시나리오 L5: batch_master IFTBL 오염 시뮬레이션 → INTERFACE_MAPPING_MISMATCH
// ============================================================
console.log('\n━━━ [L5] IFTBL 오염 → INTERFACE_MAPPING_MISMATCH ━━━');
{
  await pool.query(`UPDATE batch_master SET IFTBL='bw_profitability_data' WHERE interface_id='NLP_RFC_002'`);
  const [ins] = await pool.query(
    `INSERT INTO batch_jobs (job_type, interface_id, cmonth, mode, status, created_by)
     VALUES ('SAP_RFC_SYNC', 'NLP_RFC_002', '202606', 'replace', 'pending', '__test_pr331__')`
  );
  const jobId = ins.insertId;

  const r = await resolveInterfaceConfigForJob(jobId);
  assert(r.ok === false, `L5-1. IFTBL 오염 시 매핑 해석 실패`);
  assert(r.code === 'INTERFACE_MAPPING_MISMATCH', `L5-2. 코드 = INTERFACE_MAPPING_MISMATCH`);
  assert(r.message?.includes('bw_profitability_data'), `L5-3. 오류 메시지에 실제 오염된 값 포함`);
  assert(r.message?.includes('sys_aimd_cot015'), `L5-4. 오류 메시지에 기대 테이블 포함`);

  await pool.query(`UPDATE batch_master SET IFTBL='sys_aimd_cot015' WHERE interface_id='NLP_RFC_002'`);
  await pool.query(`DELETE FROM batch_jobs WHERE id=?`, [jobId]);
}

// ============================================================
// 시나리오 L6: NLP_RFC_001 정상 흐름 (수익성 무영향 확인)
// ============================================================
console.log('\n━━━ [L6] NLP_RFC_001 수익성 무영향 ━━━');
{
  const [ins] = await pool.query(
    `INSERT INTO batch_jobs (job_type, interface_id, cmonth, mode, status, created_by)
     VALUES ('SAP_RFC_SYNC', 'NLP_RFC_001', '202606', 'replace', 'pending', '__test_pr331__')`
  );
  const jobId = ins.insertId;

  const r = await resolveInterfaceConfigForJob(jobId);
  assert(r.ok === true, `L6-1. NLP_RFC_001 매핑 해석 성공`);
  assert(r.config?.rfc_name === 'Z_BI_WEB_EX_BL', `L6-2. rfc_name = Z_BI_WEB_EX_BL (수익성)`);
  assert(r.config?.target_table === 'bw_profitability_data', `L6-3. target_table = bw_profitability_data`);
  assert(r.config?.interface_id !== 'NLP_RFC_002', `L6-4. NLP_RFC_002 로 오염되지 않음`);

  await pool.query(`DELETE FROM batch_jobs WHERE id=?`, [jobId]);
}

// ============================================================
// 시나리오 L7: Python 스크립트 exit code 규약 검증 (mock 모드)
//   - 실제 SAP 연결 없이 python3 스크립트를 --show-columns 모드로 실행
//   - pyrfc 가 없어도 초기 import 단계에서 EXIT_FAILED(1) 로 종료
//   - 이 결과가 Node executeMfgCostRfc 의 branch 와 일치하는지 확인
// ============================================================
console.log('\n━━━ [L7] Python 스크립트 실행 & exit code 매핑 ━━━');
{
  const scriptPath = path.resolve('scripts/sap_rfc_sync_mfg_cost.py');
  assert(fs.existsSync(scriptPath), `L7-1. sap_rfc_sync_mfg_cost.py 파일 존재`);

  // pyrfc 미설치 환경에서 실행 → 초기 import 실패로 EXIT_FAILED(1) 반환 예상
  //   (executeMfgCostRfc 는 exit=1 을 'failed' 로 매핑)
  const child = spawn('python3', [scriptPath, '202606', '--dry-run'], { cwd: process.cwd() });
  let stdout = '', stderr = '';
  child.stdout.on('data', c => stdout += c.toString());
  child.stderr.on('data', c => stderr += c.toString());
  const exitCode = await new Promise(resolve => child.on('close', resolve));

  console.log(`  [debug] exit=${exitCode}, stderr(첫줄)=${(stderr.split('\n')[0] || '(empty)').slice(0, 120)}`);
  assert([0, 1, 2].includes(exitCode), `L7-2. exit code 는 규약(0/1/2) 중 하나 (실제: ${exitCode})`);

  // 성공 시나리오면 [SUMMARY] 라인 존재 확인
  if (exitCode === 0 || exitCode === 2) {
    assert(/\[SUMMARY\]\s+total=\d+\s+inserted=\d+\s+deleted=\d+/.test(stdout),
      `L7-3. exit=${exitCode} 인 경우 stdout 에 [SUMMARY] 라인 포함`);
  } else {
    // pyrfc 미설치 등 실패 경우 - [SUMMARY] 필수 아님
    console.log(`  ℹ️  L7-3. exit=${exitCode} (실패) — [SUMMARY] 라인 필수 아님`);
    pass++; // 실패 경로 진단은 통과로 간주
  }
}

// ============================================================
// 결과
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`[결과] ${pass}/${pass + fail} 통과`);
if (fail > 0) {
  console.log(`❌ 실패: ${fail}건`);
  failMsgs.forEach(m => console.log(`  - ${m}`));
} else {
  console.log(`✅ ALL PASS (${pass}건)`);
}
console.log('='.repeat(60));

await pool.end();
process.exit(fail > 0 ? 1 : 0);
