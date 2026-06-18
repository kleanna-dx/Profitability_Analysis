-- ============================================================
-- 사용자 테이블
-- 로그인 인증 및 사용자 관리
-- ※ role 컬럼 제거됨 → role_id (FK → roles.id) 사용
-- ※ 009_create_rbac_tables.sql 먼저 실행 필요
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id`               int(11)      NOT NULL AUTO_INCREMENT,
  `user_id`          varchar(50)  NOT NULL           COMMENT '로그인 아이디 (SSO sproId와 동일)',
  `password`         varchar(255) DEFAULT NULL        COMMENT '비밀번호 (SHA-256 해시 hex 64자, SSO 유저는 NULL 가능)',
  `name`             varchar(100) NOT NULL            COMMENT '사용자 이름',
  `email`            varchar(150) DEFAULT NULL        COMMENT '이메일',
  `group_name`       varchar(100) DEFAULT NULL        COMMENT '부서(그룹) 이름',
  `group_id`         varchar(20)  DEFAULT NULL        COMMENT '그룹 ID',
  `parent_group_id`  varchar(20)  DEFAULT NULL        COMMENT '상위 그룹 ID',
  `tenant_id`        varchar(20)  DEFAULT NULL        COMMENT '테넌트 ID',
  `phone`            varchar(20)  DEFAULT NULL        COMMENT '연락처',
  `position`         varchar(50)  DEFAULT NULL        COMMENT '직급',
  `role_id`          int(11)      DEFAULT NULL        COMMENT 'RBAC 역할 FK (→ roles.id)',
  `domain_code`      varchar(20)  DEFAULT NULL        COMMENT '영역 코드 (PS, HL, MGMT, NULL=전체)',
  `is_active`        tinyint(4)   NOT NULL DEFAULT 1  COMMENT '활성 여부 (1=활성, 0=비활성)',
  `sso_yn`           tinyint(4)   NOT NULL DEFAULT 0  COMMENT 'SSO 연동 여부 (1=SSO, 0=일반)',
  `created_at`       datetime     DEFAULT current_timestamp(),
  `updated_at`       datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `idx_users_active` (`is_active`),
  KEY `idx_users_role_id` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='시스템 사용자';

-- 초기 관리자 계정 (role_id=1 → roles 테이블의 admin)
INSERT IGNORE INTO `users` (`user_id`, `name`, `email`, `role_id`, `is_active`, `sso_yn`) VALUES
('admin', '관리자', 'admin@kleannara.com', 1, 1, 0);
