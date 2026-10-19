-- ============================================================
-- 제지 생산 선속 (호기별/지종별 초지기 선속)
-- 연도별 기준정보 — 매년 재업로드
-- 이론 생산량(톤/일) = 평량×0.001² × 지폭×0.001 × 선속 × 1440
-- 날짜: 2026-10-15
-- ============================================================
CREATE TABLE IF NOT EXISTS rpsim_machine_speed (
    SPEED_ID         BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    MACHINE_CODE     VARCHAR(20)  NOT NULL                COMMENT '호기 코드 (PM2/PM3 등)',
    PRODUCT          VARCHAR(50)  NOT NULL                COMMENT '지종 (SC저평량/SC고평량/ACB/KB 등)',
    BASIS_WEIGHT     DECIMAL(8,2) NOT NULL DEFAULT 0      COMMENT '평량 (g/m²)',
    TRIM_WIDTH       DECIMAL(8,2) NOT NULL DEFAULT 0      COMMENT '지폭 (mm)',
    SPEED            DECIMAL(8,2) NOT NULL DEFAULT 0      COMMENT '선속 (m/min)',
    THEORY_PROD_TPD  DECIMAL(12,4) NULL                   COMMENT '이론생산 (톤/일, 자동계산)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    NOTE             VARCHAR(200) NULL                    COMMENT '비고',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (SPEED_ID),
    UNIQUE KEY UK_MACHINE_SPEED (YEAR, MACHINE_CODE, PRODUCT, BASIS_WEIGHT, DIVISION),
    INDEX IDX_MACHINE_SPEED_YEAR (YEAR, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 제지 생산 선속 (호기별/지종별, 연도별 기준)';
