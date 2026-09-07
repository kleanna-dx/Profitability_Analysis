-- ============================================================
-- [2026-09-04] sys_aimd_cot043 에 DIVISION / DIVISION_NM 컬럼 추가
-- ------------------------------------------------------------
-- 목적:
--   원가요소별 금액 테이블(sys_aimd_cot043) 에서도 제품군(사업부) 단위 분석이
--   가능하도록 DIVISION / DIVISION_NM 컬럼을 추가한다.
--
--   현재 sys_aimd_cot043 는 원가요소(COSTELMNT) + 코스트센터(COSTCENTER) 까지만
--   표현되어 "HL 제품군의 재료비" 와 같은 제품군 단위 필터가 불가능함.
--   sys_aimd_cot015 (sql/052) 와 동일 컨벤션으로 DIVISION 코드 + DIVISION_NM
--   명칭 두 컬럼을 함께 두어 코드 필터 규칙(NM 필터 금지) 을 그대로 재사용한다.
--
-- 삽입 위치:
--   COSTELMNT_NM 바로 다음 (AFTER COSTELMNT_NM).
--   → 원본 sql/047_create_sys_aimd_cot043.sql 의 컬럼 순서와 논리적으로
--     "원가요소 → 원가요소명 → 제품군 → 제품군명 → 코스트센터 → …"
--     흐름이 이어지도록.
--
-- 타입 결정 근거 (SAP RFC 원본 정의 CHAR 2/40, 사용자 스크린샷 기준):
--   DIVISION     VARCHAR(2)  NULL COMMENT '제품군'          (SAP CHAR 2)
--   DIVISION_NM  VARCHAR(40) NULL COMMENT '제품군 명'       (SAP CHAR 40)
--
--   * sys_aimd_cot015 (sql/052) 의 DIVISION / DIVISION_NM 과 완전히 동일.
--     두 테이블 간 코드/명칭 매핑을 그대로 재사용 가능.
--
-- 데이터 보정:
--   기존 행(row) 에 대해서는 NULL 로 채워지며, 이후 RFC 재적재 시 SAP BW
--   원본에서 값이 채워지는 것을 전제로 한다. 별도 UPDATE 는 이 마이그레이션
--   범위에 포함하지 않는다 (원천 데이터 정합성 보장을 위해).
--
-- 멱등성:
--   INFORMATION_SCHEMA 를 조회하여 컬럼 존재 여부를 확인한 후 없을 때만
--   ADD COLUMN 을 수행. 여러 번 실행해도 안전.
--
-- 의존:
--   sql/047_create_sys_aimd_cot043.sql (테이블이 이미 생성되어 있어야 함)
-- ============================================================

-- ------------------------------------------------------------
-- 1) DIVISION 컬럼 추가 (없을 때만)
-- ------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'sys_aimd_cot043'
     AND COLUMN_NAME  = 'DIVISION'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE sys_aimd_cot043 ADD COLUMN DIVISION VARCHAR(2) NULL COMMENT ''제품군 (SAP CHAR 2)'' AFTER COSTELMNT_NM',
  'SELECT ''DIVISION already exists — skip'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) DIVISION_NM 컬럼 추가 (없을 때만) — DIVISION 바로 다음에 배치
-- ------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'sys_aimd_cot043'
     AND COLUMN_NAME  = 'DIVISION_NM'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE sys_aimd_cot043 ADD COLUMN DIVISION_NM VARCHAR(40) NULL COMMENT ''제품군 명 (SAP CHAR 40, ⚠️ 필터엔 사용 금지 — DIVISION 코드 사용)'' AFTER DIVISION',
  'SELECT ''DIVISION_NM already exists — skip'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- 검증 쿼리 (운영 반영 후 실행하여 결과 확인)
-- ------------------------------------------------------------
-- 1) 컬럼 존재 및 순서 확인 (COSTELMNT_NM 다음에 DIVISION/DIVISION_NM 가 있어야 함)
--    SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLUMN_COMMENT
--      FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME = 'sys_aimd_cot043'
--       AND COLUMN_NAME IN ('COSTELMNT_NM','DIVISION','DIVISION_NM','COSTCENTER')
--     ORDER BY ORDINAL_POSITION;
--
-- 2) 컬럼 개수 확인 (기대: 047 이후 10개 + 2개 = 12개)
--    SELECT COUNT(*) AS col_count
--      FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME = 'sys_aimd_cot043';
--
-- 3) 스키마 최종 확인
--    SHOW CREATE TABLE sys_aimd_cot043\G
--
-- 4) 기존 행에 NULL 로 채워졌는지 확인
--    SELECT COUNT(*) AS total, SUM(DIVISION IS NULL) AS null_div, SUM(DIVISION_NM IS NULL) AS null_div_nm
--      FROM sys_aimd_cot043;
-- ============================================================
