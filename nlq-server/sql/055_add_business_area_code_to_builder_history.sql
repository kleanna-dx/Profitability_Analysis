-- ============================================================
-- [PR #516 / 2026-10-02] 비주얼 쿼리 빌더 이력에 업무영역(수익/제조) 저장
-- ------------------------------------------------------------
-- 배경:
--   비주얼 쿼리 빌더에서 "제조원가" 영역에서 만든 쿼리 이력을
--   현재 "수익성분석" 영역 상태에서 클릭하면,
--   제조원가 필드가 수익성분석 schema(bw_profitability_data)에서
--   조회되어 500 오류가 발생. 반대도 동일.
--
--   원인:
--     1) builder_query_history 테이블에 업무영역 저장 컬럼 없음
--        (domain_code 만 존재 — PS/HL/MGMT 구분용)
--     2) 쿼리 이력 복원 시 PS/HL/MGMT 도메인만 전환하고
--        AreaTabs(수익성분석/제조원가 탭)는 전환하지 않음
--     3) 결과: 현재 활성 영역의 target table 로 다른 영역 필드 조회 → 500
--
-- 해결:
--   builder_query_history 에 business_area_code VARCHAR(32) 컬럼 추가.
--     - 저장값:
--         'PROFITABILITY'      → 수익성분석 탭에서 생성 (프론트 배지 [수익])
--         'MANUFACTURING_COST' → 제조원가 탭에서 생성  (프론트 배지 [제조])
--         NULL                 → 이 PR 적용 이전에 생성된 레거시 이력
--                                (프론트에서 generated_sql / fields_json 기반
--                                 fallback 추론, 추론 불가 시 null 유지)
--     - 값 컨벤션: nl_query_history.business_area_code (PR #393) 와 동일
--       → 자연어 질의와 비주얼 쿼리 빌더가 동일한 코드 체계 사용
--     - 위치: domain_code 옆에 배치 (두 컬럼 모두 요청 컨텍스트 분류용)
--     - NULL 허용: 하위호환 (기존 이력 무영향)
--
--   추가로 공유 쿼리(shared_queries) 테이블에도 동일 컬럼 2개 추가:
--     - domain_code         VARCHAR(20)  : 공유 시 원본 도메인 정보 보존
--     - business_area_code  VARCHAR(32)  : 공유 시 원본 업무영역 정보 보존
--     → 공유받은 사용자가 쿼리를 열면 원본과 동일한 영역/도메인으로 자동 전환.
--
-- 프론트 매핑 (nlq-server/public/builder.html renderBuilderHistory):
--   PROFITABILITY      → [수익] (배경 #885DF6, 글씨 #ffffff)
--   MANUFACTURING_COST → [제조] (배경 #0373AE, 글씨 #ffffff)
--   NULL               → _inferBusinessAreaFromHistory() fallback 추론
--                        (SQL / 전용 필드 기반, 추론 불가 시 배지 미표시)
--   → 자연어 질의(nl_query_history) 배지 스타일과 100% 동일 inline style 재사용.
--
-- 서버 로직 (nlq-server/server.mjs):
--   - ensureBookmarkShareTables() 가 애플리케이션 startup 시 동일한
--     idempotent ALTER TABLE 마이그레이션을 자동 실행하므로,
--     애플리케이션 배포만으로도 스키마가 맞춰짐.
--   - 본 SQL 파일은 운영 DBA 가 직접 적용하고자 할 때, 그리고
--     히스토리 추적을 위한 기록으로 함께 제공.
--
-- 영향:
--   - 신규 테이블 생성 없음 (기존 2개 테이블에 컬럼 추가만).
--   - 기존 데이터 영향 없음 (추가 컬럼 DEFAULT NULL).
--   - 복원 로직은 애플리케이션 레벨 (프론트 switchAreaForHistory()).
--   - 레거시 이력(business_area_code=NULL)은 프론트가 fields_json /
--     generated_sql 패턴 기반 fallback 추론을 수행하므로 schema 불일치 없음.
--
-- 참고 SQL:
--   051_add_business_area_code_to_history.sql (PR #393, nl_query_history 동일 패턴)
-- ============================================================

-- MariaDB / MySQL 모두 IF NOT EXISTS 를 ALTER TABLE ADD COLUMN 에서
-- 지원하지 않는 버전이 있으므로, 존재 여부를 확인 후 조건부 실행.
-- (051_add_business_area_code_to_history.sql 와 동일한 안전 패턴 사용)

SET @schema := DATABASE();

-- ============================================================
-- 1. builder_query_history.business_area_code 컬럼 추가
-- ============================================================
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'builder_query_history'
    AND COLUMN_NAME  = 'business_area_code'
);
SET @stmt := IF(@col_exists = 0,
  'ALTER TABLE builder_query_history ADD COLUMN business_area_code VARCHAR(32) DEFAULT NULL COMMENT ''쿼리 실행 당시 선택된 업무영역 코드 (PROFITABILITY/MANUFACTURING_COST/NULL, PR #516)'' AFTER domain_code',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================
-- 2. builder_query_history 에 (user_id, business_area_code) 복합 인덱스 추가
--    - 사용자별 특정 영역 이력만 빠르게 조회할 수 있도록 (향후 영역별 필터 UI 대비)
-- ============================================================
SET @idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'builder_query_history'
    AND INDEX_NAME   = 'idx_business_area'
);
SET @stmt := IF(@idx_exists = 0,
  'ALTER TABLE builder_query_history ADD INDEX idx_business_area (user_id, business_area_code)',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================
-- 3. shared_queries.domain_code 컬럼 추가
--    - 공유된 쿼리에서도 원본의 도메인(PS/HL/MGMT) 정보 보존
--    - 공유 생성 시 서버가 src.domain_code 를 복사하여 저장
-- ============================================================
SET @sq_domain_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'shared_queries'
    AND COLUMN_NAME  = 'domain_code'
);
SET @stmt := IF(@sq_domain_exists = 0,
  'ALTER TABLE shared_queries ADD COLUMN domain_code VARCHAR(20) DEFAULT NULL COMMENT ''공유 시 원본 쿼리의 도메인 코드 (PS/HL/MGMT, PR #516)'' AFTER memo',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================
-- 4. shared_queries.business_area_code 컬럼 추가
--    - 공유된 쿼리에서도 원본의 업무영역(수익/제조) 정보 보존
--    - 공유 생성 시 서버가 src.business_area_code 를 복사하여 저장
-- ============================================================
SET @sq_area_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'shared_queries'
    AND COLUMN_NAME  = 'business_area_code'
);
SET @stmt := IF(@sq_area_exists = 0,
  'ALTER TABLE shared_queries ADD COLUMN business_area_code VARCHAR(32) DEFAULT NULL COMMENT ''공유 시 원본 쿼리의 업무영역 코드 (PROFITABILITY/MANUFACTURING_COST/NULL, PR #516)'' AFTER domain_code',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- ============================================================
-- 5. 적용 결과 검증
-- ============================================================

-- 5-1) builder_query_history 추가된 컬럼 확인
SELECT
  'builder_query_history' AS table_name,
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_MAXIMUM_LENGTH AS max_len,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME   = 'builder_query_history'
  AND COLUMN_NAME  = 'business_area_code';

-- 5-2) builder_query_history 추가된 인덱스 확인
SELECT
  'builder_query_history' AS table_name,
  INDEX_NAME,
  SEQ_IN_INDEX,
  COLUMN_NAME,
  NON_UNIQUE
FROM INFORMATION_SCHEMA.STATISTICS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME   = 'builder_query_history'
  AND INDEX_NAME   = 'idx_business_area'
ORDER BY SEQ_IN_INDEX;

-- 5-3) shared_queries 추가된 컬럼 확인
SELECT
  'shared_queries' AS table_name,
  COLUMN_NAME,
  DATA_TYPE,
  CHARACTER_MAXIMUM_LENGTH AS max_len,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME   = 'shared_queries'
  AND COLUMN_NAME IN ('domain_code', 'business_area_code')
ORDER BY ORDINAL_POSITION;

-- 5-4) 레거시 이력 비율 확인 (NULL 비율)
--    적용 직후: 100% NULL (이 PR 이전 모든 이력이 레거시)
--    이후 신규 쿼리부터 PROFITABILITY/MANUFACTURING_COST 값이 쌓임.
SELECT
  'builder_query_history' AS table_name,
  COUNT(*)                                                            AS total,
  SUM(business_area_code IS NULL)                                     AS legacy_null,
  SUM(business_area_code = 'PROFITABILITY')                           AS profitability,
  SUM(business_area_code = 'MANUFACTURING_COST')                      AS manufacturing_cost,
  ROUND(SUM(business_area_code IS NULL) / NULLIF(COUNT(*),0) * 100, 2) AS legacy_pct
FROM builder_query_history;

-- ============================================================
-- 완료
--
-- 다음 단계 (운영 적용 체크리스트):
--   [ ] 위 5-1 결과에 business_area_code 1개 row 가 보이면 컬럼 추가 성공
--   [ ] 위 5-2 결과에 idx_business_area 가 (user_id→1, business_area_code→2) 로
--       나오면 인덱스 추가 성공
--   [ ] 위 5-3 결과에 shared_queries 의 domain_code / business_area_code
--       2개 row 가 보이면 공유 테이블 컬럼 추가 성공
--   [ ] 위 5-4 는 적용 직후에는 legacy_null = total (100%) 로 나오는 것이 정상
--   [ ] 애플리케이션(nlq-server) 재배포 — 서버의 ensureBookmarkShareTables()
--       가 자동으로 동일한 ALTER 를 실행하므로 수동 적용 vs 서버 적용 결과 동일
--
-- Rollback (문제가 생겨서 되돌려야 할 때):
--   ALTER TABLE builder_query_history DROP INDEX idx_business_area;
--   ALTER TABLE builder_query_history DROP COLUMN business_area_code;
--   ALTER TABLE shared_queries        DROP COLUMN business_area_code;
--   ALTER TABLE shared_queries        DROP COLUMN domain_code;
--   → 단, 애플리케이션이 ensureBookmarkShareTables() 로 다시 ALTER 하므로
--     애플리케이션도 함께 이전 버전으로 롤백해야 재추가 방지 가능.
-- ============================================================
