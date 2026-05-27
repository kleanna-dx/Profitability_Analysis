-- ============================================================
-- 도메인(영역) 기반 학습관리 구조 마이그레이션 스크립트
-- 대상 DB: company_board
-- 실행 순서: 위에서 아래로 순차 실행
-- ============================================================

-- 1. 도메인 마스터 테이블
CREATE TABLE IF NOT EXISTS domain_master (
    domain_code VARCHAR(10) PRIMARY KEY COMMENT '영역 코드 (PS, HL, MGMT)',
    domain_name VARCHAR(100) NOT NULL COMMENT '영역 이름',
    description TEXT COMMENT '설명',
    sort_order INT DEFAULT 0 COMMENT '정렬 순서',
    is_active TINYINT(1) DEFAULT 1 COMMENT '활성 여부',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='수익성분석 영역(도메인) 마스터';

-- 도메인 데이터 삽입
INSERT IGNORE INTO domain_master (domain_code, domain_name, description, sort_order) VALUES
('PS', '페이퍼솔루션사업부', '페이퍼솔루션 사업부 수익성분석 영역', 1),
('HL', '홈앤라이프사업부', '홈앤라이프 사업부 수익성분석 영역', 2),
('MGMT', '경영기획', '경영기획·임원진 수익성분석 영역', 3);

-- 2. 도메인-조직 그룹 매핑 테이블
CREATE TABLE IF NOT EXISTS domain_group_mapping (
    id INT AUTO_INCREMENT PRIMARY KEY,
    domain_code VARCHAR(10) NOT NULL COMMENT '영역 코드',
    group_id VARCHAR(50) NOT NULL COMMENT 'group_info.group_id',
    group_name VARCHAR(200) COMMENT '그룹명 (참고용)',
    description TEXT COMMENT '설명',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_domain_group (domain_code, group_id),
    KEY idx_group_id (group_id),
    FOREIGN KEY (domain_code) REFERENCES domain_master(domain_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='도메인-조직 그룹 매핑 (조직도 상위 탐색 기준점)';

-- 매핑 데이터 삽입 (깨끗한나라 조직도 기준)
INSERT IGNORE INTO domain_group_mapping (domain_code, group_id, group_name, description) VALUES
('PS',   'D0100000', '페이퍼솔루션사업부', '페이퍼솔루션 최상위 조직'),
('HL',   'D0200132', '홈앤라이프사업부', '홈앤라이프 최상위 조직'),
('MGMT', 'D0400900', '경영기획실', '경영기획실'),
('MGMT', 'D2013147', 'CEO', 'CEO 직속'),
('MGMT', 'D2013135', 'COO', 'COO 직속');

-- 3. 기존 테이블에 domain_code 컬럼 추가
-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10) DEFAULT NULL COMMENT '영역 코드' AFTER role;
ALTER TABLE users ADD INDEX IF NOT EXISTS idx_users_domain (domain_code);

-- ontology_column
ALTER TABLE ontology_column ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10) DEFAULT 'PS' COMMENT '영역 코드' AFTER id;
ALTER TABLE ontology_column ADD INDEX IF NOT EXISTS idx_ontology_domain (domain_code);

-- metric
ALTER TABLE metric ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10) DEFAULT 'PS' COMMENT '영역 코드' AFTER id;
ALTER TABLE metric ADD INDEX IF NOT EXISTS idx_metric_domain (domain_code);

-- join_condition
ALTER TABLE join_condition ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10) DEFAULT 'PS' COMMENT '영역 코드' AFTER id;
ALTER TABLE join_condition ADD INDEX IF NOT EXISTS idx_join_domain (domain_code);

-- code_mapping
ALTER TABLE code_mapping ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10) DEFAULT NULL COMMENT '영역 코드' AFTER id;
ALTER TABLE code_mapping ADD INDEX IF NOT EXISTS idx_codemapping_domain (domain_code);

-- sql_feedback
ALTER TABLE sql_feedback ADD COLUMN IF NOT EXISTS domain_code VARCHAR(10) DEFAULT NULL COMMENT '영역 코드' AFTER id;
ALTER TABLE sql_feedback ADD INDEX IF NOT EXISTS idx_feedback_domain (domain_code);

-- 4. 유니크키 수정 (domain_code 포함하여 도메인별 데이터 분리 지원)

-- ontology_column: (column_name, table_name) → (domain_code, column_name, table_name)
ALTER TABLE ontology_column DROP INDEX uk_col_table;
ALTER TABLE ontology_column ADD UNIQUE KEY uk_col_table (domain_code, column_name, table_name);

-- metric: (metric_code) → (domain_code, metric_code)
ALTER TABLE metric DROP INDEX uk_metric_code;
ALTER TABLE metric ADD UNIQUE KEY uk_metric_code (domain_code, metric_code);

-- code_mapping: (column_name, code_value, table_name) → (domain_code, column_name, code_value, table_name)
ALTER TABLE code_mapping DROP INDEX uk_col_code;
ALTER TABLE code_mapping ADD UNIQUE KEY uk_col_code (domain_code, column_name, code_value, table_name);

-- 5. HL, MGMT 도메인 초기 데이터 세팅 (PS 데이터 복사)

-- ontology_column (122건 × 2 도메인)
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type)
SELECT 'HL', column_name, table_name, description, data_type
FROM ontology_column WHERE domain_code = 'PS';

INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type)
SELECT 'MGMT', column_name, table_name, description, data_type
FROM ontology_column WHERE domain_code = 'PS';

-- metric (19건 × 2 도메인)
INSERT IGNORE INTO metric (domain_code, metric_code, aggregation, formula, table_name, description)
SELECT 'HL', metric_code, aggregation, formula, table_name, description
FROM metric WHERE domain_code = 'PS';

INSERT IGNORE INTO metric (domain_code, metric_code, aggregation, formula, table_name, description)
SELECT 'MGMT', metric_code, aggregation, formula, table_name, description
FROM metric WHERE domain_code = 'PS';

-- join_condition (3건 × 2 도메인)
INSERT INTO join_condition (domain_code, left_column, left_table, right_column, right_table, join_type, operator, description)
SELECT 'HL', left_column, left_table, right_column, right_table, join_type, operator, description
FROM join_condition WHERE domain_code = 'PS'
AND NOT EXISTS (SELECT 1 FROM join_condition j2 WHERE j2.domain_code = 'HL');

INSERT INTO join_condition (domain_code, left_column, left_table, right_column, right_table, join_type, operator, description)
SELECT 'MGMT', left_column, left_table, right_column, right_table, join_type, operator, description
FROM join_condition WHERE domain_code = 'PS'
AND NOT EXISTS (SELECT 1 FROM join_condition j2 WHERE j2.domain_code = 'MGMT');

-- code_mapping (26건 × 2 도메인)
INSERT IGNORE INTO code_mapping (domain_code, column_name, column_name_nm, code_value, display_name, table_name, description, is_active)
SELECT 'HL', column_name, column_name_nm, code_value, display_name, table_name, description, is_active
FROM code_mapping WHERE domain_code = 'PS';

INSERT IGNORE INTO code_mapping (domain_code, column_name, column_name_nm, code_value, display_name, table_name, description, is_active)
SELECT 'MGMT', column_name, column_name_nm, code_value, display_name, table_name, description, is_active
FROM code_mapping WHERE domain_code = 'PS';

-- ============================================================
-- 완료. 서버 재시작 후 적용됩니다.
-- 참고: 동의어(ontology_synonym, metric_synonym)는 도메인별로
-- 관리자가 개별 세팅합니다 (초기 복사 대상 아님).
-- ============================================================
