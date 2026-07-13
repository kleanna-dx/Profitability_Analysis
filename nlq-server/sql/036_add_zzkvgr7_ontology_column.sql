-- =====================================================================
-- 036_add_zzkvgr7_ontology_column.sql
-- ---------------------------------------------------------------------
-- 목적: bw_profitability_data 테이블에 신규 추가된 ZZKVGR7 / ZZKVGR7_NM
--       컬럼을 학습관리(Ontology) 사전에 등록.
--
-- 배경:
--   1) DB 스키마: ALTER TABLE bw_profitability_data ADD COLUMN ZZKVGR7 …,
--      ZZKVGR7_NM … 로 두 컬럼이 이미 물리적으로 추가됨.
--   2) SAP RFC(Z_BI_WEB_EX_BL) → DB INSERT 매핑 (SapRfcSyncService.DB_COLUMNS)
--      에도 두 컬럼이 추가됨 (PR #227).
--   3) 그러나 학습관리 화면 Ontology 탭은 ontology_column 테이블을 소스로
--      쓰기 때문에, 이 테이블에도 두 컬럼을 등록해야 화면에 노출됨.
--
-- 대상 도메인:
--   HL/MGMT 도메인의 ontology_column 은 migration_domain.sql 에서
--   PS 도메인의 컬럼 리스트를 INSERT-SELECT 로 복사하는 방식을 사용하므로,
--   세 도메인(PS/HL/MGMT) 모두 동일한 컬럼을 갖도록 등록.
--
-- 정책:
--   - INSERT IGNORE 로 멱등성 보장 (UNIQUE KEY: domain_code+column_name+table_name)
--   - 재실행해도 오류 없이 통과
--
-- 작성일: 2026-07-13
-- =====================================================================

-- 1) PS 도메인
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES
  ('PS', 'ZZKVGR7',    'bw_profitability_data', '고객 그룹 7',   'varchar(5)'),
  ('PS', 'ZZKVGR7_NM', 'bw_profitability_data', '고객그룹7 명',  'varchar(100)');

-- 2) HL 도메인
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES
  ('HL', 'ZZKVGR7',    'bw_profitability_data', '고객 그룹 7',   'varchar(5)'),
  ('HL', 'ZZKVGR7_NM', 'bw_profitability_data', '고객그룹7 명',  'varchar(100)');

-- 3) MGMT 도메인
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES
  ('MGMT', 'ZZKVGR7',    'bw_profitability_data', '고객 그룹 7',   'varchar(5)'),
  ('MGMT', 'ZZKVGR7_NM', 'bw_profitability_data', '고객그룹7 명',  'varchar(100)');

-- 4) 검증용 SELECT
SELECT
  domain_code,
  column_name,
  description,
  data_type,
  is_active
FROM ontology_column
WHERE column_name IN ('ZZKVGR7', 'ZZKVGR7_NM')
ORDER BY domain_code, column_name;
