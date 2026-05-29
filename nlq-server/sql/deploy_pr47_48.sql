-- ============================================================
-- 운영 배포 SQL (PR #47 + #48 변경사항)
-- 생성일: 2026-05-29
-- 대상 DB: integration (운영 10.2.14.247:3306)
-- ============================================================
--
-- PR #47: DB 변경 없음 (Java 배치 코드만 수정)
-- PR #48: 이력 개인화 + 빌더 북마크/공유 기능
--
-- 변경 내용:
--   1. nl_query_history 테이블: user_id 컬럼 추가 (자연어 질의 이력 개인화)
--   2. builder_query_history 테이블: user_id, is_bookmarked 컬럼 추가
--   3. shared_queries 테이블: 신규 생성 (쿼리 공유 기능)
--
-- ※ 실행 전 반드시 백업!
--   mysqldump -u [user] -p integration nl_query_history builder_query_history > history_backup_20260529.sql
--
-- ※ 서버(nlq-server)에 ensureBookmarkShareTables() 자동 마이그레이션이 있어
--   서버 재시작만으로도 자동 적용되지만, 운영 안정성을 위해 수동 실행 권장
--
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. nl_query_history: user_id 컬럼 추가 (자연어 질의 이력 개인화)
-- ────────────────────────────────────────────────────────────
-- ※ 이미 존재하면 "Duplicate column name" 에러 → 무시하고 다음 진행

ALTER TABLE `nl_query_history`
  ADD COLUMN `user_id` VARCHAR(50) DEFAULT NULL COMMENT '작성자 로그인 ID' AFTER `id`;

ALTER TABLE `nl_query_history`
  ADD INDEX `idx_nl_user_id` (`user_id`);


-- ────────────────────────────────────────────────────────────
-- 2. builder_query_history: user_id, is_bookmarked 컬럼 추가
-- ────────────────────────────────────────────────────────────
-- ※ 이미 존재하면 "Duplicate column name" 에러 → 무시하고 다음 진행

ALTER TABLE `builder_query_history`
  ADD COLUMN `user_id` VARCHAR(50) DEFAULT NULL COMMENT '작성자 로그인 ID' AFTER `id`;

ALTER TABLE `builder_query_history`
  ADD COLUMN `is_bookmarked` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '북마크 여부 (0=일반, 1=즐겨찾기)' AFTER `error_message`;

ALTER TABLE `builder_query_history`
  ADD INDEX `idx_user_id` (`user_id`);

ALTER TABLE `builder_query_history`
  ADD INDEX `idx_bookmark` (`user_id`, `is_bookmarked`);


-- ────────────────────────────────────────────────────────────
-- 3. shared_queries 테이블: 신규 생성 (쿼리 공유 기능)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `shared_queries` (
  `id`              INT(11)      NOT NULL AUTO_INCREMENT,
  `history_id`      INT(11)      NOT NULL              COMMENT '원본 builder_query_history.id',
  `from_user_id`    VARCHAR(50)  NOT NULL              COMMENT '공유한 사용자 ID',
  `to_user_id`      VARCHAR(50)  NOT NULL              COMMENT '공유받은 사용자 ID',
  `title`           VARCHAR(200) NOT NULL              COMMENT '쿼리 제목',
  `fields_json`     TEXT         NOT NULL              COMMENT '선택 필드 JSON (스냅샷)',
  `conditions_json` TEXT         DEFAULT NULL           COMMENT '필터 조건 JSON (스냅샷)',
  `group_by_json`   TEXT         DEFAULT NULL           COMMENT 'GROUP BY JSON (스냅샷)',
  `order_by`        VARCHAR(100) DEFAULT NULL,
  `order_dir`       VARCHAR(10)  DEFAULT 'DESC',
  `limit_val`       INT(11)      DEFAULT 1000,
  `prompt`          TEXT         DEFAULT NULL           COMMENT '추가 프롬프트',
  `generated_sql`   TEXT         DEFAULT NULL           COMMENT '생성된 SQL',
  `memo`            VARCHAR(500) DEFAULT NULL           COMMENT '공유 메모',
  `is_read`         TINYINT(1)   NOT NULL DEFAULT 0    COMMENT '읽음 여부 (0=안읽음, 1=읽음)',
  `created_at`      TIMESTAMP    NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_shared_to`   (`to_user_id`, `created_at` DESC),
  KEY `idx_shared_from` (`from_user_id`),
  KEY `idx_history_id`  (`history_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='쿼리 공유 테이블';


-- ────────────────────────────────────────────────────────────
-- 4. 확인 쿼리 (실행 후 결과 확인용)
-- ────────────────────────────────────────────────────────────

-- 4-1) nl_query_history에 user_id 컬럼 존재 확인
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'nl_query_history'
  AND COLUMN_NAME = 'user_id';

-- 4-2) builder_query_history에 user_id, is_bookmarked 컬럼 존재 확인
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'builder_query_history'
  AND COLUMN_NAME IN ('user_id', 'is_bookmarked');

-- 4-3) shared_queries 테이블 존재 확인
SHOW TABLES LIKE 'shared_queries';
DESCRIBE `shared_queries`;


-- ════════════════════════════════════════════════════════════
-- 변경 요약
-- ════════════════════════════════════════════════════════════
--
-- [테이블: nl_query_history]
--   + user_id VARCHAR(50) DEFAULT NULL  ← 신규 컬럼
--   + INDEX idx_nl_user_id (user_id)    ← 신규 인덱스
--
-- [테이블: builder_query_history]
--   + user_id VARCHAR(50) DEFAULT NULL  ← 신규 컬럼
--   + is_bookmarked TINYINT(1) DEFAULT 0 ← 신규 컬럼
--   + INDEX idx_user_id (user_id)       ← 신규 인덱스
--   + INDEX idx_bookmark (user_id, is_bookmarked) ← 신규 복합 인덱스
--
-- [테이블: shared_queries]              ← 신규 테이블 (전체)
--   id, history_id, from_user_id, to_user_id, title,
--   fields_json, conditions_json, group_by_json,
--   order_by, order_dir, limit_val, prompt, generated_sql,
--   memo, is_read, created_at
--
-- ════════════════════════════════════════════════════════════
