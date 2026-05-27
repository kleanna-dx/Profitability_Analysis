-- ============================================================
-- Module-Profit 테이블 생성 DDL
-- 대상 DB: integration (MariaDB)
-- 실행: mysql -u appuser -p integration < 001_create_profit_tables.sql
-- ============================================================

USE integration;

-- ── 1. 배치 상태 ──
CREATE TABLE IF NOT EXISTS profit_batch_status (
    BATCH_ID            BIGINT AUTO_INCREMENT PRIMARY KEY,
    BATCH_NAME          VARCHAR(200)    NOT NULL,
    BATCH_TYPE          VARCHAR(50)     NOT NULL,
    SOURCE_SYSTEM       VARCHAR(100),
    TARGET_TABLE        VARCHAR(200),
    STATUS              VARCHAR(20)     NOT NULL DEFAULT 'PENDING',
    TOTAL_ROWS          BIGINT,
    PROCESSED_ROWS      BIGINT          DEFAULT 0,
    ERROR_ROWS          BIGINT          DEFAULT 0,
    PERIOD_YEAR         INT,
    PERIOD_MONTH        INT,
    ERROR_MESSAGE       TEXT,
    STARTED_AT          DATETIME,
    COMPLETED_AT        DATETIME,
    EXECUTION_TIME_MS   BIGINT,
    CREATED_BY          VARCHAR(50),
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 2. Ontology 컬럼 ──
CREATE TABLE IF NOT EXISTS profit_ontology_column (
    ONTOLOGY_COLUMN_ID  BIGINT AUTO_INCREMENT PRIMARY KEY,
    COLUMN_NAME         VARCHAR(100)    NOT NULL,
    TABLE_NAME          VARCHAR(200)    NOT NULL,
    COLUMN_DESCRIPTION  VARCHAR(500),
    DATA_TYPE           VARCHAR(50),
    COLUMN_GROUP        VARCHAR(100),
    SORT_ORDER          INT,
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1,
    CREATED_BY          VARCHAR(50),
    UPDATED_BY          VARCHAR(50),
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT          DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 3. Ontology 동의어 ──
CREATE TABLE IF NOT EXISTS profit_ontology_synonym (
    SYNONYM_ID          BIGINT AUTO_INCREMENT PRIMARY KEY,
    ONTOLOGY_COLUMN_ID  BIGINT          NOT NULL,
    SYNONYM_TEXT        VARCHAR(200)    NOT NULL,
    SYNONYM_SOURCE      VARCHAR(50),
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1,
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ontology_synonym_column
        FOREIGN KEY (ONTOLOGY_COLUMN_ID) REFERENCES profit_ontology_column(ONTOLOGY_COLUMN_ID)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 4. Metric (계산 지표) ──
CREATE TABLE IF NOT EXISTS profit_metric (
    METRIC_ID           BIGINT AUTO_INCREMENT PRIMARY KEY,
    METRIC_CODE         VARCHAR(100)    NOT NULL UNIQUE,
    METRIC_NAME         VARCHAR(200)    NOT NULL,
    AGGREGATION         VARCHAR(20)     NOT NULL,
    FORMULA             VARCHAR(2000)   NOT NULL,
    TABLE_NAME          VARCHAR(200)    NOT NULL,
    DESCRIPTION         VARCHAR(1000),
    DISPLAY_FORMAT      VARCHAR(50),
    UNIT                VARCHAR(50),
    SORT_ORDER          INT,
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1,
    CREATED_BY          VARCHAR(50),
    UPDATED_BY          VARCHAR(50),
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT          DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 5. Metric 동의어 ──
CREATE TABLE IF NOT EXISTS profit_metric_synonym (
    METRIC_SYNONYM_ID   BIGINT AUTO_INCREMENT PRIMARY KEY,
    METRIC_ID           BIGINT          NOT NULL,
    SYNONYM_TEXT        VARCHAR(200)    NOT NULL,
    SYNONYM_SOURCE      VARCHAR(50),
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1,
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_metric_synonym_metric
        FOREIGN KEY (METRIC_ID) REFERENCES profit_metric(METRIC_ID)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 6. JOIN 조건 ──
CREATE TABLE IF NOT EXISTS profit_join_condition (
    JOIN_CONDITION_ID   BIGINT AUTO_INCREMENT PRIMARY KEY,
    JOIN_NAME           VARCHAR(200),
    LEFT_COLUMN         VARCHAR(100)    NOT NULL,
    LEFT_TABLE          VARCHAR(200)    NOT NULL,
    RIGHT_COLUMN        VARCHAR(100)    NOT NULL,
    RIGHT_TABLE         VARCHAR(200)    NOT NULL,
    JOIN_TYPE           VARCHAR(20)     NOT NULL DEFAULT 'INNER',
    OPERATOR            VARCHAR(10)     NOT NULL DEFAULT '=',
    SORT_ORDER          INT,
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1,
    CREATED_BY          VARCHAR(50),
    UPDATED_BY          VARCHAR(50),
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT          DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 7. 매핑 인박스 ──
CREATE TABLE IF NOT EXISTS profit_mapping_inbox (
    INBOX_ID            BIGINT AUTO_INCREMENT PRIMARY KEY,
    UNMAPPED_TERM       VARCHAR(300)    NOT NULL,
    TERM_TYPE           VARCHAR(30)     NOT NULL,
    ORIGINAL_QUERY      VARCHAR(2000),
    SUGGESTED_COLUMN    VARCHAR(100),
    SUGGESTED_METRIC_CODE VARCHAR(100),
    OCCURRENCE_COUNT    INT             NOT NULL DEFAULT 1,
    STATUS              VARCHAR(20)     NOT NULL DEFAULT 'PENDING',
    RESOLVED_BY         VARCHAR(50),
    RESOLVED_AT         DATETIME,
    RESOLUTION_NOTE     VARCHAR(500),
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT          DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 8. 자연어 질의 이력 ──
CREATE TABLE IF NOT EXISTS profit_nl_query_history (
    QUERY_HISTORY_ID    BIGINT AUTO_INCREMENT PRIMARY KEY,
    USER_ID             BIGINT,
    USER_NAME           VARCHAR(100),
    NATURAL_QUERY       VARCHAR(2000)   NOT NULL,
    GENERATED_SQL       TEXT,
    QUERY_MODE          VARCHAR(20)     DEFAULT 'NLQ',
    RESULT_COUNT        INT,
    RESULT_SUMMARY      TEXT,
    METRICS_USED        VARCHAR(1000),
    FILTERS_USED        VARCHAR(1000),
    DATA_SOURCE         VARCHAR(500),
    EXECUTION_TIME_MS   BIGINT,
    STATUS              VARCHAR(20)     NOT NULL DEFAULT 'PENDING',
    ERROR_MESSAGE       VARCHAR(2000),
    FEEDBACK_SCORE      INT,
    FEEDBACK_COMMENT    VARCHAR(1000),
    IS_BOOKMARKED       TINYINT(1)      NOT NULL DEFAULT 0,
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── 인덱스 ──
CREATE INDEX idx_batch_status ON profit_batch_status(STATUS);
CREATE INDEX idx_batch_period ON profit_batch_status(PERIOD_YEAR, PERIOD_MONTH);
CREATE INDEX idx_ontology_column_table ON profit_ontology_column(TABLE_NAME);
CREATE INDEX idx_ontology_synonym_text ON profit_ontology_synonym(SYNONYM_TEXT);
CREATE INDEX idx_metric_code ON profit_metric(METRIC_CODE);
CREATE INDEX idx_metric_synonym_text ON profit_metric_synonym(SYNONYM_TEXT);
CREATE INDEX idx_join_active ON profit_join_condition(IS_ACTIVE);
CREATE INDEX idx_mapping_status ON profit_mapping_inbox(STATUS);
CREATE INDEX idx_query_history_user ON profit_nl_query_history(USER_ID);
CREATE INDEX idx_query_history_created ON profit_nl_query_history(CREATED_AT);
