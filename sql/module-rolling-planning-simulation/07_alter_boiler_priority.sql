-- ============================================================
-- rpsim_boiler_master에 우선순위 컬럼 추가
-- ① 폐합성소각로 → ② 복합보일러 → ③ 유동상보일러 → ④ LNG보일러
-- 날짜: 2026-10-15
-- ============================================================

-- 컬럼 존재 여부 확인 후 추가 (MariaDB 호환)
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rpsim_boiler_master' AND COLUMN_NAME = 'PRIORITY');

SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE rpsim_boiler_master ADD COLUMN PRIORITY INT NOT NULL DEFAULT 99 COMMENT ''스팀 분배 우선순위 (1=최우선)'' AFTER STEAM_PER_HOUR',
    'SELECT ''PRIORITY column already exists'' AS info');

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 기본 우선순위 세팅 (보일러 타입별, 데이터가 있을 때만)
UPDATE rpsim_boiler_master SET PRIORITY = 1 WHERE BOILER_TYPE = 'INCIN_SYNTH';   -- 폐합성 소각로
UPDATE rpsim_boiler_master SET PRIORITY = 2 WHERE BOILER_TYPE = 'COGEN';          -- 복합 보일러
UPDATE rpsim_boiler_master SET PRIORITY = 3 WHERE BOILER_TYPE = 'INCIN_FLUID';    -- 유동상 보일러
UPDATE rpsim_boiler_master SET PRIORITY = 4 WHERE BOILER_TYPE = 'LNG';            -- LNG 보일러
UPDATE rpsim_boiler_master SET PRIORITY = 5 WHERE BOILER_TYPE = 'EXTERNAL';       -- 외부 보일러
