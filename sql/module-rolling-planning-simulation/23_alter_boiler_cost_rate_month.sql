-- =====================================================================
-- 23_alter_boiler_cost_rate_month.sql
-- 보일러 연료단가(rpsim_boiler_cost_rate)에 MONTH 컬럼 추가
-- 모든 단가가 매월/매년 변동 가능 → 월별 관리 필요
-- =====================================================================

-- 1) MONTH 컬럼 추가 (0=기본값/연간, 1~12=월별)
ALTER TABLE rpsim_boiler_cost_rate
    ADD COLUMN MONTH INT NOT NULL DEFAULT 0 COMMENT '월 (0=기본/연간, 1~12=월별)' AFTER YEAR;

-- 2) FACTOR 컬럼 추가 (BSC/ASC 단가 × FACTOR = 최종단가)
ALTER TABLE rpsim_boiler_cost_rate
    ADD COLUMN FACTOR DECIMAL(10,4) DEFAULT 1.0000 COMMENT '단가 보정 계수 (기본 1.0)' AFTER RATE_UNIT;

-- 3) UK 변경: 같은 보일러+연도+월+단가유형 중복 방지
ALTER TABLE rpsim_boiler_cost_rate
    DROP INDEX IF EXISTS uk_rpsim_cost_rate,
    ADD UNIQUE KEY uk_rpsim_cost_rate (YEAR, MONTH, BOILER_CODE, RATE_TYPE, DIVISION);
