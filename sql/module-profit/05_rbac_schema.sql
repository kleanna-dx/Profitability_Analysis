-- ============================================================
-- RBAC (Role-Based Access Control) 메뉴 권한 관리 스키마
-- 서버 시작 시 자동 생성됨 (ensureRbacTables)
-- 이 파일은 참고용 DDL 문서입니다.
-- ============================================================

-- 1) 역할 테이블
CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(30) NOT NULL UNIQUE COMMENT '역할 코드 (예: admin, user, PS 등)',
  role_name VARCHAR(100) NOT NULL COMMENT '역할 표시명',
  description VARCHAR(255) NULL COMMENT '역할 설명',
  sort_order INT DEFAULT 0 COMMENT '정렬순서',
  is_active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_roles_code (role_code),
  INDEX idx_roles_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 역할 테이블';

-- 2) 메뉴 테이블
CREATE TABLE IF NOT EXISTS menus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  menu_code VARCHAR(50) NOT NULL UNIQUE COMMENT '메뉴 코드 (URL path)',
  menu_name VARCHAR(100) NOT NULL COMMENT '메뉴 표시명',
  menu_url VARCHAR(200) NOT NULL COMMENT '메뉴 URL (예: /index.html)',
  icon_class VARCHAR(100) NULL COMMENT 'Font Awesome 아이콘 클래스',
  sort_order INT DEFAULT 0 COMMENT '정렬순서',
  is_active TINYINT DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_menus_code (menu_code),
  INDEX idx_menus_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 메뉴 테이블';

-- 3) 역할-메뉴 매핑 테이블
CREATE TABLE IF NOT EXISTS role_menus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_id INT NOT NULL,
  menu_id INT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role_menu (role_id, menu_id),
  INDEX idx_rm_role (role_id),
  INDEX idx_rm_menu (menu_id),
  CONSTRAINT fk_rm_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  CONSTRAINT fk_rm_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 역할-메뉴 매핑';

-- 4) users 테이블에 role_id 컬럼 추가 (기존 테이블 변경)
ALTER TABLE users ADD COLUMN role_id INT NULL COMMENT 'RBAC 역할 FK' AFTER role;

-- ============================================================
-- 시드 데이터
-- ============================================================

-- 기본 역할
INSERT INTO roles (role_code, role_name, description, sort_order) VALUES
('admin', '관리자', '전체 메뉴 접근 가능한 시스템 관리자', 1),
('user', '일반 사용자', '기본 메뉴만 접근 가능', 2);

-- 기본 메뉴 (사이드바 메뉴 항목)
INSERT INTO menus (menu_code, menu_name, menu_url, icon_class, sort_order) VALUES
('nlq',       '자연어 질의',          '/',               'fas fa-comments',          1),
('builder',   '비주얼 쿼리 빌더',    '/builder.html',   'fas fa-th-large',          2),
('report',    'PPT 분석 장표 생성',   '/report',         'fas fa-file-powerpoint',   3),
('learning',  '학습 관리',            '/learning.html',  'fas fa-graduation-cap',    4),
('admin',     '사용자 관리',          '/admin.html',     'fas fa-users-cog',         5),
('permission','메뉴 권한 관리',       '/permission.html','fas fa-shield-alt',        6),
('batch',     '배치 관리',            '/batch.html',     'fas fa-sync-alt',          7);

-- admin 역할 → 모든 메뉴 접근 가능
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m WHERE r.role_code = 'admin';

-- user 역할 → 기본 메뉴만 접근 가능 (nlq, builder, report)
INSERT INTO role_menus (role_id, menu_id)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m
WHERE r.role_code = 'user' AND m.menu_code IN ('nlq', 'builder', 'report');

-- 기존 사용자 role_id 마이그레이션
UPDATE users u
JOIN roles r ON r.role_code = u.role
SET u.role_id = r.id
WHERE u.role_id IS NULL;
