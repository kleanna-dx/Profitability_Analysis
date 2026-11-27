-- =====================================================================
-- 38_alter_hl_customer_expense_drop_sales_team.sql
-- HL 장려금·마케팅비 — 영업팀 구분 제거 (기획팀이 년월 전체를 업로드, 년월 × 거래처 = 1행)
-- 35_hl_sales.sql 이전 버전(SALES_TEAM 포함)으로 이미 테이블을 만든 경우에만 해당. 새로 만든 테이블은 변화 없음
-- ※ 실행 전 확인: 같은 년월·거래처가 여러 영업팀에 나뉘어 있으면 UK 생성이 실패합니다 — 아래 확인 쿼리 결과가 0건이어야 함
--    SELECT YM, CUSTOMER_CODE, COUNT(*) FROM rpsim_hl_customer_expense GROUP BY YM, CUSTOMER_CODE HAVING COUNT(*) > 1;
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

ALTER TABLE rpsim_hl_customer_expense
    DROP INDEX IF EXISTS UK_HL_CUST_EXPENSE,
    DROP COLUMN IF EXISTS SALES_TEAM;
ALTER TABLE rpsim_hl_customer_expense
    ADD UNIQUE KEY IF NOT EXISTS UK_HL_CUST_EXPENSE (YM, CUSTOMER_CODE);
