-- ============================================================
-- module-simulation: 경영시뮬레이션 (Rolling Planning Simulation)
-- DB       : MariaDB 10.11+ (utf8mb4)
-- Prefix   : rpsim_ (Rolling Planning SIMulation)
-- 실행 순서 : 01_schema.sql → 02_seed_data.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. rpsim_unit (호기 마스터)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_unit (
    UNIT_ID          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '호기 PK',
    UNIT_CODE        VARCHAR(20)  NOT NULL                COMMENT '호기 코드 (예: M01)',
    UNIT_NAME        VARCHAR(100) NOT NULL                COMMENT '호기명 (예: 1호기)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부 (PS/ST)',
    DESCRIPTION      VARCHAR(500) NULL                    COMMENT '설명',
    IS_ACTIVE        TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    CREATED_BY       BIGINT       NULL     COMMENT '생성자 사용자 ID',
    UPDATED_AT       DATETIME     NULL     COMMENT '수정일시',
    UPDATED_BY       BIGINT       NULL     COMMENT '수정자 사용자 ID',
    DELETED_YN       CHAR(1)      NOT NULL DEFAULT 'N' COMMENT '삭제 여부',
    DELETED_AT       DATETIME     NULL     COMMENT '삭제일시',
    DELETED_BY       BIGINT       NULL     COMMENT '삭제자 사용자 ID',
    PRIMARY KEY (UNIT_ID),
    UNIQUE KEY UK_RPSIM_UNIT_CODE (UNIT_CODE),
    INDEX IDX_RPSIM_UNIT_DIVISION (DIVISION),
    INDEX IDX_RPSIM_UNIT_DELETED (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 호기(생산설비) 마스터';


-- ------------------------------------------------------------
-- 2. rpsim_material (원부자재 마스터)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_material (
    MATERIAL_ID      BIGINT       NOT NULL AUTO_INCREMENT COMMENT '자재 PK',
    MATERIAL_CODE    VARCHAR(50)  NOT NULL                COMMENT '자재 코드',
    MATERIAL_NAME    VARCHAR(200) NOT NULL                COMMENT '자재명',
    CATEGORY         VARCHAR(20)  NOT NULL DEFAULT 'RAW'  COMMENT '구분 (RAW=원자재, SUB=부자재)',
    UNIT_OF_MEASURE  VARCHAR(20)  NOT NULL DEFAULT 'kg'   COMMENT '단위 (kg, L, EA 등)',
    DESCRIPTION      VARCHAR(500) NULL                    COMMENT '설명',
    IS_ACTIVE        TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    CREATED_BY       BIGINT       NULL     COMMENT '생성자 사용자 ID',
    UPDATED_AT       DATETIME     NULL     COMMENT '수정일시',
    UPDATED_BY       BIGINT       NULL     COMMENT '수정자 사용자 ID',
    DELETED_YN       CHAR(1)      NOT NULL DEFAULT 'N' COMMENT '삭제 여부',
    DELETED_AT       DATETIME     NULL     COMMENT '삭제일시',
    DELETED_BY       BIGINT       NULL     COMMENT '삭제자 사용자 ID',
    PRIMARY KEY (MATERIAL_ID),
    UNIQUE KEY UK_RPSIM_MATERIAL_CODE (MATERIAL_CODE),
    INDEX IDX_RPSIM_MATERIAL_CATEGORY (CATEGORY),
    INDEX IDX_RPSIM_MATERIAL_DELETED (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 원부자재 마스터';


-- ------------------------------------------------------------
-- 3. rpsim_raw_record (SAP BW 원본 데이터 — 핵심 테이블)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_raw_record (
    RECORD_ID                  BIGINT       NOT NULL AUTO_INCREMENT COMMENT '레코드 PK',
    CALENDAR_YM                VARCHAR(6)   NOT NULL                COMMENT '달력연도/월 (202605)',
    PROCESS_CODE               VARCHAR(20)  NULL     COMMENT '공정 코드',
    PROCESS_NAME               VARCHAR(100) NULL     COMMENT '공정명',
    MACHINE_CODE               VARCHAR(20)  NULL     COMMENT '생산호기 코드',
    MACHINE_NAME               VARCHAR(100) NULL     COMMENT '생산호기명',
    PRODUCT_LEVEL1             VARCHAR(20)  NULL     COMMENT '제품계층 레벨1',
    PRODUCT_LEVEL1_NAME        VARCHAR(100) NULL     COMMENT '제품계층 레벨1명',
    PRODUCT_LEVEL2             VARCHAR(20)  NULL     COMMENT '제품계층 레벨2',
    PRODUCT_LEVEL2_NAME        VARCHAR(100) NULL     COMMENT '제품계층 레벨2명',
    PRODUCT_LEVEL3             VARCHAR(20)  NULL     COMMENT '제품계층 레벨3',
    PRODUCT_LEVEL3_NAME        VARCHAR(100) NULL     COMMENT '제품계층 레벨3명',
    PRODUCT_LEVEL4             VARCHAR(20)  NULL     COMMENT '제품계층 레벨4',
    PRODUCT_LEVEL4_NAME        VARCHAR(100) NULL     COMMENT '제품계층 레벨4명',
    MATERIAL_CODE              VARCHAR(50)  NULL     COMMENT '자재 코드',
    MATERIAL_NAME              VARCHAR(200) NULL     COMMENT '자재명',
    MATERIAL_GROUP             VARCHAR(50)  NULL     COMMENT '자재 그룹',
    MATERIAL_GROUP_NAME        VARCHAR(100) NULL     COMMENT '자재 그룹명',
    MATERIAL_GROUP_MAJOR       VARCHAR(50)  NULL     COMMENT '자재그룹(대분류)',
    MATERIAL_GROUP_MAJOR_NAME  VARCHAR(100) NULL     COMMENT '자재그룹(대분류)명',
    PRODUCT_TYPE_CODE          VARCHAR(20)  NULL     COMMENT '지종/제품구분',
    PRODUCT_TYPE_NAME          VARCHAR(100) NULL     COMMENT '지종/제품구분명',
    PLAN_UNIT_CONSUMPTION      DECIMAL(18,6) NULL    COMMENT '계획 원단위(KG/Ton)(당월)',
    COMPONENT_QTY              DECIMAL(18,6) NULL    COMMENT '구성부품수량(당월)',
    BASE_QTY                   DECIMAL(18,6) NULL    COMMENT '기준수량(당월)',
    PLAN_UNIT_CONSUMPTION_WASTE DECIMAL(18,6) NULL   COMMENT '계획 원단위(폐품포함)(당월)',
    PLAN_UNIT_PRICE            DECIMAL(18,4) NULL    COMMENT '계획 단가(당월)',
    PLAN_ALLOC_QTY             DECIMAL(18,6) NULL    COMMENT '계획 배부수량(당월)',
    TOTAL_PRODUCTION           DECIMAL(18,4) NULL    COMMENT '총생산량(당월)',
    PRODUCTION_QTY             DECIMAL(18,4) NULL    COMMENT '생산수량(당월)',
    WASTE_QTY                  DECIMAL(18,4) NULL    COMMENT '폐품수량(당월)',
    ACTUAL_UNIT_CONSUMPTION    DECIMAL(18,6) NULL    COMMENT '실제 원단위(KG/Ton)(당월)',
    ACTUAL_ALLOC_QTY           DECIMAL(18,6) NULL    COMMENT '실제 배부수량(당월)',
    ACTUAL_UNIT_PRICE          DECIMAL(18,4) NULL    COMMENT '실제단가(당월)',
    ISSUE_QTY                  DECIMAL(18,4) NULL    COMMENT '출고수량(당월)',
    ISSUE_AMOUNT               DECIMAL(18,4) NULL    COMMENT '출고금액(당월)',
    PLAN_VS_USAGE_DIFF         DECIMAL(18,4) NULL    COMMENT '계획대비 사용량 차이',
    PLAN_VS_PRICE_DIFF         DECIMAL(18,4) NULL    COMMENT '계획대비 단가 차이',
    DATA_SOURCE                VARCHAR(20)  NOT NULL DEFAULT 'SAP_BW' COMMENT '데이터 소스',
    FILE_NAME                  VARCHAR(300) NULL     COMMENT '업로드 파일명',
    CREATED_AT                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    PRIMARY KEY (RECORD_ID),
    INDEX IDX_RPSIM_RAW_YM          (CALENDAR_YM),
    INDEX IDX_RPSIM_RAW_MACHINE     (MACHINE_CODE),
    INDEX IDX_RPSIM_RAW_MATERIAL    (MATERIAL_CODE),
    INDEX IDX_RPSIM_RAW_MC_YM       (MACHINE_CODE, CALENDAR_YM),
    INDEX IDX_RPSIM_RAW_MAT_GROUP   (MATERIAL_GROUP_NAME)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – SAP BW 원본 데이터(원부재료비 실적)';


-- ------------------------------------------------------------
-- 4. rpsim_machine_capacity (호기별 생산능력 기준)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_machine_capacity (
    CAPACITY_ID      BIGINT       NOT NULL AUTO_INCREMENT COMMENT '생산능력 PK',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MACHINE_CODE     VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    HOURLY_CAPACITY  DECIMAL(12,4) NOT NULL DEFAULT 0     COMMENT '시간당 생산능력(톤/시간)',
    BASIS_WEIGHT_REF DECIMAL(10,2) NULL                   COMMENT '기준 평량(g/m²)',
    NOTE             VARCHAR(500) NULL                    COMMENT '메모',
    VALID_FROM       VARCHAR(6)   NOT NULL DEFAULT '202401' COMMENT '유효 시작 (YYYYMM)',
    VALID_TO         VARCHAR(6)   NOT NULL DEFAULT '999912' COMMENT '유효 종료 (YYYYMM)',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    CREATED_BY       BIGINT       NULL     COMMENT '생성자 사용자 ID',
    UPDATED_AT       DATETIME     NULL     COMMENT '수정일시',
    UPDATED_BY       BIGINT       NULL     COMMENT '수정자 사용자 ID',
    DELETED_YN       CHAR(1)      NOT NULL DEFAULT 'N' COMMENT '삭제 여부',
    DELETED_AT       DATETIME     NULL     COMMENT '삭제일시',
    DELETED_BY       BIGINT       NULL     COMMENT '삭제자 사용자 ID',
    PRIMARY KEY (CAPACITY_ID),
    INDEX IDX_RPSIM_CAP_MACHINE  (MACHINE_CODE),
    INDEX IDX_RPSIM_CAP_DIVISION (DIVISION),
    INDEX IDX_RPSIM_CAP_DELETED  (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 호기별 시간당 생산능력';


-- ------------------------------------------------------------
-- 5. rpsim_operating_time (월별 가동시간)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_operating_time (
    OPTIME_ID                  BIGINT       NOT NULL AUTO_INCREMENT COMMENT '가동시간 PK',
    DIVISION                   VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MACHINE_CODE               VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    YM                         VARCHAR(6)   NOT NULL                COMMENT 'YYYYMM',
    TOTAL_DAYS                 DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '월 총일수',
    PLANNED_SHUTDOWN_DAYS      DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '계획운휴일수',
    OPERATION_NORMAL_DAYS      DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '정상가동일수',
    OPERATION_WASTE_DAYS       DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '폐품손실일수',
    OPERATION_UNPLANNED_DAYS   DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '비계획생산일수',
    OPERATION_STARTUP_DAYS     DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '초출(기동손실)일수',
    OPERATION_TRIMMING_DAYS    DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '절지일수',
    DOWNTIME_REPAIR_DAYS       DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '정비일수',
    DOWNTIME_CLEANING_DAYS     DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '세척일수',
    DOWNTIME_ACCIDENT_DAYS     DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '사고일수',
    CREATED_AT                 DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    CREATED_BY                 BIGINT       NULL     COMMENT '생성자 사용자 ID',
    UPDATED_AT                 DATETIME     NULL     COMMENT '수정일시',
    UPDATED_BY                 BIGINT       NULL     COMMENT '수정자 사용자 ID',
    DELETED_YN                 CHAR(1)      NOT NULL DEFAULT 'N' COMMENT '삭제 여부',
    DELETED_AT                 DATETIME     NULL     COMMENT '삭제일시',
    DELETED_BY                 BIGINT       NULL     COMMENT '삭제자 사용자 ID',
    PRIMARY KEY (OPTIME_ID),
    UNIQUE KEY UK_RPSIM_OPTIME (DIVISION, MACHINE_CODE, YM),
    INDEX IDX_RPSIM_OPTIME_YM      (YM),
    INDEX IDX_RPSIM_OPTIME_DELETED (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 월별 호기별 가동시간';


-- ------------------------------------------------------------
-- 6. rpsim_pw_line (전력비 호기 마스터)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_line (
    PW_LINE_ID         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '전력호기 PK',
    LINE_CODE          VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    LINE_NAME          VARCHAR(100) NOT NULL                COMMENT '호기명',
    LINE_GROUP         VARCHAR(50)  NOT NULL                COMMENT '라인그룹 (제지/화장지/가공 등)',
    UNIT_TYPE          VARCHAR(10)  NOT NULL DEFAULT 'kg'   COMMENT '단위(kg/EA)',
    KWH_PER_HOUR_RUN   DECIMAL(12,4) NOT NULL DEFAULT 0    COMMENT '가동시 시간당 kWh',
    KWH_PER_HOUR_STBY  DECIMAL(12,4) NOT NULL DEFAULT 0    COMMENT '운휴시 시간당 kWh',
    DISPLAY_ORDER      INT          NOT NULL DEFAULT 0      COMMENT '표시 순서',
    IS_ACTIVE          TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '활성 여부',
    DIVISION           VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    CREATED_AT         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    CREATED_BY         BIGINT       NULL     COMMENT '생성자 사용자 ID',
    UPDATED_AT         DATETIME     NULL     COMMENT '수정일시',
    UPDATED_BY         BIGINT       NULL     COMMENT '수정자 사용자 ID',
    DELETED_YN         CHAR(1)      NOT NULL DEFAULT 'N' COMMENT '삭제 여부',
    DELETED_AT         DATETIME     NULL     COMMENT '삭제일시',
    DELETED_BY         BIGINT       NULL     COMMENT '삭제자 사용자 ID',
    PRIMARY KEY (PW_LINE_ID),
    UNIQUE KEY UK_RPSIM_PW_LINE_CODE (LINE_CODE),
    INDEX IDX_RPSIM_PW_LINE_GROUP  (LINE_GROUP),
    INDEX IDX_RPSIM_PW_LINE_DELETED (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 전력비 호기(라인) 마스터';


-- ------------------------------------------------------------
-- 7. rpsim_pw_tariff (한전 요금 단가)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_tariff (
    TARIFF_ID       BIGINT       NOT NULL AUTO_INCREMENT COMMENT '요금 PK',
    YEAR            INT          NOT NULL                COMMENT '연도',
    SEASON          VARCHAR(20)  NOT NULL                COMMENT '시즌 (summer/winter/spring_fall)',
    TIME_ZONE       VARCHAR(20)  NOT NULL                COMMENT '시간대 (peak/mid/off)',
    DEMAND_KRW      DECIMAL(12,4) NOT NULL DEFAULT 0    COMMENT '기본요금(원/kW)',
    ENERGY_KRW      DECIMAL(12,4) NOT NULL DEFAULT 0    COMMENT '전력량요금(원/kWh)',
    DIVISION        VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    CREATED_AT      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT      DATETIME     NULL     COMMENT '수정일시',
    PRIMARY KEY (TARIFF_ID),
    UNIQUE KEY UK_RPSIM_TARIFF (YEAR, SEASON, TIME_ZONE, DIVISION),
    INDEX IDX_RPSIM_TARIFF_YEAR (YEAR)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 한전 요금 단가';


-- ------------------------------------------------------------
-- 8. rpsim_pw_result (전력비 계산 결과)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_result (
    RESULT_ID          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '결과 PK',
    YM                 VARCHAR(6)   NOT NULL                COMMENT 'YYYYMM',
    LINE_CODE          VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    DIVISION           VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    RUN_HOURS          DECIMAL(12,2) NULL    COMMENT '가동시간(h)',
    STANDBY_HOURS      DECIMAL(12,2) NULL    COMMENT '운휴시간(h)',
    TOTAL_KWH          DECIMAL(18,4) NULL    COMMENT '총 전력량(kWh)',
    DEMAND_COST_KRW    DECIMAL(18,2) NULL    COMMENT '기본요금(원)',
    ENERGY_COST_KRW    DECIMAL(18,2) NULL    COMMENT '전력량요금(원)',
    TOTAL_COST_KRW     DECIMAL(18,2) NULL    COMMENT '총 전력비(원)',
    CREATED_AT         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT         DATETIME     NULL     COMMENT '수정일시',
    PRIMARY KEY (RESULT_ID),
    UNIQUE KEY UK_RPSIM_PW_RESULT (YM, LINE_CODE, DIVISION),
    INDEX IDX_RPSIM_PW_RESULT_YM (YM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 전력비 계산 결과';


-- ------------------------------------------------------------
-- 9. rpsim_logi_rate (물류 운임 단가)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_logi_rate (
    RATE_ID          BIGINT       NOT NULL AUTO_INCREMENT COMMENT '운임 PK',
    YEAR_QUARTER     VARCHAR(10)  NOT NULL                COMMENT '분기 (2026-Q1)',
    REGION           VARCHAR(50)  NOT NULL DEFAULT ''      COMMENT '지역',
    COUNTRY          VARCHAR(50)  NOT NULL DEFAULT ''      COMMENT '국가',
    PORT             VARCHAR(100) NOT NULL                 COMMENT '항구',
    CONTAINER_UNIT   VARCHAR(10)  NOT NULL DEFAULT '40'    COMMENT '컨테이너 단위(20/40)',
    VOLUME_PER_MONTH DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '월 물동량',
    RATE_USD         DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '운임(USD)',
    MEMO             VARCHAR(500) NULL                    COMMENT '메모',
    SORT_ORDER       INT          NOT NULL DEFAULT 0      COMMENT '정렬 순서',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    CREATED_BY       BIGINT       NULL     COMMENT '생성자 사용자 ID',
    UPDATED_AT       DATETIME     NULL     COMMENT '수정일시',
    UPDATED_BY       BIGINT       NULL     COMMENT '수정자 사용자 ID',
    DELETED_YN       CHAR(1)      NOT NULL DEFAULT 'N' COMMENT '삭제 여부',
    DELETED_AT       DATETIME     NULL     COMMENT '삭제일시',
    DELETED_BY       BIGINT       NULL     COMMENT '삭제자 사용자 ID',
    PRIMARY KEY (RATE_ID),
    INDEX IDX_RPSIM_LOGI_RATE_QTR    (YEAR_QUARTER),
    INDEX IDX_RPSIM_LOGI_RATE_REGION (REGION),
    INDEX IDX_RPSIM_LOGI_RATE_DELETED (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 분기별 해상 운임 단가';


-- ------------------------------------------------------------
-- 10. rpsim_logi_exchange_rate (월별 환율)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_logi_exchange_rate (
    EXCHANGE_ID    BIGINT       NOT NULL AUTO_INCREMENT COMMENT '환율 PK',
    YEAR           INT          NOT NULL                COMMENT '연도',
    MONTH          INT          NOT NULL                COMMENT '월',
    DIVISION       VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    CURRENCY       VARCHAR(10)  NOT NULL DEFAULT 'USD'  COMMENT '통화',
    RATE           DECIMAL(12,4) NOT NULL DEFAULT 1350  COMMENT '환율(원/통화)',
    MEMO           VARCHAR(500) NULL                    COMMENT '메모',
    CREATED_AT     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT     DATETIME     NULL     COMMENT '수정일시',
    PRIMARY KEY (EXCHANGE_ID),
    UNIQUE KEY UK_RPSIM_EXCHANGE (YEAR, MONTH, DIVISION, CURRENCY)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 월별 적용 환율';


-- ------------------------------------------------------------
-- 11. rpsim_logi_cost_local (국내 출발항 운임)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_logi_cost_local (
    LOCAL_COST_ID      BIGINT       NOT NULL AUTO_INCREMENT COMMENT '국내운임 PK',
    YEAR_QUARTER       VARCHAR(10)  NOT NULL                COMMENT '분기',
    PORT_ORIGIN        VARCHAR(50)  NOT NULL                COMMENT '출발항 (광양/부산)',
    CONTAINER_SIZE     VARCHAR(10)  NOT NULL DEFAULT '20ft' COMMENT '컨테이너 규격',
    DIVISION           VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    CONTAINER_FEE_KRW  DECIMAL(18,2) NOT NULL DEFAULT 0    COMMENT '컨테이너비(원)',
    EXTRA_FEE_KRW      DECIMAL(18,2) NOT NULL DEFAULT 0    COMMENT '부대비용(원)',
    MEMO               VARCHAR(500) NULL                    COMMENT '메모',
    CREATED_AT         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    CREATED_BY         BIGINT       NULL     COMMENT '생성자 사용자 ID',
    UPDATED_AT         DATETIME     NULL     COMMENT '수정일시',
    UPDATED_BY         BIGINT       NULL     COMMENT '수정자 사용자 ID',
    DELETED_YN         CHAR(1)      NOT NULL DEFAULT 'N' COMMENT '삭제 여부',
    DELETED_AT         DATETIME     NULL     COMMENT '삭제일시',
    DELETED_BY         BIGINT       NULL     COMMENT '삭제자 사용자 ID',
    PRIMARY KEY (LOCAL_COST_ID),
    UNIQUE KEY UK_RPSIM_LOCAL_COST (YEAR_QUARTER, PORT_ORIGIN, CONTAINER_SIZE, DIVISION),
    INDEX IDX_RPSIM_LOCAL_COST_DELETED (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 출발항별 컨테이너/부대비용 단가';


-- ------------------------------------------------------------
-- 12. rpsim_batch_job (배치 실행 이력)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_batch_job (
    BATCH_ID         BIGINT       NOT NULL AUTO_INCREMENT COMMENT '배치 PK',
    JOB_ID           VARCHAR(50)  NOT NULL                COMMENT '작업 고유 ID',
    INPUT_MONTH      VARCHAR(6)   NOT NULL                COMMENT '대상 월(YYYYMM)',
    EXECUTION_MODE   VARCHAR(20)  NOT NULL DEFAULT 'REPLACE' COMMENT '실행 모드(REPLACE/INSERT)',
    STATUS           VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT '상태(PENDING/RUNNING/SUCCESS/FAILED)',
    SOURCE_COUNT     INT          NOT NULL DEFAULT 0      COMMENT '원천 건수',
    INSERT_COUNT     INT          NOT NULL DEFAULT 0      COMMENT '적재 건수',
    ERROR_COUNT      INT          NOT NULL DEFAULT 0      COMMENT '오류 건수',
    ERROR_MESSAGE    TEXT         NULL                    COMMENT '오류 메시지',
    DURATION_MS      INT          NOT NULL DEFAULT 0      COMMENT '실행 시간(ms)',
    EXECUTED_BY      VARCHAR(50)  NULL     DEFAULT 'admin' COMMENT '실행자',
    STARTED_AT       DATETIME     NULL     COMMENT '시작일시',
    COMPLETED_AT     DATETIME     NULL     COMMENT '완료일시',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    PRIMARY KEY (BATCH_ID),
    UNIQUE KEY UK_RPSIM_BATCH_JOB_ID (JOB_ID),
    INDEX IDX_RPSIM_BATCH_MONTH  (INPUT_MONTH),
    INDEX IDX_RPSIM_BATCH_STATUS (STATUS),
    INDEX IDX_RPSIM_BATCH_CREATED (CREATED_AT DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – SAP RFC 배치 실행 이력';


-- ============================================================
-- END OF SCHEMA
-- ============================================================
