-- ============================================================
-- 013: nl_query_history에 session_id 컬럼 추가
-- 채팅 세션 단위로 이력을 그룹핑하기 위한 UUID 컬럼
-- ============================================================

-- 1) session_id 컬럼 추가 (없으면)
ALTER TABLE nl_query_history
  ADD COLUMN IF NOT EXISTS session_id VARCHAR(36) DEFAULT NULL
  COMMENT '채팅 세션 ID (UUID)' AFTER user_id;

-- 2) 인덱스 추가 (user_id + session_id 복합 인덱스)
ALTER TABLE nl_query_history
  ADD INDEX IF NOT EXISTS idx_nl_session_id (user_id, session_id);

-- ============================================================
-- 검증
-- ============================================================
SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'nl_query_history'
  AND COLUMN_NAME = 'session_id';
