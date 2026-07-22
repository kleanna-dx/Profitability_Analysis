-- ============================================================
-- [PR #250 / 2026-07-22] bw_profitability_data 인덱스·실행계획 진단 SQL
-- ------------------------------------------------------------
-- 목적:
--   1) DIVISION, CALMONTH, MATERIAL 3컬럼 복합 인덱스 존재 여부 확인
--   2) 문제 쿼리(월별 SKU 매출)의 EXPLAIN 확인 → full scan / temporary / filesort 여부
--   3) 인덱스 미존재 시 생성 DDL 제안
-- 사용법 (MariaDB CLI):
--   $ mysql -h <host> -u <user> -p <db> < check-index-and-explain.sql
-- 또는:
--   $ mysql> source /path/to/check-index-and-explain.sql;
-- ============================================================

-- ------------------------------------------------------------
-- [1] bw_profitability_data 테이블에 등록된 모든 인덱스 조회
-- ------------------------------------------------------------
SELECT
  TABLE_SCHEMA         AS `스키마`,
  TABLE_NAME           AS `테이블`,
  INDEX_NAME           AS `인덱스명`,
  NON_UNIQUE           AS `NON_UNIQUE`,
  SEQ_IN_INDEX         AS `순서`,
  COLUMN_NAME          AS `컬럼`,
  CARDINALITY          AS `카디널리티`,
  INDEX_TYPE           AS `인덱스타입`
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'bw_profitability_data'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;

-- ------------------------------------------------------------
-- [2] (DIVISION, CALMONTH, MATERIAL) 조합 복합 인덱스가 존재하는지
--     "leftmost prefix" 규칙으로 판정.
--     - 첫 번째 컬럼이 DIVISION 인 인덱스가 반드시 있어야
--       WHERE DIVISION='10' AND CALMONTH BETWEEN ... 절이 인덱스 range scan 됨.
-- ------------------------------------------------------------
SELECT
  INDEX_NAME               AS `인덱스명`,
  GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS `컬럼순서`
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'bw_profitability_data'
  AND INDEX_NAME IN (
    SELECT DISTINCT INDEX_NAME
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME   = 'bw_profitability_data'
      AND SEQ_IN_INDEX = 1
      AND COLUMN_NAME  = 'DIVISION'
  )
GROUP BY INDEX_NAME;

-- ------------------------------------------------------------
-- [3] 문제 쿼리의 EXPLAIN (2026년 3월~6월 월별 SKU 매출)
--     확인 포인트:
--       - type = ALL         → 풀 테이블 스캔 (인덱스 미사용). BAD.
--       - type = range/ref   → 인덱스 사용. GOOD.
--       - Extra: Using temporary + Using filesort → GROUP BY 정렬용
--                임시 테이블 사용 (수십만행이면 매우 느림). BAD.
--       - rows       → 실제 스캔 예상 행 수. 22만행 전체 나오면 인덱스 미적중.
-- ------------------------------------------------------------
EXPLAIN
SELECT
  CALMONTH                    AS `연월`,
  MATERIAL                    AS `SKU코드`,
  MAX(MATERIAL_NM)            AS `SKU명`,
  SUM(ZAMT003)                AS `매출 합계(원)`
FROM bw_profitability_data
WHERE DIVISION = '10'
  AND CALMONTH BETWEEN '202603' AND '202606'
GROUP BY CALMONTH, MATERIAL
ORDER BY CALMONTH ASC, SUM(ZAMT003) DESC;

-- ------------------------------------------------------------
-- [3-b] EXPLAIN ANALYZE (MariaDB 10.1+) — 실측 시간까지 확인
--     ※ 실제 쿼리를 실행하므로 시간이 오래 걸릴 수 있음. 필요 시에만 실행.
-- ------------------------------------------------------------
-- ANALYZE FORMAT=JSON
-- SELECT
--   CALMONTH, MATERIAL, MAX(MATERIAL_NM), SUM(ZAMT003)
-- FROM bw_profitability_data
-- WHERE DIVISION = '10'
--   AND CALMONTH BETWEEN '202603' AND '202606'
-- GROUP BY CALMONTH, MATERIAL;

-- ============================================================
-- [4] 인덱스가 없을 때 생성 권장 DDL
-- ------------------------------------------------------------
-- 아래는 실행 예시입니다. 실제 실행 전에 다음을 확인하세요:
--   - 위 [2] 쿼리 결과가 비어있을 때만 실행 (이미 있으면 중복 인덱스 생성 지양)
--   - 인덱스 생성은 테이블 락을 걸므로 서비스 시간대에는 실행 금지
--   - 22만 행 규모에서는 수 초~수십 초 내 완료 (bw_profitability_data 크기 기준)
-- ============================================================
--
-- 권장 복합 인덱스 (leftmost prefix rule):
--   ① DIVISION  ← WHERE DIVISION='10'  (선택도 낮지만 필터 필수)
--   ② CALMONTH  ← WHERE CALMONTH BETWEEN ... (range scan)
--   ③ MATERIAL  ← GROUP BY MATERIAL (인덱스 정렬로 filesort 회피)
--
-- CREATE INDEX idx_bw_div_calmonth_material
--   ON bw_profitability_data (DIVISION, CALMONTH, MATERIAL);
--
-- 검증: 인덱스 생성 후 위 [3] EXPLAIN 을 재실행하여
--       type=range 또는 ref, Extra에 Using index 가 표시되는지 확인.
-- ============================================================

-- ------------------------------------------------------------
-- [5] 테이블 크기·행수 확인 (참고)
-- ------------------------------------------------------------
SELECT
  TABLE_SCHEMA                     AS `스키마`,
  TABLE_NAME                       AS `테이블`,
  TABLE_ROWS                       AS `대략_행수`,
  ROUND(DATA_LENGTH  / 1024/1024, 1) AS `데이터_MB`,
  ROUND(INDEX_LENGTH / 1024/1024, 1) AS `인덱스_MB`,
  ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024/1024, 1) AS `합계_MB`
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'bw_profitability_data';
