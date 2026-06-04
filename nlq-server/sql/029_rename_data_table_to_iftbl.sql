-- ============================================================
-- Migration: 029_rename_data_table_to_iftbl.sql
-- Date    : 2026-06-04
-- Author  : AI Developer
-- ============================================================
--
-- ▶ 목적
--   028 에서 추가한 batch_master 매핑 컬럼을 다음과 같이 정리한다:
--     1) data_table        → IFTBL  (코멘트: '인터페이스 테이블')
--     2) data_month_column → 삭제  (월 컬럼명은 SAP BW 표준 'CALMONTH' 고정)
--
-- ▶ 멱등성 보장 방법
--   MariaDB 의 ALTER TABLE ... CHANGE/DROP COLUMN 자체에는 IF EXISTS 가 있으나,
--   "이미 IFTBL 로 변경된 뒤 재실행" 같은 케이스를 안전하게 처리하기 위해
--   INFORMATION_SCHEMA 를 먼저 조회해 컬럼 존재 여부로 분기한다.
-- ============================================================

-- ── 1. data_table → IFTBL 로 컬럼명 변경 (코멘트 '인터페이스 테이블') ──
SET @has_data_table = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_master'
     AND COLUMN_NAME  = 'data_table'
);
SET @has_iftbl = (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_master'
     AND COLUMN_NAME  = 'IFTBL'
);

-- 1-a) data_table 만 존재 → CHANGE 로 이름/코멘트 변경
SET @sql := IF(@has_data_table = 1 AND @has_iftbl = 0,
  "ALTER TABLE batch_master CHANGE COLUMN data_table IFTBL VARCHAR(100) NULL COMMENT '인터페이스 테이블'",
  "SELECT 'skip: rename data_table -> IFTBL' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1-b) data_table 도 없고 IFTBL 도 없는 신규 환경 → IFTBL 직접 추가
SET @sql := IF(@has_data_table = 0 AND @has_iftbl = 0,
  "ALTER TABLE batch_master ADD COLUMN IFTBL VARCHAR(100) NULL COMMENT '인터페이스 테이블' AFTER rfc_param",
  "SELECT 'skip: add IFTBL' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1-c) IFTBL 이 이미 있더라도 코멘트가 다를 수 있으니 항상 보정 (멱등)
ALTER TABLE batch_master
  MODIFY COLUMN IFTBL VARCHAR(100) NULL COMMENT '인터페이스 테이블';

-- ── 2. data_month_column 컬럼 삭제 (필요 시) ──
ALTER TABLE batch_master
  DROP COLUMN IF EXISTS data_month_column;

-- ── 3. NLP_RFC_001 (수익성데이터) 시드 보정 ──
--     028 에서 data_table='bw_profitability_data' 로 저장된 값이 CHANGE 후
--     IFTBL 컬럼에 그대로 보존되지만, 신규 환경에서는 비어 있을 수 있으므로
--     안전하게 한 번 더 UPDATE.
UPDATE batch_master
   SET IFTBL = 'bw_profitability_data'
 WHERE interface_id = 'NLP_RFC_001'
   AND (IFTBL IS NULL OR IFTBL = '');

-- ── 4. 확인 ──
SELECT interface_id, interface_name, IFTBL
  FROM batch_master
 ORDER BY interface_id;
