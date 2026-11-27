-- =====================================================================
-- 31_purchase_plan.sql
-- 구매 이동계획 (STEP1 › 구매계획) — 통화·환율·부대비율 마스터 + 업로드 버전·펄프 수불·펄프 외 영향
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

-- 1) 통화 마스터
CREATE TABLE IF NOT EXISTS rpsim_purchase_currency (
    CURRENCY_ID            BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    CURRENCY_CODE          VARCHAR(10) NOT NULL COMMENT '통화코드',
    CURRENCY_NAME          VARCHAR(50) NULL COMMENT '통화명',
    BASE_YN                CHAR(1) NOT NULL COMMENT '기준통화 여부',
    SORT_ORDER             INT NULL COMMENT '정렬순서',
    USE_YN                 CHAR(1) NOT NULL COMMENT '사용 여부',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (CURRENCY_ID),
    UNIQUE KEY UK_PUR_CURRENCY (CURRENCY_CODE),
    INDEX IDX_PURCHASE_CURRENCY_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 구매 통화 마스터';

-- 2) 월별 환율
CREATE TABLE IF NOT EXISTS rpsim_purchase_exchange_rate (
    RATE_ID                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    CURRENCY_CODE          VARCHAR(10) NOT NULL COMMENT '통화코드',
    RATE                   DECIMAL(14,4) NOT NULL COMMENT '환율 (원)',
    MEMO                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (RATE_ID),
    UNIQUE KEY UK_PUR_EXRATE (YM, CURRENCY_CODE),
    INDEX IDX_PURCHASE_EXCHANGE_RATE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 구매 월별 환율';

-- 3) 부대비율 (연도 × 자재)
CREATE TABLE IF NOT EXISTS rpsim_purchase_incidental_rate (
    INCIDENTAL_ID          BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR                   INT NOT NULL COMMENT '연도',
    MATERIAL_CODE          VARCHAR(18) NOT NULL COMMENT '자재코드',
    MATERIAL_NAME          VARCHAR(100) NULL COMMENT '자재명',
    RATE                   DECIMAL(8,4) NOT NULL COMMENT '부대비율',
    MEMO                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (INCIDENTAL_ID),
    UNIQUE KEY UK_PUR_INCIDENTAL (YEAR, MATERIAL_CODE),
    INDEX IDX_PURCHASE_INCIDENTAL_RATE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 구매 부대비율';

-- 4) 업로드 버전 (업로드 1건 = 1행)
CREATE TABLE IF NOT EXISTS rpsim_purchase_plan_version (
    VERSION_ID             BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    START_YM               VARCHAR(6) NOT NULL COMMENT '시작 년월',
    END_YM                 VARCHAR(6) NOT NULL COMMENT '종료 년월',
    WRITE_DATE             DATE NULL COMMENT '작성일',
    FILE_NAME              VARCHAR(255) NULL COMMENT '업로드 파일명',
    STATUS                 VARCHAR(10) NOT NULL COMMENT '상태 (ACTIVE/REPLACED)',
    PULP_ROWS              INT NULL COMMENT '펄프 행 수',
    NON_PULP_ROWS          INT NULL COMMENT '펄프 외 행 수',
    WARNINGS               TEXT NULL COMMENT '업로드 경고 (JSON)',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (VERSION_ID),
    INDEX IDX_PUR_VER_YM (START_YM, STATUS),
    INDEX IDX_PURCHASE_PLAN_VERSION_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 구매 이동계획 업로드 버전';

-- 5) 펄프 수불 (버전 × 월 × 사업부 × 자재)
CREATE TABLE IF NOT EXISTS rpsim_purchase_pulp_plan (
    PLAN_ID                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    VERSION_ID             BIGINT NOT NULL COMMENT '업로드 버전 ID',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    MATERIAL_CODE          VARCHAR(18) NOT NULL COMMENT '자재코드',
    MATERIAL_NAME          VARCHAR(100) NULL COMMENT '자재명',
    MATL_GROUP_NM          VARCHAR(100) NULL COMMENT '자재그룹명',
    IN_QTY_TON             DECIMAL(18,3) NULL COMMENT '입고량 (톤, 구매+이동)',
    MOVE_IN_QTY_TON        DECIMAL(18,3) NULL COMMENT '이동 입고량 (톤)',
    PAY_CURRENCY           VARCHAR(10) NULL COMMENT '결제 통화',
    UNIT_PRICE_FC          DECIMAL(18,4) NULL COMMENT '단가 (외화)',
    OFFER_MONTH            VARCHAR(20) NULL COMMENT '오퍼월',
    IN_AMOUNT_MKRW         DECIMAL(18,6) NULL COMMENT '입고금액 (백만원)',
    OUT_QTY_TON            DECIMAL(18,3) NULL COMMENT '출고량 (톤)',
    NOTE                   VARCHAR(1000) NULL COMMENT '비고',
    EXCEL_ROW_NO           INT NULL COMMENT '엑셀 행번호',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (PLAN_ID),
    INDEX IDX_PUR_PULP_VER (VERSION_ID, YM, DIVISION),
    INDEX IDX_PURCHASE_PULP_PLAN_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 구매 이동계획 펄프 수불';

-- 6) 펄프 외 영향
CREATE TABLE IF NOT EXISTS rpsim_purchase_non_pulp_impact (
    IMPACT_ID              BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    VERSION_ID             BIGINT NOT NULL COMMENT '업로드 버전 ID',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    ITEM_GROUP             VARCHAR(100) NOT NULL COMMENT '항목 그룹',
    MATL_GROUP_NM          VARCHAR(100) NULL COMMENT '자재그룹명',
    ITEM_NAME              VARCHAR(200) NULL COMMENT '항목명',
    CONTENT                VARCHAR(1000) NULL COMMENT '내용',
    IMPACT_MKRW            DECIMAL(18,6) NOT NULL COMMENT '영향 금액 (백만원)',
    NOTE                   VARCHAR(1000) NULL COMMENT '비고',
    EXCEL_ROW_NO           INT NULL COMMENT '엑셀 행번호',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (IMPACT_ID),
    INDEX IDX_PUR_NONPULP_VER (VERSION_ID, YM, DIVISION),
    INDEX IDX_PURCHASE_NON_PULP_IMPACT_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 구매 이동계획 펄프 외 영향';
