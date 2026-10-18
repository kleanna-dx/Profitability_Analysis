-- ============================================================
-- 지종 마스터
-- KSC, SC, IV, KB, CCKB 등 — 연도구분없음 (공통)
-- 날짜: 2026-10-18
-- ============================================================
CREATE TABLE IF NOT EXISTS rpsim_product_master (
    PRODUCT_ID       BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    PRODUCT_CODE     VARCHAR(30)  NOT NULL                COMMENT '지종 코드 (SC/KB/IV/CCKB/KSC 등)',
    PRODUCT_NAME     VARCHAR(100) NOT NULL                COMMENT '지종명',
    PRODUCT_GROUP    VARCHAR(50)  NULL                    COMMENT '지종 그룹 (백판지/산업용지 등)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    DISPLAY_ORDER    INT          NOT NULL DEFAULT 0      COMMENT '표시 순서',
    IS_ACTIVE        TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '활성 여부',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (PRODUCT_ID),
    UNIQUE KEY UK_PRODUCT_CODE (PRODUCT_CODE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 지종 마스터 (연도구분없음, 공통)';
