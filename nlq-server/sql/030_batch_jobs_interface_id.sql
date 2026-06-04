-- ============================================================================
-- 030_batch_jobs_interface_id.sql
--
-- 목적:
--   1) batch_jobs.interface_id 컬럼/인덱스 보장 (이전 환경 보강용 멱등 ALTER)
--   2) 기존에 interface_id 가 NULL 로 들어간 행 백필
--        - created_by 가 'scheduler:<interface_id>' 형식이면 거기서 추출
--        - 그 외 NULL 은 'NLP_RFC_001' (수익성데이터) 로 fallback
--
-- 배경:
--   [인터페이스 수행관리] 스케줄러 자동 실행 / [배치관리] 수동 실행 시
--   batch_jobs INSERT 에서 interface_id 를 채우지 않아 [인터페이스 이력관리]
--   탭의 인터페이스 필터로 조회되지 않는 문제가 있었음.
--   server.mjs 의 모든 INSERT 가 interface_id 를 채우도록 수정한 PR 과
--   같이 적용해야 함 (코드만 고치면 기존 NULL 행은 그대로 남음).
--
-- 멱등성:
--   - 컬럼/인덱스는 INFORMATION_SCHEMA 조회 후 조건부 ALTER
--   - 백필 UPDATE 는 WHERE interface_id IS NULL 조건이라 재실행 안전
-- ============================================================================

-- 1) interface_id 컬럼 보장 ----------------------------------------------------
SET @has_col := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_jobs'
     AND COLUMN_NAME  = 'interface_id'
);

SET @sql := IF(@has_col = 0,
  "ALTER TABLE batch_jobs ADD COLUMN interface_id VARCHAR(50) NULL COMMENT '인터페이스 ID (batch_master)' AFTER job_type",
  "SELECT 'skip: batch_jobs.interface_id already exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 코멘트는 항상 보정
ALTER TABLE batch_jobs
  MODIFY COLUMN interface_id VARCHAR(50) NULL COMMENT '인터페이스 ID (batch_master)';

-- 2) interface_id 인덱스 보장 --------------------------------------------------
SET @has_idx := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'batch_jobs'
     AND INDEX_NAME   = 'idx_batch_jobs_interface'
);

SET @sql := IF(@has_idx = 0,
  "ALTER TABLE batch_jobs ADD INDEX idx_batch_jobs_interface (interface_id)",
  "SELECT 'skip: idx_batch_jobs_interface already exists' AS info"
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3) NULL 백필 ① — created_by 'scheduler:<interface_id>' 패턴에서 추출 -----------
UPDATE batch_jobs
   SET interface_id = SUBSTRING(created_by, 11)
 WHERE interface_id IS NULL
   AND created_by LIKE 'scheduler:%'
   AND LENGTH(created_by) > 10;

-- 4) NULL 백필 ② — 나머지는 수익성데이터(NLP_RFC_001) 로 fallback ---------------
--    (현재 운영 인터페이스는 수익성데이터 1종이므로 합리적 기본값)
UPDATE batch_jobs
   SET interface_id = 'NLP_RFC_001'
 WHERE interface_id IS NULL;

-- 5) 결과 확인 (참고용) --------------------------------------------------------
SELECT 'batch_jobs interface_id backfill done' AS info,
       COUNT(*)                                AS total,
       SUM(interface_id IS NULL)               AS null_left,
       SUM(interface_id = 'NLP_RFC_001')       AS rfc001_count
  FROM batch_jobs;
