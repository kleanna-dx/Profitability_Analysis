-- ============================================================
-- 운영 배포용 통합 SQL
-- 생성일: 2026-05-28
-- 대상 DB: company_board (운영 10.2.14.247:3306)
-- ============================================================
-- 
-- 이 스크립트는 아래 변경사항을 한 번에 적용합니다:
--   1. 도메인(영역) 테이블 생성 + 시드
--   2. 배치 작업 이력 테이블 생성
--   3. RBAC 테이블(roles, menus, role_menus) 생성 + 시드
--   4. users 테이블 변경: role_id 컬럼 추가, domain_code 컬럼 추가
--   5. users.role → role_id 데이터 마이그레이션
--   6. users.role 레거시 컬럼 삭제
--
-- ※ 실행 전 반드시 백업하세요!
--   mysqldump -u [user] -p company_board users > users_backup.sql
--
-- ※ 순서대로 실행하세요. 중간에 실패하면 해당 단계부터 재실행 가능합니다.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. 도메인(영역) 마스터 테이블
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `domain_master` (
  `domain_code`  varchar(20)  NOT NULL       COMMENT '영역 코드 (PS, HL, MGMT)',
  `domain_name`  varchar(100) NOT NULL       COMMENT '영역 이름',
  `sort_order`   int(11)      DEFAULT 0      COMMENT '정렬 순서',
  `is_active`    tinyint(1)   DEFAULT 1      COMMENT '활성 여부',
  `created_at`   datetime     DEFAULT current_timestamp(),
  `updated_at`   datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`domain_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='수익성분석 영역(도메인) 마스터';

INSERT IGNORE INTO `domain_master` (`domain_code`, `domain_name`, `sort_order`) VALUES
  ('PS',   'PS',              1),
  ('HL',   'HL',              2),
  ('MGMT', '경영기획·임원진', 3);

-- 도메인-조직 그룹 매핑 테이블
CREATE TABLE IF NOT EXISTS `domain_group_mapping` (
  `id`           int(11)      NOT NULL AUTO_INCREMENT,
  `domain_code`  varchar(20)  NOT NULL       COMMENT '영역 코드',
  `group_id`     varchar(20)  NOT NULL       COMMENT '조직도 최상위 그룹 ID (사업부급)',
  `group_name`   varchar(100) DEFAULT NULL   COMMENT '그룹명 (참고용)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_domain_group` (`domain_code`, `group_id`),
  CONSTRAINT `fk_dgm_domain` FOREIGN KEY (`domain_code`) REFERENCES `domain_master`(`domain_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='도메인-조직 그룹 매핑';

INSERT IGNORE INTO `domain_group_mapping` (`domain_code`, `group_id`, `group_name`) VALUES
  ('PS',   'D0100000', '페이퍼솔루션사업부'),
  ('HL',   'D0200132', '홈앤라이프사업부'),
  ('MGMT', 'D0400900', '경영기획실'),
  ('MGMT', 'D2013147', 'CEO'),
  ('MGMT', 'D2013135', 'COO');


-- ────────────────────────────────────────────────────────────
-- 2. 배치 작업 이력 테이블
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS `batch_jobs` (
  `id`             int(11)      NOT NULL AUTO_INCREMENT,
  `job_type`       varchar(50)  NOT NULL DEFAULT 'SAP_RFC_SYNC' COMMENT '작업유형',
  `cmonth`         varchar(6)   NOT NULL      COMMENT '입력년월 (YYYYMM)',
  `mode`           varchar(20)  NOT NULL DEFAULT 'replace' COMMENT '실행모드: replace/append/dry-run',
  `status`         enum('pending','running','success','failed','cancelled') NOT NULL DEFAULT 'pending',
  `started_at`     datetime     DEFAULT NULL,
  `finished_at`    datetime     DEFAULT NULL,
  `total_rows`     int(11)      DEFAULT 0     COMMENT 'T_DATA 수신 행 수',
  `inserted_rows`  int(11)      DEFAULT 0     COMMENT 'DB INSERT 행 수',
  `deleted_rows`   int(11)      DEFAULT 0     COMMENT 'DELETE한 기존 행 수',
  `error_message`  text         DEFAULT NULL,
  `log_text`       longtext     DEFAULT NULL  COMMENT '실행 로그',
  `created_by`     varchar(50)  DEFAULT NULL  COMMENT '실행자 ID',
  `created_at`     datetime     DEFAULT current_timestamp(),
  `updated_at`     datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_batch_status` (`status`),
  KEY `idx_batch_cmonth` (`cmonth`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='배치 작업 이력';


-- ────────────────────────────────────────────────────────────
-- 3. RBAC 테이블 생성 + 시드 데이터
-- ────────────────────────────────────────────────────────────

-- 3-1) 역할 테이블
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

-- 3-2) 메뉴 테이블
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

-- 3-3) 역할-메뉴 매핑 테이블
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

-- 3-4) 시드 데이터: 기본 역할
INSERT IGNORE INTO `roles` (`role_code`, `role_name`, `description`, `sort_order`) VALUES
  ('admin', '관리자',     '전체 메뉴 접근 가능한 시스템 관리자', 1),
  ('user',  '일반 사용자', '기본 메뉴만 접근 가능',            2);

-- 3-5) 시드 데이터: 메뉴
INSERT IGNORE INTO `menus` (`menu_code`, `menu_name`, `menu_url`, `icon_class`, `sort_order`) VALUES
  ('nlq',        '자연어 질의',         '/',               'fas fa-comments',        1),
  ('builder',    '비주얼 쿼리 빌더',   '/builder.html',   'fas fa-th-large',        2),
  ('report',     'PPT 분석 장표 생성',  '/report',         'fas fa-file-powerpoint', 3),
  ('learning',   '학습 관리',           '/learning.html',  'fas fa-graduation-cap',  4),
  ('permission', '권한 관리',          '/permission.html','fas fa-shield-alt',      5),
  ('batch',      '배치 관리',           '/batch.html',     'fas fa-sync-alt',        6);

-- 3-6) 시드 데이터: admin → 모든 메뉴
INSERT IGNORE INTO `role_menus` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m WHERE r.role_code = 'admin';

-- 3-7) 시드 데이터: user → 기본 메뉴만 (nlq, builder, report)
INSERT IGNORE INTO `role_menus` (`role_id`, `menu_id`)
SELECT r.id, m.id FROM roles r CROSS JOIN menus m
WHERE r.role_code = 'user' AND m.menu_code IN ('nlq', 'builder', 'report');


-- ────────────────────────────────────────────────────────────
-- 4. users 테이블 변경: 컬럼 추가
-- ────────────────────────────────────────────────────────────

-- 4-1) role_id 컬럼 추가 (이미 있으면 에러 → 무시하고 진행)
ALTER TABLE `users` ADD COLUMN `role_id` INT NULL COMMENT 'RBAC 역할 FK' AFTER `position`;
-- ※ "Duplicate column name 'role_id'" 에러 시 이미 존재 → 다음으로 진행

-- 4-2) domain_code 컬럼 추가 (이미 있으면 에러 → 무시하고 진행)
ALTER TABLE `users` ADD COLUMN `domain_code` VARCHAR(20) DEFAULT NULL COMMENT '영역 코드 (PS, HL, MGMT, NULL=전체)' AFTER `role_id`;
-- ※ "Duplicate column name 'domain_code'" 에러 시 이미 존재 → 다음으로 진행


-- ────────────────────────────────────────────────────────────
-- 5. users.role → role_id 데이터 마이그레이션
-- ────────────────────────────────────────────────────────────

-- 5-1) role 값이 roles.role_code와 매칭되는 사용자 매핑
UPDATE `users` u
  JOIN `roles` r ON r.role_code = u.role
SET u.role_id = r.id
WHERE u.role_id IS NULL AND u.role IS NOT NULL;

-- 5-2) 그래도 role_id NULL인 사용자 (role='viewer' 등 레거시) → 'user' 강제 배정
UPDATE `users`
SET role_id = (SELECT id FROM `roles` WHERE role_code = 'user' LIMIT 1)
WHERE role_id IS NULL;

-- 5-3) 확인: 모든 사용자의 role_id가 매핑되었는지 검증
-- ※ 이 결과에서 role_id가 NULL인 행이 없어야 합니다!
SELECT user_id, role_id,
  (SELECT role_code FROM roles WHERE id = users.role_id) AS mapped_role
FROM `users`
ORDER BY id;


-- ────────────────────────────────────────────────────────────
-- 6. users.role 레거시 컬럼 삭제
-- ※ 위 5-3 확인 결과에 문제가 없을 때만 실행!
-- ────────────────────────────────────────────────────────────

ALTER TABLE `users` DROP COLUMN `role`;


-- ────────────────────────────────────────────────────────────
-- 7. 최종 확인
-- ────────────────────────────────────────────────────────────

-- users 테이블 구조 확인 (role 컬럼 없어야 함, role_id/domain_code 있어야 함)
DESCRIBE `users`;

-- 전체 사용자 역할 매핑 확인
SELECT u.user_id, u.name, u.role_id, r.role_code, r.role_name, u.domain_code, u.is_active
FROM users u
LEFT JOIN roles r ON r.id = u.role_id
ORDER BY u.id;
