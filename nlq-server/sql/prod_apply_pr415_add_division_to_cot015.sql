-- ============================================================
-- [운영 반영용 통합 스크립트] PR #415
-- sys_aimd_cot015 에 DIVISION / DIVISION_NM 컬럼 추가 + Ontology 시드
--
-- 작성일  : 2026-09-04
-- 대상 PR :
--   - PR #415 : sys_aimd_cot015 에 사업부(제품군) 코드/명칭 컬럼 추가
--               원본 마이그레이션 파일 (jswon → develop 반영본):
--                 · sql/052_add_division_to_sys_aimd_cot015.sql (DDL, 신규)
--                 · sql/050_seed_cost_ontology.sql              (ontology 시드, PR #415 델타 6행)
--                 · sql/043_create_sys_aimd_cot015.sql          (원본 CREATE 정의 갱신 — 신규 환경용)
--
-- 실행 방법:
--   mysql -u <user> -p <database> < prod_apply_pr415_add_division_to_cot015.sql
--   또는
--   mysql> USE <database>;
--   mysql> SOURCE prod_apply_pr415_add_division_to_cot015.sql;
--
-- ⚠️ 사전 조건:
--   1) 아래 테이블이 운영 DB 에 이미 존재해야 합니다:
--        · sys_aimd_cot015 (제품별원가)   ← sql/043_create_sys_aimd_cot015.sql
--        · ontology_column                ← 학습관리 스키마 (PR #383 이전 이미 존재)
--      존재하지 않으면 본 스크립트 상단 [사전 점검] 섹션에서 진단됩니다.
--
--   2) 본 스크립트 실행 후, 자연어질의에서 DIVISION 필터를 사용하려면
--      RAG 인덱스 재빌드가 필요합니다:
--        POST /api/rag/build   (관리자 세션 필요)
--      또는 학습관리 화면에서 [RAG 인덱스 재빌드] 버튼 클릭.
--      이 단계를 생략하면 rag_embeddings 에 신규 컬럼 청크가 반영되지 않아
--      LLM 이 DIVISION 컬럼을 "허용 컬럼 목록" 에서 못 봐 필터를 못 만듭니다.
--
--   3) 실제 데이터 값(값 채우기) 은 Spring Boot 어댑터
--      (SapRfcSyncService · NLP_RFC_002 → Z_BI_WEB_EX_BL_4) 의 SAP → DB
--      필드 매핑에 DIVISION / DIVISION_NM 이 추가되어야 채워집니다.
--      → 본 스크립트는 컬럼만 생성. 값은 후속 RFC 재적재 시 채워짐.
--
-- 멱등성:
--   본 스크립트는 여러 번 실행해도 안전합니다.
--     · DDL   : INFORMATION_SCHEMA 체크 후 없을 때만 ADD COLUMN
--     · 시드  : UNIQUE KEY (domain_code, column_name, table_name) + INSERT IGNORE
--
-- ▣ 본 스크립트가 수행하는 작업 (요약)
--   1) sys_aimd_cot015 에 DIVISION      VARCHAR(5)   NULL AFTER MATERIAL_NM
--   2) sys_aimd_cot015 에 DIVISION_NM   VARCHAR(100) NULL AFTER DIVISION
--   3) ontology_column 에 3도메인 (PS/HL/MGMT) × 2컬럼 = 6행 시드
--
-- 스키마 변경: YES (DDL 추가)
-- 데이터 변경: YES (ontology_column 6행 추가)
-- 서버 코드   : 없음 (이 스크립트로 무관)
-- 환경변수    : 없음
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- [사전 점검] 필수 테이블 존재 여부 확인
-- ═══════════════════════════════════════════════════════════
SELECT
  CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_cot015') = 1
       THEN '✓ sys_aimd_cot015 존재'
       ELSE '✗ sys_aimd_cot015 없음 — sql/043_create_sys_aimd_cot015.sql 을 먼저 실행하세요'
  END AS check_table_cot015,
  CASE WHEN (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ontology_column') = 1
       THEN '✓ ontology_column 존재'
       ELSE '✗ ontology_column 없음 — 학습관리 스키마를 먼저 배포하세요'
  END AS check_table_ontology_column;


-- ═══════════════════════════════════════════════════════════
-- 1) sys_aimd_cot015 에 DIVISION 컬럼 추가 (없을 때만)
--    타입: VARCHAR(5) — bw_profitability_data 의 DIVISION 과 동일
--    위치: AFTER MATERIAL_NM
-- ═══════════════════════════════════════════════════════════
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'sys_aimd_cot015'
     AND COLUMN_NAME  = 'DIVISION'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE sys_aimd_cot015 ADD COLUMN DIVISION VARCHAR(5) NULL COMMENT ''사업부(제품군) 코드 (CHAR 5, bw_profitability_data 와 동일)'' AFTER MATERIAL_NM',
  'SELECT ''DIVISION already exists — skip'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ═══════════════════════════════════════════════════════════
-- 2) sys_aimd_cot015 에 DIVISION_NM 컬럼 추가 (없을 때만)
--    타입: VARCHAR(100) — bw_profitability_data 의 DIVISION_NM 과 동일
--    위치: AFTER DIVISION
--    ⚠️ 필터엔 사용 금지 — DIVISION 코드로 필터하세요
-- ═══════════════════════════════════════════════════════════
SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'sys_aimd_cot015'
     AND COLUMN_NAME  = 'DIVISION_NM'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE sys_aimd_cot015 ADD COLUMN DIVISION_NM VARCHAR(100) NULL COMMENT ''사업부(제품군)명 (CHAR 100, ⚠️ 필터엔 사용 금지 — DIVISION 코드 사용)'' AFTER DIVISION',
  'SELECT ''DIVISION_NM already exists — skip'' AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;


-- ═══════════════════════════════════════════════════════════
-- 3) ontology_column 시드 — 3도메인 (PS / HL / MGMT) × 2컬럼 = 6행
--    이 시드가 있어야 자연어질의(NLQ) 프롬프트가 DIVISION 컬럼을
--    "허용 컬럼 목록" 에 포함시켜서 LLM 이 WHERE 절에 사용 가능.
--    (미등록 시 → "알 수 없는 용어입니다" / column-not-in-schema 경고)
--
--   UNIQUE KEY : (domain_code, column_name, table_name)
--   INSERT IGNORE : 이미 있는 행은 무시 → 재실행 안전.
-- ═══════════════════════════════════════════════════════════
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES
-- PS 도메인 (페이퍼솔루션)
('PS',   'DIVISION',    'sys_aimd_cot015', '사업부(제품군) 코드',                                        'varchar(5)'),
('PS',   'DIVISION_NM', 'sys_aimd_cot015', '사업부(제품군)명 (⚠️ 필터에 사용 금지 — DIVISION 코드 사용)', 'varchar(100)'),
-- HL 도메인 (홈앤라이프)
('HL',   'DIVISION',    'sys_aimd_cot015', '사업부(제품군) 코드',                                        'varchar(5)'),
('HL',   'DIVISION_NM', 'sys_aimd_cot015', '사업부(제품군)명 (⚠️ 필터에 사용 금지 — DIVISION 코드 사용)', 'varchar(100)'),
-- MGMT 도메인 (경영관리)
('MGMT', 'DIVISION',    'sys_aimd_cot015', '사업부(제품군) 코드',                                        'varchar(5)'),
('MGMT', 'DIVISION_NM', 'sys_aimd_cot015', '사업부(제품군)명 (⚠️ 필터에 사용 금지 — DIVISION 코드 사용)', 'varchar(100)');


-- ============================================================
-- 검증 쿼리 (실행 완료 후 아래 SELECT 을 실행해서 결과 확인)
-- ------------------------------------------------------------
-- 1) 컬럼 존재 및 순서 확인
--    (MATERIAL_NM → DIVISION → DIVISION_NM 순서여야 함)
--    SELECT COLUMN_NAME, ORDINAL_POSITION, DATA_TYPE,
--           CHARACTER_MAXIMUM_LENGTH, COLUMN_COMMENT
--      FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME = 'sys_aimd_cot015'
--       AND COLUMN_NAME IN ('MATERIAL_NM','DIVISION','DIVISION_NM')
--     ORDER BY ORDINAL_POSITION;
--
-- 2) sys_aimd_cot015 총 컬럼 개수 (기대: 38개 = seq + 35개 원본 + DIVISION/DIVISION_NM)
--    SELECT COUNT(*) AS col_count
--      FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME = 'sys_aimd_cot015';
--
-- 3) ontology_column 시드 반영 확인 (기대: 6행 = 3도메인 × 2컬럼)
--    SELECT domain_code, column_name, table_name, description
--      FROM ontology_column
--     WHERE table_name = 'sys_aimd_cot015'
--       AND column_name IN ('DIVISION','DIVISION_NM')
--     ORDER BY domain_code, column_name;
--
-- 4) 기존 데이터 NULL 여부 (기존 row 는 모두 NULL 이어야 정상)
--    SELECT COUNT(*)              AS total_rows,
--           SUM(DIVISION IS NULL) AS null_division,
--           SUM(DIVISION_NM IS NULL) AS null_division_nm
--      FROM sys_aimd_cot015;
--
-- 5) 전체 스키마 확인
--    SHOW CREATE TABLE sys_aimd_cot015\G
-- ============================================================


-- ============================================================
-- 후속 조치 (본 스크립트 실행 후 반드시 수행)
-- ------------------------------------------------------------
-- (1) RAG 인덱스 재빌드 (필수)
--     · 관리자 세션으로 학습관리 화면 접속 → [RAG 인덱스 재빌드] 버튼
--     · 또는 API 호출: POST /api/rag/build
--     → rag_embeddings 에 DIVISION / DIVISION_NM 청크가 등록되어야
--        LLM 이 사업부 필터를 인식/생성 가능.
--
-- (2) 서버 재기동 (선택)
--     · pm2 restart <nlq-server>
--     · 온톨로지 캐시가 있는 환경이면 캐시 갱신 목적.
--
-- (3) SAP BW 어댑터 확인 (실제 값 채우기)
--     · Spring Boot SapRfcSyncService 의 NLP_RFC_002 (Z_BI_WEB_EX_BL_4)
--       매핑에 DIVISION / DIVISION_NM 이 추가되어 있는지 확인.
--     · 추가되어 있지 않으면 컬럼은 있어도 값이 계속 NULL 로만 채워짐.
--     · 추가 후 다음 RFC 재적재 스케줄부터 값이 채워짐.
--
-- (4) 스모크 테스트 (권장)
--     · 자연어질의: "PS 사업부의 인건비 합계 알려줘"
--       → SQL 이 WHERE DIVISION = 'PS' (또는 실제 코드값) 로 생성되는지 확인.
--     · 자연어질의: "HL 사업부의 원가 상위 5개 알려줘"
--       → 마찬가지로 DIVISION 필터가 나오는지 확인.
-- ============================================================
