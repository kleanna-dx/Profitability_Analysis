-- =====================================================================
-- 32_sales_plan.sql
-- 판매계획 (STEP1 › 판매계획, PS) — 공통코드·등급 마스터 + 업로드 버전·등급별·국가별 판매량
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

-- 1) 공통 코드 (판매구분/제품유형/국가)
CREATE TABLE IF NOT EXISTS rpsim_sales_code (
    CODE_ID                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    CODE_TYPE              VARCHAR(20) NOT NULL COMMENT '코드 구분 (SALES_TYPE/PRODUCT_TYPE/COUNTRY)',
    CODE_NAME              VARCHAR(100) NOT NULL COMMENT '코드명',
    COUNTRY_YN             CHAR(1) NOT NULL COMMENT '국가별 입력 대상 여부',
    SORT_ORDER             INT NULL COMMENT '정렬순서',
    USE_YN                 CHAR(1) NOT NULL COMMENT '사용 여부',
    MEMO                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (CODE_ID),
    UNIQUE KEY UK_SALES_CODE (CODE_TYPE, CODE_NAME),
    INDEX IDX_SALES_CODE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 판매계획 공통 코드';

-- 2) 등급 마스터
CREATE TABLE IF NOT EXISTS rpsim_sales_grade (
    GRADE_ID               BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    PRODUCT_TYPE           VARCHAR(100) NOT NULL COMMENT '제품유형',
    GRADE_NAME             VARCHAR(100) NOT NULL COMMENT '등급명',
    PROD_PRODUCT           VARCHAR(100) NULL COMMENT '생산 지종',
    SORT_ORDER             INT NULL COMMENT '정렬순서',
    USE_YN                 CHAR(1) NOT NULL COMMENT '사용 여부',
    MEMO                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (GRADE_ID),
    UNIQUE KEY UK_SALES_GRADE (DIVISION, PRODUCT_TYPE, GRADE_NAME),
    INDEX IDX_SALES_GRADE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 판매계획 등급 마스터';

-- 3) 업로드 버전
CREATE TABLE IF NOT EXISTS rpsim_sales_plan_version (
    VERSION_ID             BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    START_YM               VARCHAR(6) NOT NULL COMMENT '시작 년월',
    END_YM                 VARCHAR(6) NOT NULL COMMENT '종료 년월',
    WRITE_DATE             DATE NULL COMMENT '작성일',
    FILE_NAME              VARCHAR(255) NULL COMMENT '업로드 파일명',
    STATUS                 VARCHAR(10) NOT NULL COMMENT '상태 (ACTIVE/REPLACED)',
    GRADE_ROWS             INT NULL COMMENT '등급 행 수',
    COUNTRY_ROWS           INT NULL COMMENT '국가 행 수',
    WARNINGS               TEXT NULL COMMENT '업로드 경고 (JSON)',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (VERSION_ID),
    INDEX IDX_SALES_VER (DIVISION, START_YM, STATUS),
    INDEX IDX_SALES_PLAN_VERSION_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 판매계획 업로드 버전';

-- 4) 등급별 판매량
CREATE TABLE IF NOT EXISTS rpsim_sales_plan (
    PLAN_ID                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    VERSION_ID             BIGINT NOT NULL COMMENT '업로드 버전 ID',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    SALES_TYPE             VARCHAR(100) NOT NULL COMMENT '판매구분',
    PRODUCT_TYPE           VARCHAR(100) NOT NULL COMMENT '제품유형',
    GRADE_NAME             VARCHAR(100) NOT NULL COMMENT '등급명',
    QTY_TON                DECIMAL(14,3) NOT NULL COMMENT '판매량 (톤)',
    NOTE                   VARCHAR(500) NULL COMMENT '비고',
    EXCEL_ROW_NO           INT NULL COMMENT '엑셀 행번호',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (PLAN_ID),
    INDEX IDX_SALES_PLAN_VER (VERSION_ID, YM, DIVISION),
    INDEX IDX_SALES_PLAN_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 판매계획 등급별 판매량';

-- 5) 국가별 수출 판매량
CREATE TABLE IF NOT EXISTS rpsim_sales_plan_country (
    COUNTRY_PLAN_ID        BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    VERSION_ID             BIGINT NOT NULL COMMENT '업로드 버전 ID',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    SALES_TYPE             VARCHAR(100) NOT NULL COMMENT '판매구분',
    COUNTRY                VARCHAR(100) NOT NULL COMMENT '국가',
    QTY_TON                DECIMAL(14,3) NOT NULL COMMENT '판매량 (톤)',
    NOTE                   VARCHAR(500) NULL COMMENT '비고',
    EXCEL_ROW_NO           INT NULL COMMENT '엑셀 행번호',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (COUNTRY_PLAN_ID),
    INDEX IDX_SALES_CTRY_VER (VERSION_ID, YM, DIVISION),
    INDEX IDX_SALES_PLAN_COUNTRY_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 판매계획 국가별 판매량';
