-- ===========================================
-- 연료비 고정차감 항목: MONTH 컬럼 추가 (월별 관리)
-- 기존 데이터는 MONTH=0 (월 구분 없음 = 연간 고정)
-- ===========================================

ALTER TABLE rpsim_cogen_deduction ADD COLUMN MONTH INT DEFAULT 0 AFTER YEAR;
