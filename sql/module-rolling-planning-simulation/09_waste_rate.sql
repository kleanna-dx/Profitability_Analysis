-- ============================================================
-- 폐품률 마스터 (연도×호기×지종별)
-- 1년간 고정값으로 사용
-- 양품 생산계획 = 이론생산성(톤/일) × (1-폐품률) × 정상가동시간(h) ÷ 24
-- 날짜: 2026-10-18
-- ============================================================
CREATE TABLE IF NOT EXISTS rpsim_waste_rate (
    WASTE_RATE_ID    BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    MACHINE_CODE     VARCHAR(20)  NOT NULL                COMMENT '호기 코드 (PM2/PM3 등)',
    PRODUCT          VARCHAR(50)  NULL                    COMMENT '지종 (SC/KB/IV 등, NULL=호기 전체 기본값)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    WASTE_RATE_PCT   DECIMAL(6,3) NOT NULL DEFAULT 0      COMMENT '폐품률 (%, 예: 8.44)',
    NOTE             VARCHAR(200) NULL                    COMMENT '비고',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (WASTE_RATE_ID),
    UNIQUE KEY UK_WASTE_RATE (YEAR, MACHINE_CODE, PRODUCT, DIVISION),
    INDEX IDX_WASTE_RATE_YEAR (YEAR, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 폐품률 마스터 (연도별 고정, 양품 생산계획 산출용)';
