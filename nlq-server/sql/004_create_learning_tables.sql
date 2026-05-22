-- ============================================================
-- 학습관리 테이블 (Ontology / Metric / Code Mapping / JOIN / Feedback)
-- NLQ AI가 SQL 생성 시 참조하는 메타데이터
-- ============================================================

-- 1) 온톨로지 컬럼 사전
CREATE TABLE IF NOT EXISTS `ontology_column` (
  `id`          int(11)      NOT NULL AUTO_INCREMENT,
  `column_name` varchar(100) NOT NULL   COMMENT '컬럼 영문명 (DB컬럼)',
  `table_name`  varchar(200) DEFAULT 'bw_profitability_data' COMMENT '소속 테이블',
  `description` varchar(300) DEFAULT NULL COMMENT '컬럼 설명',
  `data_type`   varchar(50)  DEFAULT NULL COMMENT '데이터 타입',
  `created_at`  datetime     DEFAULT current_timestamp(),
  `updated_at`  datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_col_table` (`column_name`, `table_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='온톨로지 컬럼 사전';


-- 2) 온톨로지 동의어
CREATE TABLE IF NOT EXISTS `ontology_synonym` (
  `id`           int(11)      NOT NULL AUTO_INCREMENT,
  `column_id`    int(11)      NOT NULL   COMMENT 'ontology_column FK',
  `synonym_text` varchar(200) NOT NULL   COMMENT '자연어 동의어',
  `created_at`   datetime     DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_col_syn` (`column_id`, `synonym_text`),
  CONSTRAINT `ontology_synonym_ibfk_1` FOREIGN KEY (`column_id`) REFERENCES `ontology_column`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='온톨로지 동의어';


-- 3) 계산지표 사전
CREATE TABLE IF NOT EXISTS `metric` (
  `id`          int(11)      NOT NULL AUTO_INCREMENT,
  `metric_code` varchar(100) NOT NULL   COMMENT '지표 코드 (예: NETSALES)',
  `aggregation` varchar(20)  DEFAULT 'SUM' COMMENT '집계 방식 (SUM, AVG, COUNT, CALC 등)',
  `formula`     varchar(500) NOT NULL   COMMENT '계산식 (예: ZAMT001 - ZAMT002)',
  `table_name`  varchar(200) DEFAULT 'bw_profitability_data' COMMENT '소속 테이블',
  `description` varchar(300) DEFAULT NULL COMMENT '지표 설명',
  `created_at`  datetime     DEFAULT current_timestamp(),
  `updated_at`  datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_metric_code` (`metric_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='계산 지표 사전';


-- 4) 지표 동의어
CREATE TABLE IF NOT EXISTS `metric_synonym` (
  `id`           int(11)      NOT NULL AUTO_INCREMENT,
  `metric_id`    int(11)      NOT NULL   COMMENT 'metric FK',
  `synonym_text` varchar(200) NOT NULL   COMMENT '자연어 동의어',
  `created_at`   datetime     DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_metric_syn` (`metric_id`, `synonym_text`),
  CONSTRAINT `metric_synonym_ibfk_1` FOREIGN KEY (`metric_id`) REFERENCES `metric`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='지표 동의어';


-- 5) 코드값-명칭 매핑 사전
CREATE TABLE IF NOT EXISTS `code_mapping` (
  `id`             int(11)      NOT NULL AUTO_INCREMENT,
  `column_name`    varchar(100) NOT NULL   COMMENT '대상 컬럼 (코드 컬럼, 예: PROFIT_CTR)',
  `column_name_nm` varchar(100) DEFAULT NULL COMMENT '명칭 컬럼 (예: PROFIT_CTR_NM) - NULL이면 AI가 CASE WHEN 사용',
  `code_value`     varchar(100) NOT NULL   COMMENT '코드값 (예: 2000)',
  `display_name`   varchar(200) NOT NULL   COMMENT '표시 명칭 (예: 제지사업부)',
  `table_name`     varchar(200) DEFAULT 'bw_profitability_data' COMMENT '대상 테이블',
  `description`    varchar(300) DEFAULT NULL COMMENT '설명 메모',
  `is_active`      tinyint(1)   DEFAULT 1  COMMENT '활성 여부',
  `created_at`     datetime     DEFAULT current_timestamp(),
  `updated_at`     datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_col_code` (`column_name`, `code_value`, `table_name`),
  KEY `idx_code_mapping_col` (`column_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='코드값-명칭 매핑 사전';


-- 6) 조인 조건 사전
CREATE TABLE IF NOT EXISTS `join_condition` (
  `id`           int(11)      NOT NULL AUTO_INCREMENT,
  `left_column`  varchar(100) NOT NULL   COMMENT '왼쪽 컬럼',
  `left_table`   varchar(200) NOT NULL   COMMENT '왼쪽 테이블',
  `right_column` varchar(100) NOT NULL   COMMENT '오른쪽 컬럼',
  `right_table`  varchar(200) NOT NULL   COMMENT '오른쪽 테이블',
  `join_type`    varchar(20)  DEFAULT 'LEFT' COMMENT 'INNER / LEFT / RIGHT / FULL',
  `operator`     varchar(10)  DEFAULT '='    COMMENT '연산자',
  `description`  varchar(300) DEFAULT NULL   COMMENT '설명',
  `created_at`   datetime     DEFAULT current_timestamp(),
  `updated_at`   datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='조인 조건 사전';


-- 7) SQL 피드백 학습 데이터
CREATE TABLE IF NOT EXISTS `sql_feedback` (
  `id`            int(11)       NOT NULL AUTO_INCREMENT,
  `query_text`    varchar(2000) NOT NULL   COMMENT '원래 자연어 질문',
  `original_sql`  text          DEFAULT NULL COMMENT 'AI가 생성한 원본 SQL',
  `corrected_sql` text          DEFAULT NULL COMMENT '사용자가 수정한 SQL',
  `feedback_type` enum('correct','corrected') NOT NULL COMMENT 'correct=정확해요, corrected=수정됨',
  `is_active`     tinyint(1)    DEFAULT 1  COMMENT '학습에 사용 여부',
  `created_at`    datetime      DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_feedback_active`  (`is_active`, `feedback_type`),
  KEY `idx_feedback_created` (`created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='SQL 피드백 학습 데이터';
