-- =====================================================================
-- 35_hl_sales.sql
-- HL 판매계획 (STEP1 › HL 판매계획 · 장려금·마케팅비)
--   1) rpsim_hl_sales_plan        — SKU별 판매계획: 년월 × 영업팀 × 거래처 × 자재코드 = BOX 수량 · BOX당 단가 → 순매출
--   2) rpsim_hl_customer_expense  — 거래처별 장려금·마케팅비 (기획팀, 년월 × 거래처 = 1행, 영업팀 구분 없음)
--   3) rpsim_hl_sales_close       — 마감: SALES=년월×영업팀 / EXPENSE·PRODUCTION=년월 전체(SALES_TEAM='전체')
-- 엑셀 재업로드 = 그 범위 데이터를 통째 교체 (파일에 없는 행은 소프트 삭제)
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

-- 1) HL 판매계획 (SKU별)
CREATE TABLE IF NOT EXISTS rpsim_hl_sales_plan (
    PLAN_ID                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    SALES_TEAM             VARCHAR(100) NOT NULL COMMENT '영업팀 (장려금·생산계획 마감 행은 ''전체'')',
    CUSTOMER_CODE          VARCHAR(30) NOT NULL COMMENT '거래처코드',
    CUSTOMER_NAME          VARCHAR(200) NULL COMMENT '거래처명',
    CATEGORY               VARCHAR(100) NULL COMMENT '카테고리',
    MATERIAL_CODE          VARCHAR(50) NOT NULL COMMENT '자재코드',
    BOX_QTY                DECIMAL(14,2) NOT NULL COMMENT 'BOX 수량',
    BOX_PRICE              DECIMAL(14,2) NOT NULL COMMENT 'BOX당 단가 (원)',
    NET_SALES              DECIMAL(18,2) NOT NULL COMMENT '순매출 (원, BOX 수량 × BOX당 단가 — 서버 계산)',
    NOTE                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (PLAN_ID),
    UNIQUE KEY UK_HL_SALES_PLAN (YM, SALES_TEAM, CUSTOMER_CODE, MATERIAL_CODE),
    INDEX IDX_HL_SALES_PLAN_YM (YM, SALES_TEAM),
    INDEX IDX_HL_SALES_PLAN_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – HL 판매계획 (SKU별)';

-- 2) HL 장려금·마케팅비 (거래처별)
CREATE TABLE IF NOT EXISTS rpsim_hl_customer_expense (
    EXPENSE_ID             BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    CUSTOMER_CODE          VARCHAR(30) NOT NULL COMMENT '거래처코드',
    CUSTOMER_NAME          VARCHAR(200) NULL COMMENT '거래처명',
    INCENTIVE_AMT          DECIMAL(18,2) NOT NULL COMMENT '장려금 (원)',
    MARKETING_AMT          DECIMAL(18,2) NOT NULL COMMENT '마케팅비 (원)',
    NOTE                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (EXPENSE_ID),
    UNIQUE KEY UK_HL_CUST_EXPENSE (YM, CUSTOMER_CODE),
    INDEX IDX_HL_CUSTOMER_EXPENSE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – HL 거래처별 장려금·마케팅비';

-- 3) HL 마감
CREATE TABLE IF NOT EXISTS rpsim_hl_sales_close (
    CLOSE_ID               BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    SALES_TEAM             VARCHAR(100) NOT NULL COMMENT '영업팀 (장려금·생산계획 마감 행은 ''전체'')',
    CLOSE_TYPE             VARCHAR(20) NOT NULL COMMENT '마감 구분 (SALES/EXPENSE/PRODUCTION)',
    IS_CLOSED              CHAR(1) NOT NULL COMMENT '마감 여부 (Y/N)',
    CLOSED_BY              VARCHAR(50) NULL COMMENT '마감자',
    CLOSED_AT              DATETIME NULL COMMENT '마감일시',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (CLOSE_ID),
    UNIQUE KEY UK_HL_SALES_CLOSE (YM, SALES_TEAM, CLOSE_TYPE),
    INDEX IDX_HL_SALES_CLOSE_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – HL 마감 (판매계획·장려금·생산계획)';
