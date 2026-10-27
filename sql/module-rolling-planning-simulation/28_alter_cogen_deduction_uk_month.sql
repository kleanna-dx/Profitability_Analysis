-- =====================================================================
-- 28_alter_cogen_deduction_uk_month.sql
-- 연료비 고정차감 UK에 MONTH 추가 — 월별 데이터 중복 방지
-- 기존 UK: (YEAR, ITEM_TYPE, DIVISION) → 같은 항목은 연도당 1건만 가능
-- 변경 UK: (YEAR, MONTH, ITEM_TYPE, DIVISION) → 월별로 다른 값 허용
-- =====================================================================

ALTER TABLE rpsim_cogen_deduction
    DROP INDEX UK_COGEN_DEDUCT,
    ADD UNIQUE KEY UK_COGEN_DEDUCT (YEAR, MONTH, ITEM_TYPE, DIVISION);
