-- ============================================================
-- RBAC (Role-Based Access Control) 테이블
-- 역할, 메뉴, 역할-메뉴 매핑 테이블 생성 + 시드 데이터
-- ============================================================

-- 1) 역할 테이블
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

-- 2) 메뉴 테이블
CREATE TABLE IF NOT EXISTS `menus` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `menu_code`   VARCHAR(50)  NOT NULL UNIQUE  COMMENT '메뉴 코드',
  `menu_name`   VARCHAR(100) NOT NULL         COMMENT '메뉴 표시명',
  `menu_url`    VARCHAR(200) NOT NULL         COMMENT '메뉴 URL (예: /index.html)',
  `icon_class`  VARCHAR(100) DEFAULT NULL     COMMENT 'Font Awesome 아이콘 클래스',
  `sort_order`  INT          DEFAULT 0        COMMENT '정렬순서',
  `is_active`   TINYINT      DEFAULT 1,
  `created_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_menus_code` (`menu_code`),
  INDEX `idx_menus_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 메뉴 테이블';

-- 3) 역할-메뉴 매핑 테이블
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

-- ============================================================
-- 시드 데이터
-- ============================================================

-- 기본 역할
INSERT IGNORE INTO `roles` (`role_code`, `role_name`, `description`, `sort_order`) VALUES
  ('admin', '관리자',     '전체 메뉴 접근 가능한 시스템 관리자', 1),
  ('user',  '일반 사용자', '기본 메뉴만 접근 가능',            2);

-- 기본 메뉴
INSERT IGNORE INTO `menus` (`menu_code`, `menu_name`, `menu_url`, `icon_class`, `sort_order`) VALUES
  ('nlq',        '자연어 질의',         '/',               'fas fa-comments',        1),
  ('builder',    '비주얼 쿼리 빌더',   '/builder.html',   'fas fa-th-large',        2),
  ('report',     'PPT 분석 장표 생성',  '/report',         'fas fa-file-powerpoint', 3),
  ('learning',   '학습 관리',           '/learning.html',  'fas fa-graduation-cap',  4),
  ('permission', '권한 관리',          '/permission.html','fas fa-shield-alt',      5),
  ('batch',      '배치 관리',           '/batch.html',     'fas fa-sync-alt',        6);

-- admin → 모든 메뉴
INSERT IGNORE INTO `role_menus` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m WHERE r.role_code = 'admin';

-- user → 기본 메뉴만 (nlq, builder, report)
INSERT IGNORE INTO `role_menus` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m
WHERE r.role_code = 'user' AND m.menu_code IN ('nlq', 'builder', 'report');
