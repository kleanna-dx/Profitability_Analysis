-- ============================================================
-- 사용자 테이블
-- 로그인 인증 및 사용자 관리
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
  `id`               int(11)      NOT NULL AUTO_INCREMENT,
  `user_id`          varchar(50)  NOT NULL           COMMENT '로그인 아이디 (SSO sproId와 동일)',
  `password`         varchar(255) DEFAULT NULL        COMMENT '비밀번호 (bcrypt 해시, SSO 유저는 NULL 가능)',
  `name`             varchar(100) NOT NULL            COMMENT '사용자 이름',
  `email`            varchar(150) DEFAULT NULL        COMMENT '이메일',
  `group_name`       varchar(100) DEFAULT NULL        COMMENT '부서(그룹) 이름',
  `group_id`         varchar(20)  DEFAULT NULL        COMMENT '그룹 ID',
  `parent_group_id`  varchar(20)  DEFAULT NULL        COMMENT '상위 그룹 ID',
  `tenant_id`        varchar(20)  DEFAULT NULL        COMMENT '테넌트 ID',
  `phone`            varchar(20)  DEFAULT NULL        COMMENT '연락처',
  `position`         varchar(50)  DEFAULT NULL        COMMENT '직급',
  `role`             enum('admin','user','viewer') NOT NULL DEFAULT 'user' COMMENT '권한',
  `is_active`        tinyint(4)   NOT NULL DEFAULT 1  COMMENT '활성 여부 (1=활성, 0=비활성)',
  `sso_yn`           tinyint(4)   NOT NULL DEFAULT 0  COMMENT 'SSO 연동 여부 (1=SSO, 0=일반)',
  `created_at`       datetime     DEFAULT current_timestamp(),
  `updated_at`       datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`),
  KEY `idx_users_active` (`is_active`),
  KEY `idx_users_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='시스템 사용자';

-- 초기 관리자 계정
INSERT IGNORE INTO `users` (`user_id`, `name`, `email`, `role`, `is_active`, `sso_yn`) VALUES
('admin', '관리자', 'admin@kleannara.com', 'admin', 1, 0);
