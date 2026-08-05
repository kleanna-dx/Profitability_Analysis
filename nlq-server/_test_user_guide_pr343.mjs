// ============================================================
// [PR #343] 자연어질의 가이드 '다시 보지 않기' 사용자별 관리 검증 테스트
//
// 배경:
//   - 이전: 프런트가 localStorage['nlqCoachMarkSeen_v1'] 로 '다시 보지 않기' 저장.
//           브라우저 범위이므로 같은 브라우저를 공유하는 서로 다른 사용자에게 상호 영향.
//   - 이후: users.nlq_guide_hidden TINYINT(1) 컬럼에 사용자별로 저장.
//           로그인 사용자별로 완전히 독립 관리
//           + GET/POST /api/me/nlq-guide-hidden API.
//
// 검증 항목:
//   1) users.nlq_guide_hidden 컬럼 존재 및 스키마 정합성
//   2) DEFAULT 0 → 신규 사용자는 최초 진입 시 가이드 표시
//   3) 특정 사용자만 UPDATE — 다른 사용자에게 영향 없음 (핵심 시나리오)
//   4) 값 왕복 (0↔1) 저장 확인
//   5) ensureNlqGuideColumn() 재실행 시 idempotent (컬럼 중복 추가 안 됨)
//   6) (원복) 이전 시도로 만들었을 수 있는 sys_aimd_user_guides 테이블이 남아있지 않아야 함
//
// 실행:
//   node _test_user_guide_pr343.mjs
// ============================================================

import mysql from 'mysql2/promise';
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

const TEST_USER_A = '__pr343_test_user_A__';
const TEST_USER_B = '__pr343_test_user_B__';

async function ensureTestUsers() {
  const [cols] = await pool.query(`SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users'`);
  const info = cols.map(c => c.COLUMN_NAME);
  const buildInsert = async (uid) => {
    const [ex] = await pool.query('SELECT user_id FROM users WHERE user_id = ?', [uid]);
    if (ex.length > 0) return;
    const values = { user_id: uid };
    if (info.includes('name')) values.name = 'PR343 Test';
    if (info.includes('password')) values.password = 'x';
    if (info.includes('email')) values.email = uid + '@example.com';
    if (info.includes('is_active')) values.is_active = 1;
    if (info.includes('created_at')) values.created_at = new Date();
    if (info.includes('updated_at')) values.updated_at = new Date();
    const keys = Object.keys(values);
    const sql = `INSERT INTO users (${keys.map(k => '`'+k+'`').join(',')}) VALUES (${keys.map(_ => '?').join(',')})`;
    await pool.query(sql, keys.map(k => values[k]));
  };
  await buildInsert(TEST_USER_A);
  await buildInsert(TEST_USER_B);
}

async function cleanupTestData() {
  await pool.query('DELETE FROM users WHERE user_id IN (?, ?)', [TEST_USER_A, TEST_USER_B]);
}

// server.mjs 의 ensureNlqGuideColumn() 과 동일 로직을 테스트에서도 재사용
async function ensureNlqGuideColumnLocal() {
  const [colRows] = await pool.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'nlq_guide_hidden'
  `);
  if (colRows.length === 0) {
    await pool.query(`
      ALTER TABLE users
      ADD COLUMN nlq_guide_hidden TINYINT(1) NOT NULL DEFAULT 0
      COMMENT '자연어질의 가이드 다시 보지 않기 여부 (0=표시, 1=미표시)'
    `);
  }
}

async function main() {
  console.log('\n=== [PR #343] users.nlq_guide_hidden 사용자별 관리 검증 시작 ===\n');

  console.log('▶ 사전 준비: users.nlq_guide_hidden 컬럼 확보');
  await ensureNlqGuideColumnLocal();

  console.log('▶ 사전 준비: 테스트 유저 2명 생성');
  await ensureTestUsers();

  // --- 1) 컬럼 스키마 검증
  console.log('\n▶ [1/6] users.nlq_guide_hidden 컬럼 스키마 검증');
  const [colRows] = await pool.query(`
    SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = 'nlq_guide_hidden'
  `);
  assert(colRows.length === 1, 'users.nlq_guide_hidden 컬럼 존재');
  if (colRows.length === 1) {
    const c = colRows[0];
    assert(c.DATA_TYPE === 'tinyint', 'DATA_TYPE = tinyint');
    assert(c.IS_NULLABLE === 'NO', 'NOT NULL 제약');
    assert(String(c.COLUMN_DEFAULT) === '0', 'DEFAULT 0');
    assert((c.COLUMN_COMMENT || '').includes('다시 보지 않기'), 'COMMENT 에 취지 명시');
  }

  // --- 2) DEFAULT 0 확인
  console.log('\n▶ [2/6] 신규 사용자는 nlq_guide_hidden=0 (가이드 표시)');
  const [aRow0] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_A]);
  const [bRow0] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_B]);
  assert(aRow0[0].nlq_guide_hidden === 0, 'A 초기값 0 (표시)');
  assert(bRow0[0].nlq_guide_hidden === 0, 'B 초기값 0 (표시)');

  // --- 3) 특정 사용자만 UPDATE 시 다른 사용자에게 영향 없음
  console.log('\n▶ [3/6] 사용자 A/B 격리 검증 (핵심 시나리오 — 원본 버그 재현 방지)');
  const [upd1] = await pool.query(
    'UPDATE users SET nlq_guide_hidden = 1 WHERE user_id = ?',
    [TEST_USER_A]
  );
  assert(upd1.affectedRows === 1, 'A 만 UPDATE 되어야 함 (affectedRows=1)');
  const [aRow1] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_A]);
  const [bRow1] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_B]);
  assert(aRow1[0].nlq_guide_hidden === 1, 'A → 1 (미표시)');
  assert(bRow1[0].nlq_guide_hidden === 0, 'B 는 여전히 0 (표시) — A 설정 영향 없음');

  // B 도 UPDATE 해도 A 값에 영향 없음
  await pool.query('UPDATE users SET nlq_guide_hidden = 1 WHERE user_id = ?', [TEST_USER_B]);
  const [aRow2] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_A]);
  const [bRow2] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_B]);
  assert(aRow2[0].nlq_guide_hidden === 1, 'B UPDATE 후에도 A 는 1 그대로');
  assert(bRow2[0].nlq_guide_hidden === 1, 'B → 1');

  // B 를 0 으로 되돌려도 A 값에 영향 없음
  await pool.query('UPDATE users SET nlq_guide_hidden = 0 WHERE user_id = ?', [TEST_USER_B]);
  const [aRow3] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_A]);
  const [bRow3] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_B]);
  assert(aRow3[0].nlq_guide_hidden === 1, 'B 를 0 으로 되돌려도 A 는 1 유지 (완전 격리)');
  assert(bRow3[0].nlq_guide_hidden === 0, 'B → 0');

  // --- 4) 값 왕복 저장
  console.log('\n▶ [4/6] 값 왕복(0↔1) 저장 검증');
  await pool.query('UPDATE users SET nlq_guide_hidden = 0 WHERE user_id = ?', [TEST_USER_A]);
  const [aRow4] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_A]);
  assert(aRow4[0].nlq_guide_hidden === 0, 'A 를 다시 0 으로 되돌리기 가능');
  await pool.query('UPDATE users SET nlq_guide_hidden = 1 WHERE user_id = ?', [TEST_USER_A]);
  const [aRow5] = await pool.query('SELECT nlq_guide_hidden FROM users WHERE user_id=?', [TEST_USER_A]);
  assert(aRow5[0].nlq_guide_hidden === 1, 'A 를 다시 1 로 저장 가능');

  // --- 5) idempotent: ensureNlqGuideColumn 재호출 시 오류 없음, 컬럼 중복 안 됨
  console.log('\n▶ [5/6] ensureNlqGuideColumn 재호출 시 idempotent');
  await ensureNlqGuideColumnLocal();
  await ensureNlqGuideColumnLocal();
  const [colRows2] = await pool.query(`
    SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users' AND COLUMN_NAME='nlq_guide_hidden'
  `);
  assert(colRows2[0].c === 1, '재호출 후에도 컬럼은 1개 (중복 추가 안 됨)');

  // --- 6) 이전 시도로 만들었을 수 있는 sys_aimd_user_guides 테이블이 없어야 함
  //     (server.mjs ensureNlqGuideColumn 이 cleanup 으로 DROP)
  console.log('\n▶ [6/6] 이전 시도 잔재(sys_aimd_user_guides) 부재 확인');
  const [tblRows] = await pool.query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_user_guides'
  `);
  assert(tblRows.length === 0, 'sys_aimd_user_guides 테이블이 존재하지 않음 (초기 시도 원복 완료)');

  // --- 정리
  console.log('\n▶ 정리: 테스트 데이터 삭제');
  await cleanupTestData();

  console.log('\n=== 검증 결과 ===');
  console.log(`  Pass: ${passCount}`);
  console.log(`  Fail: ${failCount}`);
  if (failCount > 0) {
    console.log('\n실패 항목:');
    failed.forEach(m => console.log('  - ' + m));
    process.exit(1);
  }
  console.log('\n✅ [PR #343] users.nlq_guide_hidden 사용자별 관리 검증 통과\n');
  process.exit(0);
}

try {
  await main();
} catch (e) {
  console.error('\n❌ 테스트 실행 중 오류:', e);
  try { await cleanupTestData(); } catch (_) {}
  process.exit(1);
} finally {
  await pool.end().catch(() => {});
}
