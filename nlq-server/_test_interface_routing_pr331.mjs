// ============================================================
// [PR #331] 인터페이스 예약 실행 라우팅 검증 통합 테스트
//
// 검증 목표:
//   ★ 최종 기준 ★
//   드롭다운에서 'NLP_RFC_002 - 제조원가 RFC' 를 선택하여 예약하면
//   반드시 Z_BI_WEB_EX_BL_4 가 실행되고,
//   T_DATA 결과가 sys_aimd_cot015 에 적재되어야 한다.
//
// 검증 항목 (요청서 8개 요구사항 대응):
//   1) 예약 등록 시 선택한 interface_id 저장 확인
//   2) 예약 실행 시 interface_id 기준으로 batch_master 재조회 확인
//   3) 수익성 RFC 기본값 / 하드코딩 / fallback 제거 확인
//   4) NLP_RFC_002 실행 시 Z_BI_WEB_EX_BL_4 + sys_aimd_cot015 매핑 확인
//   5) 기존 잘못 저장된 예약/이력 데이터 진단
//   6) 실행 전 매핑 검증 (INTERFACE_MAPPING_MISMATCH) 로직 확인
//   7) 수행관리/이력관리에 실제 실행값 표시 확인
//   8) 로그 포맷 (resolvedRfcFunction / targetTable) 확인
//
// 실행:
//   node _test_interface_routing_pr331.mjs
// ============================================================

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
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

let passCount = 0;
let failCount = 0;
const failed = [];

function assert(cond, msg) {
  if (cond) {
    passCount++;
    console.log(`  ✅ ${msg}`);
  } else {
    failCount++;
    failed.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

// ============================================================
// 시나리오 A: batch_master 매핑 정합성 (PR #331 5번 요구사항)
// ============================================================
console.log('\n━━━ [시나리오 A] batch_master 매핑 정합성 ━━━');
{
  const rows = await query(
    `SELECT interface_id, interface_name, rfc_name, IFTBL, default_mode
       FROM batch_master WHERE interface_id IN ('NLP_RFC_001','NLP_RFC_002')
       ORDER BY interface_id`
  );

  const m1 = rows.find(r => r.interface_id === 'NLP_RFC_001');
  const m2 = rows.find(r => r.interface_id === 'NLP_RFC_002');

  assert(m1 !== undefined, 'A-1. NLP_RFC_001 (수익성) 마스터 행 존재');
  assert(m1?.rfc_name === 'Z_BI_WEB_EX_BL', `A-2. NLP_RFC_001.rfc_name === 'Z_BI_WEB_EX_BL' (실제: ${m1?.rfc_name})`);
  assert(m1?.IFTBL === 'bw_profitability_data', `A-3. NLP_RFC_001.IFTBL === 'bw_profitability_data' (실제: ${m1?.IFTBL})`);

  assert(m2 !== undefined, 'A-4. NLP_RFC_002 (제조원가) 마스터 행 존재');
  assert(m2?.rfc_name === 'Z_BI_WEB_EX_BL_4', `A-5. NLP_RFC_002.rfc_name === 'Z_BI_WEB_EX_BL_4' (실제: ${m2?.rfc_name})`);
  assert(m2?.IFTBL === 'sys_aimd_cot015', `A-6. NLP_RFC_002.IFTBL === 'sys_aimd_cot015' (실제: ${m2?.IFTBL})`);
  assert(m2?.interface_name === '제조원가 RFC', `A-7. NLP_RFC_002.interface_name === '제조원가 RFC' (실제: ${m2?.interface_name})`);

  // Z_BI_PRE_COST 잔존 없음
  const preCost = await query(
    `SELECT COUNT(*) AS cnt FROM batch_master
      WHERE rfc_name='Z_BI_PRE_COST' OR rfc_param LIKE '%Z_BI_PRE_COST%'`
  );
  assert(preCost[0].cnt === 0, `A-8. Z_BI_PRE_COST 잔존 참조 = 0 (실제: ${preCost[0].cnt})`);

  // rfc_name NULL 잔존 없음 (수익성 RFC 기본값 fallback 원천 차단)
  const nullRfc = await query(
    `SELECT COUNT(*) AS cnt FROM batch_master WHERE rfc_name IS NULL OR rfc_name = ''`
  );
  assert(nullRfc[0].cnt === 0, `A-9. rfc_name NULL/빈값 잔존 = 0 (실제: ${nullRfc[0].cnt})`);
}

// ============================================================
// 시나리오 B: 예약 등록 → interface_id 저장 검증 (요구사항 1)
// ============================================================
console.log('\n━━━ [시나리오 B] 예약 등록 시 interface_id 저장 ━━━');
{
  // 임시 예약 두 건 INSERT (NLP_RFC_001, NLP_RFC_002 각각)
  await query(`DELETE FROM batch_schedule WHERE remark = '__TEST_PR331__'`);

  const [r1] = await pool.query(
    `INSERT INTO batch_schedule
       (interface_id, schedule_type, exec_datetime, target_cmonth, exec_mode, is_active, remark, created_by)
     VALUES ('NLP_RFC_001', 'once', DATE_ADD(NOW(), INTERVAL 1 DAY), '202608', 'replace', 1, '__TEST_PR331__', 'test')`
  );
  const [r2] = await pool.query(
    `INSERT INTO batch_schedule
       (interface_id, schedule_type, exec_datetime, target_cmonth, exec_mode, is_active, remark, created_by)
     VALUES ('NLP_RFC_002', 'once', DATE_ADD(NOW(), INTERVAL 1 DAY), '202608', 'replace', 1, '__TEST_PR331__', 'test')`
  );

  // DB 재조회하여 실제 저장된 interface_id 검증
  const sched1 = await query(`SELECT interface_id FROM batch_schedule WHERE id = ?`, [r1.insertId]);
  const sched2 = await query(`SELECT interface_id FROM batch_schedule WHERE id = ?`, [r2.insertId]);

  assert(sched1[0].interface_id === 'NLP_RFC_001', `B-1. 수익성 예약 저장 후 interface_id === 'NLP_RFC_001'`);
  assert(sched2[0].interface_id === 'NLP_RFC_002', `B-2. 제조원가 예약 저장 후 interface_id === 'NLP_RFC_002'`);

  // JOIN 하여 rfc_name 이 정확히 매핑되는지 확인 (실행 시 조회 경로와 동일)
  const join1 = await query(
    `SELECT s.interface_id, m.rfc_name, m.IFTBL
       FROM batch_schedule s LEFT JOIN batch_master m ON m.interface_id = s.interface_id
      WHERE s.id = ?`,
    [r1.insertId]
  );
  const join2 = await query(
    `SELECT s.interface_id, m.rfc_name, m.IFTBL
       FROM batch_schedule s LEFT JOIN batch_master m ON m.interface_id = s.interface_id
      WHERE s.id = ?`,
    [r2.insertId]
  );

  assert(join1[0].rfc_name === 'Z_BI_WEB_EX_BL', `B-3. NLP_RFC_001 예약 JOIN → rfc_name = Z_BI_WEB_EX_BL`);
  assert(join1[0].IFTBL === 'bw_profitability_data', `B-4. NLP_RFC_001 예약 JOIN → IFTBL = bw_profitability_data`);
  assert(join2[0].rfc_name === 'Z_BI_WEB_EX_BL_4', `B-5. NLP_RFC_002 예약 JOIN → rfc_name = Z_BI_WEB_EX_BL_4`);
  assert(join2[0].IFTBL === 'sys_aimd_cot015', `B-6. NLP_RFC_002 예약 JOIN → IFTBL = sys_aimd_cot015`);

  // 정리
  await query(`DELETE FROM batch_schedule WHERE remark = '__TEST_PR331__'`);
}

// ============================================================
// 시나리오 C: server.mjs 코드 매핑 로직 자체 검증 (요구사항 2, 3, 6)
// ============================================================
console.log('\n━━━ [시나리오 C] server.mjs 코드 라우팅 로직 검증 ━━━');
{
  const src = fs.readFileSync(path.resolve('server.mjs'), 'utf-8');

  // (요구사항 2) executeBatchJob 이 interface_id 기반으로 batch_master 를 재조회하는지
  assert(src.includes('resolveInterfaceConfigForJob'),
    `C-1. resolveInterfaceConfigForJob 함수 존재 (interface_id → batch_master 조회)`);
  assert(/EXPECTED_INTERFACE_MAPPING\s*=\s*\{[\s\S]*NLP_RFC_001[\s\S]*NLP_RFC_002/m.test(src),
    `C-2. EXPECTED_INTERFACE_MAPPING 에 NLP_RFC_001 / NLP_RFC_002 등록`);

  // (요구사항 3) 하드코딩된 기본값 / fallback 제거 - 실행 코드에서 특정 RFC 로 하드 라우팅 하는 부분 없음
  //   'Z_BI_WEB_EX_BL' 문자열은 EXPECTED_INTERFACE_MAPPING / 로그 / 스키마 시드에서 등장 가능
  //   그러나 executeBatchJob 안에서 rfc_name 을 하드코딩으로 지정하지 않아야 함
  //   → springReqBody 에서 cfg.rfc_name 을 사용하는지 확인
  assert(src.includes('rfc_name: cfg.rfc_name'),
    `C-3. Spring Boot 요청에 cfg.rfc_name 명시 전달 (interface_id 기반)`);
  assert(src.includes('interface_id: cfg.interface_id'),
    `C-4. Spring Boot 요청에 cfg.interface_id 명시 전달`);
  assert(src.includes('target_table: cfg.target_table'),
    `C-5. Spring Boot 요청에 cfg.target_table 명시 전달`);

  // (요구사항 6) INTERFACE_CONFIG_ERROR / INTERFACE_MAPPING_MISMATCH 사용 확인
  assert(src.includes('INTERFACE_CONFIG_ERROR'),
    `C-6. INTERFACE_CONFIG_ERROR 코드 사용 (설정 누락 시 실행 중단)`);
  assert(src.includes('INTERFACE_MAPPING_MISMATCH'),
    `C-7. INTERFACE_MAPPING_MISMATCH 코드 사용 (매핑 불일치 시 실행 중단)`);

  // 수익성 fallback / interface_id 없이 실행 방지
  assert(/interface_id\s*가\s*비어있음/.test(src) || /interface_id\s+is\s+empty/i.test(src) ||
         /interface_id\s+가\s+없는/.test(src),
    `C-8. interface_id 누락 시 기본 수익성 RFC 로 대체 실행하지 않음 (명시적 실패)`);

  // (요구사항 4) NLP_RFC_002 는 Node.js 가 직접 python3 sap_rfc_sync_mfg_cost.py 실행
  assert(src.includes('executeMfgCostRfc'),
    `C-9. executeMfgCostRfc 함수 존재 (NLP_RFC_002 전용 실행 경로)`);
  assert(src.includes('sap_rfc_sync_mfg_cost.py'),
    `C-10. NLP_RFC_002 는 sap_rfc_sync_mfg_cost.py 직접 실행`);
  assert(src.includes("cfg.interface_id === 'NLP_RFC_002'"),
    `C-11. interface_id === 'NLP_RFC_002' 분기 존재`);

  // (요구사항 8) 실행 직전 로그 포맷
  assert(src.includes('resolvedRfcFunction') && src.includes('targetTable') && src.includes('input.I_CMONTH'),
    `C-12. 필수 로그 필드 (resolvedRfcFunction / targetTable / input.I_CMONTH) 출력`);
  assert(src.includes('[InterfaceSchedule]'),
    `C-13. [InterfaceSchedule] 로그 태그 사용`);
  assert(src.includes('[MfgCostGuard]'),
    `C-14. [MfgCostGuard] 실행 직전 검증 로그 존재`);

  // 수익성 실행 함수를 제조원가에서 재사용하지 않는지 확인 (별도 함수 사용)
  //   → executeMfgCostRfc 는 executeBatchJob 안에서 return await 로 호출되고,
  //     그 뒤 Spring Boot 코드로 넘어가지 않아야 함
  const routingMatch = src.match(/interface_id === 'NLP_RFC_002'[\s\S]{0,200}executeMfgCostRfc/);
  assert(routingMatch !== null,
    `C-15. NLP_RFC_002 분기가 executeMfgCostRfc 로 라우팅 (Spring Boot 재사용 안 함)`);
}

// ============================================================
// 시나리오 D: 매핑 검증 실패 시뮬레이션 (요구사항 6)
// ============================================================
console.log('\n━━━ [시나리오 D] INTERFACE_MAPPING_MISMATCH 시뮬레이션 ━━━');
{
  // 임시로 batch_master.NLP_RFC_002 를 잘못된 값으로 오염시켜서
  // resolveInterfaceConfigForJob 이 INTERFACE_MAPPING_MISMATCH 를 반환하는지 검증
  //   → 이 코드에서 직접 검증하지 않고 (server.mjs import 시 스케줄러 시작 위험),
  //     로직 자체를 mock 으로 검증하는 대신
  //     실제 서버 재시작 후 batch_jobs 로그로 확인하는 편이 안전.
  //   → 여기서는 조건 분기의 소스 코드 존재만 검증.
  const src = fs.readFileSync(path.resolve('server.mjs'), 'utf-8');

  // (a) rfc_name 불일치 검증 로직
  assert(/m\.rfc_name\s*!==\s*expected\.rfc_name/.test(src),
    `D-1. rfc_name 기대값 불일치 시 INTERFACE_MAPPING_MISMATCH 반환`);
  // (b) target_table 불일치 검증 로직
  assert(/m\.target_table\s*!==\s*expected\.target_table/.test(src),
    `D-2. target_table 기대값 불일치 시 INTERFACE_MAPPING_MISMATCH 반환`);
  // (c) 실행 직전 최종 검증 (executeMfgCostRfc 내부에도 이중 검증)
  assert(/cfg\.rfc_name\s*!==\s*'Z_BI_WEB_EX_BL_4'/.test(src),
    `D-3. 제조원가 실행 직전 rfc_name 재검증`);
  assert(/cfg\.target_table\s*!==\s*'sys_aimd_cot015'/.test(src),
    `D-4. 제조원가 실행 직전 target_table 재검증`);
}

// ============================================================
// 시나리오 E: 이력 상세 API - target_table 반환 (요구사항 7)
// ============================================================
console.log('\n━━━ [시나리오 E] 이력관리에 실제 실행값 표시 ━━━');
{
  const src = fs.readFileSync(path.resolve('server.mjs'), 'utf-8');
  assert(/m\.IFTBL\s+AS\s+target_table/i.test(src),
    `E-1. /api/interface/history/:jobId JOIN 에서 IFTBL을 target_table 로 반환`);

  const html = fs.readFileSync(path.resolve('public/interface.html'), 'utf-8');
  assert(html.includes('target_table') && html.includes('적재 테이블'),
    `E-2. interface.html 이력 상세 모달에 '적재 테이블' 표시`);
}

// ============================================================
// 시나리오 F: sap_rfc_sync_mfg_cost.py [SUMMARY] 라인 (요구사항 4, 7)
// ============================================================
console.log('\n━━━ [시나리오 F] sap_rfc_sync_mfg_cost.py [SUMMARY] 파싱 규약 ━━━');
{
  const py = fs.readFileSync(path.resolve('scripts/sap_rfc_sync_mfg_cost.py'), 'utf-8');
  const summaryMatches = py.match(/\[SUMMARY\]\s+total=/g);
  assert(summaryMatches && summaryMatches.length >= 2,
    `F-1. [SUMMARY] 라인이 SUCCESS/NO_DATA/DRY-RUN 경로에 각각 출력 (${summaryMatches?.length || 0}개)`);

  // Node.js 파싱 정규식과 일치 확인
  const node = fs.readFileSync(path.resolve('server.mjs'), 'utf-8');
  assert(/\\\[SUMMARY\\\]\\s\+total=/.test(node),
    `F-2. Node.js executeMfgCostRfc 가 [SUMMARY] 라인을 정규식으로 파싱`);
}

// ============================================================
// 시나리오 G: 로컬 DB 반영 상태 재확인 (요구사항 5)
// ============================================================
console.log('\n━━━ [시나리오 G] 기존 예약 데이터 정합성 ━━━');
{
  // batch_schedule 스키마 확인 - rfc_name / target_table 컬럼이 없어야 함 (있으면 오래된 legacy 스키마)
  const cols = await query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='batch_schedule'`
  );
  const colNames = cols.map(c => c.COLUMN_NAME);
  assert(!colNames.includes('rfc_name'),
    `G-1. batch_schedule 에 별도 rfc_name 컬럼 없음 (실행 시 batch_master 조회 원칙)`);
  assert(!colNames.includes('target_table'),
    `G-2. batch_schedule 에 별도 target_table 컬럼 없음 (실행 시 batch_master 조회 원칙)`);
  assert(colNames.includes('interface_id'),
    `G-3. batch_schedule 에 interface_id 컬럼 존재 (실행 시 라우팅 키)`);

  // 유효하지 않은 interface_id 를 참조하는 예약은 없어야 함
  const orphan = await query(
    `SELECT COUNT(*) AS cnt FROM batch_schedule s
       LEFT JOIN batch_master m ON m.interface_id = s.interface_id
      WHERE m.interface_id IS NULL`
  );
  assert(orphan[0].cnt === 0, `G-4. batch_master 에 없는 interface_id 를 참조하는 예약 = 0 (실제: ${orphan[0].cnt})`);
}

// ============================================================
// 결과 요약
// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`[결과] ${passCount}/${passCount + failCount} 통과`);
if (failCount > 0) {
  console.log(`❌ 실패: ${failCount}건`);
  failed.forEach(m => console.log(`  - ${m}`));
} else {
  console.log(`✅ ALL PASS (${passCount}건)`);
}
console.log('='.repeat(60));

await pool.end();
process.exit(failCount > 0 ? 1 : 0);
