-- ============================================================
-- rpsim_steam_unit_rate에 MONTH 컬럼 추가
-- 계절별로 원단위가 다르므로 월별 관리 필요 (전년 동월 참고)
-- 날짜: 2026-10-19
-- ============================================================

USE integration;

-- MONTH 컬럼 추가
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rpsim_steam_unit_rate' AND COLUMN_NAME = 'MONTH');

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE rpsim_steam_unit_rate ADD COLUMN MONTH INT NULL COMMENT ''적용 월 (1~12, NULL=연간)'' AFTER YEAR',
    'SELECT ''MONTH column already exists'' AS info');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 기존 UNIQUE KEY 삭제 후 MONTH 포함 재생성
ALTER TABLE rpsim_steam_unit_rate DROP INDEX IF EXISTS UK_STEAM_UNIT;
ALTER TABLE rpsim_steam_unit_rate 
    ADD UNIQUE KEY UK_STEAM_UNIT (YEAR, MONTH, MACHINE_CODE, DIVISION);
