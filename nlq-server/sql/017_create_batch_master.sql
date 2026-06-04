-- =====================================================================
-- 017_create_batch_master.sql
-- 인터페이스 마스터 테이블 (SAP ↔ S&OP 연동 정의)
-- =====================================================================

CREATE TABLE IF NOT EXISTS batch_master (
  interface_id     VARCHAR(50)  NOT NULL                COMMENT '인터페이스 ID (PK)',
  interface_name   VARCHAR(200) NOT NULL                COMMENT '인터페이스 명',
  sender           VARCHAR(50)  NOT NULL DEFAULT 'SAP'  COMMENT '송신 시스템',
  receiver         VARCHAR(50)  NOT NULL DEFAULT 'S&OP' COMMENT '수신 시스템',
  rfc_func_or_url  VARCHAR(500) DEFAULT NULL            COMMENT 'RFC Function 명 또는 REST URL',
  rfc_param        TEXT         DEFAULT NULL            COMMENT 'RFC/REST 호출 파라미터',
  exec_command     VARCHAR(500) DEFAULT NULL            COMMENT '실행 명령어',
  remark           TEXT         DEFAULT NULL            COMMENT '비고',
  is_active        TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '활성 여부',
  created_by       VARCHAR(50)  DEFAULT NULL            COMMENT '등록자',
  updated_by       VARCHAR(50)  DEFAULT NULL            COMMENT '수정자',
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (interface_id),
  KEY idx_batch_master_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='인터페이스 마스터 (SAP ↔ S&OP 연동 정의)';

-- =====================================================================
-- 시드 데이터 (스크린샷 기반 6건)
-- =====================================================================
INSERT INTO batch_master
  (interface_id, interface_name, sender, receiver, rfc_func_or_url, rfc_param, exec_command, is_active, created_by)
VALUES
  ('SNOP_RFC_001', '자재마스터',       'SAP', 'S&OP', '/sales-api/sap/rfc/001', 'B',  'POST /sales-api/sap/rfc/001', 1, 'admin'),
  ('SNOP_RFC_002', '일자별재고',       'SAP', 'S&OP', '/sales-api/sap/rfc/002', NULL, 'POST /sales-api/sap/rfc/002', 1, 'admin'),
  ('SNOP_RFC_003', '생산실적',         'SAP', 'S&OP', '/sales-api/sap/rfc/003', NULL, 'POST /sales-api/sap/rfc/003', 1, 'admin'),
  ('SNOP_RFC_004', '판매실적',         'SAP', 'S&OP', '/sales-api/sap/rfc/004', NULL, 'POST /sales-api/sap/rfc/004', 1, 'admin'),
  ('SNOP_RFC_005', '월말마감실적',     'SAP', 'S&OP', '/sales-api/sap/rfc/005', NULL, 'POST /sales-api/sap/rfc/005', 1, 'admin'),
  ('SNOP_RFC_006', '리뉴얼자재연결',   'SAP', 'S&OP', '/sales-api/sap/rfc/006', 'A',  'POST /sales-api/sap/rfc/006', 0, 'admin')
ON DUPLICATE KEY UPDATE
  interface_name = VALUES(interface_name),
  rfc_func_or_url = VALUES(rfc_func_or_url),
  rfc_param = VALUES(rfc_param),
  exec_command = VALUES(exec_command),
  is_active = VALUES(is_active),
  updated_by = 'admin';
