-- ============================================================
-- rpsim_daily_operation: 일별 가동시간 관리
-- 호기별/일자별 가동시간(hr)과 운휴여부를 관리
-- 날짜: 2026-10-19
-- ============================================================

USE integration;

CREATE TABLE IF NOT EXISTS rpsim_daily_operation (
    DAILY_OP_ID        BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION           VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MACHINE_CODE       VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    YEAR               INT          NOT NULL                COMMENT '연도',
    MONTH              INT          NOT NULL                COMMENT '월 (1~12)',
    DAY                INT          NOT NULL                COMMENT '일 (1~31)',
    OPERATION_HOURS    DECIMAL(5,2) NOT NULL DEFAULT 24     COMMENT '가동시간 (hr, 기본=24)',
    IS_SHUTDOWN        TINYINT(1)   NOT NULL DEFAULT 0      COMMENT '운휴 여부 (1=운휴, 0=가동)',
    SHUTDOWN_REASON    VARCHAR(100) NULL                    COMMENT '운휴 사유',
    MEMO               VARCHAR(200) NULL                    COMMENT '비고',
    CREATED_AT         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    UPDATED_AT         DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP  COMMENT '수정일시',
    PRIMARY KEY (DAILY_OP_ID),
    UNIQUE KEY UK_DAILY_OP (DIVISION, MACHINE_CODE, YEAR, MONTH, DAY)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 일별 호기별 가동시간';
