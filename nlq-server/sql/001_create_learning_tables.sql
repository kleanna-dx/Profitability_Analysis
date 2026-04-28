-- ============================================================
-- 학습관리 테이블 생성 (Ontology / Metric / JOIN)
-- DB: company_board
-- ============================================================

-- 1) Ontology 컬럼 사전
CREATE TABLE IF NOT EXISTS `ontology_column` (
  `id`          INT(11)       NOT NULL AUTO_INCREMENT,
  `column_name` VARCHAR(100)  NOT NULL   COMMENT '컬럼 영문명 (DB컬럼)',
  `table_name`  VARCHAR(200)  DEFAULT 'bw_profitability_data' COMMENT '소속 테이블',
  `description` VARCHAR(300)  DEFAULT NULL COMMENT '컬럼 설명',
  `data_type`   VARCHAR(50)   DEFAULT NULL COMMENT '데이터 타입',
  `created_at`  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_col_table` (`column_name`, `table_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='온톨로지 컬럼 사전';

-- 2) Ontology 동의어
CREATE TABLE IF NOT EXISTS `ontology_synonym` (
  `id`           INT(11)      NOT NULL AUTO_INCREMENT,
  `column_id`    INT(11)      NOT NULL   COMMENT 'ontology_column FK',
  `synonym_text` VARCHAR(200) NOT NULL   COMMENT '자연어 동의어',
  `created_at`   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_col_syn` (`column_id`, `synonym_text`),
  CONSTRAINT `fk_ont_syn_col` FOREIGN KEY (`column_id`) REFERENCES `ontology_column`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='온톨로지 동의어';

-- 3) Metric 계산지표 사전
CREATE TABLE IF NOT EXISTS `metric` (
  `id`          INT(11)       NOT NULL AUTO_INCREMENT,
  `metric_code` VARCHAR(100)  NOT NULL   COMMENT '지표 코드 (예: NETSALES)',
  `aggregation` VARCHAR(20)   DEFAULT 'SUM' COMMENT '집계 방식 (SUM, AVG, COUNT, CALC 등)',
  `formula`     VARCHAR(500)  NOT NULL   COMMENT '계산식 (예: ZAMT001 - ZAMT002)',
  `table_name`  VARCHAR(200)  DEFAULT 'bw_profitability_data' COMMENT '소속 테이블',
  `description` VARCHAR(300)  DEFAULT NULL COMMENT '지표 설명',
  `created_at`  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_metric_code` (`metric_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='계산 지표 사전';

-- 4) Metric 동의어
CREATE TABLE IF NOT EXISTS `metric_synonym` (
  `id`           INT(11)      NOT NULL AUTO_INCREMENT,
  `metric_id`    INT(11)      NOT NULL   COMMENT 'metric FK',
  `synonym_text` VARCHAR(200) NOT NULL   COMMENT '자연어 동의어',
  `created_at`   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_metric_syn` (`metric_id`, `synonym_text`),
  CONSTRAINT `fk_met_syn_met` FOREIGN KEY (`metric_id`) REFERENCES `metric`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='지표 동의어';

-- 5) JOIN 조건 사전
CREATE TABLE IF NOT EXISTS `join_condition` (
  `id`           INT(11)      NOT NULL AUTO_INCREMENT,
  `left_column`  VARCHAR(100) NOT NULL   COMMENT '왼쪽 컬럼',
  `left_table`   VARCHAR(200) NOT NULL   COMMENT '왼쪽 테이블',
  `right_column` VARCHAR(100) NOT NULL   COMMENT '오른쪽 컬럼',
  `right_table`  VARCHAR(200) NOT NULL   COMMENT '오른쪽 테이블',
  `join_type`    VARCHAR(20)  DEFAULT 'LEFT' COMMENT 'INNER / LEFT / RIGHT / FULL',
  `operator`     VARCHAR(10)  DEFAULT '=' COMMENT '연산자',
  `description`  VARCHAR(300) DEFAULT NULL COMMENT '설명',
  `created_at`   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='조인 조건 사전';
