-- ============================================================
-- 운영 배포 스크립트: PR #67 ~ PR #79 통합 마이그레이션
-- 제목: 인터페이스 관리 (batch_master / batch_schedule) 전체 변경 통합
-- 대상 DB: MariaDB 11.x (company_board)
-- ============================================================
--
-- ★ 이 파일 하나만 운영 DB 에 실행하면, 개발 환경과 동일한 스키마가 됩니다.
-- ★ 모든 ALTER 는 MariaDB 네이티브 IF [NOT] EXISTS 절을 사용 → 멱등.
-- ★ 모든 INSERT 는 NOT EXISTS 가드 → 중복 실행해도 안전.
-- ★ 시드는 NLP_RFC_001 / NLP_RFC_002 (기본 인터페이스 2건) 만 포함.
--   - SNOP_RFC_* 는 절대 들어가지 않습니다.
--   - 이미 같은 interface_id 가 있으면 절대 덮어쓰지 않습니다.
--
-- ▶ 실행 방법:
--     mysql -u company -p company_board < 026_full_migration_pr67_to_pr79.sql
--   또는 Adminer / DBeaver / HeidiSQL 에서 통째로 붙여넣고 실행.
--
-- ▶ 포함된 변경 (PR 별):
--     PR #67/#68 : batch_master 테이블 생성
--     PR #69     : batch_schedule 테이블 + batch_jobs.interface_id + 메뉴
--     PR #70     : batch_master.rfc_name 컬럼 추가
--     PR #71     : batch_schedule.remark 자동 기본값 정리
--     PR #72     : batch_master.default_mode / allowed_modes 컬럼 + 기본 시드
--     PR #73     : schedule_type ENUM 에 'manual' 추가
--     PR #75     : exec_time NULL 허용
--     PR #77     : 1회 예약(once) 모드 — ENUM 확장 + 컬럼 추가 + UNIQUE→INDEX
--     PR #74/#76/#78/#79 : UI 변경 (DB 변경 없음)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1) batch_master 테이블 생성 (PR #67/#68)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_master (
  interface_id     VARCHAR(50)  NOT NULL,
  interface_name   VARCHAR(200) NOT NULL,
  sender           VARCHAR(50)  NOT NULL DEFAULT 'SAP',
  receiver         VARCHAR(50)  NOT NULL DEFAULT 'S&OP',
  rfc_func_or_url  VARCHAR(500) DEFAULT NULL,
  rfc_param        TEXT         DEFAULT NULL,
  exec_command     VARCHAR(500) DEFAULT NULL,
  remark           TEXT         DEFAULT NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_by       VARCHAR(50)  DEFAULT NULL,
  updated_by       VARCHAR(50)  DEFAULT NULL,
  created_at       DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (interface_id),
  KEY idx_batch_master_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ────────────────────────────────────────────────────────────
-- 2) batch_master 컬럼 확장 (PR #70, #72)
--    MariaDB 의 ADD COLUMN IF NOT EXISTS / ADD INDEX IF NOT EXISTS 사용
-- ────────────────────────────────────────────────────────────

-- 2-1) PR #70: rfc_name 컬럼 + 인덱스
ALTER TABLE batch_master
  ADD COLUMN IF NOT EXISTS rfc_name VARCHAR(100) NULL AFTER receiver;

ALTER TABLE batch_master
  ADD INDEX IF NOT EXISTS idx_batch_master_rfc_name (rfc_name);

-- 2-2) PR #72: default_mode 컬럼
ALTER TABLE batch_master
  ADD COLUMN IF NOT EXISTS default_mode VARCHAR(20) NOT NULL DEFAULT 'replace' AFTER rfc_param;

-- 2-3) PR #72: allowed_modes 컬럼
ALTER TABLE batch_master
  ADD COLUMN IF NOT EXISTS allowed_modes VARCHAR(100) NOT NULL DEFAULT 'replace,append,dry-run' AFTER default_mode;


-- ────────────────────────────────────────────────────────────
-- 3) batch_master 기본 인터페이스 시드 (NLP_RFC_001 / NLP_RFC_002)
--    NOT EXISTS 가드 — 이미 있으면 절대 덮어쓰지 않음.
-- ────────────────────────────────────────────────────────────

-- 3-1) NLP_RFC_001 — 수익성데이터
INSERT INTO batch_master
  (interface_id, interface_name, sender, receiver, rfc_name, rfc_func_or_url, rfc_param, default_mode, allowed_modes, exec_command, remark, is_active, created_by)
SELECT
  'NLP_RFC_001', '수익성데이터', 'SAP', 'analytics', 'Z_BI_WEB_EX_BL',
  'POST /profit-api/sap-rfc/execute',
  '{"function":"Z_BI_WEB_EX_BL","params":{"I_CMONTH":"{CMONTH}"}}',
  'replace', 'replace,append,dry-run', 'SAP_RFC_SYNC',
  'SAP BW 수익성분석 데이터 동기화', 1, 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM batch_master WHERE interface_id = 'NLP_RFC_001'
);

-- 3-2) NLP_RFC_002 — 제조원가 RFC (Z_BI_WEB_EX_BL_4)
--      (구 함수명 Z_BI_PRE_COST 는 PR #329 에서 Z_BI_WEB_EX_BL_4 로 일괄 교체됨)
INSERT INTO batch_master
  (interface_id, interface_name, sender, receiver, rfc_name, rfc_func_or_url, rfc_param, default_mode, allowed_modes, exec_command, remark, is_active, created_by)
SELECT
  'NLP_RFC_002', '제조원가 RFC', 'SAP', 'analytics', 'Z_BI_WEB_EX_BL_4',
  'POST /profit-api/sap-rfc/execute',
  '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}',
  'replace', 'replace,append,dry-run', 'SAP_RFC_SYNC',
  '제조원가 RFC (Z_BI_WEB_EX_BL_4) — sys_aimd_cot015 적재 / 월마감 후 실행', 1, 'admin'
WHERE NOT EXISTS (
  SELECT 1 FROM batch_master WHERE interface_id = 'NLP_RFC_002'
);


-- ────────────────────────────────────────────────────────────
-- 4) batch_schedule 테이블 생성 (PR #69, 최신 스키마)
--    최신 스키마 = PR #79 시점:
--      - ENUM('daily','monthly','manual','once')
--      - exec_time NULL 허용
--      - exec_datetime / target_cmonth / exec_mode 컬럼 포함
--      - UNIQUE 없음, FK + 일반 INDEX 만
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS batch_schedule (
  id                  INT(11)      NOT NULL AUTO_INCREMENT,
  interface_id        VARCHAR(50)  NOT NULL,
  schedule_type       ENUM('daily','monthly','manual','once') NOT NULL DEFAULT 'daily',
  exec_time           TIME         DEFAULT NULL,
  exec_datetime       DATETIME     DEFAULT NULL,
  exec_day_of_month   TINYINT(2)   DEFAULT NULL,
  target_cmonth       VARCHAR(6)   DEFAULT NULL,
  exec_mode           VARCHAR(20)  DEFAULT NULL,
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  last_run_at         DATETIME     DEFAULT NULL,
  last_run_status     ENUM('success','failed','running','pending') DEFAULT NULL,
  next_run_at         DATETIME     DEFAULT NULL,
  remark              VARCHAR(500) DEFAULT NULL,
  created_by          VARCHAR(50)  DEFAULT NULL,
  updated_by          VARCHAR(50)  DEFAULT NULL,
  created_at          DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_batch_schedule_interface (interface_id),
  KEY idx_batch_schedule_active (is_active),
  KEY idx_batch_schedule_once_due (schedule_type, is_active, exec_datetime),
  CONSTRAINT fk_batch_schedule_interface
    FOREIGN KEY (interface_id) REFERENCES batch_master(interface_id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;


-- ────────────────────────────────────────────────────────────
-- 5) batch_schedule 스키마 마이그레이션 (이미 있던 환경용)
--    MariaDB 의 IF [NOT] EXISTS 절로 멱등 처리.
-- ────────────────────────────────────────────────────────────

-- 5-1) PR #73 + #77 : schedule_type ENUM 확장 (manual + once 포함)
--      MODIFY 는 IF EXISTS 가 없지만, 같은 결과로 변경하는 건 안전.
ALTER TABLE batch_schedule
  MODIFY COLUMN schedule_type ENUM('daily','monthly','manual','once') NOT NULL DEFAULT 'daily';

-- 5-2) PR #75 : exec_time NULL 허용
ALTER TABLE batch_schedule
  MODIFY COLUMN exec_time TIME NULL DEFAULT NULL;

-- 5-3) PR #77 : exec_datetime 컬럼 추가
ALTER TABLE batch_schedule
  ADD COLUMN IF NOT EXISTS exec_datetime DATETIME DEFAULT NULL AFTER exec_time;

-- 5-4) PR #77 : target_cmonth 컬럼 추가
ALTER TABLE batch_schedule
  ADD COLUMN IF NOT EXISTS target_cmonth VARCHAR(6) DEFAULT NULL AFTER exec_day_of_month;

-- 5-5) PR #77 : exec_mode 컬럼 추가
ALTER TABLE batch_schedule
  ADD COLUMN IF NOT EXISTS exec_mode VARCHAR(20) DEFAULT NULL AFTER target_cmonth;

-- 5-6) PR #77 : UNIQUE(interface_id) → INDEX 교체
--      FK 가 UNIQUE 를 참조 중이면 1553 발생 → 일반 INDEX 먼저 추가 후 UNIQUE drop
ALTER TABLE batch_schedule
  ADD INDEX IF NOT EXISTS idx_batch_schedule_interface (interface_id);

ALTER TABLE batch_schedule
  DROP INDEX IF EXISTS uq_batch_schedule_interface;

-- 5-7) PR #77 : 활성 인덱스
ALTER TABLE batch_schedule
  ADD INDEX IF NOT EXISTS idx_batch_schedule_active (is_active);

-- 5-8) PR #77 : once 자동실행 검색용 복합 인덱스
ALTER TABLE batch_schedule
  ADD INDEX IF NOT EXISTS idx_batch_schedule_once_due (schedule_type, is_active, exec_datetime);


-- ────────────────────────────────────────────────────────────
-- 6) PR #71 : batch_schedule.remark 자동 기본값 정리
--    예전 버전이 자동으로 넣었던 '매일 06:00' / '매월 N일' 만 NULL 로.
--    사용자가 직접 입력한 비고는 건드리지 않음.
-- ────────────────────────────────────────────────────────────
UPDATE batch_schedule
   SET remark = NULL
 WHERE remark IN ('매일 06:00', '매일 06:00:00')
    OR remark REGEXP '^매월 [0-9]+일?( [0-9:]+)?$';


-- ────────────────────────────────────────────────────────────
-- 7) PR #69 : batch_jobs.interface_id 컬럼 + [인터페이스 관리] 메뉴
--    ⚠️ batch_jobs / menus / role_menus 가 없는 환경에서는 해당 ALTER/INSERT
--       구문이 에러를 낼 수 있습니다. 운영에 이 테이블들이 모두 있다는 전제로
--       작성되었습니다 (이전 PR 들에서 생성됨).
--       만약 batch_jobs 가 없다면 7-1 블록을 주석 처리하고 실행하세요.
-- ────────────────────────────────────────────────────────────

-- 7-1) batch_jobs.interface_id 컬럼 + 인덱스
ALTER TABLE batch_jobs
  ADD COLUMN IF NOT EXISTS interface_id VARCHAR(50) NULL AFTER job_type;

ALTER TABLE batch_jobs
  ADD INDEX IF NOT EXISTS idx_batch_jobs_interface (interface_id);

-- 7-2) [인터페이스 관리] 메뉴 등록
INSERT INTO menus (menu_code, menu_name, menu_url, icon_class, sort_order, is_active)
SELECT 'interface', '인터페이스 관리', '/interface.html', 'fas fa-exchange-alt', 7, 1
 WHERE NOT EXISTS (SELECT 1 FROM menus WHERE menu_code = 'interface');

-- 7-3) role_menus: admin(role_id=1) 매핑
INSERT INTO role_menus (role_id, menu_id)
SELECT 1, m.id
  FROM menus m
 WHERE m.menu_code = 'interface'
   AND NOT EXISTS (
     SELECT 1 FROM role_menus rm WHERE rm.role_id = 1 AND rm.menu_id = m.id
   );


-- ────────────────────────────────────────────────────────────
-- 8) 검증 출력
-- ────────────────────────────────────────────────────────────
SELECT '=== batch_master 컬럼 ===' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_master'
 ORDER BY ORDINAL_POSITION;

SELECT '=== batch_schedule 컬럼 ===' AS info;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_schedule'
 ORDER BY ORDINAL_POSITION;

SELECT '=== batch_schedule 인덱스 ===' AS info;
SELECT INDEX_NAME, NON_UNIQUE,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_schedule'
 GROUP BY INDEX_NAME, NON_UNIQUE
 ORDER BY INDEX_NAME;

SELECT '=== batch_master 행 수 ===' AS info;
SELECT COUNT(*) AS row_count FROM batch_master;

SELECT '=== batch_schedule 행 수 ===' AS info;
SELECT COUNT(*) AS row_count FROM batch_schedule;


-- ────────────────────────────────────────────────────────────
-- 9) (선택) 이전 버전에서 들어간 SNOP_RFC_* 정리
--    자동 실행되지 않습니다. 필요하면 주석을 풀고 실행하세요.
--    FK 가 ON DELETE CASCADE 라서 master 만 지우면 schedule 도 함께 사라집니다.
-- ────────────────────────────────────────────────────────────
-- DELETE FROM batch_schedule WHERE interface_id LIKE 'SNOP_RFC_%';
-- DELETE FROM batch_master   WHERE interface_id LIKE 'SNOP_RFC_%';

-- ============================================================
-- ✅ 모두 완료.
--
-- 기대값:
--   - batch_master   : rfc_name / default_mode / allowed_modes 컬럼 존재
--   - batch_schedule :
--       * schedule_type → enum('daily','monthly','manual','once')
--       * exec_time     → NULL 허용
--       * exec_datetime / target_cmonth / exec_mode 컬럼 존재
--       * uq_batch_schedule_interface → 없음
--       * idx_batch_schedule_interface / _active / _once_due → 존재
-- ============================================================
