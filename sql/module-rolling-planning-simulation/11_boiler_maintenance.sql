-- ============================================================
-- 보일러 정비계획 마스터
-- 정비 중인 보일러는 사용 불가 → 다른 보일러 구매량 증가
-- 날짜: 2026-10-18
-- ============================================================

CREATE TABLE IF NOT EXISTS rpsim_boiler_maintenance (
    MAINT_ID            BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR                INT           NOT NULL                COMMENT '적용 연도',
    MONTH               INT           NOT NULL                COMMENT '적용 월 (1~12)',
    BOILER_CODE         VARCHAR(30)   NOT NULL                COMMENT '보일러 코드 (보일러 마스터 참조)',
    DIVISION            VARCHAR(20)   NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MAINT_TYPE          VARCHAR(30)   NOT NULL DEFAULT 'REGULAR' COMMENT '정비유형 (REGULAR=정기정비, OVERHAUL=대정비, EMERGENCY=긴급, INSPECTION=법정검사)',
    MAINT_NAME          VARCHAR(200)  NULL                    COMMENT '정비명 (예: 2호기 대정비, 복합보일러 정기점검)',
    START_DATE          DATE          NULL                    COMMENT '정비 시작일',
    END_DATE            DATE          NULL                    COMMENT '정비 종료일',
    MAINT_HOURS         DECIMAL(8,2)  NOT NULL DEFAULT 0      COMMENT '정비시간 (hr) — 해당 월 사용불가 시간',
    MEMO                VARCHAR(500)  NULL                    COMMENT '비고 (정비내용, 외주업체 등)',
    CREATED_AT          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT          DATETIME      NULL,
    PRIMARY KEY (MAINT_ID),
    INDEX IDX_BOILER_MAINT_YM (YEAR, MONTH, DIVISION),
    INDEX IDX_BOILER_MAINT_CODE (BOILER_CODE, YEAR)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 보일러 정비계획 (정비 중 사용불가 → 타 보일러 구매량 증가)';
