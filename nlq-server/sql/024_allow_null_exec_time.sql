-- =====================================================================
-- 024_allow_null_exec_time.sql
--
-- 목적:
--   schedule_type='manual' (직접 실행) 인 경우, 자동 스케줄을 돌리지 않으므로
--   exec_time / exec_day_of_month 는 의미가 없음. 서버 로직은 이미
--   manual 일 때 NULL 을 INSERT/UPDATE 하도록 작성되어 있으나, 컬럼이
--   NOT NULL 이라 저장 실패가 발생 ("Column 'exec_time' cannot be null").
--
--   해결: exec_time 을 NULL 허용으로 변경.
--   daily/monthly 행은 서버에서 항상 값을 넣어주므로 동작 영향 없음.
--
-- 멱등성:
--   information_schema 로 현재 IS_NULLABLE 상태를 검사하여, 이미 NULL
--   허용으로 바뀐 경우 ALTER 를 건너뜀.
-- =====================================================================

-- 1) exec_time 을 NULL 허용으로 변경 (이미 YES 면 skip)
SET @needs_change := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'exec_time'
     AND IS_NULLABLE  = 'NO'
);

SET @sql := IF(@needs_change > 0,
  "ALTER TABLE batch_schedule
     MODIFY COLUMN exec_time TIME NULL DEFAULT NULL COMMENT '수행 시간 (manual 인 경우 NULL)'",
  "SELECT 'exec_time already nullable' AS status"
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2) (참고) exec_day_of_month 는 이미 NULL 허용이라 손대지 않음.

-- 3) 검증 출력
SELECT
  COLUMN_NAME,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'batch_schedule'
  AND COLUMN_NAME IN ('schedule_type','exec_time','exec_day_of_month')
ORDER BY ORDINAL_POSITION;
