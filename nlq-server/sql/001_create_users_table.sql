-- ============================================================
-- users 테이블 생성
-- 로그인 인증 및 사용자 관리용 테이블
-- ============================================================

CREATE TABLE IF NOT EXISTS `users` (
    `id`               INT AUTO_INCREMENT PRIMARY KEY COMMENT '자동 증가 PK',
    `user_id`          VARCHAR(50)  NOT NULL UNIQUE    COMMENT '사용자 로그인 ID',
    `name`             VARCHAR(100) NOT NULL           COMMENT '사용자 이름',
    `email`            VARCHAR(200) NULL               COMMENT '이메일',
    `group_name`       VARCHAR(100) NULL               COMMENT '그룹(부서)명',
    `group_id`         VARCHAR(20)  NULL               COMMENT '그룹 ID',
    `parent_group_id`  VARCHAR(20)  NULL               COMMENT '상위 그룹 ID',
    `tenant_id`        VARCHAR(20)  NULL               COMMENT '테넌트 ID',
    `phone`            VARCHAR(30)  NULL               COMMENT '전화번호',
    `position`         VARCHAR(50)  NULL               COMMENT '직급/직책',
    `role`             VARCHAR(20)  NOT NULL DEFAULT 'user' COMMENT '역할 (admin/user)',
    `is_active`        TINYINT(1)   NOT NULL DEFAULT 1 COMMENT '활성 상태 (1=활성, 0=비활성)',
    `sso_yn`           TINYINT(1)   NOT NULL DEFAULT 1 COMMENT 'SSO 사용 여부 (1=사용)',
    `created_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',
    `updated_at`       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '수정일시'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='사용자 정보';

-- 초기 관리자/테스트 사용자
INSERT IGNORE INTO `users` (`user_id`, `name`, `email`, `role`, `is_active`, `sso_yn`) VALUES
('admin', '관리자', 'admin@kleannara.com', 'admin', 1, 0);
