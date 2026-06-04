-- =====================================================================
-- 020_add_rfc_name.sql
--   batch_master 에 SAP RFC 함수명 전용 컬럼 rfc_name 추가
--   기존 rfc_func_or_url 은 REST URL 용도로 유지
-- =====================================================================

-- 1) rfc_name 컬럼 추가 (없을 때만)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'batch_master'
     AND COLUMN_NAME = 'rfc_name'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE batch_master ADD COLUMN rfc_name VARCHAR(100) NULL COMMENT ''SAP RFC 함수명'' AFTER receiver, ADD KEY idx_batch_master_rfc_name (rfc_name)',
  'SELECT ''column rfc_name already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) 시드 데이터에 RFC 함수명 채우기 (사용자 예시 + 추정)
UPDATE batch_master SET rfc_name = 'Z_BI_WEB_EX_BL' WHERE interface_id = 'SNOP_RFC_001';
UPDATE batch_master SET rfc_name = 'Z_BI_STOCK_D'  WHERE interface_id = 'SNOP_RFC_002';
UPDATE batch_master SET rfc_name = 'Z_BI_PROD'    WHERE interface_id = 'SNOP_RFC_003';
UPDATE batch_master SET rfc_name = 'Z_BI_SALES'   WHERE interface_id = 'SNOP_RFC_004';
UPDATE batch_master SET rfc_name = 'Z_BI_MONTH_CLOSE' WHERE interface_id = 'SNOP_RFC_005';
UPDATE batch_master SET rfc_name = 'Z_BI_MAT_LINK' WHERE interface_id = 'SNOP_RFC_006';
