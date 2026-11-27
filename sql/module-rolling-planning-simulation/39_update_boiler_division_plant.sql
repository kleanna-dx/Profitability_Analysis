-- =====================================================================
-- 39_update_boiler_division_plant.sql
-- 보일러 기준정보를 공장 공통(DIVISION='PLANT')으로 전환 — 보일러는 PS·HL 공장 공통 설비
-- 대상: 보일러 마스터 · 보일러 연료단가 · 보일러 정비계획 · 연료비 고정차감 · 스팀 구간단가
-- PLANT 데이터가 아직 없는 테이블만 PS → PLANT 로 바꿈 (이미 PLANT 행이 있으면 그 테이블은 건드리지 않음)
-- 실행 전 SELECT 로 대상 건수를 먼저 확인하세요
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

-- 실행 전 확인 (테이블별 사업부 건수)
SELECT 'rpsim_boiler_master' AS TBL, DIVISION, COUNT(*) AS CNT FROM rpsim_boiler_master WHERE DELETED_YN = 'N' GROUP BY DIVISION
UNION ALL SELECT 'rpsim_boiler_cost_rate' AS TBL, DIVISION, COUNT(*) AS CNT FROM rpsim_boiler_cost_rate WHERE DELETED_YN = 'N' GROUP BY DIVISION
UNION ALL SELECT 'rpsim_boiler_maintenance' AS TBL, DIVISION, COUNT(*) AS CNT FROM rpsim_boiler_maintenance WHERE DELETED_YN = 'N' GROUP BY DIVISION
UNION ALL SELECT 'rpsim_cogen_deduction' AS TBL, DIVISION, COUNT(*) AS CNT FROM rpsim_cogen_deduction WHERE DELETED_YN = 'N' GROUP BY DIVISION
UNION ALL SELECT 'rpsim_steam_price_interval' AS TBL, DIVISION, COUNT(*) AS CNT FROM rpsim_steam_price_interval WHERE DELETED_YN = 'N' GROUP BY DIVISION;

UPDATE rpsim_boiler_master SET DIVISION = 'PLANT'
 WHERE DIVISION = 'PS'
   AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM rpsim_boiler_master WHERE DIVISION = 'PLANT' LIMIT 1) x);

UPDATE rpsim_boiler_cost_rate SET DIVISION = 'PLANT'
 WHERE DIVISION = 'PS'
   AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM rpsim_boiler_cost_rate WHERE DIVISION = 'PLANT' LIMIT 1) x);

UPDATE rpsim_boiler_maintenance SET DIVISION = 'PLANT'
 WHERE DIVISION = 'PS'
   AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM rpsim_boiler_maintenance WHERE DIVISION = 'PLANT' LIMIT 1) x);

UPDATE rpsim_cogen_deduction SET DIVISION = 'PLANT'
 WHERE DIVISION = 'PS'
   AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM rpsim_cogen_deduction WHERE DIVISION = 'PLANT' LIMIT 1) x);

UPDATE rpsim_steam_price_interval SET DIVISION = 'PLANT'
 WHERE DIVISION = 'PS'
   AND NOT EXISTS (SELECT 1 FROM (SELECT 1 FROM rpsim_steam_price_interval WHERE DIVISION = 'PLANT' LIMIT 1) x);

