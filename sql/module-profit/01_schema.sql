-- ============================================================
-- module-profit: RAG 기반 수익성분석 AI 챗봇 모듈 DDL
-- 실행 환경: MariaDB 10.11+ (utf8mb4)
-- 실행 순서: 이 파일을 가장 먼저 실행하세요
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ontology 컬럼 (BW DB 컬럼 메타데이터)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_ontology_column (
    ONTOLOGY_COLUMN_ID  BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'Ontology 컬럼 ID (PK)',
    COLUMN_NAME         VARCHAR(100)  NOT NULL                COMMENT 'BW DB 컬럼 물리명',
    TABLE_NAME          VARCHAR(200)  NOT NULL                COMMENT 'BW DB 테이블명 (예: /BIC/OHYOHC0004)',
    COLUMN_DESCRIPTION  VARCHAR(500)  NULL                    COMMENT '컬럼 설명 (한글)',
    DATA_TYPE           VARCHAR(50)   NULL                    COMMENT '데이터 타입 (VARCHAR, DECIMAL 등)',
    COLUMN_GROUP        VARCHAR(100)  NULL                    COMMENT '컬럼 그룹 (기간, 조직/사업부, 자재/제품 등)',
    SORT_ORDER          INT           NULL                    COMMENT '정렬 순서',
    IS_ACTIVE           TINYINT(1)    NOT NULL DEFAULT 1      COMMENT '활성 여부 (1=활성, 0=비활성)',
    CREATED_BY          VARCHAR(50)   NULL                    COMMENT '생성자',
    UPDATED_BY          VARCHAR(50)   NULL                    COMMENT '수정자',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT          DATETIME      NULL     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',

    PRIMARY KEY (ONTOLOGY_COLUMN_ID),
    CONSTRAINT UK_PROFIT_ONTCOL_NAME_TABLE UNIQUE (COLUMN_NAME, TABLE_NAME)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 Ontology 컬럼 (BW DB 컬럼 메타데이터)';

CREATE INDEX IDX_PROFIT_ONTCOL_TABLE    ON profit_ontology_column (TABLE_NAME);
CREATE INDEX IDX_PROFIT_ONTCOL_GROUP    ON profit_ontology_column (COLUMN_GROUP);
CREATE INDEX IDX_PROFIT_ONTCOL_ACTIVE   ON profit_ontology_column (IS_ACTIVE);


-- ------------------------------------------------------------
-- 2. Ontology 동의어 (컬럼-자연어 매핑)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_ontology_synonym (
    SYNONYM_ID          BIGINT        NOT NULL AUTO_INCREMENT COMMENT '동의어 ID (PK)',
    ONTOLOGY_COLUMN_ID  BIGINT        NOT NULL                COMMENT 'Ontology 컬럼 ID (FK)',
    SYNONYM_TEXT        VARCHAR(200)  NOT NULL                COMMENT '동의어 텍스트 (예: 순매출, 브랜드 1)',
    SYNONYM_SOURCE      VARCHAR(50)   NULL                    COMMENT '동의어 출처 (MANUAL, EXCEL_UPLOAD, AI_SUGGEST)',
    IS_ACTIVE           TINYINT(1)    NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',

    PRIMARY KEY (SYNONYM_ID),
    CONSTRAINT FK_PROFIT_ONTSYN_COLUMN FOREIGN KEY (ONTOLOGY_COLUMN_ID)
        REFERENCES profit_ontology_column (ONTOLOGY_COLUMN_ID) ON DELETE CASCADE,
    CONSTRAINT UK_PROFIT_ONTSYN_TEXT_COL UNIQUE (SYNONYM_TEXT, ONTOLOGY_COLUMN_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 Ontology 동의어 (컬럼-자연어 매핑)';

CREATE INDEX IDX_PROFIT_ONTSYN_COLID   ON profit_ontology_synonym (ONTOLOGY_COLUMN_ID);
CREATE INDEX IDX_PROFIT_ONTSYN_TEXT    ON profit_ontology_synonym (SYNONYM_TEXT);
CREATE INDEX IDX_PROFIT_ONTSYN_ACTIVE  ON profit_ontology_synonym (IS_ACTIVE);


-- ------------------------------------------------------------
-- 3. Metric (계산 지표 사전)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_metric (
    METRIC_ID           BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'Metric ID (PK)',
    METRIC_CODE         VARCHAR(100)  NOT NULL                COMMENT 'Metric 고유 코드 (예: NETSALES, FG_COST)',
    METRIC_NAME         VARCHAR(200)  NOT NULL                COMMENT 'Metric 표시명 (예: 순매출, 제품원가)',
    AGGREGATION         VARCHAR(20)   NOT NULL                COMMENT '집계 방식 (SUM, AVG, COUNT, MAX, MIN)',
    FORMULA             VARCHAR(2000) NOT NULL                COMMENT '계산식 (예: ZAMT001 - ZAMT002 - ZAMT004)',
    TABLE_NAME          VARCHAR(200)  NOT NULL                COMMENT '기준 테이블명',
    DESCRIPTION         VARCHAR(1000) NULL                    COMMENT 'Metric 상세 설명',
    DISPLAY_FORMAT      VARCHAR(50)   NULL                    COMMENT '표시 형식 (예: #,##0, 0.00%)',
    UNIT                VARCHAR(50)   NULL                    COMMENT '단위 (원, 천원, kg 등)',
    SORT_ORDER          INT           NULL                    COMMENT '정렬 순서',
    IS_ACTIVE           TINYINT(1)    NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_BY          VARCHAR(50)   NULL                    COMMENT '생성자',
    UPDATED_BY          VARCHAR(50)   NULL                    COMMENT '수정자',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT          DATETIME      NULL     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',

    PRIMARY KEY (METRIC_ID),
    CONSTRAINT UK_PROFIT_METRIC_CODE UNIQUE (METRIC_CODE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 Metric 사전 (계산 지표 정의)';

CREATE INDEX IDX_PROFIT_METRIC_TABLE   ON profit_metric (TABLE_NAME);
CREATE INDEX IDX_PROFIT_METRIC_ACTIVE  ON profit_metric (IS_ACTIVE);


-- ------------------------------------------------------------
-- 4. Metric 동의어 (Metric-자연어 매핑)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_metric_synonym (
    METRIC_SYNONYM_ID   BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'Metric 동의어 ID (PK)',
    METRIC_ID           BIGINT        NOT NULL                COMMENT 'Metric ID (FK)',
    SYNONYM_TEXT        VARCHAR(200)  NOT NULL                COMMENT '동의어 텍스트 (예: 순매출, 매출액)',
    SYNONYM_SOURCE      VARCHAR(50)   NULL                    COMMENT '동의어 출처 (MANUAL, EXCEL_UPLOAD, AI_SUGGEST)',
    IS_ACTIVE           TINYINT(1)    NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',

    PRIMARY KEY (METRIC_SYNONYM_ID),
    CONSTRAINT FK_PROFIT_METSYN_METRIC FOREIGN KEY (METRIC_ID)
        REFERENCES profit_metric (METRIC_ID) ON DELETE CASCADE,
    CONSTRAINT UK_PROFIT_METSYN_TEXT_MET UNIQUE (SYNONYM_TEXT, METRIC_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 Metric 동의어 (Metric-자연어 매핑)';

CREATE INDEX IDX_PROFIT_METSYN_METID   ON profit_metric_synonym (METRIC_ID);
CREATE INDEX IDX_PROFIT_METSYN_TEXT    ON profit_metric_synonym (SYNONYM_TEXT);
CREATE INDEX IDX_PROFIT_METSYN_ACTIVE  ON profit_metric_synonym (IS_ACTIVE);


-- ------------------------------------------------------------
-- 5. JOIN 조건 (테이블 간 연결 규칙)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_join_condition (
    JOIN_CONDITION_ID   BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'JOIN 조건 ID (PK)',
    JOIN_NAME           VARCHAR(200)  NULL                    COMMENT 'JOIN 조건명 (설명용)',
    LEFT_COLUMN         VARCHAR(100)  NOT NULL                COMMENT '좌측 컬럼명',
    LEFT_TABLE          VARCHAR(200)  NOT NULL                COMMENT '좌측 테이블명',
    RIGHT_COLUMN        VARCHAR(100)  NOT NULL                COMMENT '우측 컬럼명',
    RIGHT_TABLE         VARCHAR(200)  NOT NULL                COMMENT '우측 테이블명',
    JOIN_TYPE           VARCHAR(20)   NOT NULL DEFAULT 'INNER' COMMENT 'JOIN 타입 (INNER, LEFT)',
    OPERATOR            VARCHAR(10)   NOT NULL DEFAULT '='    COMMENT '비교 연산자 (=, <>, >=, <=)',
    SORT_ORDER          INT           NULL                    COMMENT '정렬 순서',
    IS_ACTIVE           TINYINT(1)    NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_BY          VARCHAR(50)   NULL                    COMMENT '생성자',
    UPDATED_BY          VARCHAR(50)   NULL                    COMMENT '수정자',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT          DATETIME      NULL     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',

    PRIMARY KEY (JOIN_CONDITION_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 JOIN 조건 (테이블 간 연결 규칙)';

CREATE INDEX IDX_PROFIT_JOIN_LTABLE    ON profit_join_condition (LEFT_TABLE);
CREATE INDEX IDX_PROFIT_JOIN_RTABLE    ON profit_join_condition (RIGHT_TABLE);
CREATE INDEX IDX_PROFIT_JOIN_ACTIVE    ON profit_join_condition (IS_ACTIVE);


-- ------------------------------------------------------------
-- 6. 자연어 질의 이력 (학습 데이터)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_nl_query_history (
    QUERY_HISTORY_ID    BIGINT        NOT NULL AUTO_INCREMENT COMMENT '질의 이력 ID (PK)',
    USER_ID             BIGINT        NULL                    COMMENT '사용자 ID (core_user 참조)',
    USER_NAME           VARCHAR(100)  NULL                    COMMENT '사용자명',
    NATURAL_QUERY       VARCHAR(2000) NOT NULL                COMMENT '사용자 자연어 질문 원문',
    GENERATED_SQL       TEXT          NULL                    COMMENT '생성된 SQL문',
    QUERY_MODE          VARCHAR(20)   NULL     DEFAULT 'NLQ'  COMMENT '질의 모드 (NLQ, SQL, VISUAL)',
    RESULT_COUNT        INT           NULL                    COMMENT '결과 행 수',
    RESULT_SUMMARY      TEXT          NULL                    COMMENT '결과 요약 (AI 생성)',
    METRICS_USED        VARCHAR(1000) NULL                    COMMENT '사용된 Metric 목록 (JSON)',
    FILTERS_USED        VARCHAR(1000) NULL                    COMMENT '사용된 필터 조건 (JSON)',
    DATA_SOURCE         VARCHAR(500)  NULL                    COMMENT '데이터 출처 테이블명',
    EXECUTION_TIME_MS   BIGINT        NULL                    COMMENT 'SQL 실행 시간 (밀리초)',
    STATUS              VARCHAR(20)   NOT NULL DEFAULT 'PENDING' COMMENT '상태 (PENDING, SUCCESS, FAILED)',
    ERROR_MESSAGE       VARCHAR(2000) NULL                    COMMENT '오류 메시지',
    FEEDBACK_SCORE      INT           NULL                    COMMENT '피드백 점수 (1~5)',
    FEEDBACK_COMMENT    VARCHAR(1000) NULL                    COMMENT '피드백 코멘트',
    IS_BOOKMARKED       TINYINT(1)    NOT NULL DEFAULT 0      COMMENT '북마크 여부',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시 (질문 시각)',

    PRIMARY KEY (QUERY_HISTORY_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 자연어 질의 이력 (학습 데이터)';

CREATE INDEX IDX_PROFIT_NLQH_USER      ON profit_nl_query_history (USER_ID);
CREATE INDEX IDX_PROFIT_NLQH_STATUS    ON profit_nl_query_history (STATUS);
CREATE INDEX IDX_PROFIT_NLQH_CREATED   ON profit_nl_query_history (CREATED_AT);
CREATE INDEX IDX_PROFIT_NLQH_BOOKMARK  ON profit_nl_query_history (IS_BOOKMARKED);
CREATE INDEX IDX_PROFIT_NLQH_MODE      ON profit_nl_query_history (QUERY_MODE);


-- ------------------------------------------------------------
-- 7. 배치 상태 (SAP→BW 데이터 적재 이력)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_batch_status (
    BATCH_ID            BIGINT        NOT NULL AUTO_INCREMENT COMMENT '배치 ID (PK)',
    BATCH_NAME          VARCHAR(200)  NOT NULL                COMMENT '배치명',
    BATCH_TYPE          VARCHAR(50)   NOT NULL                COMMENT '배치 유형 (SAP_CLOSE, DATA_LOAD, VALIDATION, INDEX_BUILD)',
    SOURCE_SYSTEM       VARCHAR(100)  NULL                    COMMENT '소스 시스템 (SAP, BW 등)',
    TARGET_TABLE        VARCHAR(200)  NULL                    COMMENT '대상 테이블명',
    STATUS              VARCHAR(20)   NOT NULL DEFAULT 'PENDING' COMMENT '상태 (PENDING, RUNNING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED)',
    TOTAL_ROWS          BIGINT        NULL                    COMMENT '전체 처리 대상 행 수',
    PROCESSED_ROWS      BIGINT        NULL     DEFAULT 0      COMMENT '처리 완료 행 수',
    ERROR_ROWS          BIGINT        NULL     DEFAULT 0      COMMENT '오류 행 수',
    PERIOD_YEAR         INT           NULL                    COMMENT '마감 연도',
    PERIOD_MONTH        INT           NULL                    COMMENT '마감 월',
    ERROR_MESSAGE       TEXT          NULL                    COMMENT '오류 메시지',
    STARTED_AT          DATETIME      NULL                    COMMENT '배치 시작 일시',
    COMPLETED_AT        DATETIME      NULL                    COMMENT '배치 완료 일시',
    EXECUTION_TIME_MS   BIGINT        NULL                    COMMENT '실행 시간 (밀리초)',
    CREATED_BY          VARCHAR(50)   NULL                    COMMENT '생성자 (배치 실행자)',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',

    PRIMARY KEY (BATCH_ID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 배치 상태 (SAP→BW 데이터 적재 이력)';

CREATE INDEX IDX_PROFIT_BATCH_STATUS   ON profit_batch_status (STATUS);
CREATE INDEX IDX_PROFIT_BATCH_TYPE     ON profit_batch_status (BATCH_TYPE);
CREATE INDEX IDX_PROFIT_BATCH_PERIOD   ON profit_batch_status (PERIOD_YEAR, PERIOD_MONTH);
CREATE INDEX IDX_PROFIT_BATCH_CREATED  ON profit_batch_status (CREATED_AT);
CREATE INDEX IDX_PROFIT_BATCH_TARGET   ON profit_batch_status (TARGET_TABLE);


-- ------------------------------------------------------------
-- 8. 매핑 인박스 (미매핑 용어 수집)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_mapping_inbox (
    INBOX_ID              BIGINT        NOT NULL AUTO_INCREMENT COMMENT '인박스 ID (PK)',
    UNMAPPED_TERM         VARCHAR(300)  NOT NULL                COMMENT '미매핑 용어 (사용자 입력 원문)',
    TERM_TYPE             VARCHAR(30)   NOT NULL                COMMENT '용어 유형 (COLUMN, METRIC, VALUE, FILTER)',
    ORIGINAL_QUERY        VARCHAR(2000) NULL                    COMMENT '원래 질의문 전체',
    SUGGESTED_COLUMN      VARCHAR(100)  NULL                    COMMENT 'AI 제안 매핑 컬럼',
    SUGGESTED_METRIC_CODE VARCHAR(100)  NULL                    COMMENT 'AI 제안 매핑 Metric 코드',
    OCCURRENCE_COUNT      INT           NOT NULL DEFAULT 1      COMMENT '발생 횟수 (같은 용어 누적)',
    STATUS                VARCHAR(20)   NOT NULL DEFAULT 'PENDING' COMMENT '처리 상태 (PENDING, APPROVED, REJECTED)',
    RESOLVED_BY           VARCHAR(50)   NULL                    COMMENT '처리자',
    RESOLVED_AT           DATETIME      NULL                    COMMENT '처리 일시',
    RESOLUTION_NOTE       VARCHAR(500)  NULL                    COMMENT '처리 메모',
    CREATED_AT            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '최초 발생 일시',
    UPDATED_AT            DATETIME      NULL     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시',

    PRIMARY KEY (INBOX_ID),
    CONSTRAINT UK_PROFIT_INBOX_TERM_TYPE UNIQUE (UNMAPPED_TERM, TERM_TYPE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 매핑 인박스 (미매핑 용어 수집 및 관리)';

CREATE INDEX IDX_PROFIT_INBOX_STATUS   ON profit_mapping_inbox (STATUS);
CREATE INDEX IDX_PROFIT_INBOX_TYPE     ON profit_mapping_inbox (TERM_TYPE);
CREATE INDEX IDX_PROFIT_INBOX_COUNT    ON profit_mapping_inbox (OCCURRENCE_COUNT DESC);
CREATE INDEX IDX_PROFIT_INBOX_CREATED  ON profit_mapping_inbox (CREATED_AT);
