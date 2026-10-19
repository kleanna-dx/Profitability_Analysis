-- ============================================================
-- rpsim_machine_speed UNIQUE KEY에 BASIS_WEIGHT 추가
-- 같은 호기+지종이라도 평량별로 선속이 다름 (PM3/SC/220g ≠ PM3/SC/230g)
-- 날짜: 2026-10-19
-- ============================================================

-- 기존 UNIQUE KEY 삭제
ALTER TABLE rpsim_machine_speed DROP INDEX IF EXISTS UK_MACHINE_SPEED;

-- 평량(BASIS_WEIGHT) 포함한 새 UNIQUE KEY 생성
ALTER TABLE rpsim_machine_speed 
    ADD UNIQUE KEY UK_MACHINE_SPEED (YEAR, MACHINE_CODE, PRODUCT, BASIS_WEIGHT, DIVISION);
