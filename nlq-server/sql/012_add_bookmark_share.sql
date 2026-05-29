-- ============================================================
-- 012: 이력 개인화 + 빌더 북마크 & 공유 기능 추가
-- ============================================================

-- 0) nl_query_history에 user_id 컬럼 추가 (자연어 질의 이력 개인화)
ALTER TABLE `nl_query_history`
  ADD COLUMN `user_id` varchar(50) DEFAULT NULL COMMENT '작성자 로그인 ID' AFTER `id`,
  ADD INDEX `idx_nl_user_id` (`user_id`);

-- 1) builder_query_history에 user_id, is_bookmarked 컬럼 추가
ALTER TABLE `builder_query_history`
  ADD COLUMN `user_id` varchar(50) DEFAULT NULL COMMENT '작성자 로그인 ID' AFTER `id`,
  ADD COLUMN `is_bookmarked` tinyint(1) NOT NULL DEFAULT 0 COMMENT '북마크 여부 (0=일반, 1=즐겨찾기)' AFTER `error_message`,
  ADD INDEX `idx_user_id` (`user_id`),
  ADD INDEX `idx_bookmark` (`user_id`, `is_bookmarked`);

-- 2) 공유 테이블: 쿼리를 다른 사용자에게 공유
CREATE TABLE IF NOT EXISTS `shared_queries` (
  `id`              int(11)      NOT NULL AUTO_INCREMENT,
  `history_id`      int(11)      NOT NULL              COMMENT '원본 builder_query_history.id',
  `from_user_id`    varchar(50)  NOT NULL              COMMENT '공유한 사용자 ID',
  `to_user_id`      varchar(50)  NOT NULL              COMMENT '공유받은 사용자 ID',
  `title`           varchar(200) NOT NULL              COMMENT '쿼리 제목',
  `fields_json`     text         NOT NULL              COMMENT '선택 필드 JSON (스냅샷)',
  `conditions_json` text         DEFAULT NULL           COMMENT '필터 조건 JSON (스냅샷)',
  `group_by_json`   text         DEFAULT NULL           COMMENT 'GROUP BY JSON (스냅샷)',
  `order_by`        varchar(100) DEFAULT NULL,
  `order_dir`       varchar(10)  DEFAULT 'DESC',
  `limit_val`       int(11)      DEFAULT 1000,
  `prompt`          text         DEFAULT NULL           COMMENT '추가 프롬프트',
  `generated_sql`   text         DEFAULT NULL           COMMENT '생성된 SQL',
  `memo`            varchar(500) DEFAULT NULL           COMMENT '공유 메모',
  `is_read`         tinyint(1)   NOT NULL DEFAULT 0    COMMENT '읽음 여부 (0=안읽음, 1=읽음)',
  `created_at`      timestamp    NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_shared_to`   (`to_user_id`, `created_at` DESC),
  KEY `idx_shared_from` (`from_user_id`),
  KEY `idx_history_id`  (`history_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='쿼리 공유 테이블';
