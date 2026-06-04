-- =====================================================================
-- 026_full_migration_pr67_to_pr79.sql
--
-- 🎯 목적: PR #67 ~ PR #79 동안 발생한 모든 DB **스키마** 변경사항을
--         하나로 통합한 "운영 환경 일괄 적용용" 마이그레이션 스크립트.
--
-- 📌 이 파일 하나만 운영 DB(company_board) 에 실행하면, 개발 환경과
--    완전히 동일한 **스키마** 상태가 됩니다.
--
-- ⚠️ 중요: 이 스크립트는 **데이터(시드)를 절대 넣지 않습니다.**
--    - batch_master / batch_schedule 의 행(row)은 사용자가 화면에서
--      직접 등록한 것만 유지됩니다.
--    - 이전 버전(시드 포함) 실행 후 원치 않는 SNOP_RFC_* 행이 생겼다면
--      섹션 9 의 "선택적 정리 쿼리"를 참고하여 운영자가 직접 삭제하세요.
--
-- ▶ 실행 방법:
--     mysql -u company -p company_board < 026_full_migration_pr67_to_pr79.sql
--   또는
--     mysql -u company -p company_board
--     mysql> SOURCE /path/to/026_full_migration_pr67_to_pr79.sql;
--
-- ▶ 멱등성 (Idempotent):
--     - 모든 ALTER 는 information_schema 검사 후 PREPARE/EXECUTE 로 실행.
--     - 모든 CREATE TABLE 은 IF NOT EXISTS.
--     - 이미 적용된 변경은 자동 SKIP 되며, 몇 번 재실행해도 안전합니다.
--
-- ▶ 포함된 스키마 변경 (PR 별):
--     PR #67/#68 : batch_master 테이블 생성 (인터페이스 마스터)
--     PR #69     : batch_schedule 테이블 생성 (스케줄)
--     PR #69     : batch_jobs.interface_id 컬럼 추가 + [인터페이스 관리] 메뉴
--     PR #70     : batch_master.rfc_name 컬럼 추가 (SAP RFC 함수명)
--     PR #71     : batch_schedule.remark 자동 기본값 정리 (UPDATE)
--     PR #72     : batch_master.default_mode / allowed_modes 컬럼 추가
--     PR #73     : schedule_type ENUM 에 'manual' 추가
--     PR #75     : batch_schedule.exec_time NULL 허용
--     PR #77     : 1회 예약(once) 모드 추가
--                  - schedule_type ENUM 에 'once' 추가
--                  - exec_datetime / target_cmonth / exec_mode 컬럼 추가
--                  - UNIQUE(interface_id) 제거 → 일반 INDEX
--                    (FK 보호 위해 INDEX 먼저 추가 후 UNIQUE drop — MariaDB 1553 회피)
--                  - 복합 인덱스 idx_batch_schedule_once_due 추가
--     PR #74/#76/#78/#79 : UI 한글화/버튼/토글 (DB 변경 없음)
--
-- ▶ 실행 후 검증:
--     섹션 8) 검증 SELECT 가 자동 출력합니다.
-- =====================================================================

SET NAMES utf8mb4;

-- =====================================================================
-- 1) batch_master 테이블 생성 (PR #67/#68)  — 데이터 없음
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
-- 2) batch_master 컬럼 확장 (멱등)
--    PR #70: rfc_name
--    PR #72: default_mode, allowed_modes
-- =====================================================================

-- 2-1) PR #70 — rfc_name 컬럼 추가
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_master'
     AND COLUMN_NAME  = 'rfc_name'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE batch_master
     ADD COLUMN rfc_name VARCHAR(100) NULL COMMENT 'SAP RFC 함수명' AFTER receiver,
     ADD KEY idx_batch_master_rfc_name (rfc_name)",
  "SELECT 'rfc_name already exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2-2) PR #72 — default_mode 컬럼 추가
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_master'
     AND COLUMN_NAME  = 'default_mode'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE batch_master
     ADD COLUMN default_mode VARCHAR(20) NOT NULL DEFAULT 'replace'
                 COMMENT '기본 실행 모드: replace/append/dry-run' AFTER rfc_param",
  "SELECT 'default_mode already exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2-3) PR #72 — allowed_modes 컬럼 추가
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_master'
     AND COLUMN_NAME  = 'allowed_modes'
);
SET @sql := IF(@col_exists = 0,
  "ALTER TABLE batch_master
     ADD COLUMN allowed_modes VARCHAR(100) NOT NULL DEFAULT 'replace,append,dry-run'
                 COMMENT '허용 모드 CSV' AFTER default_mode",
  "SELECT 'allowed_modes already exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- 3) batch_master 기본 인터페이스 시드 (NLP_RFC_001 / NLP_RFC_002)
--    ⚠️ 운영 DB 가 비어 있을 때만 동작 (NOT EXISTS 가드 — 멱등).
--    이미 같은 interface_id 가 있으면 건드리지 않음 (UPDATE 안 함).
--    SNOP_RFC_* 시드는 더 이상 넣지 않습니다.
-- =====================================================================

-- 3-1) NLP_RFC_001 — 수익성데이터 (Z_BI_WEB_EX_BL)
INSERT INTO batch_master
  (interface_id,  interface_name, sender, receiver,    rfc_name,         rfc_func_or_url,                    rfc_param,                                                        default_mode, allowed_modes,            exec_command,   remark,                              is_active, created_by)
SELECT
  'NLP_RFC_001', '수익성데이터', 'SAP', 'analytics', 'Z_BI_WEB_EX_BL', 'POST /profit-api/sap-rfc/execute', '{"function":"Z_BI_WEB_EX_BL","params":{"I_CMONTH":"{CMONTH}"}}', 'replace',    'replace,append,dry-run', 'SAP_RFC_SYNC', 'SAP BW 수익성분석 데이터 동기화',     1,          'admin'
 WHERE NOT EXISTS (SELECT 1 FROM batch_master WHERE interface_id = 'NLP_RFC_001');

-- 3-2) NLP_RFC_002 — 제조원가 (Z_BI_PRE_COST)
INSERT INTO batch_master
  (interface_id,  interface_name, sender, receiver,    rfc_name,        rfc_func_or_url,                    rfc_param,                                                       default_mode, allowed_modes,            exec_command,   remark,                                  is_active, created_by)
SELECT
  'NLP_RFC_002', '제조원가',     'SAP', 'analytics', 'Z_BI_PRE_COST', 'POST /profit-api/sap-rfc/execute', '{"function":"Z_BI_PRE_COST","params":{"I_CMONTH":"{CMONTH}"}}', 'replace',    'replace,append,dry-run', 'SAP_RFC_SYNC', '제조원가 인터페이스 (월마감 후 실행)',   1,          'admin'
 WHERE NOT EXISTS (SELECT 1 FROM batch_master WHERE interface_id = 'NLP_RFC_002');

-- =====================================================================
-- 4) batch_schedule 테이블 생성 (PR #69)
--    ⚠️ 최신 스키마(PR #79 시점)로 한방에 만듭니다.
--       데이터(시드)는 넣지 않습니다.
-- =====================================================================
CREATE TABLE IF NOT EXISTS batch_schedule (
  id                  INT(11)      NOT NULL AUTO_INCREMENT,
  interface_id        VARCHAR(50)  NOT NULL                  COMMENT '인터페이스 ID (FK → batch_master)',
  schedule_type       ENUM('daily','monthly','manual','once') NOT NULL DEFAULT 'daily'
                                                              COMMENT '수행 주기 (daily=매일, monthly=매월, manual=수동전용, once=1회예약)',
  exec_time           TIME         DEFAULT NULL              COMMENT '수행 시간 (manual/once 인 경우 NULL)',
  exec_datetime       DATETIME     DEFAULT NULL              COMMENT '1회 예약 실행 일시 (schedule_type=once)',
  exec_day_of_month   TINYINT(2)   DEFAULT NULL              COMMENT '월간일 경우 실행일(1~31)',
  target_cmonth       VARCHAR(6)   DEFAULT NULL              COMMENT '대상년월 YYYYMM (once / manual 기본값)',
  exec_mode           VARCHAR(20)  DEFAULT NULL              COMMENT '실행 모드 replace/append/dry-run (once / manual 기본값)',
  is_active           TINYINT(1)   NOT NULL DEFAULT 1        COMMENT '활성 여부',
  last_run_at         DATETIME     DEFAULT NULL              COMMENT '마지막 수행 시각',
  last_run_status     ENUM('success','failed','running','pending') DEFAULT NULL COMMENT '마지막 수행 상태',
  next_run_at         DATETIME     DEFAULT NULL              COMMENT '다음 수행 예정',
  remark              VARCHAR(500) DEFAULT NULL              COMMENT '비고',
  created_by          VARCHAR(50)  DEFAULT NULL              COMMENT '등록자',
  updated_by          VARCHAR(50)  DEFAULT NULL              COMMENT '수정자',
  created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_batch_schedule_interface (interface_id),
  KEY idx_batch_schedule_active (is_active),
  KEY idx_batch_schedule_once_due (schedule_type, is_active, exec_datetime),
  CONSTRAINT fk_batch_schedule_interface
    FOREIGN KEY (interface_id) REFERENCES batch_master(interface_id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci
  COMMENT='인터페이스 수행(스케줄) 관리';

-- =====================================================================
-- 5) batch_schedule 스키마 마이그레이션 (이미 테이블이 있던 환경용 — 멱등)
--    PR #73: ENUM 에 'manual' 추가
--    PR #75: exec_time NULL 허용
--    PR #77: ENUM 에 'once' 추가, exec_datetime / target_cmonth / exec_mode 추가,
--            UNIQUE→INDEX 교체, 복합 인덱스 추가
-- =====================================================================

-- 5-1) schedule_type ENUM 확장 (manual + once 모두 포함하도록 보장)
SET @cur_enum := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'schedule_type'
);
SET @needs := IF(@cur_enum NOT LIKE '%manual%' OR @cur_enum NOT LIKE '%once%', 1, 0);
SET @sql := IF(@needs = 1,
  "ALTER TABLE batch_schedule
     MODIFY COLUMN schedule_type ENUM('daily','monthly','manual','once')
                   NOT NULL DEFAULT 'daily'
                   COMMENT '수행 주기 (daily=매일, monthly=매월, manual=수동전용, once=1회예약)'",
  "SELECT 'schedule_type ENUM already has manual+once' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5-2) exec_time NULL 허용 (PR #75)
SET @needs_change := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'exec_time'
     AND IS_NULLABLE  = 'NO'
);
SET @sql := IF(@needs_change > 0,
  "ALTER TABLE batch_schedule
     MODIFY COLUMN exec_time TIME NULL DEFAULT NULL COMMENT '수행 시간 (manual/once 인 경우 NULL)'",
  "SELECT 'exec_time already nullable' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5-3) exec_datetime 컬럼 추가 (PR #77)
SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'exec_datetime'
);
SET @sql := IF(@has = 0,
  "ALTER TABLE batch_schedule
     ADD COLUMN exec_datetime DATETIME DEFAULT NULL
                COMMENT '1회 예약 실행 일시 (schedule_type=once 인 경우)'
                AFTER exec_time",
  "SELECT 'exec_datetime exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5-4) target_cmonth 컬럼 추가 (PR #77)
SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'target_cmonth'
);
SET @sql := IF(@has = 0,
  "ALTER TABLE batch_schedule
     ADD COLUMN target_cmonth VARCHAR(6) DEFAULT NULL
                COMMENT '대상년월 YYYYMM (once 모드 / manual 기본값)'
                AFTER exec_day_of_month",
  "SELECT 'target_cmonth exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5-5) exec_mode 컬럼 추가 (PR #77)
SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'exec_mode'
);
SET @sql := IF(@has = 0,
  "ALTER TABLE batch_schedule
     ADD COLUMN exec_mode VARCHAR(20) DEFAULT NULL
                COMMENT '실행 모드 (replace/append/dry-run) — once / manual 기본값'
                AFTER target_cmonth",
  "SELECT 'exec_mode exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5-6) UNIQUE(interface_id) → INDEX 교체 (PR #77)
--      ⚠️ FK fk_batch_schedule_interface 가 uq_batch_schedule_interface 를
--         참조 중이므로, 일반 INDEX 를 먼저 추가하여 FK 가 그쪽으로 빠지게
--         한 뒤에야 UNIQUE 를 drop 할 수 있음 (MariaDB 1553 회피).
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND INDEX_NAME   = 'idx_batch_schedule_interface'
);
SET @sql := IF(@has_idx = 0,
  "ALTER TABLE batch_schedule ADD INDEX idx_batch_schedule_interface (interface_id)",
  "SELECT 'idx_batch_schedule_interface exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 이제 FK 가 idx_batch_schedule_interface 를 쓸 수 있으므로 UNIQUE drop 가능
SET @has_uq := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND INDEX_NAME   = 'uq_batch_schedule_interface'
);
SET @sql := IF(@has_uq > 0,
  "ALTER TABLE batch_schedule DROP INDEX uq_batch_schedule_interface",
  "SELECT 'uq_batch_schedule_interface already removed' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5-7) once 자동실행 검색용 복합 인덱스 (PR #77)
SET @has_idx2 := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND INDEX_NAME   = 'idx_batch_schedule_once_due'
);
SET @sql := IF(@has_idx2 = 0,
  "ALTER TABLE batch_schedule
     ADD INDEX idx_batch_schedule_once_due (schedule_type, is_active, exec_datetime)",
  "SELECT 'idx_batch_schedule_once_due exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- 6) (SKIP) batch_schedule 시드 데이터
--    ⚠️ 이 스크립트는 시드 행(SNOP_RFC_001 등)을 더 이상 넣지 않습니다.
--    화면에서 직접 등록한 스케줄만 유지됩니다.
-- =====================================================================

-- 6-b) PR #71 — 자동 생성된 기본 remark 정리
--      ⚠️ 사용자가 직접 입력한 비고는 건드리지 않고, 예전 버전이 자동으로
--         넣었던 '매일 06:00' / '매월 N일' 형태만 NULL 로 정리합니다.
UPDATE batch_schedule
   SET remark = NULL
 WHERE remark IN ('매일 06:00', '매일 06:00:00')
    OR remark REGEXP '^매월 [0-9]+일?( [0-9:]+)?$';

-- =====================================================================
-- 7) batch_jobs.interface_id 컬럼 추가 + [인터페이스 관리] 메뉴 등록 (PR #69)
--    ⚠️ batch_jobs / menus / role_menus 테이블이 존재하는 경우에만 수행.
-- =====================================================================

-- 7-1) batch_jobs.interface_id 컬럼 추가 (batch_jobs 가 있고 컬럼이 없을 때만)
SET @tbl_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_jobs'
);
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_jobs'
     AND COLUMN_NAME  = 'interface_id'
);
SET @sql := IF(@tbl_exists = 1 AND @col_exists = 0,
  "ALTER TABLE batch_jobs
     ADD COLUMN interface_id VARCHAR(50) NULL COMMENT '인터페이스 ID (batch_master)' AFTER job_type,
     ADD KEY idx_batch_jobs_interface (interface_id)",
  "SELECT 'batch_jobs.interface_id skipped (table missing or column already exists)' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7-2) [인터페이스 관리] 메뉴 등록 (menus 테이블이 있는 경우)
--      ⚠️ 메뉴는 화면 진입을 위해 반드시 필요하므로 등록은 유지합니다.
SET @menus_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'menus'
);
SET @sql := IF(@menus_exists = 1,
  "INSERT INTO menus (menu_code, menu_name, menu_url, icon_class, sort_order, is_active)
   VALUES ('interface', '인터페이스 관리', '/interface.html', 'fas fa-exchange-alt', 7, 1)
   ON DUPLICATE KEY UPDATE
     menu_name = VALUES(menu_name),
     menu_url = VALUES(menu_url),
     icon_class = VALUES(icon_class),
     sort_order = VALUES(sort_order),
     is_active = VALUES(is_active)",
  "SELECT 'menus table not present — menu seed skipped' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7-3) role_menus: admin(role_id=1) 매핑 (menus + role_menus 가 있는 경우)
SET @role_menus_exists := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'role_menus'
);
SET @sql := IF(@menus_exists = 1 AND @role_menus_exists = 1,
  "INSERT INTO role_menus (role_id, menu_id)
   SELECT 1, m.id
     FROM menus m
    WHERE m.menu_code = 'interface'
      AND NOT EXISTS (
        SELECT 1 FROM role_menus rm WHERE rm.role_id = 1 AND rm.menu_id = m.id
      )",
  "SELECT 'role_menus mapping skipped (table missing)' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- =====================================================================
-- 8) 검증 출력
-- =====================================================================
SELECT '=== batch_master 컬럼 ===' AS section;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'batch_master'
 ORDER BY ORDINAL_POSITION;

SELECT '=== batch_schedule 컬럼 ===' AS section;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'batch_schedule'
 ORDER BY ORDINAL_POSITION;

SELECT '=== batch_schedule 인덱스 ===' AS section;
SELECT INDEX_NAME, NON_UNIQUE,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'batch_schedule'
 GROUP BY INDEX_NAME, NON_UNIQUE
 ORDER BY INDEX_NAME;

SELECT '=== batch_master 행 수 (참고용) ===' AS section;
SELECT COUNT(*) AS row_count FROM batch_master;

SELECT '=== batch_schedule 행 수 (참고용) ===' AS section;
SELECT COUNT(*) AS row_count FROM batch_schedule;

-- =====================================================================
-- 9) (선택) 이전 버전 시드로 들어간 SNOP_RFC_* 정리 쿼리
--    ⚠️ 자동 실행되지 않습니다. 필요시 운영자가 주석 해제 후 실행하세요.
--    이전 버전(시드 포함)을 실행한 환경에서 SNOP_RFC_001 ~ SNOP_RFC_006 이
--    남아 있다면 아래 두 줄로 일괄 삭제 가능합니다. FK 가 ON DELETE CASCADE
--    이므로 batch_schedule 의 관련 행도 함께 사라집니다.
-- =====================================================================
-- DELETE FROM batch_schedule WHERE interface_id LIKE 'SNOP_RFC_%';
-- DELETE FROM batch_master   WHERE interface_id LIKE 'SNOP_RFC_%';

-- =====================================================================
-- ✅ 모두 완료.
--
-- 기대값:
--   - batch_master  : 컬럼에 rfc_name, default_mode, allowed_modes 가 있어야 함
--   - batch_schedule:
--       * schedule_type → ENUM('daily','monthly','manual','once')
--       * exec_time      → YES (NULL 허용)
--       * exec_datetime  → 존재
--       * target_cmonth  → 존재
--       * exec_mode      → 존재
--   - 인덱스:
--       * PRIMARY
--       * idx_batch_schedule_interface         (NON_UNIQUE=1)
--       * idx_batch_schedule_active            (NON_UNIQUE=1)
--       * idx_batch_schedule_once_due          (NON_UNIQUE=1)
--       * fk_batch_schedule_interface          (FK)
--       * uq_batch_schedule_interface          → ❌ 더 이상 존재하면 안 됨
-- =====================================================================
