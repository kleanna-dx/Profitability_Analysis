-- =====================================================================
-- 30_alter_energy_ref_columns.sql
-- 에너지비 기준정보 컬럼 보강 (엔티티에는 있으나 SQL 파일에 빠져 있던 컬럼)
--   1) rpsim_steam_price_interval.MONTH — 스팀 구간단가 월별 관리 (UK: 계약연도+월+보일러+순번+사업부)
--      ※ 예전 29_alter_steam_price_interval_month.sql 이 삭제되어 누락됐던 컬럼
--   2) rpsim_burner_lng_rate.MONTH — LNG 버너 원단위 월별 관리 (UK: 연도+월+호기+사업부)
--   3) rpsim_boiler_maintenance.RESPONSIBILITY — 보일러 정비 귀책구분
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

-- 1) 스팀 구간단가 — 월별
ALTER TABLE rpsim_steam_price_interval
    ADD COLUMN IF NOT EXISTS MONTH INT NOT NULL DEFAULT 0 COMMENT '월 (1~12, 0=월 구분 없던 기존 데이터)' AFTER CONTRACT_YEAR;
ALTER TABLE rpsim_steam_price_interval
    DROP INDEX IF EXISTS IDX_STEAM_PRICE,
    ADD INDEX IDX_STEAM_PRICE (CONTRACT_YEAR, MONTH, DIVISION);

-- 2) LNG 버너 원단위 — 월별 (UK 에 MONTH 포함)
ALTER TABLE rpsim_burner_lng_rate
    ADD COLUMN IF NOT EXISTS MONTH INT NOT NULL DEFAULT 1 COMMENT '적용 월 (1~12)' AFTER YEAR;
ALTER TABLE rpsim_burner_lng_rate
    DROP INDEX IF EXISTS UK_BURNER_LNG,
    ADD UNIQUE KEY UK_BURNER_LNG (YEAR, MONTH, MACHINE_CODE, DIVISION);

-- 3) 보일러 정비계획 — 귀책구분
ALTER TABLE rpsim_boiler_maintenance
    ADD COLUMN IF NOT EXISTS RESPONSIBILITY VARCHAR(20) NULL COMMENT '귀책구분' AFTER MAINT_TYPE;
