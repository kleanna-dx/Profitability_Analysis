-- ============================================================
-- rpsim_steam_price_interval에 BOILER_CODE 컬럼 추가
-- 어떤 보일러에 구간단가를 적용할지 지정
-- 날짜: 2026-10-19
-- ============================================================

USE integration;

SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rpsim_steam_price_interval' AND COLUMN_NAME = 'BOILER_CODE');

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE rpsim_steam_price_interval ADD COLUMN BOILER_CODE VARCHAR(30) NULL COMMENT ''적용 보일러코드'' AFTER CONTRACT_YEAR',
    'SELECT ''BOILER_CODE column already exists'' AS info');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
