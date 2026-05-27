-- ============================================================
-- 배치 작업 이력 테이블
-- SAP RFC 동기화 등 배치 작업 실행 이력 관리
-- ※ 서버 시작 시 자동 생성되지만, 수동 생성도 가능
-- ============================================================

CREATE TABLE IF NOT EXISTS `batch_jobs` (
  `id`             int(11)      NOT NULL AUTO_INCREMENT,
  `job_type`       varchar(50)  NOT NULL DEFAULT 'SAP_RFC_SYNC' COMMENT '작업유형',
  `cmonth`         varchar(6)   NOT NULL      COMMENT '입력년월 (YYYYMM)',
  `mode`           varchar(20)  NOT NULL DEFAULT 'replace' COMMENT '실행모드: replace/append/dry-run',
  `status`         enum('pending','running','success','failed','cancelled') NOT NULL DEFAULT 'pending',
  `started_at`     datetime     DEFAULT NULL,
  `finished_at`    datetime     DEFAULT NULL,
  `total_rows`     int(11)      DEFAULT 0     COMMENT 'T_DATA 수신 행 수',
  `inserted_rows`  int(11)      DEFAULT 0     COMMENT 'DB INSERT 행 수',
  `deleted_rows`   int(11)      DEFAULT 0     COMMENT 'DELETE한 기존 행 수',
  `error_message`  text         DEFAULT NULL,
  `log_text`       longtext     DEFAULT NULL  COMMENT '실행 로그',
  `created_by`     varchar(50)  DEFAULT NULL  COMMENT '실행자 ID',
  `created_at`     datetime     DEFAULT current_timestamp(),
  `updated_at`     datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_batch_status` (`status`),
  KEY `idx_batch_cmonth` (`cmonth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='배치 작업 이력';
