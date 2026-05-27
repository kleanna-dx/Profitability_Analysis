-- ============================================================
-- 도메인(영역) 관리 테이블
-- 수익성분석 영역 마스터 + 조직-도메인 매핑
-- ============================================================

-- 1) 도메인 마스터 테이블
CREATE TABLE IF NOT EXISTS `domain_master` (
  `domain_code`  varchar(20)  NOT NULL       COMMENT '영역 코드 (PS, HL, MGMT)',
  `domain_name`  varchar(100) NOT NULL       COMMENT '영역 이름',
  `sort_order`   int(11)      DEFAULT 0      COMMENT '정렬 순서',
  `is_active`    tinyint(1)   DEFAULT 1      COMMENT '활성 여부',
  `created_at`   datetime     DEFAULT current_timestamp(),
  `updated_at`   datetime     DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`domain_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='수익성분석 영역(도메인) 마스터';

-- 도메인 초기 데이터
INSERT IGNORE INTO `domain_master` (`domain_code`, `domain_name`, `sort_order`) VALUES
('PS',   '페이퍼솔루션사업부', 1),
('HL',   '홈앤라이프사업부',   2),
('MGMT', '경영기획',           3);


-- 2) 도메인-조직 그룹 매핑 테이블
CREATE TABLE IF NOT EXISTS `domain_group_mapping` (
  `id`           int(11)      NOT NULL AUTO_INCREMENT,
  `domain_code`  varchar(20)  NOT NULL       COMMENT '영역 코드',
  `group_id`     varchar(20)  NOT NULL       COMMENT '조직도 최상위 그룹 ID (사업부급)',
  `group_name`   varchar(100) DEFAULT NULL   COMMENT '그룹명 (참고용)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_domain_group` (`domain_code`, `group_id`),
  CONSTRAINT `domain_group_mapping_ibfk_1` FOREIGN KEY (`domain_code`) REFERENCES `domain_master`(`domain_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='도메인-조직 그룹 매핑';

-- 매핑 초기 데이터 (깨끗한나라 조직도 기준)
INSERT IGNORE INTO `domain_group_mapping` (`domain_code`, `group_id`, `group_name`) VALUES
('PS',   'D0100000', '페이퍼솔루션사업부'),
('HL',   'D0200132', '홈앤라이프사업부'),
('MGMT', 'D0400900', '경영기획실'),
('MGMT', 'D2013147', 'CEO'),
('MGMT', 'D2013135', 'COO');
