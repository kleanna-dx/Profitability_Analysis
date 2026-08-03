-- =========================================================
-- 022_populate_batch_master_rfc.sql
-- 목적:
--   1. batch_master에 RFC 실행 모드 관련 컬럼 추가
--      - default_mode  : 기본 실행 모드 (replace/append/dry-run)
--      - allowed_modes : 허용 모드 CSV (예: 'replace,append,dry-run')
--   2. [배치관리] 화면처럼 실제 RFC 호출이 가능하도록 batch_master 데이터 정비
--      (rfc_func_or_url, rfc_param 채워 넣음 + 기본/허용 모드 설정)
--
-- 컨벤션:
--   - rfc_func_or_url : Spring Boot Endpoint (POST /profit-api/sap-rfc/execute)
--   - rfc_param       : JSON 형식의 RFC 호출 파라미터 템플릿 ({CMONTH}는 실행시 치환)
--   - exec_command    : Node.js에서 호출 시 사용할 명령 식별자 (SAP_RFC_SYNC)
-- =========================================================

-- (1) default_mode 컬럼 추가 (멱등)
SET @stmt := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_master' AND COLUMN_NAME = 'default_mode') = 0,
  "ALTER TABLE batch_master ADD COLUMN default_mode VARCHAR(20) NOT NULL DEFAULT 'replace' COMMENT '기본 실행 모드: replace/append/dry-run' AFTER rfc_param",
  "SELECT 'default_mode already exists' AS info"
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- (2) allowed_modes 컬럼 추가 (멱등)
SET @stmt := IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_master' AND COLUMN_NAME = 'allowed_modes') = 0,
  "ALTER TABLE batch_master ADD COLUMN allowed_modes VARCHAR(100) NOT NULL DEFAULT 'replace,append,dry-run' COMMENT '허용 모드 CSV' AFTER default_mode",
  "SELECT 'allowed_modes already exists' AS info"
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- (3) 기존 시드 행이 NLP_RFC_* 로 들어가 있어서 — SNOP_RFC_* 컨벤션 + 실제 RFC 호출용 데이터로 정비
--     (기존 NLP_RFC_001, NLP_RFC_002 행이 있으면 그대로 두되, 실 운영용 시드만 UPSERT)
INSERT INTO batch_master
  (interface_id,     interface_name,    sender, receiver,    rfc_name,           rfc_func_or_url,                                rfc_param,                                                          default_mode, allowed_modes,                exec_command,      remark,                                  is_active, created_by)
VALUES
  ('SNOP_RFC_001',   '수익성분석',        'SAP', 'analytics', 'Z_BI_WEB_EX_BL',  'POST /profit-api/sap-rfc/execute',             '{"function":"Z_BI_WEB_EX_BL","params":{"I_CMONTH":"{CMONTH}"}}',  'replace',    'replace,append,dry-run',     'SAP_RFC_SYNC',    'SAP BW 수익성분석 데이터 동기화',           1, 'admin'),
  ('SNOP_RFC_002',   '제조원가 RFC',     'SAP', 'analytics', 'Z_BI_WEB_EX_BL_4','POST /profit-api/sap-rfc/execute',             '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}','replace',    'replace,append,dry-run',     'SAP_RFC_SYNC',    '제조원가 RFC (Z_BI_WEB_EX_BL_4) — 월마감 후 실행',   1, 'admin'),
  ('SNOP_RFC_003',   '생산실적',          'SAP', 'analytics', 'Z_BI_PROD',       'POST /profit-api/sap-rfc/execute',             '{"function":"Z_BI_PROD","params":{"I_CMONTH":"{CMONTH}"}}',       'replace',    'replace,append,dry-run',     'SAP_RFC_SYNC',    '월별 생산실적 데이터 동기화',                 1, 'admin'),
  ('SNOP_RFC_004',   '판매실적',          'SAP', 'analytics', 'Z_BI_SALES',      'POST /profit-api/sap-rfc/execute',             '{"function":"Z_BI_SALES","params":{"I_CMONTH":"{CMONTH}"}}',      'replace',    'replace,append,dry-run',     'SAP_RFC_SYNC',    '월별 판매실적 데이터 동기화',                 1, 'admin'),
  ('SNOP_RFC_005',   '월말마감실적',      'SAP', 'analytics', 'Z_BI_MONTH_CLOSE','POST /profit-api/sap-rfc/execute',             '{"function":"Z_BI_MONTH_CLOSE","params":{"I_CMONTH":"{CMONTH}"}}','replace',    'replace,append,dry-run',     'SAP_RFC_SYNC',    '월말마감 후 재계산 (말일 23시 실행)',         1, 'admin'),
  ('SNOP_RFC_006',   '자재마스터',        'SAP', 'analytics', 'Z_BI_MAT_LINK',   'POST /profit-api/sap-rfc/execute',             '{"function":"Z_BI_MAT_LINK","params":{"I_CMONTH":"{CMONTH}"}}',   'replace',    'replace,append,dry-run',     'SAP_RFC_SYNC',    '자재마스터 신규/변경분 연결',                 1, 'admin')
ON DUPLICATE KEY UPDATE
  interface_name  = VALUES(interface_name),
  sender          = VALUES(sender),
  receiver        = VALUES(receiver),
  rfc_name        = VALUES(rfc_name),
  rfc_func_or_url = VALUES(rfc_func_or_url),
  rfc_param       = VALUES(rfc_param),
  default_mode    = VALUES(default_mode),
  allowed_modes   = VALUES(allowed_modes),
  exec_command    = VALUES(exec_command),
  remark          = VALUES(remark),
  is_active       = VALUES(is_active),
  updated_by      = 'admin';

-- (4) 기존 NLP_RFC_* 시드(예전 시드)에도 RFC 호출 데이터 채워넣어 일관성 유지
--     (NLP_RFC_001 = 수익성, NLP_RFC_002 = 제조원가로 매핑)
UPDATE batch_master
   SET rfc_name        = 'Z_BI_WEB_EX_BL',
       rfc_func_or_url = 'POST /profit-api/sap-rfc/execute',
       rfc_param       = '{"function":"Z_BI_WEB_EX_BL","params":{"I_CMONTH":"{CMONTH}"}}',
       default_mode    = 'replace',
       allowed_modes   = 'replace,append,dry-run',
       exec_command    = 'SAP_RFC_SYNC',
       remark          = COALESCE(remark, 'SAP BW 수익성분석 데이터 동기화'),
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_001';

UPDATE batch_master
   SET rfc_name        = 'Z_BI_WEB_EX_BL_4',
       rfc_func_or_url = 'POST /profit-api/sap-rfc/execute',
       rfc_param       = '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}',
       default_mode    = 'replace',
       allowed_modes   = 'replace,append,dry-run',
       exec_command    = 'SAP_RFC_SYNC',
       remark          = COALESCE(remark, '제조원가 RFC (Z_BI_WEB_EX_BL_4) — 월마감 후 실행'),
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_002';
