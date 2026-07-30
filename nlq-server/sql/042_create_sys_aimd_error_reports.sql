-- ============================================================
-- [2026-07-30] AIMD 오류 접수 테이블 생성 (PR #319)
-- ------------------------------------------------------------
-- 목적:
--   자연어 질의 오류 카드의 [오류 접수] 버튼으로부터 접수된 오류를
--   저장하고 관리자 워크플로(OPEN → IN_PROGRESS → RESOLVED/IGNORED)로
--   추적하기 위한 테이블.
--
--   관리자는 이 테이블의 request_id 로 nlq-server.log 를 grep 하여
--   원문 스택/SQL/내부 경로를 확인한다 (그런 민감정보는 이 테이블에
--   저장하지 않음).
--
--   AIMD 시스템 관리용 테이블 명명 규칙: sys_aimd_{table_name}
--   (sys_aimd_areas / sys_aimd_user_areas 와 동일 컨벤션)
--
-- 기존 테이블 재사용 검토 (nl_query_history):
--   - request_id 컬럼은 이미 있지만 UNIQUE 제약 없음 (인덱스만)
--   - 질의 로그(성공 포함 전체)라 status 워크플로에 부적합
--   - "질의한 사람" 과 "접수한 사람" 을 분리할 수 없음
--   → 별도 테이블로 신설 (관심사 분리)
--
-- 사용 시점:
--   운영 DB 에 이 테이블이 없는 상태에서 처음 반영할 때.
--   (dev 환경에서는 서버 부팅 시 server.mjs 의
--    ensureErrorReportsTable() 이 CREATE TABLE IF NOT EXISTS 로
--    자동 생성하므로 별도 실행 불필요.)
--
-- 멱등성:
--   - CREATE TABLE IF NOT EXISTS 로 안전하게 재실행 가능
--   - request_id UNIQUE 제약으로 동일 요청 중복 접수 방지 (DB 레벨)
--
-- 의존:
--   - users 테이블이 이미 존재해야 함 (002_create_users.sql)
--     ※ user_id 는 논리적으로 users.user_id 를 참조하지만
--       외래키(FK)는 걸지 않음 (사용자 삭제 후에도 오류 접수 이력은 유지)
-- ============================================================

CREATE TABLE IF NOT EXISTS sys_aimd_error_reports (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  request_id          VARCHAR(64)  NOT NULL UNIQUE COMMENT '오류 요청 ID (nlq-server.log grep 키, 중복 접수 방지)',
  user_id             VARCHAR(64)  NOT NULL        COMMENT '오류를 접수한 사용자 (서버 세션에서 채움)',
  business_area_code  VARCHAR(32)  NULL            COMMENT '업무영역 내부 코드 (PROFITABILITY / MANUFACTURING_COST 등)',
  domain_code         VARCHAR(10)  NULL            COMMENT '도메인 내부 코드 (PS / HL / MGMT)',
  query_mode          VARCHAR(20)  NULL            COMMENT '질의 모드 (aggregate=현황집계 / analysis=분석질문 / builder 등)',
  user_question       TEXT         NULL            COMMENT '사용자가 입력한 질문 원문',
  error_code          VARCHAR(50)  NULL            COMMENT '오류 분류 코드 (TIMEOUT / HTTP_504 / SQL_EXECUTION_ERROR / GATEWAY_TIMEOUT / SYSTEM 등)',
  http_status         INT          NULL            COMMENT 'HTTP 상태 코드 (있는 경우)',
  error_summary       VARCHAR(500) NULL            COMMENT '사용자 화면에 표시된 안전한 오류 요약 (원문 stack/경로 저장 금지)',
  status              VARCHAR(20)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / IN_PROGRESS / RESOLVED / IGNORED',
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_err_reports_request_id (request_id),
  INDEX idx_err_reports_user       (user_id),
  INDEX idx_err_reports_status     (status),
  INDEX idx_err_reports_created    (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='AIMD 사용자 오류 접수 (nlq-server.log 매칭 키: request_id)';

-- ============================================================
-- 검증 쿼리 (운영 반영 후 실행하여 결과 확인)
-- ------------------------------------------------------------
-- 1) 테이블 존재 확인
--    SHOW TABLES LIKE 'sys_aimd_error_reports';
--
-- 2) 스키마 확인 (컬럼/인덱스/UNIQUE 제약)
--    SHOW CREATE TABLE sys_aimd_error_reports\G
--
-- 3) 인덱스 목록 확인 (UNIQUE(request_id) + 4개 인덱스 존재해야 함)
--    SHOW INDEX FROM sys_aimd_error_reports;
--
-- 4) 접수 이력 조회 (관리자 워크플로)
--    SELECT id, request_id, user_id, domain_code, error_code, http_status,
--           error_summary, status, created_at
--      FROM sys_aimd_error_reports
--     WHERE status = 'OPEN'
--     ORDER BY created_at DESC;
--
-- 5) 특정 requestId 의 서버 로그 추적 (운영 서버에서)
--    grep "req-YYYYMMDD-HHMMSS-XXXXXX" /data/analytics/logs/nlq-server.log
-- ============================================================
