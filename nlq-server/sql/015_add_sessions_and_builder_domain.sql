-- ============================================================
-- 015: 세션 영구 저장소 + 빌더 이력 도메인 컬럼
-- PR #55 배포 시 운영 DB에 수동 실행
-- ============================================================

-- 1) sessions 테이블 (express-mysql-session 영구 저장소)
--    서버 시작 시 자동 생성되지만, 운영에서는 미리 생성 권장
CREATE TABLE IF NOT EXISTS `sessions` (
  `session_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `expires` int(11) unsigned NOT NULL,
  `data` mediumtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Express 세션 영구 저장소 (PM2 재시작 시에도 세션 유지)';

-- 2) builder_query_history에 domain_code 컬럼 추가
--    이력 항목에 [PS]/[HL] 도메인 뱃지 표시 및 이력 복원 시 도메인 자동 전환용
ALTER TABLE builder_query_history
  ADD COLUMN IF NOT EXISTS domain_code VARCHAR(20) DEFAULT NULL
  COMMENT '분석 영역 도메인 코드' AFTER is_bookmarked;

-- ============================================================
-- .env 설정 추가 필요 (운영 서버):
--   SESSION_SECRET=<고정 비밀키 문자열>
-- 
-- 이 값이 없으면 서버 재시작마다 세션이 무효화됩니다.
-- ============================================================
