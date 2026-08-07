-- ============================================================
-- 046: 로그인 이력 테이블 신규 생성
-- ------------------------------------------------------------
-- 목적:
--   사용자 로그인 성공 시점의 접속 이력을 영구 저장한다.
--   (일반 로그인 + SSO 로그인 성공 케이스 모두 포함)
--
-- 스펙:
--   - 테이블명 : sys_aimd_login_log
--   - 컬럼 4개 : log_seq, user_id, ip_addr, login_dt
--   - 인덱스   : PK(log_seq) 만, 별도 추가 인덱스 없음
--
-- 저장 시점:
--   1) POST /api/login          → 일반 아이디/비번 로그인 성공 시
--   2) POST /api/login/sendEncData → SSO 로그인 성공 시
--      (SSO 신규 사용자 자동 생성 케이스도 포함)
--
-- 저장 대상:
--   - 성공한 로그인만 기록 (실패/비활성 계정 등은 기록하지 않음)
-- ============================================================

CREATE TABLE IF NOT EXISTS `sys_aimd_login_log` (
  `log_seq`  BIGINT       NOT NULL AUTO_INCREMENT             COMMENT '로그 일련번호 (PK)',
  `user_id`  VARCHAR(50)  NOT NULL                            COMMENT '로그인 사용자 ID',
  `ip_addr`  VARCHAR(45)  DEFAULT NULL                        COMMENT '접속 IP 주소 (IPv4/IPv6 대응)',
  `login_dt` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP  COMMENT '로그인 일시',
  PRIMARY KEY (`log_seq`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='로그인 이력 (일반 로그인 + SSO 로그인 성공 시 1건 INSERT)';
