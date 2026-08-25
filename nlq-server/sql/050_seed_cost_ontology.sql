-- ============================================================
-- [2026-08-25] 제조원가 세부업무영역용 학습(온톨로지/동의어) 시드
-- ------------------------------------------------------------
-- 배경:
--   기존 학습 데이터는 bw_profitability_data(수익성분석) 전용이었음.
--   PR #383/#385 로 도입된 "제조원가 3-tab" (제품별원가/부서별원가/호기별원가)
--   에서 사용자가 자연어 질의 시 "알 수 없는 용어입니다..." 응답이 발생.
--   근본 원인: sys_aimd_cot015 / sys_aimd_cot043 컬럼이 ontology_column 에
--   미등록 → GPT 가 학습 컨텍스트를 못 받아 SQL 생성 실패.
--
-- 대상:
--   1) sys_aimd_cot015 (제품별원가) 30개 주요 컬럼
--      · 차원: CALMONTH / PLANT / PLANT_NM / MATERIAL / MATERIAL_NM
--             / ZCGUBUN / ZCGUBUN_D / BASE_UOM / LBKUM / CURRENCY
--      · 금액: TOTAL / KST_V / KST_F / KST001~KST039 (10개) + TOTAL1/TOTAL2
--   2) sys_aimd_cot043 (부서별 + 호기별 원가) 9개 컬럼 전부
--      · CALMONTH / ZCOSTCOMP / ZCOSTCOMP_NM / COSTELMNT / COSTELMNT_NM
--        / COSTCENTER / COSTCENTER_NM / CURRENCY / AMOUNT
--
-- 도메인 배포:
--   3개 도메인 (PS/HL/MGMT) 각각에 등록 → 사용자가 어느 도메인에서
--   제조원가 탭을 열어도 학습 컨텍스트가 로드됨.
--
-- 동의어 (ontology_synonym):
--   사용자 확정 예시질문 (PR #385) 및 이번 세션에서 확정한
--   부서별/호기별 예시질문에서 도출한 자연어 표현들을 우선 등록.
--
-- 멱등성:
--   - ontology_column: UNIQUE KEY (domain_code, column_name, table_name)
--     → INSERT IGNORE 로 재실행 안전.
--   - ontology_synonym: UNIQUE KEY (column_id, synonym_text)
--     → INSERT IGNORE + 서브쿼리 (WHERE domain_code, column_name, table_name)
--     로 재실행 안전.
--
-- 주의:
--   ontology_column 시드는 반드시 (domain_code, column_name, table_name) 3개로
--   UK 를 만족해야 하며, ontology_synonym 시드도 서브쿼리에 table_name 을
--   함께 넣어야 다른 테이블의 동명 컬럼(예: CALMONTH)과 섞이지 않음.
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
