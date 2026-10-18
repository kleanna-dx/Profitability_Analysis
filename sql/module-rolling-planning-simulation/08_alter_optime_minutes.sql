-- ============================================================
-- rpsim_operating_time: 단위를 일(Day) → 분(min/월)로 변경
-- 컬럼명은 유지 (기존 호환), COMMENT만 수정
-- 입력: 분 단위, 시간 변환은 DTO에서 ÷60
-- 날짜: 2026-10-18
-- ============================================================

-- 컬럼 COMMENT 변경 (단위: 분/월)
ALTER TABLE rpsim_operating_time MODIFY COLUMN TOTAL_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '총 시간 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN PLANNED_SHUTDOWN_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '계획운휴 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN OPERATION_NORMAL_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '정상가동 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN OPERATION_WASTE_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '폐품손실 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN OPERATION_UNPLANNED_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '비계획생산 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN OPERATION_STARTUP_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '초출 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN OPERATION_TRIMMING_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '절지 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN DOWNTIME_REPAIR_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '정비 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN DOWNTIME_CLEANING_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '펠트세척 (분/월)';
ALTER TABLE rpsim_operating_time MODIFY COLUMN DOWNTIME_ACCIDENT_DAYS DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '사고 등 (분/월)';
