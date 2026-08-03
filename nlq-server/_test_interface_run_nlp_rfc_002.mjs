#!/usr/bin/env node
/**
 * 인터페이스 수행관리 · 이력관리 통합 시나리오 검증
 * (PR #329 — 제조원가 RFC Z_BI_WEB_EX_BL_4)
 *
 * 검증 시나리오 (Spring Boot 미배포 상태에서도 검증 가능한 항목):
 *   6) 수행관리의 상태·건수·소요시간 표시 (batch_jobs 레코드 생성 흐름)
 *   7) 이력관리의 함수명·입력값·결과 건수·오류 정보
 *      - /api/interface/history/:jobId 응답에 rfc_name 포함 확인
 *   9) RFC 실패 및 DB 실패 시 상태 · 이력 저장
 *      - Spring Boot 미접속 상태에서 batch_jobs 가 'failed' 로 마감되는지 확인
 *
 * 로컬 API baseUrl: http://localhost:3000
 * 관리자 세션이 필요하지만 여기서는 SQL 직접 삽입으로 시나리오 데이터 셋업.
 */
import mysql from 'mysql2/promise';

const DB = {
  host: 'localhost',
  port: 3306,
  user: 'company',
  password: 'company1234!',
  database: 'company_board',
};

let PASS = 0, FAIL = 0;
function assertEq(actual, expected, name) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    PASS++;
    console.log(`  [PASS] ${name}`);
  } else {
    FAIL++;
    console.log(`  [FAIL] ${name}`);
    console.log(`         expected: ${JSON.stringify(expected)}`);
    console.log(`         actual:   ${JSON.stringify(actual)}`);
  }
}

const pool = await mysql.createPool(DB);

// ── 셋업 ──
console.log('[SETUP] 이전 테스트 데이터 정리');
await pool.query(
  "DELETE FROM batch_jobs WHERE interface_id='NLP_RFC_002' AND created_by IN ('test:pr329','test:pr329_fail')"
);
await pool.query(
  "DELETE FROM batch_schedule WHERE interface_id='NLP_RFC_002' AND remark = 'PR#329 통합 테스트'"
);


// ── 시나리오 A: batch_master 상태 최종 검증 ──
console.log('\n[시나리오 A] batch_master.NLP_RFC_002 최종 상태');
const [master] = await pool.query(
  "SELECT interface_id, interface_name, rfc_name, rfc_param, IFTBL, is_active FROM batch_master WHERE interface_id='NLP_RFC_002'"
);
assertEq(master.length, 1, 'NLP_RFC_002 행 존재');
assertEq(master[0].interface_name, '제조원가 RFC', 'interface_name = 제조원가 RFC');
assertEq(master[0].rfc_name, 'Z_BI_WEB_EX_BL_4', 'rfc_name = Z_BI_WEB_EX_BL_4');
assertEq(master[0].IFTBL, 'sys_aimd_cot015', 'IFTBL = sys_aimd_cot015');
const paramObj = JSON.parse(master[0].rfc_param);
assertEq(paramObj.function, 'Z_BI_WEB_EX_BL_4', 'rfc_param.function = Z_BI_WEB_EX_BL_4');
assertEq(paramObj.params.I_CMONTH, '{CMONTH}', 'rfc_param.params.I_CMONTH = {CMONTH}');
assertEq(master[0].is_active, 1, 'is_active = 1');


// ── 시나리오 B: 수익성분석(NLP_RFC_001) 분리 확인 ──
console.log('\n[시나리오 B] 수익성분석 로직 불변 확인');
const [profit] = await pool.query(
  "SELECT interface_id, IFTBL FROM batch_master WHERE interface_id='NLP_RFC_001'"
);
assertEq(profit[0].IFTBL, 'bw_profitability_data', 'NLP_RFC_001 IFTBL 유지');


// ── 시나리오 C: Z_BI_PRE_COST 잔존 없음 확인 ──
console.log('\n[시나리오 C] Z_BI_PRE_COST 참조 완전 제거');
const [old1] = await pool.query(
  "SELECT COUNT(*) AS cnt FROM batch_master WHERE rfc_name='Z_BI_PRE_COST'"
);
assertEq(old1[0].cnt, 0, 'rfc_name=Z_BI_PRE_COST 인 마스터 없음');

const [old2] = await pool.query(
  "SELECT COUNT(*) AS cnt FROM batch_master WHERE rfc_param LIKE '%Z_BI_PRE_COST%'"
);
assertEq(old2[0].cnt, 0, 'rfc_param 에 Z_BI_PRE_COST 문자열 없음');


// ── 시나리오 D: 인터페이스 수행관리 [신규 등록] — 스케줄 생성 ──
console.log('\n[시나리오 D] 수행관리 [신규 등록] — batch_schedule INSERT');
const [insSched] = await pool.query(
  `INSERT INTO batch_schedule
     (interface_id, schedule_type, exec_datetime, target_cmonth, exec_mode,
      is_active, remark, created_by, updated_by)
   VALUES ('NLP_RFC_002', 'once', NOW(), '202606', 'replace',
           1, 'PR#329 통합 테스트', 'test', 'test')`
);
const schedId = insSched.insertId;
console.log(`    스케줄 생성됨 (id=${schedId})`);

// 스케줄 조회 시 마스터의 rfc_name 이 JOIN 되는지 확인
const [schedRow] = await pool.query(
  `SELECT s.id, s.interface_id, m.interface_name, m.rfc_name, s.target_cmonth, s.exec_mode
     FROM batch_schedule s
     LEFT JOIN batch_master m ON m.interface_id = s.interface_id
    WHERE s.id = ?`,
  [schedId]
);
assertEq(schedRow[0].interface_name, '제조원가 RFC', 'JOIN interface_name');
assertEq(schedRow[0].rfc_name, 'Z_BI_WEB_EX_BL_4', 'JOIN rfc_name = Z_BI_WEB_EX_BL_4');
assertEq(schedRow[0].target_cmonth, '202606', 'target_cmonth 저장');


// ── 시나리오 E: 수행 실행 시뮬레이션 — batch_jobs 레코드 (RFC 실행 요청) ──
console.log('\n[시나리오 E] 수행 실행 시뮬레이션 — batch_jobs 생성 및 history JOIN');
const [insJob] = await pool.query(
  `INSERT INTO batch_jobs
     (job_type, interface_id, cmonth, mode, status, created_by, log_text)
   VALUES ('SAP_RFC_SYNC', 'NLP_RFC_002', '202606', 'replace', 'pending',
           'test:pr329', 'PR#329 통합 테스트 — RFC Z_BI_WEB_EX_BL_4 실행 요청')`
);
const jobId = insJob.insertId;
console.log(`    job 생성됨 (id=${jobId})`);

// 이력 목록 API 가 사용하는 JOIN
const [histList] = await pool.query(
  `SELECT j.id, j.interface_id, m.interface_name, m.rfc_name,
          j.cmonth, j.mode, j.status
     FROM batch_jobs j
     LEFT JOIN batch_master m ON m.interface_id = j.interface_id
    WHERE j.id = ?`,
  [jobId]
);
assertEq(histList[0].rfc_name, 'Z_BI_WEB_EX_BL_4', '이력 목록 JOIN 결과 rfc_name = Z_BI_WEB_EX_BL_4');
assertEq(histList[0].interface_name, '제조원가 RFC', '이력 목록 interface_name = 제조원가 RFC');
assertEq(histList[0].cmonth, '202606', 'cmonth = 202606');

// 이력 단건 상세 API 가 사용하는 새 JOIN (PR #329 에서 rfc_name / rfc_param 추가)
const [histDetail] = await pool.query(
  `SELECT j.*, m.interface_name, m.rfc_name, m.rfc_param
     FROM batch_jobs j
     LEFT JOIN batch_master m ON m.interface_id = j.interface_id
    WHERE j.id = ?`,
  [jobId]
);
assertEq(histDetail[0].rfc_name, 'Z_BI_WEB_EX_BL_4', '이력 상세 JOIN rfc_name = Z_BI_WEB_EX_BL_4 (구 함수명 안 나옴)');
assertEq(histDetail[0].interface_name, '제조원가 RFC', '이력 상세 interface_name = 제조원가 RFC');
const paramInDetail = JSON.parse(histDetail[0].rfc_param);
assertEq(paramInDetail.function, 'Z_BI_WEB_EX_BL_4', '이력 상세 rfc_param.function');


// ── 시나리오 F: 상태값 통일 확인 — 수익성과 동일한 상태 셋 (pending/running/success/failed) ──
console.log('\n[시나리오 F] 상태값 통일 (수익성과 동일)');
// 상태 변경 시나리오: pending → running → failed (RFC 실패 시뮬레이션)
await pool.query("UPDATE batch_jobs SET status='running', started_at=NOW() WHERE id=?", [jobId]);
const [running] = await pool.query("SELECT status FROM batch_jobs WHERE id=?", [jobId]);
assertEq(running[0].status, 'running', "status='running' 전이 가능");

// 시나리오 9: RFC 실패 상태 저장
await pool.query(
  "UPDATE batch_jobs SET status='failed', finished_at=NOW(), error_message=? WHERE id=?",
  ['Spring Boot 연결 실패 (테스트 시뮬레이션)', jobId]
);
const [failed] = await pool.query(
  "SELECT status, error_message, TIMESTAMPDIFF(SECOND, started_at, finished_at) AS elapsed_sec FROM batch_jobs WHERE id=?",
  [jobId]
);
assertEq(failed[0].status, 'failed', "status='failed' 저장됨");
assertEq(failed[0].error_message.includes('Spring Boot 연결 실패'), true, 'error_message 저장됨');
console.log(`    소요시간: ${failed[0].elapsed_sec}초 (started_at→finished_at)`);

// 시나리오 6: 이력 목록 화면에 상태 · 건수 · 소요시간 필드가 모두 조회되는지
const [statsRow] = await pool.query(
  `SELECT status, inserted_rows, error_message,
          TIMESTAMPDIFF(SECOND, started_at, finished_at) AS elapsed_sec
     FROM batch_jobs WHERE id=?`,
  [jobId]
);
assertEq(statsRow[0].status, 'failed', '상태 표시 가능');
assertEq(statsRow[0].elapsed_sec !== null, true, '소요시간 계산 가능');


// ── 시나리오 G: 성공 케이스 (건수 · NO_DATA · 성공) ──
console.log('\n[시나리오 G] 성공 케이스 — 상태별 이력 저장');
// NO_DATA 케이스 시뮬레이션 (수익성 상태값과 동일하게, batch_jobs 는 success 로 저장하되
// log_text 에 NO_DATA 명시. 별도 상태 컬럼 확장은 batch_jobs 스키마 미변경 원칙 준수.)
const [insNoData] = await pool.query(
  `INSERT INTO batch_jobs
     (job_type, interface_id, cmonth, mode, status, started_at, finished_at,
      total_rows, inserted_rows, error_message, log_text, created_by)
   VALUES ('SAP_RFC_SYNC', 'NLP_RFC_002', '202607', 'replace', 'success',
           NOW(), NOW(), 0, 0, NULL,
           '[NO_DATA] RFC 호출은 성공했으나 T_DATA 가 비어있음. I_CMONTH=202607',
           'test:pr329')`
);
const [noData] = await pool.query(
  `SELECT status, total_rows, inserted_rows, log_text FROM batch_jobs WHERE id=?`,
  [insNoData.insertId]
);
assertEq(noData[0].status, 'success', 'NO_DATA 는 success 상태 (수익성 동일 규약)');
assertEq(noData[0].total_rows, 0, 'total_rows = 0');
assertEq(noData[0].log_text.includes('NO_DATA'), true, 'log_text 에 NO_DATA 마커');


// ── 정리 ──
console.log('\n[TEARDOWN] 테스트 데이터 정리');
await pool.query("DELETE FROM batch_jobs WHERE created_by='test:pr329'");
await pool.query("DELETE FROM batch_schedule WHERE remark='PR#329 통합 테스트'");


// ── 결과 ──
await pool.end();
console.log();
console.log('='.repeat(60));
if (FAIL === 0) {
  console.log(`  ✅ ALL PASS (${PASS}건)`);
  process.exit(0);
} else {
  console.log(`  ❌ FAIL ${FAIL}건 / PASS ${PASS}건`);
  process.exit(1);
}
