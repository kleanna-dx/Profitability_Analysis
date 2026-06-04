-- =====================================================================
-- 025_add_once_schedule.sql
--
-- 목적:
--   인터페이스 한 건을 "특정 일시(YYYY-MM-DD HH:MM)에 한 번"만 자동
--   실행시키는 'once' 예약 모드를 batch_schedule 에 추가.
--
--   사용 시나리오 (사용자 요청):
--     [1] NLP_RFC_001 / 대상년월 202605 / 실행일&시간 20260605 07:00
--     [2] NLP_RFC_001 / 대상년월 202605 / 실행일&시간 20260605 08:00
--     ↑ 같은 인터페이스를 여러 일시로 다중 예약 가능해야 함.
--
-- 변경 요약:
--   1) schedule_type ENUM 에 'once' 추가
--   2) exec_datetime DATETIME  — once 모드의 정확한 실행 일시
--   3) target_cmonth VARCHAR(6) — 대상년월 (YYYYMM) — once / manual 에 사용
--   4) exec_mode VARCHAR(20)    — 실행 모드 (replace/append/dry-run) — once 에 사용
--   5) UNIQUE(interface_id) 제거 → 같은 인터페이스 다중 예약 허용
--      대신 INDEX(interface_id) 추가
--   6) once 자동 실행용 인덱스: (schedule_type, is_active, exec_datetime)
--
-- 멱등성:
--   각 ALTER 전에 information_schema 로 현재 상태를 검사하여 skip 가능.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) schedule_type ENUM 에 'once' 추가
-- ---------------------------------------------------------------------
SET @cur_enum := (
  SELECT COLUMN_TYPE FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'schedule_type'
);
SET @needs := IF(@cur_enum NOT LIKE '%once%', 1, 0);
SET @sql := IF(@needs = 1,
  "ALTER TABLE batch_schedule
     MODIFY COLUMN schedule_type ENUM('daily','monthly','manual','once')
     NOT NULL DEFAULT 'daily'
     COMMENT '수행 주기 (daily=매일, monthly=매월, manual=수동전용, once=1회예약)'",
  "SELECT 'schedule_type already has once' AS status"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 2) exec_datetime 컬럼 추가 (once 모드의 실행 일시)
-- ---------------------------------------------------------------------
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
  "SELECT 'exec_datetime exists' AS status"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 3) target_cmonth 컬럼 추가 (대상년월)
-- ---------------------------------------------------------------------
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
  "SELECT 'target_cmonth exists' AS status"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 4) exec_mode 컬럼 추가 (실행 모드)
-- ---------------------------------------------------------------------
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
  "SELECT 'exec_mode exists' AS status"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 5) UNIQUE(interface_id) 제거 → 일반 INDEX 로 교체
--    같은 인터페이스를 여러 일시로 등록할 수 있어야 함.
--
--    중요: fk_batch_schedule_interface FK 가 uq_batch_schedule_interface
--    인덱스를 참조 중이므로, 먼저 일반 INDEX 를 추가하여 FK 가 그쪽으로
--    빠지도록 한 뒤 UNIQUE 를 drop 해야 함 (MariaDB 1553 회피).
-- ---------------------------------------------------------------------
SET @has_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND INDEX_NAME   = 'idx_batch_schedule_interface'
);
SET @sql := IF(@has_idx = 0,
  "ALTER TABLE batch_schedule ADD INDEX idx_batch_schedule_interface (interface_id)",
  "SELECT 'idx_batch_schedule_interface exists' AS status"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 이제 FK 는 idx_batch_schedule_interface 를 사용할 수 있으므로 UNIQUE drop 가능
SET @has_uq := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND INDEX_NAME   = 'uq_batch_schedule_interface'
);
SET @sql := IF(@has_uq > 0,
  "ALTER TABLE batch_schedule DROP INDEX uq_batch_schedule_interface",
  "SELECT 'unique index already removed' AS status"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 6) once 자동실행 검색용 복합 인덱스
--    스케줄러가 1분마다 "WHERE schedule_type='once' AND is_active=1
--    AND exec_datetime <= NOW() AND last_run_status IS NULL" 로 조회
-- ---------------------------------------------------------------------
SET @has_idx2 := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND INDEX_NAME   = 'idx_batch_schedule_once_due'
);
SET @sql := IF(@has_idx2 = 0,
  "ALTER TABLE batch_schedule
     ADD INDEX idx_batch_schedule_once_due (schedule_type, is_active, exec_datetime)",
  "SELECT 'idx_batch_schedule_once_due exists' AS status"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 검증 출력
-- ---------------------------------------------------------------------
SELECT 'COLUMNS' AS section;
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'batch_schedule'
   AND COLUMN_NAME IN ('schedule_type','exec_time','exec_datetime',
                       'exec_day_of_month','target_cmonth','exec_mode')
 ORDER BY ORDINAL_POSITION;

SELECT 'INDEXES' AS section;
SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
  FROM information_schema.STATISTICS
 WHERE TABLE_SCHEMA = DATABASE()
   AND TABLE_NAME   = 'batch_schedule'
 GROUP BY INDEX_NAME, NON_UNIQUE
 ORDER BY INDEX_NAME;
