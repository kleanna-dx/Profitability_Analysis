-- ============================================================
-- users.role 레거시 컬럼 → role_id (RBAC) 마이그레이션
-- 
-- 실행 조건: 009_create_rbac_tables.sql 실행 후
-- 실행 순서: 반드시 아래 순서대로 실행
-- ============================================================

-- -------------------------------------------------------
-- Step 1: users 테이블에 role_id 컬럼 추가 (없으면)
-- -------------------------------------------------------
-- role_id 컬럼이 이미 존재하면 무시됨 (에러 발생 시 무시하고 진행)
ALTER TABLE `users` ADD COLUMN `role_id` INT NULL COMMENT 'RBAC 역할 FK' AFTER `position`;
-- ※ 이미 존재하면 "Duplicate column name 'role_id'" 에러 → 무시하고 진행

-- -------------------------------------------------------
-- Step 2: 기존 role 값 → role_id 매핑
-- -------------------------------------------------------
-- role='admin' → roles.role_code='admin' → role_id 매핑
UPDATE `users` u
  JOIN `roles` r ON r.role_code = u.role
SET u.role_id = r.id
WHERE u.role_id IS NULL AND u.role IS NOT NULL;

-- -------------------------------------------------------
-- Step 3: 그래도 role_id가 NULL인 사용자 → 'user' 역할 강제 배정
-- (role 값이 roles 테이블에 없는 레거시 데이터, 예: 'viewer')
-- -------------------------------------------------------
UPDATE `users`
SET role_id = (SELECT id FROM `roles` WHERE role_code = 'user' LIMIT 1)
WHERE role_id IS NULL;

-- -------------------------------------------------------
-- Step 4: 확인 — role_id NULL인 사용자가 없어야 함
-- -------------------------------------------------------
SELECT user_id, role_id, 
  (SELECT role_code FROM roles WHERE id = users.role_id) AS mapped_role
FROM `users`
ORDER BY id;

-- -------------------------------------------------------
-- Step 5: role 컬럼 삭제
-- -------------------------------------------------------
-- ※ 위 확인 결과에 문제가 없을 때만 실행!
ALTER TABLE `users` DROP COLUMN `role`;

-- -------------------------------------------------------
-- Step 6: role 컬럼의 기존 인덱스 제거 (있으면)
-- -------------------------------------------------------
-- idx_users_role 인덱스가 있었다면 role 컬럼 DROP 시 자동 제거됨
-- 수동으로 확인:
-- SHOW INDEX FROM users WHERE Key_name = 'idx_users_role';

-- ============================================================
-- 완료 후 최종 users 테이블 구조 확인
-- ============================================================
DESCRIBE `users`;
