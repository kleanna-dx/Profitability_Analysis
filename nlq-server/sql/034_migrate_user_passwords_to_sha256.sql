-- ============================================================
-- 034: users.password 평문 → SHA-256 해시 일괄 마이그레이션
-- ------------------------------------------------------------
-- 관련 PR : #175 (fix(auth): 비밀번호 SHA-256 저장)
-- 작성일  : 2026-06-18
--
-- 배경:
--   - 그룹웨어가 POST /api/users/bulk 로 password='kleannara12#' 같은
--     평문을 전달하여 users.password 컬럼에 평문이 저장되어 있던 문제 수정.
--   - 앞으로 모든 신규/수정 password 는 서버에서 SHA-256(UTF-8) 해싱 후 저장.
--   - 운영 DB 에 이미 평문으로 저장된 사용자들도 SHA-256 해시값으로 일괄 변환.
--
-- ※ 코드(server.mjs)의 migrateUserPasswordsToSha256() 가 서버 기동 시
--    자동으로 같은 작업을 수행하므로, 이 SQL 은 다음 상황에 활용:
--      1) DB 작업과 앱 배포를 분리해서 수행해야 할 때
--      2) 앱 배포 전에 운영 DB 의 평문 사용자 수를 사전 점검할 때
--      3) 마이그레이션 결과를 SQL 콘솔에서 직접 검증하고 싶을 때
--
-- 현재 해싱 방식 (PR #175 기준):
--   - 알고리즘 : SHA-256 (FIPS 180-4)
--   - 인코딩  : UTF-8 입력 → 64자 16진수 (소문자) 출력
--   - Salt   : 없음 (deterministic. 같은 평문 → 항상 같은 해시)
--   - MySQL  : SHA2(s, 256)
--   - Node.js: crypto.createHash('sha256').update(s, 'utf8').digest('hex')
--   ※ 위 두 함수는 UTF-8 입력에 대해 100% 동일한 결과 반환 (검증 완료, 한글 포함).
--
-- DDL 변경:
--   - 신규 테이블 : 없음
--   - 신규 컬럼  : 없음
--   - 컬럼 정의 변경:
--       users.password 컬럼의 COMMENT 만 정정 (코드 동작에는 영향 없음).
--       기존: '비밀번호 (bcrypt 해시, SSO 유저는 NULL 가능)'   ← 실제 구현과 불일치
--       변경: '비밀번호 (SHA-256 해시 hex 64자, SSO 유저는 NULL 가능)'
--       (타입 varchar(255), DEFAULT NULL, NULL 허용은 그대로 유지)
--
-- 멱등성:
--   - SHA-256 해시는 항상 64자 16진수.
--   - 그 외 password 만 평문으로 간주하고 변환 → 여러 번 실행해도 안전.
--   - ALTER ... MODIFY COLUMN 도 같은 정의로 여러 번 실행 가능 (재실행 안전).
-- ============================================================

-- 안전을 위해 트랜잭션으로 감쌈 (MySQL InnoDB 가정)
-- ※ MySQL/MariaDB 에서 ALTER TABLE 은 DDL 이라 implicit commit 이 발생하지만,
--   UPDATE 가 ALTER 이후이므로 ALTER 가 먼저 끝나도 데이터 마이그레이션은
--   별도 트랜잭션에서 안전하게 수행됩니다.
START TRANSACTION;

-- ─────────────────────────────────────────────────────────
-- [1/4] 사전 점검: 변환 대상(평문 추정) 사용자 수 확인
--   - 실행 전에 수동으로 SELECT 만 먼저 돌려보고 싶다면 아래 한 줄 활용:
--
--     SELECT COUNT(*) AS plain_count
--       FROM users
--      WHERE password IS NOT NULL AND password <> ''
--        AND NOT (LENGTH(password) = 64 AND password REGEXP '^[0-9a-fA-F]{64}$');
-- ─────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────
-- [2/4] users.password 컬럼 코멘트 정정
--   - 기존 코멘트 'bcrypt 해시' 는 실제 구현(SHA-256)과 불일치 →
--     운영 DBA / 신규 합류 개발자 혼동 방지를 위해 정정.
--   - 컬럼 타입 / 길이(varchar(255)) / NULL 허용 / DEFAULT 는 그대로 유지.
-- ─────────────────────────────────────────────────────────
ALTER TABLE users
  MODIFY COLUMN password varchar(255) DEFAULT NULL
  COMMENT '비밀번호 (SHA-256 해시 hex 64자, SSO 유저는 NULL 가능)';

-- ─────────────────────────────────────────────────────────
-- [3/4] 평문 password → SHA-256(UTF-8) 해시값으로 일괄 변환
--   조건:
--     - password IS NOT NULL AND password <> ''  (NULL/빈 문자열 건너뜀)
--     - LENGTH(password) != 64 또는 16진수가 아님  (이미 해시된 행은 보호)
--   변환:
--     - SHA2(password, 256) → 64자 hex (소문자) 반환
--   영향 최소화:
--     - WHERE 절에 인덱스가 없어 풀스캔이지만 users 는 통상 수천~수만 행.
--     - 운영 환경에서 lock 시간이 우려되면 application-level 마이그레이션
--       (server.mjs migrateUserPasswordsToSha256) 을 사용해 행 단위 처리.
-- ─────────────────────────────────────────────────────────
UPDATE users
   SET password = SHA2(password, 256),
       updated_at = CURRENT_TIMESTAMP
 WHERE password IS NOT NULL
   AND password <> ''
   AND NOT (LENGTH(password) = 64 AND password REGEXP '^[0-9a-fA-F]{64}$');

-- ─────────────────────────────────────────────────────────
-- [4/4] 사후 검증: 평문이 남아있는지 + 코멘트가 갱신됐는지 확인
--   결과의 plain_remaining 컬럼이 0 이어야 정상.
--
--     -- 데이터 검증
--     SELECT
--       SUM(CASE WHEN password IS NULL OR password = '' THEN 1 ELSE 0 END) AS null_or_empty,
--       SUM(CASE WHEN LENGTH(password) = 64
--                  AND password REGEXP '^[0-9a-fA-F]{64}$' THEN 1 ELSE 0 END) AS sha256_hex,
--       SUM(CASE WHEN password IS NOT NULL AND password <> ''
--                  AND NOT (LENGTH(password) = 64
--                             AND password REGEXP '^[0-9a-fA-F]{64}$') THEN 1 ELSE 0 END) AS plain_remaining,
--       COUNT(*) AS total
--     FROM users;
--
--     -- 코멘트 검증 (기대값: '비밀번호 (SHA-256 해시 hex 64자, SSO 유저는 NULL 가능)')
--     SELECT COLUMN_COMMENT
--       FROM INFORMATION_SCHEMA.COLUMNS
--      WHERE TABLE_SCHEMA = DATABASE()
--        AND TABLE_NAME   = 'users'
--        AND COLUMN_NAME  = 'password';
-- ─────────────────────────────────────────────────────────

COMMIT;

-- ============================================================
-- 롤백 안내
-- ------------------------------------------------------------
-- SHA-256 은 단방향 해시이므로 한 번 적용된 해시값을 원래 평문으로 되돌릴 수 없음.
-- 만약 운영에서 롤백이 필요하면:
--   1) 사전에 users 테이블 백업 (mysqldump 또는 별도 백업 테이블) 필수
--      예) CREATE TABLE users_bak_20260618 AS SELECT * FROM users;
--   2) 문제 발생 시 백업 테이블에서 password 컬럼을 복구
--      예) UPDATE users u JOIN users_bak_20260618 b ON u.user_id = b.user_id
--            SET u.password = b.password;
--   3) 코멘트만 원복하려면:
--      ALTER TABLE users
--        MODIFY COLUMN password varchar(255) DEFAULT NULL
--        COMMENT '비밀번호 (bcrypt 해시, SSO 유저는 NULL 가능)';
-- ============================================================
