-- =====================================================================
-- 30_rename_boiler_code_blr.sql
-- 보일러 코드를 BLR-* 체계로 통일
--   보일러 마스터(E_*)와 연료단가·구간단가(BLR-*) 코드가 달라
--   에너지비 계산에서 단가를 찾지 못하는 문제(단가미등록 → 0원) 해결
--
--   E_INCIN_2 → BLR-INCIN   (폐합성보일러 2호)
--   E_FLUID   → BLR-FLUID   (유동상보일러)
--   E_LNG     → BLR-LNG     (LNG보일러)
--   E_COGEN_1 / E_COGEN_2 → 아래 [복합보일러] 참고 (결정 필요)
--
-- ※ 실행 순서: 이 SQL 실행 → 코드 배포 → 에너지팀 수신 재실행
-- =====================================================================

-- 1) 보일러 마스터
UPDATE rpsim_boiler_master SET BOILER_CODE='BLR-INCIN' WHERE BOILER_CODE='E_INCIN_2';
UPDATE rpsim_boiler_master SET BOILER_CODE='BLR-FLUID' WHERE BOILER_CODE='E_FLUID';
UPDATE rpsim_boiler_master SET BOILER_CODE='BLR-LNG'   WHERE BOILER_CODE='E_LNG';

-- 2) 보일러 정비계획
UPDATE rpsim_boiler_maintenance SET BOILER_CODE='BLR-INCIN' WHERE BOILER_CODE='E_INCIN_2';
UPDATE rpsim_boiler_maintenance SET BOILER_CODE='BLR-FLUID' WHERE BOILER_CODE='E_FLUID';
UPDATE rpsim_boiler_maintenance SET BOILER_CODE='BLR-LNG'   WHERE BOILER_CODE='E_LNG';

-- 3) 일별 스팀 배분 계획 (저장된 배분표)
UPDATE rpsim_daily_steam_alloc SET BOILER_CODE='BLR-INCIN' WHERE BOILER_CODE='E_INCIN_2';
UPDATE rpsim_daily_steam_alloc SET BOILER_CODE='BLR-FLUID' WHERE BOILER_CODE='E_FLUID';
UPDATE rpsim_daily_steam_alloc SET BOILER_CODE='BLR-LNG'   WHERE BOILER_CODE='E_LNG';

-- 4) 보일러 연료단가: 예전 코드(E_INCIN_2)로 수신된 폐합성 단가 삭제
--    → 배포 후 에너지팀 수신을 다시 실행하면 BLR-INCIN 으로 새로 들어옵니다
DELETE FROM rpsim_boiler_cost_rate WHERE BOILER_CODE='E_INCIN_2';

-- ---------------------------------------------------------------------
-- [복합보일러] E_COGEN_1 / E_COGEN_2 — 결정 후 한 가지만 실행
--   연료단가·구간단가·BSC 보증량은 'BLR-COGEN' 한 묶음으로 들어옵니다.
--
-- (안 1) 1·2호기를 BLR-COGEN 한 대로 합치기 (용량 35+35 = 70톤/hr)
--   UPDATE rpsim_boiler_master SET BOILER_CODE='BLR-COGEN', BOILER_NAME='복합보일러', STEAM_PER_HOUR=70
--    WHERE BOILER_CODE='E_COGEN_1';
--   DELETE FROM rpsim_boiler_master WHERE BOILER_CODE='E_COGEN_2';
--
-- (안 2) 1·2호기를 따로 유지 → 코드 수정 필요 (단가·보증량을 두 대에 나누는 로직)
-- ---------------------------------------------------------------------

-- 확인
SELECT BOILER_CODE, BOILER_NAME, YEAR, MONTH, STEAM_PER_HOUR, PRIORITY
  FROM rpsim_boiler_master ORDER BY YEAR, MONTH, PRIORITY;
