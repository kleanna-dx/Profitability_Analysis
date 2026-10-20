-- ===========================================
-- 일별 스팀 배부 계획 테이블
-- 자동 계산 결과를 저장/편집/확정하는 용도
-- ===========================================

CREATE TABLE IF NOT EXISTS rpsim_daily_steam_alloc (
    ALLOC_ID        BIGINT AUTO_INCREMENT PRIMARY KEY,
    YEAR            INT NOT NULL,
    MONTH           INT NOT NULL,
    DAY             INT NOT NULL,
    BOILER_CODE     VARCHAR(30) NOT NULL,
    ALLOC_TON       DECIMAL(12,2) DEFAULT 0 COMMENT '배분량(톤/일)',
    ALLOC_TPH       DECIMAL(12,4) DEFAULT 0 COMMENT '배분량(T/H)',
    DAILY_DEMAND    DECIMAL(12,2) DEFAULT 0 COMMENT '일 필요량(톤)',
    IS_SHUTDOWN     TINYINT(1) DEFAULT 0 COMMENT '운휴 여부',
    MEMO            VARCHAR(200),
    DIVISION        VARCHAR(20) NOT NULL DEFAULT 'PS',
    IS_LOCKED       TINYINT(1) DEFAULT 0 COMMENT '확정 여부',
    LOCKED_BY       VARCHAR(50),
    LOCKED_AT       DATETIME,
    CREATED_BY      VARCHAR(50),
    CREATED_AT      DATETIME DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE INDEX uk_daily_steam (YEAR, MONTH, DAY, BOILER_CODE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='일별 스팀 배부 계획';
