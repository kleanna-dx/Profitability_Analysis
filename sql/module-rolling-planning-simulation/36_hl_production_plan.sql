-- =====================================================================
-- 36_hl_production_plan.sql
-- HL 생산계획 (STEP1 › 생산계획, HL) — 년월 × 생산 호기 × 자재코드 = 월 생산량(EA)
-- 현업이 년월 전체를 입력·업로드 후 확정 (확정 = rpsim_hl_sales_close CLOSE_TYPE='PRODUCTION')
-- 전력비·에너지비: EA × 1EA 중량(rpsim_hl_material_master) ÷ 1000 = 톤 · 기저귀 라인은 계산 제외
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

CREATE TABLE IF NOT EXISTS rpsim_hl_production_plan (
    PROD_ID                BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                     VARCHAR(6) NOT NULL COMMENT '년월 (YYYYMM)',
    CATEGORY               VARCHAR(100) NULL COMMENT '카테고리 분류',
    MACHINE                VARCHAR(50) NOT NULL COMMENT '생산 호기 (호기 마스터 코드·이름 또는 별칭: 가공3→RP3, 생리대5→SN5)',
    PROD_TYPE              VARCHAR(100) NULL COMMENT '생산 분류',
    MATERIAL_CODE          VARCHAR(50) NOT NULL COMMENT '자재코드',
    MATERIAL_NAME          VARCHAR(200) NULL COMMENT '자재명',
    QTY_EA                 DECIMAL(16,2) NOT NULL COMMENT '월 생산량 (EA)',
    NOTE                   VARCHAR(500) NULL COMMENT '비고',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (PROD_ID),
    UNIQUE KEY UK_HL_PROD_PLAN (YM, MACHINE, MATERIAL_CODE),
    INDEX IDX_HL_PRODUCTION_PLAN_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – HL 생산계획 (EA)';
