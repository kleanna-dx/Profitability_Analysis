-- ============================================================
-- rpsim_production_plan: 생산계획 (STEP3 확정 데이터)
-- 호기/지종/평량별 예상 양품량 + 잠금(확정) 상태 관리
-- 날짜: 2026-10-19
-- ============================================================

USE integration;

CREATE TABLE IF NOT EXISTS rpsim_production_plan (
    PLAN_ID            BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION           VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MACHINE_CODE       VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    YEAR               INT          NOT NULL                COMMENT '연도',
    MONTH              INT          NOT NULL                COMMENT '월 (1~12)',
    PRODUCT            VARCHAR(50)  NOT NULL                COMMENT '지종 코드',
    BASIS_WEIGHT       DECIMAL(8,2) NULL                    COMMENT '평량 (g/m²)',
    TRIM_WIDTH         DECIMAL(8,2) NULL                    COMMENT '지폭 (mm)',
    THEORY_PROD_TPD    DECIMAL(10,2) NULL                   COMMENT '이론생산 (톤/일)',
    WASTE_RATE_PCT     DECIMAL(5,2) NULL                    COMMENT '폐품률 (%)',
    GOOD_TON           DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '예상 양품량 (톤)',
    OPERATION_DAYS     DECIMAL(5,1) NULL                    COMMENT '가동일수',
    IS_LOCKED          TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '잠금(확정) 여부 (1=확정)',
    LOCKED_BY          VARCHAR(50)  NULL                    COMMENT '확정자 userId',
    LOCKED_AT          DATETIME     NULL                    COMMENT '확정 일시',
    CREATED_BY         VARCHAR(50)  NULL                    COMMENT '등록자 userId',
    CREATED_AT         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT         DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP  COMMENT '수정일시',
    PRIMARY KEY (PLAN_ID),
    UNIQUE KEY UK_PROD_PLAN (DIVISION, MACHINE_CODE, YEAR, MONTH, PRODUCT, BASIS_WEIGHT)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 생산계획 (STEP3 확정)';
