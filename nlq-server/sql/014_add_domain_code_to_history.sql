-- 014: nl_query_history에 domain_code 컬럼 추가 (분석 영역 구분 및 이력 배지 표시용)
-- 서버 자동 마이그레이션에도 포함되어 있으므로 프로덕션 수동 배포 시 사용

ALTER TABLE nl_query_history
  ADD COLUMN IF NOT EXISTS domain_code VARCHAR(20) DEFAULT NULL
  COMMENT '분석 영역 도메인 코드' AFTER session_id;

ALTER TABLE nl_query_history
  ADD INDEX IF NOT EXISTS idx_nl_domain (user_id, domain_code);
