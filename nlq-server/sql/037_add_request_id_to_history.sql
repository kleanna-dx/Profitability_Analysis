-- ============================================================
-- [PR #251 / 2026-07-22] nl_query_history 에 requestId / error_type 추가
-- ------------------------------------------------------------
-- 배경:
--   질의 실행 직후 오류 화면에는 requestId 와 오류 유형(errorType) 배지가
--   표시되지만, <질의 이력> 에서 동일한 오류 이력을 재열람하면
--   requestId 가 사라지고 배지가 '시스템 오류' 로 통일되어 나타나는 문제.
--   원인은 nl_query_history 에 두 컬럼이 없어서 저장/복원할 수 없었기 때문.
-- 해결:
--   1) request_id VARCHAR(64) — 실행 시 발급된 요청 ID (서버 로그 grep 키)
--   2) error_type VARCHAR(50)  — 프론트 배지용 오류 유형 코드
--      (예: db_query_timeout / db_execution / gateway_timeout / system 등)
--   두 컬럼 모두 NULL 허용. 과거 이력은 NULL 로 남으며, 프론트에서
--   'Request ID 없음' 으로 표시하도록 처리한다.
-- ============================================================

-- MariaDB / MySQL 모두 IF NOT EXISTS 를 ALTER TABLE ADD COLUMN 에서
-- 지원하지 않는 버전이 있으므로, 존재 여부를 확인 후 조건부 실행.
-- (10.0+ MariaDB 는 지원하지만 안전한 pattern 을 사용)

SET @schema := DATABASE();

-- request_id 컬럼 추가
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'nl_query_history'
    AND COLUMN_NAME  = 'request_id'
);
SET @stmt := IF(@col_exists = 0,
  'ALTER TABLE nl_query_history ADD COLUMN request_id VARCHAR(64) DEFAULT NULL COMMENT ''요청 ID (서버 로그 매칭용, PR #251)'' AFTER error_message',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- error_type 컬럼 추가
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'nl_query_history'
    AND COLUMN_NAME  = 'error_type'
);
SET @stmt := IF(@col_exists = 0,
  'ALTER TABLE nl_query_history ADD COLUMN error_type VARCHAR(50) DEFAULT NULL COMMENT ''오류 유형 코드 (db_query_timeout / db_execution / gateway_timeout / system 등, PR #251)'' AFTER request_id',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- request_id 검색용 인덱스 (운영 로그 매칭 지원)
SET @idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'nl_query_history'
    AND INDEX_NAME   = 'idx_history_request_id'
);
SET @stmt := IF(@idx_exists = 0,
  'CREATE INDEX idx_history_request_id ON nl_query_history (request_id)',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 검증
SELECT COLUMN_NAME, DATA_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME   = 'nl_query_history'
  AND COLUMN_NAME IN ('request_id', 'error_type')
ORDER BY ORDINAL_POSITION;
