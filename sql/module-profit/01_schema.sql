-- ============================================================
-- module-profit: RAG 기반 수익성분석 AI 챗봇 스키마
-- DB       : MariaDB 10.11+ (utf8mb4)
-- 실행 순서 : 01_schema.sql → 02_seed_data.sql
-- 작성 기준 : 엔티티 @Table/@Column 매핑 1:1
-- ============================================================

-- ------------------------------------------------------------
-- 1. profit_ontology_column  (Ontology 컬럼 사전)
--    BW DB 테이블 컬럼 ↔ 자연어 매핑의 핵심 메타데이터
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_ontology_column (
    ONTOLOGY_COLUMN_ID  BIGINT          NOT NULL AUTO_INCREMENT COMMENT '온톨로지 컬럼 PK',
    COLUMN_NAME         VARCHAR(100)    NOT NULL                COMMENT 'BW DB 실제 컬럼명',
    TABLE_NAME          VARCHAR(200)    NOT NULL                COMMENT 'BW DB 테이블명 (스키마.테이블)',
    COLUMN_DESCRIPTION  VARCHAR(500)    NULL                    COMMENT '컬럼 설명 (자연어)',
    DATA_TYPE           VARCHAR(50)     NULL                    COMMENT '데이터 타입 (VARCHAR, DECIMAL 등)',
    COLUMN_GROUP        VARCHAR(100)    NULL                    COMMENT '컬럼 그룹 (기간, 사업부, 제품 등)',
    SORT_ORDER          INT             NULL                    COMMENT '표시 정렬 순서',
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '활성 여부 (1=활성, 0=비활성)',
    CREATED_BY          VARCHAR(50)     NULL                    COMMENT '생성자',
    UPDATED_BY          VARCHAR(50)     NULL                    COMMENT '수정자',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT          DATETIME        NULL                    COMMENT '수정일시',
    PRIMARY KEY (ONTOLOGY_COLUMN_ID),
    INDEX IDX_ONTOLOGY_COLUMN_TABLE_NAME  (TABLE_NAME),
    INDEX IDX_ONTOLOGY_COLUMN_GROUP       (COLUMN_GROUP),
    INDEX IDX_ONTOLOGY_COLUMN_ACTIVE      (IS_ACTIVE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='온톨로지 컬럼 사전 – BW DB 컬럼과 자연어 매핑';


-- ------------------------------------------------------------
-- 2. profit_ontology_synonym  (Ontology 동의어)
--    하나의 컬럼에 여러 자연어 표현을 매핑
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_ontology_synonym (
    SYNONYM_ID          BIGINT          NOT NULL AUTO_INCREMENT COMMENT '동의어 PK',
    ONTOLOGY_COLUMN_ID  BIGINT          NOT NULL                COMMENT 'FK → profit_ontology_column',
    SYNONYM_TEXT        VARCHAR(200)    NOT NULL                COMMENT '동의어 텍스트 (자연어 표현)',
    SYNONYM_SOURCE      VARCHAR(50)     NULL                    COMMENT '동의어 출처 (MANUAL, AI, IMPORT)',
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    PRIMARY KEY (SYNONYM_ID),
    INDEX IDX_ONTOLOGY_SYNONYM_COLUMN     (ONTOLOGY_COLUMN_ID),
    INDEX IDX_ONTOLOGY_SYNONYM_TEXT       (SYNONYM_TEXT),
    CONSTRAINT FK_ONTOLOGY_SYNONYM_COLUMN
        FOREIGN KEY (ONTOLOGY_COLUMN_ID)
        REFERENCES profit_ontology_column (ONTOLOGY_COLUMN_ID)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='온톨로지 컬럼 동의어 – 하나의 컬럼에 여러 자연어 표현 매핑';


-- ------------------------------------------------------------
-- 3. profit_metric  (계산 지표 사전)
--    수익성분석 수식(공식)을 정의; AI는 이 사전만 참조
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_metric (
    METRIC_ID           BIGINT          NOT NULL AUTO_INCREMENT COMMENT '지표 PK',
    METRIC_CODE         VARCHAR(100)    NOT NULL                COMMENT '지표 코드 (NETSALES, GP 등)',
    METRIC_NAME         VARCHAR(200)    NOT NULL                COMMENT '지표명 (순매출, 매출총이익 등)',
    AGGREGATION         VARCHAR(20)     NOT NULL                COMMENT '집계 유형 (SUM, AVG, COUNT 등)',
    FORMULA             VARCHAR(2000)   NOT NULL                COMMENT '수식 표현 (ZAMT001-ZAMT002-ZAMT004)',
    TABLE_NAME          VARCHAR(200)    NOT NULL                COMMENT '수식이 참조하는 테이블',
    DESCRIPTION         VARCHAR(1000)   NULL                    COMMENT '지표 상세 설명',
    DISPLAY_FORMAT      VARCHAR(50)     NULL                    COMMENT '표시 형식 (#,##0 등)',
    UNIT                VARCHAR(50)     NULL                    COMMENT '단위 (원, %, BOX 등)',
    SORT_ORDER          INT             NULL                    COMMENT '표시 정렬 순서',
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_BY          VARCHAR(50)     NULL                    COMMENT '생성자',
    UPDATED_BY          VARCHAR(50)     NULL                    COMMENT '수정자',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT          DATETIME        NULL                    COMMENT '수정일시',
    PRIMARY KEY (METRIC_ID),
    UNIQUE KEY UK_METRIC_CODE (METRIC_CODE),
    INDEX IDX_METRIC_TABLE_NAME (TABLE_NAME),
    INDEX IDX_METRIC_ACTIVE     (IS_ACTIVE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='계산 지표 사전 – AI가 참조하는 수식 정의';


-- ------------------------------------------------------------
-- 4. profit_metric_synonym  (Metric 동의어)
--    Metric에 대한 자연어 동의어 매핑
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_metric_synonym (
    METRIC_SYNONYM_ID   BIGINT          NOT NULL AUTO_INCREMENT COMMENT 'Metric 동의어 PK',
    METRIC_ID           BIGINT          NOT NULL                COMMENT 'FK → profit_metric',
    SYNONYM_TEXT        VARCHAR(200)    NOT NULL                COMMENT '동의어 텍스트',
    SYNONYM_SOURCE      VARCHAR(50)     NULL                    COMMENT '동의어 출처 (MANUAL, AI, IMPORT)',
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    PRIMARY KEY (METRIC_SYNONYM_ID),
    INDEX IDX_METRIC_SYNONYM_METRIC   (METRIC_ID),
    INDEX IDX_METRIC_SYNONYM_TEXT     (SYNONYM_TEXT),
    CONSTRAINT FK_METRIC_SYNONYM_METRIC
        FOREIGN KEY (METRIC_ID)
        REFERENCES profit_metric (METRIC_ID)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Metric 동의어 – 지표에 대한 자연어 표현 매핑';


-- ------------------------------------------------------------
-- 5. profit_join_condition  (JOIN 조건 사전)
--    BW 데이터 테이블 간 연결 조건; SQL ON 절에 자동 적용
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_join_condition (
    JOIN_CONDITION_ID   BIGINT          NOT NULL AUTO_INCREMENT COMMENT 'JOIN 조건 PK',
    JOIN_NAME           VARCHAR(200)    NULL                    COMMENT 'JOIN 조건 설명명',
    LEFT_COLUMN         VARCHAR(100)    NOT NULL                COMMENT '좌측 테이블 조인 컬럼',
    LEFT_TABLE          VARCHAR(200)    NOT NULL                COMMENT '좌측 테이블명',
    RIGHT_COLUMN        VARCHAR(100)    NOT NULL                COMMENT '우측 테이블 조인 컬럼',
    RIGHT_TABLE         VARCHAR(200)    NOT NULL                COMMENT '우측 테이블명',
    JOIN_TYPE           VARCHAR(20)     NOT NULL DEFAULT 'INNER' COMMENT 'JOIN 유형 (INNER, LEFT, RIGHT)',
    OPERATOR            VARCHAR(10)     NOT NULL DEFAULT '='    COMMENT '비교 연산자 (=, >=, <= 등)',
    SORT_ORDER          INT             NULL                    COMMENT '표시 정렬 순서',
    IS_ACTIVE           TINYINT(1)      NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_BY          VARCHAR(50)     NULL                    COMMENT '생성자',
    UPDATED_BY          VARCHAR(50)     NULL                    COMMENT '수정자',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT          DATETIME        NULL                    COMMENT '수정일시',
    PRIMARY KEY (JOIN_CONDITION_ID),
    INDEX IDX_JOIN_CONDITION_LEFT_TABLE  (LEFT_TABLE),
    INDEX IDX_JOIN_CONDITION_RIGHT_TABLE (RIGHT_TABLE),
    INDEX IDX_JOIN_CONDITION_ACTIVE      (IS_ACTIVE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='JOIN 조건 사전 – 테이블 간 연결 조건 정의';


-- ------------------------------------------------------------
-- 6. profit_nl_query_history  (자연어 질의 이력)
--    사용자 질문 → SQL 변환 → 실행 → 결과/피드백 기록
--    학습 데이터로 활용되는 핵심 테이블
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_nl_query_history (
    QUERY_HISTORY_ID    BIGINT          NOT NULL AUTO_INCREMENT COMMENT '질의 이력 PK',
    USER_ID             BIGINT          NULL                    COMMENT '질의 사용자 ID (core_user FK 개념)',
    USER_NAME           VARCHAR(100)    NULL                    COMMENT '사용자 표시명',
    NATURAL_QUERY       VARCHAR(2000)   NOT NULL                COMMENT '사용자 자연어 질문 원문',
    GENERATED_SQL       TEXT            NULL                    COMMENT 'AI가 생성한 SQL',
    QUERY_MODE          VARCHAR(20)     NULL     DEFAULT 'NLQ'  COMMENT '질의 모드 (NLQ=자연어, VQB=비주얼빌더)',
    RESULT_COUNT        INT             NULL                    COMMENT '질의 결과 행 수',
    RESULT_SUMMARY      TEXT            NULL                    COMMENT '결과 요약 (AI 생성)',
    METRICS_USED        VARCHAR(1000)   NULL                    COMMENT '사용된 지표 목록 (콤마 구분)',
    FILTERS_USED        VARCHAR(1000)   NULL                    COMMENT '적용된 필터 조건',
    DATA_SOURCE         VARCHAR(500)    NULL                    COMMENT '데이터 출처 테이블',
    EXECUTION_TIME_MS   BIGINT          NULL                    COMMENT 'SQL 실행 시간 (ms)',
    STATUS              VARCHAR(20)     NOT NULL DEFAULT 'PENDING' COMMENT '상태 (PENDING, SUCCESS, FAILED)',
    ERROR_MESSAGE       VARCHAR(2000)   NULL                    COMMENT '에러 메시지 (실패 시)',
    FEEDBACK_SCORE      INT             NULL                    COMMENT '사용자 피드백 점수 (1~5)',
    FEEDBACK_COMMENT    VARCHAR(1000)   NULL                    COMMENT '사용자 피드백 코멘트',
    IS_BOOKMARKED       TINYINT(1)      NOT NULL DEFAULT 0      COMMENT '북마크 여부',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '질의 일시',
    PRIMARY KEY (QUERY_HISTORY_ID),
    INDEX IDX_NL_QUERY_USER_ID      (USER_ID),
    INDEX IDX_NL_QUERY_STATUS       (STATUS),
    INDEX IDX_NL_QUERY_CREATED_AT   (CREATED_AT),
    INDEX IDX_NL_QUERY_BOOKMARKED   (IS_BOOKMARKED, USER_ID),
    INDEX IDX_NL_QUERY_FEEDBACK     (FEEDBACK_SCORE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='자연어 질의 이력 – 질문/SQL/결과/피드백 전 과정 기록';


-- ------------------------------------------------------------
-- 7. profit_batch_status  (배치 실행 상태)
--    SAP 마감 → BW DB DATA 생성 배치 추적
--    데이터 검증/정합성 체크 결과 포함
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_batch_status (
    BATCH_ID            BIGINT          NOT NULL AUTO_INCREMENT COMMENT '배치 PK',
    BATCH_NAME          VARCHAR(200)    NOT NULL                COMMENT '배치명',
    BATCH_TYPE          VARCHAR(50)     NOT NULL                COMMENT '배치 유형 (MONTHLY_CLOSE, VALIDATION 등)',
    SOURCE_SYSTEM       VARCHAR(100)    NULL                    COMMENT '소스 시스템 (SAP, BW 등)',
    TARGET_TABLE        VARCHAR(200)    NULL                    COMMENT '적재 대상 테이블',
    STATUS              VARCHAR(20)     NOT NULL DEFAULT 'PENDING' COMMENT '상태 (PENDING, RUNNING, COMPLETED, COMPLETED_WITH_ERRORS, FAILED)',
    TOTAL_ROWS          BIGINT          NULL                    COMMENT '전체 행 수',
    PROCESSED_ROWS      BIGINT          NULL     DEFAULT 0      COMMENT '처리 완료 행 수',
    ERROR_ROWS          BIGINT          NULL     DEFAULT 0      COMMENT '에러 행 수',
    PERIOD_YEAR         INT             NULL                    COMMENT '마감 연도',
    PERIOD_MONTH        INT             NULL                    COMMENT '마감 월',
    ERROR_MESSAGE       TEXT            NULL                    COMMENT '에러 메시지 상세',
    STARTED_AT          DATETIME        NULL                    COMMENT '배치 시작 일시',
    COMPLETED_AT        DATETIME        NULL                    COMMENT '배치 완료 일시',
    EXECUTION_TIME_MS   BIGINT          NULL                    COMMENT '실행 시간 (ms)',
    CREATED_BY          VARCHAR(50)     NULL                    COMMENT '생성자 (배치 등록자)',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    PRIMARY KEY (BATCH_ID),
    INDEX IDX_BATCH_STATUS_STATUS      (STATUS),
    INDEX IDX_BATCH_STATUS_TYPE        (BATCH_TYPE),
    INDEX IDX_BATCH_STATUS_PERIOD      (PERIOD_YEAR, PERIOD_MONTH),
    INDEX IDX_BATCH_STATUS_CREATED_AT  (CREATED_AT),
    INDEX IDX_BATCH_STATUS_TARGET      (TARGET_TABLE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='배치 실행 상태 – SAP 마감/BW 적재/검증 배치 추적';


-- ------------------------------------------------------------
-- 8. profit_mapping_inbox  (매핑 인박스)
--    미매핑 자연어 표현 수집 → 관리자 검수 → 사전 개선
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profit_mapping_inbox (
    INBOX_ID            BIGINT          NOT NULL AUTO_INCREMENT COMMENT '인박스 PK',
    UNMAPPED_TERM       VARCHAR(300)    NOT NULL                COMMENT '미매핑 자연어 표현',
    TERM_TYPE           VARCHAR(30)     NOT NULL                COMMENT '용어 유형 (COLUMN, METRIC, VALUE, FILTER)',
    ORIGINAL_QUERY      VARCHAR(2000)   NULL                    COMMENT '미매핑이 발생한 원본 질의',
    SUGGESTED_COLUMN    VARCHAR(100)    NULL                    COMMENT '제안 매핑 컬럼',
    SUGGESTED_METRIC_CODE VARCHAR(100)  NULL                    COMMENT '제안 매핑 Metric 코드',
    OCCURRENCE_COUNT    INT             NOT NULL DEFAULT 1      COMMENT '발생 횟수 (누적)',
    STATUS              VARCHAR(20)     NOT NULL DEFAULT 'PENDING' COMMENT '처리 상태 (PENDING, APPROVED, REJECTED)',
    RESOLVED_BY         VARCHAR(50)     NULL                    COMMENT '처리자',
    RESOLVED_AT         DATETIME        NULL                    COMMENT '처리일시',
    RESOLUTION_NOTE     VARCHAR(500)    NULL                    COMMENT '처리 사유/메모',
    CREATED_AT          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '최초 발생일시',
    UPDATED_AT          DATETIME        NULL                    COMMENT '최종 수정일시',
    PRIMARY KEY (INBOX_ID),
    INDEX IDX_MAPPING_INBOX_STATUS      (STATUS),
    INDEX IDX_MAPPING_INBOX_TERM_TYPE   (TERM_TYPE, STATUS),
    INDEX IDX_MAPPING_INBOX_OCCURRENCE  (OCCURRENCE_COUNT DESC),
    INDEX IDX_MAPPING_INBOX_CREATED_AT  (CREATED_AT),
    UNIQUE KEY UK_MAPPING_INBOX_TERM    (UNMAPPED_TERM, TERM_TYPE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='매핑 인박스 – 미매핑 표현 수집 및 관리자 검수';

-- ============================================================
-- END OF SCHEMA
-- ============================================================
