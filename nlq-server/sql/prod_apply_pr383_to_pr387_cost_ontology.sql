-- ============================================================
-- [운영 반영용 통합 스크립트] PR #383 → PR #387
-- 제조원가 세부업무영역(제품별/부서별/호기별) 학습 데이터 seed
--
-- 작성일  : 2026-08-25
-- 대상 PR :
--   - PR #383 : 제조원가 3-tab 세부업무영역 + 세션 잠금 (Phase 1)
--               (코드 변경만 — DB 스키마 변경 없음)
--   - PR #385 : cost-product 전용 예시질문 + area/subArea 분리 구조
--               (코드 변경만 — DB 스키마 변경 없음)
--   - PR #386 : applyForcedTableFilter 배선 + 학습 seed + 예시질문 8+8
--               (본 스크립트의 핵심 seed)
--               원본 마이그레이션 : sql/050_seed_cost_ontology.sql
--   - PR #387 : RAG/온톨로지 tableWhitelist 지원 (LLM 컨텍스트 격리)
--               ├ 코드 변경: server.mjs / rag.mjs / public/learning.html
--               └ 데이터 변경: 050_seed_cost_ontology.sql 에 누락 동의어
--                             (매출원가/총원가/원가구성 등) 6개 보강
--
-- 실행 방법:
--   mysql -u <user> -p <database> < prod_apply_pr383_to_pr387_cost_ontology.sql
--   또는
--   mysql> USE <database>;
--   mysql> SOURCE prod_apply_pr383_to_pr387_cost_ontology.sql;
--
-- ⚠️ 실행 순서 및 사전 조건 (매우 중요):
--   1) 아래 두 테이블이 운영 DB 에 이미 존재해야 합니다:
--        · sys_aimd_cot015 (제품별원가)   ← sql/043_create_sys_aimd_cot015.sql
--        · sys_aimd_cot043 (부서/호기 원가) ← sql/047_create_sys_aimd_cot043.sql
--      존재하지 않으면 본 스크립트 실행 전 위 두 원본 DDL 을 먼저 적용하세요.
--      본 스크립트 상단의 [사전 점검] 섹션이 자동으로 존재 여부를 진단합니다.
--
--   2) 본 스크립트 실행 → 온톨로지/동의어 seed 완료 후, 반드시 RAG 인덱스 재빌드:
--        POST /api/rag/build  (관리자 세션 필요)
--      또는 학습관리 화면에서 [RAG 인덱스 재빌드] 버튼 클릭.
--      이 단계를 생략하면 rag_embeddings 테이블에 신규 온톨로지 청크가 반영되지
--      않아 NLQ 프롬프트가 sys_aimd_cot015/cot043 컬럼을 인식하지 못하고
--      "알 수 없는 용어입니다" 응답이 계속 발생합니다.
--
-- 멱등성:
--   본 스크립트는 여러 번 실행해도 안전합니다.
--   - ontology_column  : UNIQUE KEY (domain_code, column_name, table_name)
--                        + INSERT IGNORE  → 중복 삽입 무시
--   - ontology_synonym : UNIQUE KEY (column_id, synonym_text)
--                        + INSERT IGNORE  → 중복 삽입 무시
--   - 오늘 세션에서 신규 테이블/신규 컬럼 DDL 은 없습니다 (스키마 무변경).
--
-- ▣ 본 스크립트가 적재하는 데이터 (요약)
--   1) sys_aimd_cot015 (제품별원가) 온톨로지 — 30개 컬럼 × 3도메인 (PS/HL/MGMT) = 90 행
--   2) sys_aimd_cot043 (부서/호기 원가) 온톨로지 —  9개 컬럼 × 3도메인            = 27 행
--   3) sys_aimd_cot015 / sys_aimd_cot043 컬럼별 동의어 (원가/매출원가/실제원가/
--      총원가/원가구성/원가합계/제품별/부서별/호기별 등)
--
-- ▣ 오늘 세션의 DB 변경 범위 (Ledger)
--   신규 테이블 : (없음)
--   신규 컬럼   : (없음)
--   신규 인덱스 : (없음)
--   데이터 seed : ontology_column / ontology_synonym  ← 본 파일
--   RAG 재빌드  : 필수 (rag_embeddings 갱신 — 본 파일이 아닌 API 호출로 수행)
--
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- [사전 점검] 대상 테이블 존재 여부 진단
--   실행 결과가 0 이면 원본 DDL 을 먼저 적용해야 합니다.
-- ═══════════════════════════════════════════════════════════
SELECT '[PRECHECK]' AS phase,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_cot015') AS has_sys_aimd_cot015,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_cot043') AS has_sys_aimd_cot043,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ontology_column') AS has_ontology_column,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ontology_synonym') AS has_ontology_synonym,
       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rag_embeddings') AS has_rag_embeddings;


-- ═══════════════════════════════════════════════════════════
-- [사전 스냅샷] seed 실행 전 카운트 (재실행/진행상황 파악용)
-- ═══════════════════════════════════════════════════════════
SELECT '[BEFORE]' AS phase,
       (SELECT COUNT(*) FROM ontology_column
         WHERE table_name IN ('sys_aimd_cot015','sys_aimd_cot043')) AS ontology_cols_target,
       (SELECT COUNT(*) FROM ontology_synonym s
         JOIN ontology_column c ON c.id = s.column_id
         WHERE c.table_name IN ('sys_aimd_cot015','sys_aimd_cot043')) AS ontology_synonyms_target;


-- ============================================================
-- ▼▼▼ 이하 원본 sql/050_seed_cost_ontology.sql 본문과 동일 ▼▼▼
--    (본문을 이 파일 안에 인라인하여 self-contained 하게 실행 가능)
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- 1) sys_aimd_cot015 (제품별원가) — ontology_column 시드
--    도메인 3개 (PS / HL / MGMT) 에 동일 컬럼 등록
-- ═══════════════════════════════════════════════════════════
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES
-- 차원 (10개)
('PS',   'CALMONTH',    'sys_aimd_cot015', '달력연도/월 (YYYYMM)',       'varchar(6)'),
('PS',   'PLANT',       'sys_aimd_cot015', '플랜트 코드',                 'varchar(4)'),
('PS',   'PLANT_NM',    'sys_aimd_cot015', '플랜트명',                    'varchar(40)'),
('PS',   'MATERIAL',    'sys_aimd_cot015', '자재 코드 (제품 코드)',        'varchar(18)'),
('PS',   'MATERIAL_NM', 'sys_aimd_cot015', '자재명 (제품명)',              'varchar(40)'),
('PS',   'ZCGUBUN_D',   'sys_aimd_cot015', '표준원가추정 대구분 (실적/추정 등)', 'varchar(20)'),
('PS',   'ZCGUBUN',     'sys_aimd_cot015', '원가구분 (실제원가/표준원가 등)',    'varchar(20)'),
('PS',   'BASE_UOM',    'sys_aimd_cot015', '기본 단위 (KG/EA 등)',         'varchar(3)'),
('PS',   'LBKUM',       'sys_aimd_cot015', '생산수량 (매출수량)',          'decimal(17,3)'),
('PS',   'CURRENCY',    'sys_aimd_cot015', '통화 코드',                   'varchar(5)'),
-- 금액 (20개)
('PS',   'TOTAL',       'sys_aimd_cot015', '원가 합계금액',                'bigint(20)'),
('PS',   'KST_V',       'sys_aimd_cot015', '변동비 합계',                  'bigint(20)'),
('PS',   'KST_F',       'sys_aimd_cot015', '고정비 합계',                  'bigint(20)'),
('PS',   'KST001',      'sys_aimd_cot015', '재료비-펄프',                  'bigint(20)'),
('PS',   'KST002',      'sys_aimd_cot015', '재료비-고지',                  'bigint(20)'),
('PS',   'KST004',      'sys_aimd_cot015', '재료비-패드',                  'bigint(20)'),
('PS',   'KST006',      'sys_aimd_cot015', '부재료비-약품',                'bigint(20)'),
('PS',   'KST008',      'sys_aimd_cot015', '부재료비-포장재',              'bigint(20)'),
('PS',   'KST010',      'sys_aimd_cot015', '재료비-기타',                  'bigint(20)'),
('PS',   'KST012',      'sys_aimd_cot015', '인건비',                       'bigint(20)'),
('PS',   'KST014',      'sys_aimd_cot015', '도급비',                       'bigint(20)'),
('PS',   'KST015',      'sys_aimd_cot015', '에너지비',                     'bigint(20)'),
('PS',   'KST017',      'sys_aimd_cot015', '감가상각비',                   'bigint(20)'),
('PS',   'KST019',      'sys_aimd_cot015', '수선/소모품비',                'bigint(20)'),
('PS',   'KST021',      'sys_aimd_cot015', '기타경비',                     'bigint(20)'),
('PS',   'KST025',      'sys_aimd_cot015', '외주가공비',                   'bigint(20)'),
('PS',   'KST027',      'sys_aimd_cot015', '인건비-경비',                  'bigint(20)'),
('PS',   'KST029',      'sys_aimd_cot015', '인건비-기타',                  'bigint(20)'),
('PS',   'KST031',      'sys_aimd_cot015', '전력비',                       'bigint(20)'),
('PS',   'KST033',      'sys_aimd_cot015', '세금과공과',                   'bigint(20)'),
('PS',   'KST035',      'sys_aimd_cot015', '지급수수료',                   'bigint(20)'),
('PS',   'KST037',      'sys_aimd_cot015', '기타경비-폐기물',              'bigint(20)'),
('PS',   'KST039',      'sys_aimd_cot015', '생산량 (입고용)',              'bigint(20)'),
('PS',   'TOTAL1',      'sys_aimd_cot015', '현재월 표준가',                'bigint(20)'),
('PS',   'TOTAL2',      'sys_aimd_cot015', '이전월 표준가',                'bigint(20)'),
-- HL 도메인 (동일 컬럼 세트)
('HL',   'CALMONTH',    'sys_aimd_cot015', '달력연도/월 (YYYYMM)',       'varchar(6)'),
('HL',   'PLANT',       'sys_aimd_cot015', '플랜트 코드',                 'varchar(4)'),
('HL',   'PLANT_NM',    'sys_aimd_cot015', '플랜트명',                    'varchar(40)'),
('HL',   'MATERIAL',    'sys_aimd_cot015', '자재 코드 (제품 코드)',        'varchar(18)'),
('HL',   'MATERIAL_NM', 'sys_aimd_cot015', '자재명 (제품명)',              'varchar(40)'),
('HL',   'ZCGUBUN_D',   'sys_aimd_cot015', '표준원가추정 대구분 (실적/추정 등)', 'varchar(20)'),
('HL',   'ZCGUBUN',     'sys_aimd_cot015', '원가구분 (실제원가/표준원가 등)',    'varchar(20)'),
('HL',   'BASE_UOM',    'sys_aimd_cot015', '기본 단위 (KG/EA 등)',         'varchar(3)'),
('HL',   'LBKUM',       'sys_aimd_cot015', '생산수량 (매출수량)',          'decimal(17,3)'),
('HL',   'CURRENCY',    'sys_aimd_cot015', '통화 코드',                   'varchar(5)'),
('HL',   'TOTAL',       'sys_aimd_cot015', '원가 합계금액',                'bigint(20)'),
('HL',   'KST_V',       'sys_aimd_cot015', '변동비 합계',                  'bigint(20)'),
('HL',   'KST_F',       'sys_aimd_cot015', '고정비 합계',                  'bigint(20)'),
('HL',   'KST001',      'sys_aimd_cot015', '재료비-펄프',                  'bigint(20)'),
('HL',   'KST002',      'sys_aimd_cot015', '재료비-고지',                  'bigint(20)'),
('HL',   'KST004',      'sys_aimd_cot015', '재료비-패드',                  'bigint(20)'),
('HL',   'KST006',      'sys_aimd_cot015', '부재료비-약품',                'bigint(20)'),
('HL',   'KST008',      'sys_aimd_cot015', '부재료비-포장재',              'bigint(20)'),
('HL',   'KST010',      'sys_aimd_cot015', '재료비-기타',                  'bigint(20)'),
('HL',   'KST012',      'sys_aimd_cot015', '인건비',                       'bigint(20)'),
('HL',   'KST014',      'sys_aimd_cot015', '도급비',                       'bigint(20)'),
('HL',   'KST015',      'sys_aimd_cot015', '에너지비',                     'bigint(20)'),
('HL',   'KST017',      'sys_aimd_cot015', '감가상각비',                   'bigint(20)'),
('HL',   'KST019',      'sys_aimd_cot015', '수선/소모품비',                'bigint(20)'),
('HL',   'KST021',      'sys_aimd_cot015', '기타경비',                     'bigint(20)'),
('HL',   'KST025',      'sys_aimd_cot015', '외주가공비',                   'bigint(20)'),
('HL',   'KST027',      'sys_aimd_cot015', '인건비-경비',                  'bigint(20)'),
('HL',   'KST029',      'sys_aimd_cot015', '인건비-기타',                  'bigint(20)'),
('HL',   'KST031',      'sys_aimd_cot015', '전력비',                       'bigint(20)'),
('HL',   'KST033',      'sys_aimd_cot015', '세금과공과',                   'bigint(20)'),
('HL',   'KST035',      'sys_aimd_cot015', '지급수수료',                   'bigint(20)'),
('HL',   'KST037',      'sys_aimd_cot015', '기타경비-폐기물',              'bigint(20)'),
('HL',   'KST039',      'sys_aimd_cot015', '생산량 (입고용)',              'bigint(20)'),
('HL',   'TOTAL1',      'sys_aimd_cot015', '현재월 표준가',                'bigint(20)'),
('HL',   'TOTAL2',      'sys_aimd_cot015', '이전월 표준가',                'bigint(20)'),
-- MGMT 도메인 (동일 컬럼 세트)
('MGMT', 'CALMONTH',    'sys_aimd_cot015', '달력연도/월 (YYYYMM)',       'varchar(6)'),
('MGMT', 'PLANT',       'sys_aimd_cot015', '플랜트 코드',                 'varchar(4)'),
('MGMT', 'PLANT_NM',    'sys_aimd_cot015', '플랜트명',                    'varchar(40)'),
('MGMT', 'MATERIAL',    'sys_aimd_cot015', '자재 코드 (제품 코드)',        'varchar(18)'),
('MGMT', 'MATERIAL_NM', 'sys_aimd_cot015', '자재명 (제품명)',              'varchar(40)'),
('MGMT', 'ZCGUBUN_D',   'sys_aimd_cot015', '표준원가추정 대구분 (실적/추정 등)', 'varchar(20)'),
('MGMT', 'ZCGUBUN',     'sys_aimd_cot015', '원가구분 (실제원가/표준원가 등)',    'varchar(20)'),
('MGMT', 'BASE_UOM',    'sys_aimd_cot015', '기본 단위 (KG/EA 등)',         'varchar(3)'),
('MGMT', 'LBKUM',       'sys_aimd_cot015', '생산수량 (매출수량)',          'decimal(17,3)'),
('MGMT', 'CURRENCY',    'sys_aimd_cot015', '통화 코드',                   'varchar(5)'),
('MGMT', 'TOTAL',       'sys_aimd_cot015', '원가 합계금액',                'bigint(20)'),
('MGMT', 'KST_V',       'sys_aimd_cot015', '변동비 합계',                  'bigint(20)'),
('MGMT', 'KST_F',       'sys_aimd_cot015', '고정비 합계',                  'bigint(20)'),
('MGMT', 'KST001',      'sys_aimd_cot015', '재료비-펄프',                  'bigint(20)'),
('MGMT', 'KST002',      'sys_aimd_cot015', '재료비-고지',                  'bigint(20)'),
('MGMT', 'KST004',      'sys_aimd_cot015', '재료비-패드',                  'bigint(20)'),
('MGMT', 'KST006',      'sys_aimd_cot015', '부재료비-약품',                'bigint(20)'),
('MGMT', 'KST008',      'sys_aimd_cot015', '부재료비-포장재',              'bigint(20)'),
('MGMT', 'KST010',      'sys_aimd_cot015', '재료비-기타',                  'bigint(20)'),
('MGMT', 'KST012',      'sys_aimd_cot015', '인건비',                       'bigint(20)'),
('MGMT', 'KST014',      'sys_aimd_cot015', '도급비',                       'bigint(20)'),
('MGMT', 'KST015',      'sys_aimd_cot015', '에너지비',                     'bigint(20)'),
('MGMT', 'KST017',      'sys_aimd_cot015', '감가상각비',                   'bigint(20)'),
('MGMT', 'KST019',      'sys_aimd_cot015', '수선/소모품비',                'bigint(20)'),
('MGMT', 'KST021',      'sys_aimd_cot015', '기타경비',                     'bigint(20)'),
('MGMT', 'KST025',      'sys_aimd_cot015', '외주가공비',                   'bigint(20)'),
('MGMT', 'KST027',      'sys_aimd_cot015', '인건비-경비',                  'bigint(20)'),
('MGMT', 'KST029',      'sys_aimd_cot015', '인건비-기타',                  'bigint(20)'),
('MGMT', 'KST031',      'sys_aimd_cot015', '전력비',                       'bigint(20)'),
('MGMT', 'KST033',      'sys_aimd_cot015', '세금과공과',                   'bigint(20)'),
('MGMT', 'KST035',      'sys_aimd_cot015', '지급수수료',                   'bigint(20)'),
('MGMT', 'KST037',      'sys_aimd_cot015', '기타경비-폐기물',              'bigint(20)'),
('MGMT', 'KST039',      'sys_aimd_cot015', '생산량 (입고용)',              'bigint(20)'),
('MGMT', 'TOTAL1',      'sys_aimd_cot015', '현재월 표준가',                'bigint(20)'),
('MGMT', 'TOTAL2',      'sys_aimd_cot015', '이전월 표준가',                'bigint(20)');


-- ═══════════════════════════════════════════════════════════
-- 2) sys_aimd_cot043 (부서별 + 호기별 원가) — ontology_column 시드
--    ★ 부서별원가(cost-dept) 와 호기별원가(cost-machine) 가 공유하는 테이블.
--      백엔드의 forcedFilter (COSTCENTER IN/NOT IN) 로 실행 시점에 구분.
-- ═══════════════════════════════════════════════════════════
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES
-- PS 도메인 (9개 컬럼 전부)
('PS',   'CALMONTH',      'sys_aimd_cot043', '달력연도/월 (YYYYMM)',        'varchar(6)'),
('PS',   'ZCOSTCOMP',     'sys_aimd_cot043', '원가 구성요소 코드',          'varchar(3)'),
('PS',   'ZCOSTCOMP_NM',  'sys_aimd_cot043', '원가 구성요소명 (재료비/노무비 등)', 'varchar(40)'),
('PS',   'COSTELMNT',     'sys_aimd_cot043', '원가 요소 코드',              'varchar(10)'),
('PS',   'COSTELMNT_NM',  'sys_aimd_cot043', '원가 요소명',                 'varchar(40)'),
('PS',   'COSTCENTER',    'sys_aimd_cot043', '코스트센터 코드 (부서/호기 구분자)', 'varchar(10)'),
('PS',   'COSTCENTER_NM', 'sys_aimd_cot043', '코스트센터명 (부서명 또는 호기명)',  'varchar(20)'),
('PS',   'CURRENCY',      'sys_aimd_cot043', '통화 코드',                   'varchar(5)'),
('PS',   'AMOUNT',        'sys_aimd_cot043', '원가 금액',                   'bigint(20)'),
-- HL 도메인
('HL',   'CALMONTH',      'sys_aimd_cot043', '달력연도/월 (YYYYMM)',        'varchar(6)'),
('HL',   'ZCOSTCOMP',     'sys_aimd_cot043', '원가 구성요소 코드',          'varchar(3)'),
('HL',   'ZCOSTCOMP_NM',  'sys_aimd_cot043', '원가 구성요소명 (재료비/노무비 등)', 'varchar(40)'),
('HL',   'COSTELMNT',     'sys_aimd_cot043', '원가 요소 코드',              'varchar(10)'),
('HL',   'COSTELMNT_NM',  'sys_aimd_cot043', '원가 요소명',                 'varchar(40)'),
('HL',   'COSTCENTER',    'sys_aimd_cot043', '코스트센터 코드 (부서/호기 구분자)', 'varchar(10)'),
('HL',   'COSTCENTER_NM', 'sys_aimd_cot043', '코스트센터명 (부서명 또는 호기명)',  'varchar(20)'),
('HL',   'CURRENCY',      'sys_aimd_cot043', '통화 코드',                   'varchar(5)'),
('HL',   'AMOUNT',        'sys_aimd_cot043', '원가 금액',                   'bigint(20)'),
-- MGMT 도메인
('MGMT', 'CALMONTH',      'sys_aimd_cot043', '달력연도/월 (YYYYMM)',        'varchar(6)'),
('MGMT', 'ZCOSTCOMP',     'sys_aimd_cot043', '원가 구성요소 코드',          'varchar(3)'),
('MGMT', 'ZCOSTCOMP_NM',  'sys_aimd_cot043', '원가 구성요소명 (재료비/노무비 등)', 'varchar(40)'),
('MGMT', 'COSTELMNT',     'sys_aimd_cot043', '원가 요소 코드',              'varchar(10)'),
('MGMT', 'COSTELMNT_NM',  'sys_aimd_cot043', '원가 요소명',                 'varchar(40)'),
('MGMT', 'COSTCENTER',    'sys_aimd_cot043', '코스트센터 코드 (부서/호기 구분자)', 'varchar(10)'),
('MGMT', 'COSTCENTER_NM', 'sys_aimd_cot043', '코스트센터명 (부서명 또는 호기명)',  'varchar(20)'),
('MGMT', 'CURRENCY',      'sys_aimd_cot043', '통화 코드',                   'varchar(5)'),
('MGMT', 'AMOUNT',        'sys_aimd_cot043', '원가 금액',                   'bigint(20)');


-- ═══════════════════════════════════════════════════════════
-- 3) 동의어 — sys_aimd_cot015 (제품별원가)
--    자연어 질의에서 자주 등장하는 표현을 3개 도메인 모두에 등록.
-- ═══════════════════════════════════════════════════════════
INSERT IGNORE INTO ontology_synonym (column_id, synonym_text)
SELECT id, syn FROM ontology_column
CROSS JOIN (
  SELECT 'CALMONTH'    AS c, '연월'         AS syn UNION ALL SELECT 'CALMONTH',    '월별'
  UNION ALL SELECT 'CALMONTH',    '기준월'
  UNION ALL SELECT 'PLANT',       '플랜트'
  UNION ALL SELECT 'PLANT',       '공장'
  UNION ALL SELECT 'PLANT_NM',    '플랜트명'
  UNION ALL SELECT 'PLANT_NM',    '공장명'
  UNION ALL SELECT 'MATERIAL',    '자재'
  UNION ALL SELECT 'MATERIAL',    '제품코드'
  UNION ALL SELECT 'MATERIAL',    '자재코드'
  UNION ALL SELECT 'MATERIAL_NM', '자재명'
  UNION ALL SELECT 'MATERIAL_NM', '제품명'
  UNION ALL SELECT 'MATERIAL_NM', '제품별'
  UNION ALL SELECT 'ZCGUBUN',     '원가구분'
  UNION ALL SELECT 'ZCGUBUN',     '실제원가'
  UNION ALL SELECT 'ZCGUBUN',     '표준원가'
  UNION ALL SELECT 'ZCGUBUN',     '매출원가'
  UNION ALL SELECT 'ZCGUBUN_D',   '표준원가추정'
  UNION ALL SELECT 'ZCGUBUN_D',   '원가대구분'
  UNION ALL SELECT 'LBKUM',       '생산수량'
  UNION ALL SELECT 'LBKUM',       '매출수량'
  UNION ALL SELECT 'LBKUM',       '수량'
  UNION ALL SELECT 'TOTAL',       '원가합계'
  UNION ALL SELECT 'TOTAL',       '총원가'
  UNION ALL SELECT 'TOTAL',       '합계금액'
  UNION ALL SELECT 'KST_V',       '변동비'
  UNION ALL SELECT 'KST_V',       '변동원가'
  UNION ALL SELECT 'KST_F',       '고정비'
  UNION ALL SELECT 'KST_F',       '고정원가'
  UNION ALL SELECT 'KST001',      '펄프비'
  UNION ALL SELECT 'KST002',      '고지비'
  UNION ALL SELECT 'KST006',      '약품비'
  UNION ALL SELECT 'KST008',      '포장재비'
  UNION ALL SELECT 'KST012',      '인건비'
  UNION ALL SELECT 'KST014',      '도급비'
  UNION ALL SELECT 'KST015',      '에너지비'
  UNION ALL SELECT 'KST017',      '감가상각비'
  UNION ALL SELECT 'KST019',      '수선비'
  UNION ALL SELECT 'KST019',      '소모품비'
  UNION ALL SELECT 'KST025',      '외주가공비'
  UNION ALL SELECT 'KST025',      '외주비'
  UNION ALL SELECT 'KST031',      '전력비'
  UNION ALL SELECT 'KST033',      '세금과공과'
  UNION ALL SELECT 'KST035',      '지급수수료'
  UNION ALL SELECT 'TOTAL1',      '현재월표준가'
  UNION ALL SELECT 'TOTAL2',      '이전월표준가'
) AS s ON ontology_column.column_name = s.c
       AND ontology_column.table_name = 'sys_aimd_cot015'
       AND ontology_column.domain_code IN ('PS', 'HL', 'MGMT');


-- ═══════════════════════════════════════════════════════════
-- 4) 동의어 — sys_aimd_cot043 (부서별 + 호기별 원가)
-- ═══════════════════════════════════════════════════════════
INSERT IGNORE INTO ontology_synonym (column_id, synonym_text)
SELECT id, syn FROM ontology_column
CROSS JOIN (
  SELECT 'CALMONTH'      AS c, '연월'         AS syn UNION ALL SELECT 'CALMONTH',      '월별'
  UNION ALL SELECT 'CALMONTH',      '기준월'
  UNION ALL SELECT 'ZCOSTCOMP',     '원가구성요소'
  UNION ALL SELECT 'ZCOSTCOMP',     '원가구성'
  UNION ALL SELECT 'ZCOSTCOMP_NM',  '원가구성요소명'
  UNION ALL SELECT 'ZCOSTCOMP_NM',  '원가구성별'
  UNION ALL SELECT 'ZCOSTCOMP_NM',  '원가구성비율'
  UNION ALL SELECT 'ZCOSTCOMP_NM',  '재료비'
  UNION ALL SELECT 'ZCOSTCOMP_NM',  '노무비'
  UNION ALL SELECT 'ZCOSTCOMP_NM',  '경비'
  UNION ALL SELECT 'COSTELMNT',     '원가요소'
  UNION ALL SELECT 'COSTELMNT',     '원가요소코드'
  UNION ALL SELECT 'COSTELMNT_NM',  '원가요소명'
  UNION ALL SELECT 'COSTELMNT_NM',  '원가항목'
  UNION ALL SELECT 'COSTELMNT_NM',  '원가항목명'
  UNION ALL SELECT 'COSTCENTER',    '코스트센터'
  UNION ALL SELECT 'COSTCENTER',    '코스트센터코드'
  UNION ALL SELECT 'COSTCENTER',    '부서코드'
  UNION ALL SELECT 'COSTCENTER',    '호기코드'
  UNION ALL SELECT 'COSTCENTER_NM', '코스트센터명'
  UNION ALL SELECT 'COSTCENTER_NM', '부서'
  UNION ALL SELECT 'COSTCENTER_NM', '부서명'
  UNION ALL SELECT 'COSTCENTER_NM', '부서별'
  UNION ALL SELECT 'COSTCENTER_NM', '호기'
  UNION ALL SELECT 'COSTCENTER_NM', '호기명'
  UNION ALL SELECT 'COSTCENTER_NM', '호기별'
  UNION ALL SELECT 'COSTCENTER_NM', '설비'
  UNION ALL SELECT 'COSTCENTER_NM', '라인'
  UNION ALL SELECT 'AMOUNT',        '금액'
  UNION ALL SELECT 'AMOUNT',        '원가금액'
  UNION ALL SELECT 'AMOUNT',        '원가'
  UNION ALL SELECT 'AMOUNT',        '총원가'
  UNION ALL SELECT 'AMOUNT',        '원가합계'
  UNION ALL SELECT 'AMOUNT',        '비용'
) AS s ON ontology_column.column_name = s.c
       AND ontology_column.table_name = 'sys_aimd_cot043'
       AND ontology_column.domain_code IN ('PS', 'HL', 'MGMT');


-- ═══════════════════════════════════════════════════════════
-- 5) 검증 쿼리 (참고용)
-- ═══════════════════════════════════════════════════════════
-- 도메인별 등록 컬럼 개수
SELECT domain_code, table_name, COUNT(*) AS col_count
  FROM ontology_column
 WHERE table_name IN ('sys_aimd_cot015', 'sys_aimd_cot043')
 GROUP BY domain_code, table_name
 ORDER BY table_name, domain_code;

-- 도메인별 등록 동의어 개수
SELECT c.domain_code, c.table_name, COUNT(*) AS syn_count
  FROM ontology_synonym s
  JOIN ontology_column c ON s.column_id = c.id
 WHERE c.table_name IN ('sys_aimd_cot015', 'sys_aimd_cot043')
 GROUP BY c.domain_code, c.table_name
 ORDER BY c.table_name, c.domain_code;


-- ============================================================
-- ▲▲▲ 원본 sql/050_seed_cost_ontology.sql 본문 끝 ▲▲▲
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- [사후 검증] seed 실행 후 카운트 (기대값 대비 확인)
--
--   기대 카운트:
--     · sys_aimd_cot015 : 30컬럼 × 3도메인 = 90 (기존 컬럼 존재 시 그 값 유지)
--     · sys_aimd_cot043 :  9컬럼 × 3도메인 = 27
--     · 동의어 : 재실행 시 값 유지, 신규 실행 시 수십~수백 (도메인 수 × 컬럼별 동의어 수)
--
--   재실행 시 사전/사후 값이 동일하면 = 이미 반영 완료 (멱등성 정상 동작).
-- ═══════════════════════════════════════════════════════════
SELECT '[AFTER]' AS phase,
       (SELECT COUNT(*) FROM ontology_column
         WHERE table_name IN ('sys_aimd_cot015','sys_aimd_cot043')) AS ontology_cols_target,
       (SELECT COUNT(*) FROM ontology_synonym s
         JOIN ontology_column c ON c.id = s.column_id
         WHERE c.table_name IN ('sys_aimd_cot015','sys_aimd_cot043')) AS ontology_synonyms_target;

-- 도메인 × 테이블 별 세부 분해 (문제 발생 시 원인 파악용)
SELECT '[AFTER:BREAKDOWN]' AS phase,
       c.domain_code, c.table_name,
       COUNT(DISTINCT c.id)  AS column_cnt,
       COUNT(s.id)           AS synonym_cnt
FROM ontology_column c
LEFT JOIN ontology_synonym s ON s.column_id = c.id
WHERE c.table_name IN ('sys_aimd_cot015','sys_aimd_cot043')
GROUP BY c.domain_code, c.table_name
ORDER BY c.table_name, c.domain_code;

-- 실제원가/부서별/호기별 등 대표 동의어 존재 확인
SELECT '[AFTER:KEYSYN]' AS phase,
       c.domain_code, c.table_name, c.column_name, s.synonym_text
FROM ontology_synonym s
JOIN ontology_column c ON c.id = s.column_id
WHERE c.table_name IN ('sys_aimd_cot015','sys_aimd_cot043')
  AND s.synonym_text IN ('실제원가','매출원가','총원가','원가구성','제품별','부서별','호기별','실적원가')
ORDER BY c.table_name, c.domain_code, c.column_name, s.synonym_text;


-- ═══════════════════════════════════════════════════════════
-- [필수 후속 작업] RAG 인덱스 재빌드
--
--   본 스크립트는 관계형 학습 데이터(ontology_column / ontology_synonym)
--   만 갱신합니다. NLQ 프롬프트에 실제로 노출되는 벡터 청크는
--   rag_embeddings 테이블에 별도로 저장되며, 아래 API 를 호출해야만
--   갱신됩니다.
--
--   방법 A) 관리자 세션으로 curl:
--     COOKIE=/tmp/admin_cookie.txt
--     curl -s -c $COOKIE -X POST https://<운영도메인>/api/login \
--          -H "Content-Type: application/json" \
--          -d '{"username":"<admin_id>","password":"<pwd>"}'
--     curl -s -b $COOKIE -X POST https://<운영도메인>/api/rag/build \
--          -H "Content-Type: application/json" -d '{}'
--
--   방법 B) 화면에서:
--     관리자 로그인 → [학습관리] → [RAG 인덱스 재빌드] 버튼 클릭
--
--   재빌드 결과 예시:
--     { "success": true, "totalChunks": 693,
--       "message": "RAG 인덱스 빌드 완료: 693개 청크" }
--
--   재빌드가 반영되었는지 확인 (SELECT 로도 가능):
--     SELECT chunk_type, COUNT(*)
--     FROM rag_embeddings
--     WHERE is_active = 1
--       AND JSON_EXTRACT(metadata,'$.table_name')
--             IN ('sys_aimd_cot015','sys_aimd_cot043')
--     GROUP BY chunk_type;
--   → schema/ontology 각각에서 sys_aimd_cot015/cot043 청크가
--     0 이상이면 정상.
-- ═══════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════
-- [운영 반영 최종 체크리스트]
--   [ ] 1. 원본 DDL 반영 (본 스크립트 실행 전)
--          · sql/043_create_sys_aimd_cot015.sql
--          · sql/047_create_sys_aimd_cot043.sql
--   [ ] 2. 본 스크립트 실행 → [PRECHECK] 모두 1, [AFTER] 카운트 확인
--   [ ] 3. 애플리케이션 서버 재기동 (server.mjs / rag.mjs 변경 반영)
--          · PR #386, #387 코드가 배포되었는지 확인
--   [ ] 4. POST /api/rag/build 로 RAG 인덱스 재빌드
--   [ ] 5. 화면 검증
--          · [수익성분석] 탭 → 기존 동작 유지 확인
--          · [제조원가 > 제품별원가] 탭 → "제품별 실제원가 TOP 5" 등 동작
--          · [제조원가 > 부서별원가] 탭 → COSTCENTER NOT IN(호기23) 자동 주입 확인
--          · [제조원가 > 호기별원가] 탭 → COSTCENTER IN(호기23) 자동 주입 확인
--          · [학습관리 > 제조원가] 탭 → sys_aimd_cot015/cot043 컬럼만 노출
-- ═══════════════════════════════════════════════════════════
