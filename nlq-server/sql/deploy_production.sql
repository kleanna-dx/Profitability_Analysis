-- ============================================================
-- 운영 배포 SQL (PR #40~#42 변경사항)
-- 생성일: 2026-05-28
-- 대상 DB: company_board (운영 10.2.14.247:3306)
-- ============================================================
--
-- PR #40~#42에서 추가/변경된 DB 스키마만 포함합니다.
-- (domain_master, domain_group_mapping, batch_jobs 등 기존 테이블은 미포함)
--
-- 변경 내용:
--   1. RBAC 신규 테이블 3개 생성 (roles, menus, role_menus)
--   2. RBAC 시드 데이터 (역할 2개, 메뉴 6개, 매핑)
--   3. users 테이블: role_id 컬럼 추가
--   4. users.role → role_id 데이터 마이그레이션
--   5. users.role 레거시 컬럼 삭제
--
-- ※ 실행 전 반드시 백업!
--   mysqldump -u [user] -p company_board users > users_backup_20260528.sql
--
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. RBAC 테이블 생성
-- ────────────────────────────────────────────────────────────

-- 1-1) 역할 테이블
CREATE TABLE IF NOT EXISTS `roles` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `role_code`   VARCHAR(30)  NOT NULL UNIQUE  COMMENT '역할 코드 (예: admin, user)',
  `role_name`   VARCHAR(100) NOT NULL         COMMENT '역할 표시명',
  `description` VARCHAR(255) DEFAULT NULL     COMMENT '역할 설명',
  `sort_order`  INT          DEFAULT 0        COMMENT '정렬순서',
  `is_active`   TINYINT      DEFAULT 1,
  `created_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_roles_code` (`role_code`),
  INDEX `idx_roles_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 역할 테이블';

-- 1-2) 메뉴 테이블
CREATE TABLE IF NOT EXISTS `menus` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `menu_code`   VARCHAR(50)  NOT NULL UNIQUE  COMMENT '메뉴 코드',
  `menu_name`   VARCHAR(100) NOT NULL         COMMENT '메뉴 표시명',
  `menu_url`    VARCHAR(200) NOT NULL         COMMENT '메뉴 URL',
  `icon_class`  VARCHAR(100) DEFAULT NULL     COMMENT 'Font Awesome 아이콘 클래스',
  `sort_order`  INT          DEFAULT 0        COMMENT '정렬순서',
  `is_active`   TINYINT      DEFAULT 1,
  `created_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_menus_code` (`menu_code`),
  INDEX `idx_menus_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 메뉴 테이블';

-- 1-3) 역할-메뉴 매핑 테이블
CREATE TABLE IF NOT EXISTS `role_menus` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `role_id`     INT NOT NULL,
  `menu_id`     INT NOT NULL,
  `created_at`  DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_menu` (`role_id`, `menu_id`),
  INDEX `idx_rm_role` (`role_id`),
  INDEX `idx_rm_menu` (`menu_id`),
  CONSTRAINT `fk_rm_role` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_rm_menu` FOREIGN KEY (`menu_id`) REFERENCES `menus` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 역할-메뉴 매핑';


-- ────────────────────────────────────────────────────────────
-- 2. RBAC 시드 데이터
-- ────────────────────────────────────────────────────────────

-- 기본 역할
INSERT IGNORE INTO `roles` (`role_code`, `role_name`, `description`, `sort_order`) VALUES
  ('admin', '관리자',      '전체 메뉴 접근 가능한 시스템 관리자', 1),
  ('user',  '일반 사용자', '기본 메뉴만 접근 가능',              2);

-- 메뉴
INSERT IGNORE INTO `menus` (`menu_code`, `menu_name`, `menu_url`, `icon_class`, `sort_order`) VALUES
  ('nlq',        '자연어 질의',        '/',               'fas fa-comments',        1),
  ('builder',    '비주얼 쿼리 빌더',  '/builder.html',   'fas fa-th-large',        2),
  ('report',     'PPT 분석 장표 생성', '/report',         'fas fa-file-powerpoint', 3),
  ('learning',   '학습 관리',          '/learning.html',  'fas fa-graduation-cap',  4),
  ('permission', '권한 관리',         '/permission.html','fas fa-shield-alt',      5),
  ('batch',      '배치 관리',          '/batch.html',     'fas fa-sync-alt',        6);

-- admin → 모든 메뉴
INSERT IGNORE INTO `role_menus` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m WHERE r.role_code = 'admin';

-- user → 기본 메뉴만 (nlq, builder, report)
INSERT IGNORE INTO `role_menus` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m
WHERE r.role_code = 'user' AND m.menu_code IN ('nlq', 'builder', 'report');


-- ────────────────────────────────────────────────────────────
-- 3. users 테이블 변경: role_id 컬럼 추가
-- ────────────────────────────────────────────────────────────
-- ※ "Duplicate column name" 에러 시 이미 존재 → 무시하고 다음 진행

ALTER TABLE `users` ADD COLUMN `role_id` INT NULL COMMENT 'RBAC 역할 FK' AFTER `position`;


-- ────────────────────────────────────────────────────────────
-- 4. users.role → role_id 데이터 마이그레이션
-- ────────────────────────────────────────────────────────────

-- 4-1) role='admin' → role_id=1, role='user' → role_id=2 매핑
UPDATE `users` u
  JOIN `roles` r ON r.role_code = u.role
SET u.role_id = r.id
WHERE u.role_id IS NULL AND u.role IS NOT NULL;

-- 4-2) 나머지 (role='viewer' 등 레거시) → 'user' 역할 강제 배정
UPDATE `users`
SET role_id = (SELECT id FROM `roles` WHERE role_code = 'user' LIMIT 1)
WHERE role_id IS NULL;

-- 4-3) ★ 확인 ★ role_id가 NULL인 행이 없어야 합니다!
SELECT user_id, role_id,
  (SELECT role_code FROM roles WHERE id = users.role_id) AS mapped_role
FROM `users`
ORDER BY id;


-- ────────────────────────────────────────────────────────────
-- 5. users.role 레거시 컬럼 삭제
-- ※ 위 4-3 확인 후 실행!
-- ────────────────────────────────────────────────────────────

ALTER TABLE `users` DROP COLUMN `role`;


-- ────────────────────────────────────────────────────────────
-- 6. 최종 확인
-- ────────────────────────────────────────────────────────────

DESCRIBE `users`;

SELECT u.user_id, u.name, u.role_id, r.role_code, r.role_name, u.domain_code, u.is_active
FROM users u LEFT JOIN roles r ON r.id = u.role_id
ORDER BY u.id;
