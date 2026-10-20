-- ===========================================
-- 보일러 마스터: YEAR/MONTH 컬럼 추가 (월별 스팀용량 관리)
-- 기존 데이터는 YEAR=0, MONTH=0 (연도/월 구분 없음 = 기본값)
-- ===========================================

-- 1) YEAR 컬럼 추가
ALTER TABLE rpsim_boiler_master ADD COLUMN YEAR INT DEFAULT 0 AFTER DIVISION;

-- 2) MONTH 컬럼 추가
ALTER TABLE rpsim_boiler_master ADD COLUMN MONTH INT DEFAULT 0 AFTER YEAR;

-- 3) 기존 UK 변경: BOILER_CODE + DIVISION + YEAR + MONTH
-- 기존 UK가 있으면 삭제
-- (UK 이름은 환경에 따라 다를 수 있으므로, 에러 나면 무시)
ALTER TABLE rpsim_boiler_master DROP INDEX IF EXISTS uk_boiler_code;
ALTER TABLE rpsim_boiler_master DROP INDEX IF EXISTS UK_BOILER_CODE;
ALTER TABLE rpsim_boiler_master DROP INDEX IF EXISTS uk_rpsim_boiler_master;

-- 새 UK 생성: 같은 보일러코드 + 사업부 + 연도 + 월 조합 유니크
ALTER TABLE rpsim_boiler_master ADD UNIQUE INDEX uk_boiler_div_ym (BOILER_CODE, DIVISION, YEAR, MONTH);
