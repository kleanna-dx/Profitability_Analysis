-- =========================================================
-- 023_add_manual_schedule_type.sql
-- 목적: batch_schedule.schedule_type enum에 'manual' 값 추가
--       'manual' = 자동 스케줄링하지 않고 수동 실행만 사용
--       (사용자가 [실행 모달]에서 년월 YYYYMM 직접 입력하여 실행)
-- 멱등: 이미 manual이 포함된 enum이면 ALTER 생략
-- =========================================================

SET @needs_update := (
  SELECT IF(
    LOCATE("'manual'", COLUMN_TYPE) > 0,
    0,
    1
  )
    FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_schedule'
     AND COLUMN_NAME  = 'schedule_type'
);

SET @stmt := IF(
  @needs_update = 1,
  "ALTER TABLE batch_schedule
    MODIFY COLUMN schedule_type ENUM('daily','monthly','manual')
                  NOT NULL DEFAULT 'daily'
                  COMMENT '수행 주기 (daily=매일, monthly=매월, manual=수동전용)'",
  "SELECT 'schedule_type already includes manual' AS info"
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
