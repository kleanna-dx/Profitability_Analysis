-- ============================================================================
-- 031_drop_allowed_modes_exec_command.sql
--
-- 목적:
--   batch_master 에서 더 이상 사용하지 않는 컬럼 2개를 제거한다.
--     (1) allowed_modes  — 모든 인터페이스가 'replace,append,dry-run' 동일값이라
--                          차등화 의미가 없어 코드에 상수(ALLOWED_MODES_LIST)로 일원화
--     (2) exec_command   — 실제 실행 분기에서 사용되지 않는 죽은 필드 (INSERT 시에도
--                          server.mjs 가 'SAP_RFC_SYNC' 를 하드코딩) → 제거
--
--   동시에 receiver 기본값/잔여값을 'analytics' 로 정규화한다.
--     - 신규 등록 시 server.mjs 가 'analytics' 를 기본값으로 사용
--     - 기존에 'S&OP' 등으로 들어간 행은 'analytics' 로 일괄 정정
--
-- 멱등성:
--   - 컬럼 삭제는 INFORMATION_SCHEMA + PREPARE/EXECUTE 조건부 ALTER
--   - receiver 정규화는 WHERE 조건이 있어서 재실행 안전
-- ============================================================================

-- 1) allowed_modes 컬럼 삭제 (있으면) -----------------------------------------
SET @has_allowed := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_master'
     AND COLUMN_NAME  = 'allowed_modes'
);
SET @sql := IF(@has_allowed = 1,
  "ALTER TABLE batch_master DROP COLUMN allowed_modes",
  "SELECT 'skip: batch_master.allowed_modes already dropped' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) exec_command 컬럼 삭제 (있으면) ------------------------------------------
SET @has_cmd := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_master'
     AND COLUMN_NAME  = 'exec_command'
);
SET @sql := IF(@has_cmd = 1,
  "ALTER TABLE batch_master DROP COLUMN exec_command",
  "SELECT 'skip: batch_master.exec_command already dropped' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) receiver 정규화 ('S&OP', 'snop', 등 잔여값 → 'analytics') -----------------
UPDATE batch_master
   SET receiver = 'analytics'
 WHERE receiver IS NULL
    OR receiver = ''
    OR LOWER(receiver) IN ('s&op', 'snop', 's-op', 's_op');

-- 4) 결과 확인 (참고용) --------------------------------------------------------
SELECT 'batch_master cleanup done' AS info,
       interface_id, sender, receiver, default_mode
  FROM batch_master
 ORDER BY interface_id;
