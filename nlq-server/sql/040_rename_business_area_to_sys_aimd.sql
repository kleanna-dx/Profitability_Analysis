-- ============================================================
-- [2026-07-24] 업무영역 테이블명 변경 (sys_aimd_ prefix 적용)
-- ------------------------------------------------------------
-- 목적:
--   AI 경영의사결정(AIMD) 시스템의 관리용 테이블은 앞으로 모두
--   `sys_aimd_{테이블명}` 명명 규칙을 적용한다. 이번 마이그레이션은
--   PR #280 에서 신규 생성한 업무영역 테이블 2개에 한하여 rename.
--     - business_areas       → sys_aimd_areas
--     - user_business_areas  → sys_aimd_user_areas
--   (기존 RBAC 테이블 roles/menus/users 등은 변경 대상 아님)
--
-- 원칙:
--   - 새 테이블을 중복 생성하지 않고 기존 테이블을 안전하게 RENAME
--   - 기존 데이터, PK, INDEX, AUTO_INCREMENT 값을 그대로 유지
--   - 외래키(FK) 는 DROP → RENAME → 새 이름으로 재생성
--   - 이미 rename 완료된 환경에서도 오류 없이 통과(idempotent)
--
-- 사전 백업 (강력 권장, 운영 반영 전 별도 세션에서 수행):
--   -- 방법 1) mysqldump (구조+데이터)
--   -- mysqldump -u <user> -p <db_name> business_areas user_business_areas \
--   --   > backup_business_area_20260724.sql
--   --
--   -- 방법 2) CREATE TABLE ... AS SELECT (같은 DB 내 스냅샷)
--   -- CREATE TABLE `_bak_business_areas_20260724`      AS SELECT * FROM `business_areas`;
--   -- CREATE TABLE `_bak_user_business_areas_20260724` AS SELECT * FROM `user_business_areas`;
--
-- 롤백:
--   본 파일 하단의 "롤백 SQL" 섹션 참조. 반드시 백업이 존재하는 상태에서만 실행.
--
-- 실행 순서:
--   1) 옛 이름 존재 & 새 이름 부재 확인
--   2) 자식 테이블(user_business_areas)의 FK 를 동적으로 DROP
--   3) RENAME TABLE (부모/자식 원자적 처리)
--   4) 새 이름으로 FK 재생성
--   5) (선택) 검증용 SELECT
-- ============================================================


-- ------------------------------------------------------------
-- [Step 1] 자식 테이블 FK DROP
--   FK 이름은 환경마다 자동 생성될 수 있으므로 information_schema 로
--   실제 이름을 조회하여 동적으로 DROP 한다.
--   이미 rename 완료된 환경(자식 테이블 자체가 없음)에서는 skip.
-- ------------------------------------------------------------
SET @has_old_child := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_business_areas'
);
SET @has_new_child := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_user_areas'
);

-- rename 대상 여부(옛 이름이 있고, 새 이름은 없을 때)
SET @should_rename := (@has_old_child = 1 AND @has_new_child = 0);

-- 자식 FK 이름 조회 (있을 때만)
SET @fk_user_name := (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_business_areas'
     AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     AND CONSTRAINT_NAME LIKE '%user%'
   LIMIT 1
);
SET @fk_area_name := (
  SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'user_business_areas'
     AND CONSTRAINT_TYPE = 'FOREIGN KEY'
     AND CONSTRAINT_NAME LIKE '%area%'
   LIMIT 1
);

-- FK(사용자) DROP
SET @sql := IF(
  @should_rename = 1 AND @fk_user_name IS NOT NULL,
  CONCAT('ALTER TABLE `user_business_areas` DROP FOREIGN KEY `', @fk_user_name, '`'),
  'SELECT ''skip drop fk_user''' 
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- FK(area) DROP
SET @sql := IF(
  @should_rename = 1 AND @fk_area_name IS NOT NULL,
  CONCAT('ALTER TABLE `user_business_areas` DROP FOREIGN KEY `', @fk_area_name, '`'),
  'SELECT ''skip drop fk_area''' 
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ------------------------------------------------------------
-- [Step 2] RENAME TABLE (부모/자식 원자적)
--   - 옛 이름과 새 이름 상태에 따라 4가지 케이스를 모두 안전하게 처리
--     (a) 둘 다 옛 이름       → 두 테이블 동시 rename
--     (b) 부모만 옛 이름       → 부모만 rename
--     (c) 자식만 옛 이름       → 자식만 rename
--     (d) 둘 다 새 이름       → skip
-- ------------------------------------------------------------
SET @has_old_parent := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_areas'
);
SET @has_new_parent := (
  SELECT COUNT(*) FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_areas'
);

-- (a) 부모/자식 동시 rename
SET @sql := IF(
  (@has_old_parent = 1 AND @has_new_parent = 0
   AND @has_old_child  = 1 AND @has_new_child  = 0),
  'RENAME TABLE `business_areas` TO `sys_aimd_areas`, `user_business_areas` TO `sys_aimd_user_areas`',
  'SELECT ''skip rename both'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- (b) 부모만 rename (자식은 이미 새 이름이거나 없음)
SET @sql := IF(
  (@has_old_parent = 1 AND @has_new_parent = 0
   AND NOT (@has_old_child = 1 AND @has_new_child = 0)),
  'RENAME TABLE `business_areas` TO `sys_aimd_areas`',
  'SELECT ''skip rename parent only'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- (c) 자식만 rename (부모는 이미 새 이름이거나 없음)
SET @sql := IF(
  (@has_old_child = 1 AND @has_new_child = 0
   AND NOT (@has_old_parent = 1 AND @has_new_parent = 0)),
  'RENAME TABLE `user_business_areas` TO `sys_aimd_user_areas`',
  'SELECT ''skip rename child only'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ------------------------------------------------------------
-- [Step 3] FK 재생성 (새 이름 기준)
--   - 이미 같은 이름의 FK 가 있으면 skip (idempotent)
-- ------------------------------------------------------------
SET @has_fk_user := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_user_areas'
     AND CONSTRAINT_NAME = 'fk_sys_aimd_ua_user'
);
SET @has_fk_area := (
  SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_user_areas'
     AND CONSTRAINT_NAME = 'fk_sys_aimd_ua_area'
);

SET @sql := IF(
  @has_fk_user = 0,
  'ALTER TABLE `sys_aimd_user_areas` ADD CONSTRAINT `fk_sys_aimd_ua_user` FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE',
  'SELECT ''skip add fk_sys_aimd_ua_user'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @has_fk_area = 0,
  'ALTER TABLE `sys_aimd_user_areas` ADD CONSTRAINT `fk_sys_aimd_ua_area` FOREIGN KEY (`area_code`) REFERENCES `sys_aimd_areas`(`area_code`) ON DELETE CASCADE ON UPDATE CASCADE',
  'SELECT ''skip add fk_sys_aimd_ua_area'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ------------------------------------------------------------
-- [Step 4] 인덱스 이름 정비 (선택 — 이름만 새 컨벤션에 맞춤)
--   기존 CREATE 시점의 인덱스 이름이 idx_business_areas_* / idx_uba_* 라면
--   새 컨벤션(idx_sys_aimd_*)에 맞춰 rename 한다. 데이터/컬럼은 변경 없음.
--   존재 여부에 따라 idempotent 처리.
-- ------------------------------------------------------------
SET @old_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_areas'
     AND INDEX_NAME = 'idx_business_areas_code'
);
SET @new_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_areas'
     AND INDEX_NAME = 'idx_sys_aimd_areas_code'
);
SET @sql := IF(
  @old_idx > 0 AND @new_idx = 0,
  'ALTER TABLE `sys_aimd_areas` RENAME INDEX `idx_business_areas_code` TO `idx_sys_aimd_areas_code`',
  'SELECT ''skip rename idx code'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @old_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_areas'
     AND INDEX_NAME = 'idx_business_areas_active'
);
SET @new_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_areas'
     AND INDEX_NAME = 'idx_sys_aimd_areas_active'
);
SET @sql := IF(
  @old_idx > 0 AND @new_idx = 0,
  'ALTER TABLE `sys_aimd_areas` RENAME INDEX `idx_business_areas_active` TO `idx_sys_aimd_areas_active`',
  'SELECT ''skip rename idx active'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @old_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_user_areas'
     AND INDEX_NAME = 'idx_uba_user'
);
SET @new_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_user_areas'
     AND INDEX_NAME = 'idx_sys_aimd_ua_user'
);
SET @sql := IF(
  @old_idx > 0 AND @new_idx = 0,
  'ALTER TABLE `sys_aimd_user_areas` RENAME INDEX `idx_uba_user` TO `idx_sys_aimd_ua_user`',
  'SELECT ''skip rename idx ua_user'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @old_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_user_areas'
     AND INDEX_NAME = 'idx_uba_area'
);
SET @new_idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'sys_aimd_user_areas'
     AND INDEX_NAME = 'idx_sys_aimd_ua_area'
);
SET @sql := IF(
  @old_idx > 0 AND @new_idx = 0,
  'ALTER TABLE `sys_aimd_user_areas` RENAME INDEX `idx_uba_area` TO `idx_sys_aimd_ua_area`',
  'SELECT ''skip rename idx ua_area'''
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- ------------------------------------------------------------
-- [Step 5] 검증용 조회 (배포 후 수동 확인)
--   운영 반영 후 아래 SELECT 로 결과를 확인하십시오.
-- ------------------------------------------------------------
-- SELECT TABLE_NAME FROM information_schema.TABLES
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME IN ('sys_aimd_areas', 'sys_aimd_user_areas',
--                       'business_areas', 'user_business_areas');
-- -- 기대: sys_aimd_areas, sys_aimd_user_areas 2행만 존재
--
-- SELECT CONSTRAINT_NAME, TABLE_NAME
--   FROM information_schema.TABLE_CONSTRAINTS
--  WHERE TABLE_SCHEMA = DATABASE()
--    AND TABLE_NAME = 'sys_aimd_user_areas'
--    AND CONSTRAINT_TYPE = 'FOREIGN KEY';
-- -- 기대: fk_sys_aimd_ua_user, fk_sys_aimd_ua_area
--
-- SELECT area_code, area_name, is_active FROM sys_aimd_areas ORDER BY sort_order;
-- -- 기대: PROFITABILITY, MANUFACTURING_COST 최소 2행
--
-- SELECT COUNT(*) AS mapping_count FROM sys_aimd_user_areas;
-- -- 기대: 최소 admin 1건 이상 (기존 데이터 유지)


-- ============================================================
-- 롤백 SQL (문제 발생 시에만 수동 실행 — 반드시 백업 존재 상태에서)
-- ------------------------------------------------------------
-- -- 1) 새 이름 FK DROP
-- ALTER TABLE `sys_aimd_user_areas` DROP FOREIGN KEY `fk_sys_aimd_ua_user`;
-- ALTER TABLE `sys_aimd_user_areas` DROP FOREIGN KEY `fk_sys_aimd_ua_area`;
--
-- -- 2) 이름 되돌리기
-- RENAME TABLE `sys_aimd_areas`      TO `business_areas`,
--              `sys_aimd_user_areas` TO `user_business_areas`;
--
-- -- 3) 옛 이름으로 FK 재생성 (039_create_business_area_tables.sql 원본 이름 기준)
-- ALTER TABLE `user_business_areas`
--   ADD CONSTRAINT `fk_uba_user`
--     FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
--   ADD CONSTRAINT `fk_uba_area`
--     FOREIGN KEY (`area_code`) REFERENCES `business_areas`(`area_code`)
--     ON DELETE CASCADE ON UPDATE CASCADE;
--
-- -- 4) 인덱스 이름 되돌리기 (필요 시)
-- ALTER TABLE `business_areas`      RENAME INDEX `idx_sys_aimd_areas_code`   TO `idx_business_areas_code`;
-- ALTER TABLE `business_areas`      RENAME INDEX `idx_sys_aimd_areas_active` TO `idx_business_areas_active`;
-- ALTER TABLE `user_business_areas` RENAME INDEX `idx_sys_aimd_ua_user`      TO `idx_uba_user`;
-- ALTER TABLE `user_business_areas` RENAME INDEX `idx_sys_aimd_ua_area`      TO `idx_uba_area`;
-- ============================================================
