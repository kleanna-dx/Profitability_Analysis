-- ============================================================
-- [2026-07-24] 업무영역 권한 (Business Area Access Control)
-- ------------------------------------------------------------
-- 목적:
--   기존 users.domain_code (학습관리 도메인: PS/HL/MGMT) 및
--   RBAC 역할(admin/user)과는 완전히 별개인 "업무영역 접근 권한"을 도입.
--   업무영역: PROFITABILITY(수익성분석) / MANUFACTURING_COST(제조원가)
--   다중값 허용 (사용자별로 1개 이상의 업무영역 부여 가능).
--   화면·URL·API·데이터 접근을 모두 제어하는 실제 접근 권한.
--
-- 의존:
--   - users 테이블이 이미 존재해야 함 (002_create_users.sql)
--
-- 실행 순서:
--   1) business_areas 마스터 테이블 생성
--   2) user_business_areas 매핑 테이블 생성
--   3) 시드 데이터 (PROFITABILITY, MANUFACTURING_COST)
--   4) 마이그레이션: 매핑 없는 모든 기존 사용자에게 PROFITABILITY 기본 부여
--
-- 멱등성:
--   모든 CREATE / INSERT 문이 IF NOT EXISTS / INSERT IGNORE 사용.
--   운영에 반복 실행해도 안전 (기존 데이터 보존).
--
-- admin 처리:
--   admin 사용자는 이 테이블에 매핑을 저장하지 않음.
--   서버 헬퍼(getUserBusinessAreas)가 admin 을 감지하면
--   business_areas WHERE is_active=1 을 동적으로 조회하여
--   활성 area 전체를 반환함 (하드코딩 없음).
--   → 향후 새 area_code 를 추가하면 admin 은 자동으로 전체 접근 가능.
-- ============================================================

-- ------------------------------------------------------------
-- 1) 업무영역 마스터 테이블
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `business_areas` (
  `id`          INT          NOT NULL AUTO_INCREMENT,
  `area_code`   VARCHAR(32)  NOT NULL UNIQUE  COMMENT '업무영역 코드 (예: PROFITABILITY, MANUFACTURING_COST)',
  `area_name`   VARCHAR(64)  NOT NULL         COMMENT '업무영역 표시명',
  `description` VARCHAR(255) DEFAULT NULL     COMMENT '업무영역 설명',
  `sort_order`  INT          DEFAULT 0        COMMENT '정렬순서',
  `is_active`   TINYINT      DEFAULT 1        COMMENT '활성 여부 (0=비활성)',
  `created_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_ba_code` (`area_code`),
  INDEX `idx_ba_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='업무영역 마스터';

-- ------------------------------------------------------------
-- 2) 사용자-업무영역 매핑 테이블 (N:N)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `user_business_areas` (
  `user_id`    VARCHAR(64) NOT NULL,
  `area_code`  VARCHAR(32) NOT NULL,
  `granted_at` DATETIME    DEFAULT CURRENT_TIMESTAMP,
  `granted_by` VARCHAR(64) DEFAULT NULL         COMMENT '부여한 관리자 user_id (감사용)',
  PRIMARY KEY (`user_id`, `area_code`),
  INDEX `idx_uba_user` (`user_id`),
  INDEX `idx_uba_area` (`area_code`),
  CONSTRAINT `fk_uba_user` FOREIGN KEY (`user_id`)   REFERENCES `users` (`user_id`)               ON DELETE CASCADE,
  CONSTRAINT `fk_uba_area` FOREIGN KEY (`area_code`) REFERENCES `business_areas` (`area_code`)    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='사용자-업무영역 매핑';

-- ============================================================
-- 시드 데이터
-- ============================================================

-- 3) 업무영역 마스터 씨드
INSERT IGNORE INTO `business_areas` (`area_code`, `area_name`, `description`, `sort_order`) VALUES
  ('PROFITABILITY',      '수익성분석', '수익성 분석 관련 업무영역 (기본)', 10),
  ('MANUFACTURING_COST', '제조원가',   '제조원가 관련 업무영역',           20);

-- ============================================================
-- 마이그레이션
-- ============================================================

-- 4) 매핑이 하나도 없는 모든 기존 사용자에게 PROFITABILITY 기본 부여
--    (LEFT JOIN + IS NULL 로 미매핑 사용자만 필터, INSERT IGNORE 로 이중 안전)
--    admin 사용자도 여기서 PROFITABILITY 한 건이 들어가지만,
--    서버 헬퍼는 admin 을 감지하여 활성 area 전체를 동적으로 반환하므로
--    이 매핑값 자체는 조회 시 사용되지 않음 (감사 기록 성격).
INSERT IGNORE INTO `user_business_areas` (`user_id`, `area_code`, `granted_by`)
SELECT u.`user_id`, 'PROFITABILITY', 'SYSTEM_MIGRATION'
  FROM `users` u
  LEFT JOIN `user_business_areas` uba ON uba.`user_id` = u.`user_id`
 WHERE uba.`user_id` IS NULL;

-- ============================================================
-- 검증용 SELECT (실행 후 확인)
-- ============================================================
--  SELECT * FROM business_areas;
--  SELECT COUNT(*) AS total_users,
--         SUM(CASE WHEN uba.user_id IS NOT NULL THEN 1 ELSE 0 END) AS mapped_users
--    FROM users u
--    LEFT JOIN user_business_areas uba ON uba.user_id = u.user_id
--   WHERE (SELECT COUNT(*) FROM user_business_areas WHERE user_id = u.user_id) > 0
--      OR uba.user_id IS NULL;
