-- =====================================================================
-- 22_interface_management.sql
-- 경영시뮬레이션 인터페이스 관리 테이블 (마스터 + 수행관리 + 이력)
-- 수익성분석의 batch_master / batch_schedule / batch_jobs 구조 참조
-- =====================================================================

-- 1) 인터페이스 마스터
CREATE TABLE IF NOT EXISTS rpsim_itf_master (
    INTERFACE_ID    VARCHAR(50)  NOT NULL COMMENT '인터페이스 ID (PK)',
    INTERFACE_NAME  VARCHAR(200) NOT NULL COMMENT '인터페이스 명',
    SENDER          VARCHAR(50)  NOT NULL DEFAULT 'MANUAL' COMMENT '송신 시스템 (에너지팀/생산관리/SAP BW 등)',
    RECEIVER        VARCHAR(50)  NOT NULL DEFAULT 'RPSIM'  COMMENT '수신 시스템',
    RFC_NAME        VARCHAR(100) DEFAULT NULL COMMENT 'RFC 함수명 (SAP 연동 시)',
    RFC_FUNC_OR_URL VARCHAR(500) DEFAULT NULL COMMENT 'RFC Function / REST URL',
    RFC_PARAM       TEXT         DEFAULT NULL COMMENT 'RFC/REST 호출 파라미터 (JSON)',
    TARGET_TABLE    VARCHAR(100) DEFAULT NULL COMMENT '대상 테이블명',
    EXEC_MODE       VARCHAR(20)  NOT NULL DEFAULT 'REPLACE' COMMENT '기본 실행 모드 (REPLACE/MERGE/APPEND)',
    IS_ACTIVE       TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '활성 여부',
    REMARK          TEXT         DEFAULT NULL COMMENT '비고',
    CREATED_BY      VARCHAR(50)  DEFAULT NULL,
    UPDATED_BY      VARCHAR(50)  DEFAULT NULL,
    CREATED_AT      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT      DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (INTERFACE_ID),
    KEY idx_rpsim_itf_master_active (IS_ACTIVE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='경영시뮬레이션 인터페이스 마스터';

-- 시드 데이터 (13개 인터페이스)
INSERT INTO rpsim_itf_master (INTERFACE_ID, INTERFACE_NAME, SENDER, RECEIVER, RFC_NAME, TARGET_TABLE, EXEC_MODE, IS_ACTIVE, CREATED_BY)
VALUES
    ('RPSIM_ITF_001', '스팀사용 원단위',        '에너지팀',  'RPSIM', NULL,       'rpsim_steam_unit_rate',     'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_002', '보일러 마스터',           '에너지팀',  'RPSIM', NULL,       'rpsim_boiler_master',       'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_003', '보일러 정비계획',         '에너지팀',  'RPSIM', NULL,       'rpsim_boiler_maintenance',  'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_004', '스팀 구간단가',           '에너지팀',  'RPSIM', NULL,       'rpsim_steam_price_interval','REPLACE', 1, 'admin'),
    ('RPSIM_ITF_005', '보일러 연료단가',         '에너지팀',  'RPSIM', NULL,       'rpsim_boiler_cost_rate',    'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_006', '연료비 고정차감',         '에너지팀',  'RPSIM', NULL,       'rpsim_cogen_deduction',     'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_007', 'LNG 버너 원단위',        '에너지팀',  'RPSIM', NULL,       'rpsim_burner_lng_rate',     'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_008', '일별 가동시간',           '생산관리',  'RPSIM', NULL,       'rpsim_daily_operation',     'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_009', '제지 생산 선속',          '생산관리',  'RPSIM', NULL,       'rpsim_machine_speed',       'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_010', '폐품률 마스터',           '품질팀',    'RPSIM', NULL,       'rpsim_waste_rate',          'REPLACE', 1, 'admin'),
    ('RPSIM_ITF_013', '전력비 계산 결과',        '전력비모듈','RPSIM', NULL,       'rpsim_pw_monthly_summary',  'MERGE',   1, 'admin')
ON DUPLICATE KEY UPDATE
    INTERFACE_NAME = VALUES(INTERFACE_NAME),
    SENDER = VALUES(SENDER),
    TARGET_TABLE = VALUES(TARGET_TABLE),
    EXEC_MODE = VALUES(EXEC_MODE),
    IS_ACTIVE = VALUES(IS_ACTIVE),
    UPDATED_BY = 'admin';

-- 2) 인터페이스 수행관리 (스케줄)
CREATE TABLE IF NOT EXISTS rpsim_itf_schedule (
    SCHEDULE_ID       BIGINT       NOT NULL AUTO_INCREMENT,
    INTERFACE_ID      VARCHAR(50)  NOT NULL COMMENT '인터페이스 ID (FK)',
    SCHEDULE_TYPE     VARCHAR(20)  NOT NULL DEFAULT 'manual' COMMENT '수행 주기 (daily/monthly/manual/once)',
    EXEC_TIME         TIME         DEFAULT NULL COMMENT '수행 시간 (daily/monthly)',
    EXEC_DATETIME     DATETIME     DEFAULT NULL COMMENT '1회 예약 실행 일시 (once)',
    EXEC_DAY_OF_MONTH TINYINT      DEFAULT NULL COMMENT '월간 실행일 (1~31)',
    TARGET_MONTH      VARCHAR(6)   DEFAULT NULL COMMENT '대상년월 YYYYMM',
    EXEC_MODE         VARCHAR(20)  DEFAULT NULL COMMENT '실행 모드 (replace/append)',
    IS_ACTIVE         TINYINT(1)   NOT NULL DEFAULT 1,
    LAST_RUN_AT       DATETIME     DEFAULT NULL,
    LAST_RUN_STATUS   VARCHAR(20)  DEFAULT NULL COMMENT 'success/failed/running/pending',
    NEXT_RUN_AT       DATETIME     DEFAULT NULL,
    REMARK            VARCHAR(500) DEFAULT NULL,
    CREATED_BY        VARCHAR(50)  DEFAULT NULL,
    UPDATED_BY        VARCHAR(50)  DEFAULT NULL,
    CREATED_AT        DATETIME     DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT        DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (SCHEDULE_ID),
    KEY idx_rpsim_itf_sched_itf (INTERFACE_ID),
    KEY idx_rpsim_itf_sched_active (IS_ACTIVE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='경영시뮬레이션 인터페이스 수행관리 (스케줄)';

-- 3) 인터페이스 실행 이력
CREATE TABLE IF NOT EXISTS rpsim_itf_history (
    HISTORY_ID      BIGINT       NOT NULL AUTO_INCREMENT,
    INTERFACE_ID    VARCHAR(50)  NOT NULL COMMENT '인터페이스 ID',
    INTERFACE_NAME  VARCHAR(200) DEFAULT NULL COMMENT '인터페이스 명 (조회 편의)',
    JOB_TYPE        VARCHAR(50)  DEFAULT 'MANUAL_SYNC' COMMENT '구분 (SAP_RFC_SYNC/MANUAL_SYNC/EXCEL_UPLOAD)',
    EXEC_MODE       VARCHAR(20)  DEFAULT 'replace' COMMENT '모드 (replace/append/merge)',
    STATUS          VARCHAR(20)  NOT NULL DEFAULT 'pending' COMMENT '상태 (pending/running/success/failed)',
    STARTED_AT      DATETIME     DEFAULT NULL,
    COMPLETED_AT    DATETIME     DEFAULT NULL,
    DURATION_MS     INT          DEFAULT 0 COMMENT '소요시간(ms)',
    PROCESS_COUNT   INT          DEFAULT 0 COMMENT '처리건수',
    ERROR_MESSAGE   TEXT         DEFAULT NULL,
    EXECUTED_BY     VARCHAR(50)  DEFAULT NULL COMMENT '실행자',
    CREATED_AT      DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (HISTORY_ID),
    KEY idx_rpsim_itf_hist_itf (INTERFACE_ID),
    KEY idx_rpsim_itf_hist_status (STATUS),
    KEY idx_rpsim_itf_hist_created (CREATED_AT DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='경영시뮬레이션 인터페이스 실행 이력';
