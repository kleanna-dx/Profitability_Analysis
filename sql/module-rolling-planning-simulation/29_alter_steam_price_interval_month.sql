-- =====================================================================
-- 29_alter_steam_price_interval_month.sql
-- 스팀 구간단가(rpsim_steam_price_interval) 월별 관리
--   - BSC/ASC 단가와 BSC 보증량이 매월 달라질 수 있으므로 MONTH 컬럼 추가
--   - MONTH = 0 : 연간 공통(기존 데이터). 해당 월 데이터가 없을 때만 사용
--   - MONTH = 1~12 : 월별 구간단가 (에너지팀 수신 시 월별로 저장)
-- =====================================================================

ALTER TABLE rpsim_steam_price_interval
    ADD COLUMN MONTH INT NOT NULL DEFAULT 0 COMMENT '월 (0=연간 공통, 1~12=월별)' AFTER CONTRACT_YEAR;

ALTER TABLE rpsim_steam_price_interval
    DROP INDEX IDX_STEAM_PRICE,
    ADD INDEX IDX_STEAM_PRICE (CONTRACT_YEAR, MONTH, DIVISION);
