-- =====================================================================
-- 33_power_sim.sql
-- 전력비 시뮬레이션 (STEP4 › 전력비) — 호기별 전력 kW + 기준정보 버전·호기·월 평균단가·가산차감·저장 시나리오
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

-- 1) 호기별 전력 kW (월별)
CREATE TABLE IF NOT EXISTS rpsim_pw_line_kw (
    LINE_KW_ID             BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR                   INT NOT NULL COMMENT '연도',
    MONTH                  INT NOT NULL COMMENT '월 (1~12)',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    MACHINE_CODE           VARCHAR(20) NOT NULL COMMENT '호기 코드 (호기 마스터)',
    RUN_KW                 DECIMAL(20,6) NULL COMMENT '가동 시 평균 전력 (kW)',
    IDLE_KW                DECIMAL(20,6) NULL COMMENT '운휴 시 평균 전력 (kW)',
    MEMO                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (LINE_KW_ID),
    UNIQUE KEY UK_PW_LINE_KW (YEAR, MONTH, DIVISION, MACHINE_CODE),
    INDEX IDX_PW_LINE_KW_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 호기별 전력 kW (월별)';

-- 2) 기준정보 버전
CREATE TABLE IF NOT EXISTS rpsim_pw_sim_basis_version (
    VERSION_ID             BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    VERSION_NAME           VARCHAR(100) NOT NULL COMMENT '버전명',
    APPLY_YM               VARCHAR(6) NULL COMMENT '적용 년월',
    STATUS                 VARCHAR(10) NOT NULL COMMENT '상태 (DRAFT/APPROVED)',
    SOURCE                 VARCHAR(10) NOT NULL COMMENT '출처 (MANUAL/EXCEL)',
    SOURCE_FILE            VARCHAR(255) NULL COMMENT '원본 파일명',
    APPROVED_BY            VARCHAR(50) NULL COMMENT '승인자',
    APPROVED_AT            DATETIME NULL COMMENT '승인일시',
    MEMO                   VARCHAR(1000) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (VERSION_ID),
    INDEX IDX_PW_BASIS_VER (DIVISION, STATUS),
    INDEX IDX_PW_SIM_BASIS_VERSION_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 전력비 기준정보 버전';

-- 3) 기준정보 호기 (버전 × 호기)
CREATE TABLE IF NOT EXISTS rpsim_pw_sim_basis_line (
    LINE_ID                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    VERSION_ID             BIGINT NOT NULL COMMENT '업로드 버전 ID',
    LINE_CODE              VARCHAR(30) NOT NULL COMMENT '호기 코드',
    LINE_NAME              VARCHAR(100) NULL COMMENT '호기명',
    PROCESS_NAME           VARCHAR(100) NULL COMMENT '공정명',
    PROD_UNIT              VARCHAR(20) NULL COMMENT '생산 단위',
    PRODUCTIVITY_VALUE     DECIMAL(20,6) NULL COMMENT '생산성',
    PRODUCTIVITY_BASIS     VARCHAR(10) NULL COMMENT '생산성 기준 (HOUR/DAY)',
    PRODUCTIVITY_UNIT      VARCHAR(20) NULL COMMENT '생산성 단위',
    DAY_BASIS_HOURS        DECIMAL(6,3) NULL COMMENT '일 기준 시간',
    RUN_KW                 DECIMAL(20,6) NULL COMMENT '가동 시 평균 전력 (kW)',
    IDLE_KW                DECIMAL(20,6) NULL COMMENT '운휴 시 평균 전력 (kW)',
    FIXED_KWH              DECIMAL(20,6) NULL COMMENT '고정 사용량 (kWh)',
    FIXED_NOTE             VARCHAR(500) NULL COMMENT '고정 사용량 비고',
    REF_QTY                DECIMAL(24,6) NULL COMMENT '참고 생산량',
    REF_RUN_HOURS          DECIMAL(12,4) NULL COMMENT '참고 가동시간',
    SCOPE_MEMO             VARCHAR(1000) NULL COMMENT '평균전력 포함 범위',
    SOURCE_NOTE            VARCHAR(500) NULL COMMENT '출처 비고',
    SORT_ORDER             INT NULL COMMENT '정렬순서',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (LINE_ID),
    UNIQUE KEY UK_PW_BASIS_LINE (VERSION_ID, LINE_CODE),
    INDEX IDX_PW_SIM_BASIS_LINE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 전력비 기준정보 호기';

-- 4) 월 평균 전력단가
CREATE TABLE IF NOT EXISTS rpsim_pw_sim_price (
    PRICE_ID               BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    PRICE_KRW_PER_KWH      DECIMAL(20,10) NOT NULL COMMENT '평균 전력단가 (원/kWh)',
    VAT_INCLUDED_YN        CHAR(1) NOT NULL COMMENT '부가세 포함 여부',
    BASE_FEE_INCLUDED_YN   CHAR(1) NOT NULL COMMENT '기본요금 포함 여부',
    ESS_INCLUDED_YN        CHAR(1) NOT NULL COMMENT 'ESS 포함 여부',
    SETTLEMENT_INCLUDED_YN CHAR(1) NOT NULL COMMENT '정산금 포함 여부',
    SCOPE_DESC             VARCHAR(1000) NOT NULL COMMENT '단가 산정 범위',
    MEMO                   VARCHAR(1000) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (PRICE_ID),
    UNIQUE KEY UK_PW_SIM_PRICE (DIVISION, YM),
    INDEX IDX_PW_SIM_PRICE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 월 평균 전력단가';

-- 5) 기타 가산·차감
CREATE TABLE IF NOT EXISTS rpsim_pw_sim_adjust (
    ADJUST_ID              BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    ITEM_NAME              VARCHAR(200) NOT NULL COMMENT '항목명',
    DIRECTION              VARCHAR(10) NOT NULL COMMENT '가산/차감 (ADD/DEDUCT)',
    AMOUNT_KRW             DECIMAL(18,0) NOT NULL COMMENT '금액 (원)',
    CATEGORY               VARCHAR(20) NOT NULL COMMENT '분류 (BASE_FEE/ESS/SETTLEMENT/OTHER)',
    VAT_INCLUDED_YN        CHAR(1) NOT NULL COMMENT '부가세 포함 여부',
    MEMO                   VARCHAR(1000) NOT NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (ADJUST_ID),
    INDEX IDX_PW_ADJUST (DIVISION, YM),
    INDEX IDX_PW_SIM_ADJUST_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 전력비 가산·차감';

-- 6) 저장 시나리오 (입력·결과 스냅샷)
CREATE TABLE IF NOT EXISTS rpsim_pw_sim_scenario (
    SCENARIO_ID            BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    SCENARIO_NAME          VARCHAR(200) NOT NULL COMMENT '시나리오명',
    BASIS_VERSION_ID       BIGINT NULL COMMENT '기준정보 버전 ID',
    BASIS_VERSION_NAME     VARCHAR(100) NULL COMMENT '기준정보 버전명',
    BASIS_STATUS           VARCHAR(10) NULL COMMENT '기준정보 버전 상태',
    COMPLETE_YN            CHAR(1) NOT NULL COMMENT '계산 완료 여부',
    TOTAL_KWH              DECIMAL(24,6) NULL COMMENT '총 사용량 (kWh)',
    FINAL_COST_KRW         DECIMAL(18,0) NULL COMMENT '최종 전력비 (원)',
    INPUT_JSON             LONGTEXT NOT NULL COMMENT '입력 스냅샷 (JSON)',
    RESULT_JSON            LONGTEXT NOT NULL COMMENT '결과 스냅샷 (JSON)',
    MEMO                   VARCHAR(1000) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (SCENARIO_ID),
    INDEX IDX_PW_SCENARIO (DIVISION, YM),
    INDEX IDX_PW_SIM_SCENARIO_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 전력비 저장 시나리오';
