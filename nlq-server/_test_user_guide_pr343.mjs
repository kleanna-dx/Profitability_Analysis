// ============================================================
// [PR #343] 사용자별 가이드(튜토리얼) 노출 상태 관리 검증 테스트
//
// 배경:
//   - 이전: 프런트가 localStorage['nlqCoachMarkSeen_v1'] 로 '다시 보지 않기' 를 저장.
//           브라우저 범위이므로 같은 브라우저를 공유하는 서로 다른 사용자에게 상호 영향.
//   - 이후: sys_aimd_user_guides 테이블에 (user_id, guide_code) 단위로 저장.
//           로그인 사용자별로 완전히 독립 관리 + GET/POST /api/me/guide/:guide_code API.
//
// 검증 항목:
//   1) sys_aimd_user_guides 테이블 존재 및 스키마 정합성
//   2) 복합 PK (user_id, guide_code) — 같은 사용자에 대한 upsert 동작
//   3) 서로 다른 사용자 간 데이터 격리 (A 의 do_not_show=1 이 B 에 영향 없음)
//   4) users 로 FK / ON DELETE CASCADE 존재
//   5) upsert 시 completed_at 갱신 (do_not_show=1 → NOT NULL, 0 → NULL)
//   6) guide_code 여러 개 동시 저장 (같은 사용자, 다른 가이드)
//   7) 존재하지 않는 (user_id, guide_code) 조회 시 결과 없음 (프런트는 do_not_show=false 로 처리)
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

// 테스트용 유저 두 명을 미리 생성 (이미 있으면 재사용)
const TEST_USER_A = '__pr343_test_user_A__';
const TEST_USER_B = '__pr343_test_user_B__';
const GUIDE_CODE = 'NLQ_COACHMARK_V1';
const GUIDE_CODE_OTHER = 'FUTURE_GUIDE_V1';

async function ensureTestUsers() {
  // users 테이블의 최소 필수 컬럼만 채워 넣기. 스키마가 프로젝트에 따라 다르므로
  // NOT NULL / 기본값 없는 컬럼을 감안해 광범위한 INSERT 시도. 실패하면 skip.
  const cols = await pool.query(`SELECT COLUMN_NAME, IS_NULLABLE, COLUMN_DEFAULT
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='users'`);
  const info = cols[0].map(c => c.COLUMN_NAME);
  // password_hash 같은 NOT NULL 컬럼이 있을 수 있으므로 안전한 dummy 값 삽입
  const buildInsert = async (uid) => {
    // 존재 여부 확인
    const [ex] = await pool.query('SELECT user_id FROM users WHERE user_id = ?', [uid]);
    if (ex.length > 0) return;
    // 컬럼별 dummy 값
    const values = {};
    values.user_id = uid;
    if (info.includes('name')) values.name = 'PR343 Test';
    if (info.includes('password')) values.password = 'x';
    if (info.includes('password_hash')) values.password_hash = 'x';
    if (info.includes('role')) values.role = 'user';
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
  await pool.query('DELETE FROM sys_aimd_user_guides WHERE user_id IN (?, ?)', [TEST_USER_A, TEST_USER_B]);
  await pool.query('DELETE FROM users WHERE user_id IN (?, ?)', [TEST_USER_A, TEST_USER_B]);
}

async function main() {
  console.log('\n=== [PR #343] 사용자별 가이드 관리 검증 시작 ===\n');

  // --- 사전 준비: 서버 부팅 시 만들어지는 테이블을 여기서도 만들어 놓는다
  //     (테스트를 단독으로 실행할 수도 있어서 dependency 최소화)
  console.log('▶ 사전 준비: sys_aimd_user_guides 테이블 확보');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sys_aimd_user_guides (
      user_id      VARCHAR(64) NOT NULL,
      guide_code   VARCHAR(64) NOT NULL,
      do_not_show  TINYINT(1)  NOT NULL DEFAULT 0,
      completed_at DATETIME    NULL DEFAULT NULL,
      updated_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, guide_code),
      INDEX idx_sys_aimd_ug_user (user_id),
      CONSTRAINT fk_sys_aimd_ug_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  console.log('▶ 사전 준비: 테스트 유저 2명 생성');
  await ensureTestUsers();
  // 이전 실행의 잔여 데이터 정리
  await pool.query('DELETE FROM sys_aimd_user_guides WHERE user_id IN (?, ?)', [TEST_USER_A, TEST_USER_B]);

  // --- 1) 테이블 존재 및 스키마
  console.log('\n▶ [1/7] 테이블 존재 및 스키마 검증');
  const [tblRows] = await pool.query(`
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_user_guides'
  `);
  assert(tblRows.length === 1, 'sys_aimd_user_guides 테이블이 존재해야 한다');

  const [colRows] = await pool.query(`
    SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_KEY
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_user_guides'
    ORDER BY ORDINAL_POSITION
  `);
  const colNames = colRows.map(r => r.COLUMN_NAME);
  assert(colNames.includes('user_id'),      '컬럼 user_id 존재');
  assert(colNames.includes('guide_code'),   '컬럼 guide_code 존재');
  assert(colNames.includes('do_not_show'),  '컬럼 do_not_show 존재');
  assert(colNames.includes('completed_at'), '컬럼 completed_at 존재');
  assert(colNames.includes('updated_at'),   '컬럼 updated_at 존재');

  const pkCols = colRows.filter(r => r.COLUMN_KEY === 'PRI').map(r => r.COLUMN_NAME);
  assert(pkCols.includes('user_id') && pkCols.includes('guide_code'),
    '복합 PRIMARY KEY (user_id, guide_code)');

  // --- 2) upsert 동작 확인
  console.log('\n▶ [2/7] upsert (INSERT ... ON DUPLICATE KEY UPDATE) 동작 검증');
  await pool.query(
    `INSERT INTO sys_aimd_user_guides (user_id, guide_code, do_not_show, completed_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE do_not_show = VALUES(do_not_show), completed_at = VALUES(completed_at)`,
    [TEST_USER_A, GUIDE_CODE, 1, new Date()]
  );
  let [rows1] = await pool.query(
    'SELECT do_not_show, completed_at FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    [TEST_USER_A, GUIDE_CODE]
  );
  assert(rows1.length === 1, '최초 INSERT 후 1건 존재');
  assert(rows1[0].do_not_show === 1, 'do_not_show=1 저장 확인');
  assert(rows1[0].completed_at !== null, 'do_not_show=1 시 completed_at NOT NULL');

  // 동일 (user_id, guide_code) 로 다시 저장 (do_not_show=0)
  await pool.query(
    `INSERT INTO sys_aimd_user_guides (user_id, guide_code, do_not_show, completed_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE do_not_show = VALUES(do_not_show), completed_at = VALUES(completed_at)`,
    [TEST_USER_A, GUIDE_CODE, 0, null]
  );
  let [rows2] = await pool.query(
    'SELECT do_not_show, completed_at FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    [TEST_USER_A, GUIDE_CODE]
  );
  assert(rows2.length === 1, 'upsert 후에도 여전히 1건 (중복 생성 안 됨)');
  assert(rows2[0].do_not_show === 0, 'do_not_show=0 으로 업데이트됨');
  assert(rows2[0].completed_at === null, 'do_not_show=0 시 completed_at NULL');

  // --- 3) 서로 다른 사용자 간 데이터 격리 (핵심 시나리오)
  console.log('\n▶ [3/7] 사용자 A/B 데이터 격리 검증 (원본 버그 재현 방지)');
  // 격리 시나리오를 깨끗한 상태에서 시작: A/B 잔여 데이터 정리 후 A 부터 저장
  await pool.query('DELETE FROM sys_aimd_user_guides WHERE user_id IN (?, ?)', [TEST_USER_A, TEST_USER_B]);
  await pool.query(
    `INSERT INTO sys_aimd_user_guides (user_id, guide_code, do_not_show, completed_at)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE do_not_show=VALUES(do_not_show), completed_at=VALUES(completed_at)`,
    [TEST_USER_A, GUIDE_CODE, 1, new Date()]
  );
  // 사용자 B 로 조회 → 결과 없어야 함
  const [aOnly] = await pool.query(
    'SELECT user_id, do_not_show FROM sys_aimd_user_guides WHERE guide_code=? ORDER BY user_id',
    [GUIDE_CODE]
  );
  assert(aOnly.length === 1, 'A 만 저장된 상태에서 total 1건');
  assert(aOnly[0].user_id === TEST_USER_A, '단 1건이 A 소유');

  const [bLookup] = await pool.query(
    'SELECT * FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    [TEST_USER_B, GUIDE_CODE]
  );
  assert(bLookup.length === 0, '사용자 B 는 별도로 저장한 적 없으므로 0건 (= 프런트는 do_not_show=false 로 판정 → 튜토리얼 노출)');

  // 사용자 B 가 '다시 보지 않기' 를 켠 후에도 A 값에 영향 없어야 함
  await pool.query(
    `INSERT INTO sys_aimd_user_guides (user_id, guide_code, do_not_show, completed_at)
     VALUES (?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE do_not_show=VALUES(do_not_show), completed_at=VALUES(completed_at)`,
    [TEST_USER_B, GUIDE_CODE]
  );
  const [aAgain] = await pool.query(
    'SELECT do_not_show FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    [TEST_USER_A, GUIDE_CODE]
  );
  assert(aAgain.length === 1 && aAgain[0].do_not_show === 1, 'B 저장 이후에도 A 의 do_not_show=1 유지');

  // B 가 do_not_show=0 으로 되돌려도 A 는 여전히 1
  await pool.query(
    `INSERT INTO sys_aimd_user_guides (user_id, guide_code, do_not_show, completed_at)
     VALUES (?, ?, 0, NULL)
     ON DUPLICATE KEY UPDATE do_not_show=VALUES(do_not_show), completed_at=VALUES(completed_at)`,
    [TEST_USER_B, GUIDE_CODE]
  );
  const [aStill] = await pool.query(
    'SELECT do_not_show FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    [TEST_USER_A, GUIDE_CODE]
  );
  assert(aStill[0].do_not_show === 1, 'B 를 0 으로 되돌려도 A 는 여전히 1 (완전 격리)');

  // --- 4) FK / ON DELETE CASCADE
  console.log('\n▶ [4/7] FK 제약 (users → sys_aimd_user_guides ON DELETE CASCADE) 검증');
  const [fkRows] = await pool.query(`
    SELECT k.REFERENCED_TABLE_NAME AS ref_tbl,
           k.REFERENCED_COLUMN_NAME AS ref_col,
           r.DELETE_RULE AS del_rule
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
    LEFT JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r
      ON k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
     AND k.TABLE_SCHEMA   = r.CONSTRAINT_SCHEMA
    WHERE k.TABLE_SCHEMA = DATABASE()
      AND k.TABLE_NAME = 'sys_aimd_user_guides'
      AND k.REFERENCED_TABLE_NAME = 'users'
  `);
  assert(fkRows.length >= 1, 'users 참조 FK 존재');
  assert(fkRows.some(r => r.del_rule === 'CASCADE'), 'ON DELETE CASCADE 규칙 확인');

  // 실제로 사용자 삭제 시 sys_aimd_user_guides 데이터도 함께 삭제되는지 확인
  const beforeCount = (await pool.query(
    'SELECT COUNT(*) AS c FROM sys_aimd_user_guides WHERE user_id=?',
    [TEST_USER_B]
  ))[0][0].c;
  assert(beforeCount >= 1, '삭제 전 사용자 B 의 가이드 행 존재');

  await pool.query('DELETE FROM users WHERE user_id=?', [TEST_USER_B]);
  const afterCount = (await pool.query(
    'SELECT COUNT(*) AS c FROM sys_aimd_user_guides WHERE user_id=?',
    [TEST_USER_B]
  ))[0][0].c;
  assert(afterCount === 0, '사용자 삭제 시 sys_aimd_user_guides 도 CASCADE 로 삭제');

  // --- 5) completed_at 갱신 규칙 (do_not_show 1↔0 왕복)
  console.log('\n▶ [5/7] completed_at 갱신 규칙 검증');
  // A: do_not_show=1 상태에서 시간 기록됨
  const [aRow] = await pool.query(
    'SELECT do_not_show, completed_at FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    [TEST_USER_A, GUIDE_CODE]
  );
  assert(aRow[0].do_not_show === 1 && aRow[0].completed_at !== null,
    'do_not_show=1 시 completed_at 은 NOT NULL');

  // A: 0 으로 되돌리면 completed_at=NULL
  await pool.query(
    `INSERT INTO sys_aimd_user_guides (user_id, guide_code, do_not_show, completed_at)
     VALUES (?, ?, 0, NULL)
     ON DUPLICATE KEY UPDATE do_not_show=VALUES(do_not_show), completed_at=VALUES(completed_at)`,
    [TEST_USER_A, GUIDE_CODE]
  );
  const [aRow2] = await pool.query(
    'SELECT do_not_show, completed_at FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    [TEST_USER_A, GUIDE_CODE]
  );
  assert(aRow2[0].do_not_show === 0 && aRow2[0].completed_at === null,
    'do_not_show=0 으로 되돌릴 때 completed_at=NULL');

  // --- 6) 같은 사용자에 대해 여러 guide_code 공존 가능
  console.log('\n▶ [6/7] 같은 사용자의 여러 guide_code 공존 검증');
  await pool.query(
    `INSERT INTO sys_aimd_user_guides (user_id, guide_code, do_not_show, completed_at)
     VALUES (?, ?, 1, NOW())
     ON DUPLICATE KEY UPDATE do_not_show=VALUES(do_not_show), completed_at=VALUES(completed_at)`,
    [TEST_USER_A, GUIDE_CODE_OTHER]
  );
  const [aGuides] = await pool.query(
    'SELECT guide_code, do_not_show FROM sys_aimd_user_guides WHERE user_id=? ORDER BY guide_code',
    [TEST_USER_A]
  );
  assert(aGuides.length === 2, 'A 사용자에 대해 서로 다른 2개 guide_code 저장');
  const gm = Object.fromEntries(aGuides.map(g => [g.guide_code, g.do_not_show]));
  assert(gm[GUIDE_CODE] === 0, 'NLQ_COACHMARK_V1 는 do_not_show=0');
  assert(gm[GUIDE_CODE_OTHER] === 1, 'FUTURE_GUIDE_V1 는 do_not_show=1 (독립 관리)');

  // --- 7) 존재하지 않는 (user, guide) 조회 시 결과 없음 → 프런트가 do_not_show=false 로 fail-open
  console.log('\n▶ [7/7] 미저장 (신규) 사용자 조회 결과 검증');
  const [nonExist] = await pool.query(
    'SELECT * FROM sys_aimd_user_guides WHERE user_id=? AND guide_code=?',
    ['__non_existent_user_xyz__', GUIDE_CODE]
  );
  assert(nonExist.length === 0, '미저장 사용자에 대해 조회 결과 0건 (프런트는 do_not_show=false 로 튜토리얼 노출)');

  // --- 정리
  console.log('\n▶ 정리: 테스트 데이터 삭제');
  await cleanupTestData();

  // 결과 요약
  console.log('\n=== 검증 결과 ===');
  console.log(`  Pass: ${passCount}`);
  console.log(`  Fail: ${failCount}`);
  if (failCount > 0) {
    console.log('\n실패 항목:');
    failed.forEach(m => console.log('  - ' + m));
    process.exit(1);
  }
  console.log('\n✅ [PR #343] 사용자별 가이드 관리 검증 통과\n');
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
