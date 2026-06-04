-- =====================================================================
-- 019_add_interface_management.sql
--   1) batch_jobs.interface_id 컬럼 추가 (기존 데이터 보존)
--   2) [인터페이스 관리] 메뉴 등록
--   3) role_menus 매핑 (admin만)
-- =====================================================================

-- 1) batch_jobs 에 interface_id 컬럼 추가 (없을 때만)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'batch_jobs'
     AND COLUMN_NAME = 'interface_id'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE batch_jobs ADD COLUMN interface_id VARCHAR(50) NULL COMMENT ''인터페이스 ID (batch_master)'' AFTER job_type, ADD KEY idx_batch_jobs_interface (interface_id)',
  'SELECT ''column interface_id already exists'' AS msg'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) [인터페이스 관리] 메뉴 등록
INSERT INTO menus (menu_code, menu_name, menu_url, icon_class, sort_order, is_active)
VALUES ('interface', '인터페이스 관리', '/interface.html', 'fas fa-exchange-alt', 7, 1)
ON DUPLICATE KEY UPDATE
  menu_name = VALUES(menu_name),
  menu_url = VALUES(menu_url),
  icon_class = VALUES(icon_class),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

-- 3) role_menus: admin(role_id=1) 만 매핑
INSERT INTO role_menus (role_id, menu_id)
SELECT 1, m.id
  FROM menus m
 WHERE m.menu_code = 'interface'
   AND NOT EXISTS (
     SELECT 1 FROM role_menus rm
      WHERE rm.role_id = 1 AND rm.menu_id = m.id
   );
