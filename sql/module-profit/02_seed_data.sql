-- ============================================================
-- module-profit: 시드 데이터 (초기 설정용)
-- 실행 전제 : 01_schema.sql 이 먼저 실행되어 있어야 합니다.
-- 목적     : SAP BW 수익성분석 시나리오에 맞는 기본 사전 데이터
-- ============================================================

-- ============================================================
-- 1. Ontology Column (BW DB 컬럼 사전)
-- ============================================================

-- ── 기간(Period) 그룹 ──
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('ZYEAR',      'BW.ZFICO_T01', '회계연도',         'VARCHAR(4)',   '기간',     1, 1, 'system', NOW(), NOW()),
('ZMONTH',     'BW.ZFICO_T01', '회계월',           'VARCHAR(2)',   '기간',     2, 1, 'system', NOW(), NOW()),
('ZPERIOD',    'BW.ZFICO_T01', '회계기간(YYYYMM)', 'VARCHAR(6)',   '기간',     3, 1, 'system', NOW(), NOW()),
('ZQUARTER',   'BW.ZFICO_T01', '분기',             'VARCHAR(2)',   '기간',     4, 1, 'system', NOW(), NOW());

-- ── 사업부/조직(Organization) 그룹 ──
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('ZCOMP',      'BW.ZFICO_T01', '회사코드',         'VARCHAR(4)',   '조직',     10, 1, 'system', NOW(), NOW()),
('ZPLANT',     'BW.ZFICO_T01', '플랜트',           'VARCHAR(4)',   '조직',     11, 1, 'system', NOW(), NOW()),
('ZPROFIT_CTR','BW.ZFICO_T01', '손익센터',         'VARCHAR(10)',  '조직',     12, 1, 'system', NOW(), NOW()),
('ZCOST_CTR',  'BW.ZFICO_T01', '원가센터',         'VARCHAR(10)',  '조직',     13, 1, 'system', NOW(), NOW()),
('ZDIVISION',  'BW.ZFICO_T01', '사업부',           'VARCHAR(4)',   '조직',     14, 1, 'system', NOW(), NOW());

-- ── 제품/자재(Product) 그룹 ──
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('ZMATNR',     'BW.ZFICO_T01', '자재번호',         'VARCHAR(18)',  '제품',     20, 1, 'system', NOW(), NOW()),
('ZBRAND',     'BW.ZFICO_T01', '브랜드',           'VARCHAR(10)',  '제품',     21, 1, 'system', NOW(), NOW()),
('ZPROD_GRP',  'BW.ZFICO_T01', '제품군',           'VARCHAR(10)',  '제품',     22, 1, 'system', NOW(), NOW()),
('ZPROD_LINE', 'BW.ZFICO_T01', '제품라인',         'VARCHAR(10)',  '제품',     23, 1, 'system', NOW(), NOW());

-- ── 거래처/고객(Customer) 그룹 ──
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('ZCUSTOMER',  'BW.ZFICO_T01', '거래처코드',       'VARCHAR(10)',  '거래처',   30, 1, 'system', NOW(), NOW()),
('ZCHANNEL',   'BW.ZFICO_T01', '유통채널',         'VARCHAR(4)',   '거래처',   31, 1, 'system', NOW(), NOW()),
('ZREGION',    'BW.ZFICO_T01', '판매지역',         'VARCHAR(6)',   '거래처',   32, 1, 'system', NOW(), NOW());

-- ── 금액/수량(Amount) 그룹 ──
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('ZAMT001',    'BW.ZFICO_T01', '총매출액',         'DECIMAL(17,2)','금액',     40, 1, 'system', NOW(), NOW()),
('ZAMT002',    'BW.ZFICO_T01', '매출할인',         'DECIMAL(17,2)','금액',     41, 1, 'system', NOW(), NOW()),
('ZAMT003',    'BW.ZFICO_T01', '매출원가',         'DECIMAL(17,2)','금액',     42, 1, 'system', NOW(), NOW()),
('ZAMT004',    'BW.ZFICO_T01', '매출에누리',       'DECIMAL(17,2)','금액',     43, 1, 'system', NOW(), NOW()),
('ZAMT005',    'BW.ZFICO_T01', '판매관리비',       'DECIMAL(17,2)','금액',     44, 1, 'system', NOW(), NOW()),
('ZAMT006',    'BW.ZFICO_T01', '물류비',           'DECIMAL(17,2)','금액',     45, 1, 'system', NOW(), NOW()),
('ZAMT007',    'BW.ZFICO_T01', '광고선전비',       'DECIMAL(17,2)','금액',     46, 1, 'system', NOW(), NOW()),
('ZAMT008',    'BW.ZFICO_T01', '연구개발비',       'DECIMAL(17,2)','금액',     47, 1, 'system', NOW(), NOW()),
('ZQTY_BOX',   'BW.ZFICO_T01', '수량(BOX)',        'DECIMAL(13,3)','수량',     50, 1, 'system', NOW(), NOW()),
('ZQTY_EA',    'BW.ZFICO_T01', '수량(EA)',         'DECIMAL(13,3)','수량',     51, 1, 'system', NOW(), NOW());

-- ── 마스터 테이블 컬럼 (BW.ZFICO_M01: 자재마스터) ──
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('ZMATNR',     'BW.ZFICO_M01', '자재번호',         'VARCHAR(18)',  '마스터',   60, 1, 'system', NOW(), NOW()),
('ZMAKTX',     'BW.ZFICO_M01', '자재명',           'VARCHAR(100)', '마스터',   61, 1, 'system', NOW(), NOW()),
('ZBRAND_NM',  'BW.ZFICO_M01', '브랜드명',         'VARCHAR(100)', '마스터',   62, 1, 'system', NOW(), NOW()),
('ZPROD_GRP_NM','BW.ZFICO_M01','제품군명',         'VARCHAR(100)', '마스터',   63, 1, 'system', NOW(), NOW());

-- ── 마스터 테이블 컬럼 (BW.ZFICO_M02: 거래처마스터) ──
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('ZCUSTOMER',  'BW.ZFICO_M02', '거래처코드',       'VARCHAR(10)',  '마스터',   70, 1, 'system', NOW(), NOW()),
('ZCUST_NM',   'BW.ZFICO_M02', '거래처명',         'VARCHAR(100)', '마스터',   71, 1, 'system', NOW(), NOW()),
('ZCHANNEL_NM','BW.ZFICO_M02', '유통채널명',       'VARCHAR(100)', '마스터',   72, 1, 'system', NOW(), NOW()),
('ZREGION_NM', 'BW.ZFICO_M02', '판매지역명',       'VARCHAR(100)', '마스터',   73, 1, 'system', NOW(), NOW());


-- ============================================================
-- 2. Ontology Synonym (컬럼 동의어)
-- ============================================================

-- 기간 관련 동의어
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE, IS_ACTIVE, CREATED_AT)
SELECT oc.ONTOLOGY_COLUMN_ID, s.SYNONYM_TEXT, 'MANUAL', 1, NOW()
FROM profit_ontology_column oc
JOIN (
    SELECT 'ZYEAR' AS COL, 'BW.ZFICO_T01' AS TBL, '연도' AS SYNONYM_TEXT UNION ALL
    SELECT 'ZYEAR',  'BW.ZFICO_T01', '년도' UNION ALL
    SELECT 'ZYEAR',  'BW.ZFICO_T01', '회계년도' UNION ALL
    SELECT 'ZMONTH', 'BW.ZFICO_T01', '월' UNION ALL
    SELECT 'ZMONTH', 'BW.ZFICO_T01', '월별' UNION ALL
    SELECT 'ZPERIOD','BW.ZFICO_T01', '기간' UNION ALL
    SELECT 'ZPERIOD','BW.ZFICO_T01', '회계기간' UNION ALL
    SELECT 'ZQUARTER','BW.ZFICO_T01','분기' UNION ALL
    SELECT 'ZQUARTER','BW.ZFICO_T01','Q'
) s ON oc.COLUMN_NAME = s.COL AND oc.TABLE_NAME = s.TBL;

-- 조직 관련 동의어
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE, IS_ACTIVE, CREATED_AT)
SELECT oc.ONTOLOGY_COLUMN_ID, s.SYNONYM_TEXT, 'MANUAL', 1, NOW()
FROM profit_ontology_column oc
JOIN (
    SELECT 'ZCOMP' AS COL, 'BW.ZFICO_T01' AS TBL, '회사' AS SYNONYM_TEXT UNION ALL
    SELECT 'ZCOMP',       'BW.ZFICO_T01', '법인' UNION ALL
    SELECT 'ZPLANT',      'BW.ZFICO_T01', '공장' UNION ALL
    SELECT 'ZPLANT',      'BW.ZFICO_T01', '사업장' UNION ALL
    SELECT 'ZPROFIT_CTR', 'BW.ZFICO_T01', '손익센터' UNION ALL
    SELECT 'ZPROFIT_CTR', 'BW.ZFICO_T01', 'PC' UNION ALL
    SELECT 'ZCOST_CTR',   'BW.ZFICO_T01', '코스트센터' UNION ALL
    SELECT 'ZCOST_CTR',   'BW.ZFICO_T01', 'CC' UNION ALL
    SELECT 'ZDIVISION',   'BW.ZFICO_T01', '사업부' UNION ALL
    SELECT 'ZDIVISION',   'BW.ZFICO_T01', '사업본부' UNION ALL
    SELECT 'ZDIVISION',   'BW.ZFICO_T01', 'BU'
) s ON oc.COLUMN_NAME = s.COL AND oc.TABLE_NAME = s.TBL;

-- 제품 관련 동의어
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE, IS_ACTIVE, CREATED_AT)
SELECT oc.ONTOLOGY_COLUMN_ID, s.SYNONYM_TEXT, 'MANUAL', 1, NOW()
FROM profit_ontology_column oc
JOIN (
    SELECT 'ZMATNR' AS COL, 'BW.ZFICO_T01' AS TBL, '자재' AS SYNONYM_TEXT UNION ALL
    SELECT 'ZMATNR',    'BW.ZFICO_T01', '제품번호' UNION ALL
    SELECT 'ZMATNR',    'BW.ZFICO_T01', '품번' UNION ALL
    SELECT 'ZBRAND',    'BW.ZFICO_T01', '브랜드' UNION ALL
    SELECT 'ZBRAND',    'BW.ZFICO_T01', '브랜드코드' UNION ALL
    SELECT 'ZPROD_GRP', 'BW.ZFICO_T01', '제품군' UNION ALL
    SELECT 'ZPROD_GRP', 'BW.ZFICO_T01', '카테고리' UNION ALL
    SELECT 'ZPROD_LINE','BW.ZFICO_T01', '제품라인' UNION ALL
    SELECT 'ZPROD_LINE','BW.ZFICO_T01', '라인'
) s ON oc.COLUMN_NAME = s.COL AND oc.TABLE_NAME = s.TBL;

-- 거래처 관련 동의어
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE, IS_ACTIVE, CREATED_AT)
SELECT oc.ONTOLOGY_COLUMN_ID, s.SYNONYM_TEXT, 'MANUAL', 1, NOW()
FROM profit_ontology_column oc
JOIN (
    SELECT 'ZCUSTOMER' AS COL, 'BW.ZFICO_T01' AS TBL, '거래처' AS SYNONYM_TEXT UNION ALL
    SELECT 'ZCUSTOMER', 'BW.ZFICO_T01', '고객' UNION ALL
    SELECT 'ZCUSTOMER', 'BW.ZFICO_T01', '매출처' UNION ALL
    SELECT 'ZCHANNEL',  'BW.ZFICO_T01', '채널' UNION ALL
    SELECT 'ZCHANNEL',  'BW.ZFICO_T01', '유통채널' UNION ALL
    SELECT 'ZCHANNEL',  'BW.ZFICO_T01', '판매채널' UNION ALL
    SELECT 'ZREGION',   'BW.ZFICO_T01', '지역' UNION ALL
    SELECT 'ZREGION',   'BW.ZFICO_T01', '판매지역' UNION ALL
    SELECT 'ZREGION',   'BW.ZFICO_T01', '권역'
) s ON oc.COLUMN_NAME = s.COL AND oc.TABLE_NAME = s.TBL;

-- 금액/수량 관련 동의어
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE, IS_ACTIVE, CREATED_AT)
SELECT oc.ONTOLOGY_COLUMN_ID, s.SYNONYM_TEXT, 'MANUAL', 1, NOW()
FROM profit_ontology_column oc
JOIN (
    SELECT 'ZAMT001' AS COL, 'BW.ZFICO_T01' AS TBL, '총매출' AS SYNONYM_TEXT UNION ALL
    SELECT 'ZAMT001', 'BW.ZFICO_T01', '총매출액' UNION ALL
    SELECT 'ZAMT001', 'BW.ZFICO_T01', 'Gross Sales' UNION ALL
    SELECT 'ZAMT002', 'BW.ZFICO_T01', '할인' UNION ALL
    SELECT 'ZAMT002', 'BW.ZFICO_T01', '매출할인' UNION ALL
    SELECT 'ZAMT002', 'BW.ZFICO_T01', '할인액' UNION ALL
    SELECT 'ZAMT003', 'BW.ZFICO_T01', '원가' UNION ALL
    SELECT 'ZAMT003', 'BW.ZFICO_T01', '매출원가' UNION ALL
    SELECT 'ZAMT003', 'BW.ZFICO_T01', 'COGS' UNION ALL
    SELECT 'ZAMT004', 'BW.ZFICO_T01', '에누리' UNION ALL
    SELECT 'ZAMT004', 'BW.ZFICO_T01', '매출에누리' UNION ALL
    SELECT 'ZAMT005', 'BW.ZFICO_T01', '판관비' UNION ALL
    SELECT 'ZAMT005', 'BW.ZFICO_T01', '판매관리비' UNION ALL
    SELECT 'ZAMT005', 'BW.ZFICO_T01', 'SGA' UNION ALL
    SELECT 'ZAMT006', 'BW.ZFICO_T01', '물류비' UNION ALL
    SELECT 'ZAMT006', 'BW.ZFICO_T01', '배송비' UNION ALL
    SELECT 'ZAMT006', 'BW.ZFICO_T01', '운송비' UNION ALL
    SELECT 'ZAMT007', 'BW.ZFICO_T01', '광고비' UNION ALL
    SELECT 'ZAMT007', 'BW.ZFICO_T01', '광고선전비' UNION ALL
    SELECT 'ZAMT007', 'BW.ZFICO_T01', '마케팅비' UNION ALL
    SELECT 'ZAMT008', 'BW.ZFICO_T01', 'R&D' UNION ALL
    SELECT 'ZAMT008', 'BW.ZFICO_T01', '연구개발비' UNION ALL
    SELECT 'ZAMT008', 'BW.ZFICO_T01', '개발비' UNION ALL
    SELECT 'ZQTY_BOX','BW.ZFICO_T01', '수량(BOX)' UNION ALL
    SELECT 'ZQTY_BOX','BW.ZFICO_T01', '박스수량' UNION ALL
    SELECT 'ZQTY_BOX','BW.ZFICO_T01', 'BOX' UNION ALL
    SELECT 'ZQTY_EA', 'BW.ZFICO_T01', '수량(EA)' UNION ALL
    SELECT 'ZQTY_EA', 'BW.ZFICO_T01', '개수' UNION ALL
    SELECT 'ZQTY_EA', 'BW.ZFICO_T01', 'EA'
) s ON oc.COLUMN_NAME = s.COL AND oc.TABLE_NAME = s.TBL;

-- 마스터 관련 동의어
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE, IS_ACTIVE, CREATED_AT)
SELECT oc.ONTOLOGY_COLUMN_ID, s.SYNONYM_TEXT, 'MANUAL', 1, NOW()
FROM profit_ontology_column oc
JOIN (
    SELECT 'ZMAKTX' AS COL,     'BW.ZFICO_M01' AS TBL, '자재명' AS SYNONYM_TEXT UNION ALL
    SELECT 'ZMAKTX',            'BW.ZFICO_M01', '제품명' UNION ALL
    SELECT 'ZBRAND_NM',         'BW.ZFICO_M01', '브랜드명' UNION ALL
    SELECT 'ZPROD_GRP_NM',      'BW.ZFICO_M01', '제품군명' UNION ALL
    SELECT 'ZPROD_GRP_NM',      'BW.ZFICO_M01', '카테고리명' UNION ALL
    SELECT 'ZCUST_NM',          'BW.ZFICO_M02', '거래처명' UNION ALL
    SELECT 'ZCUST_NM',          'BW.ZFICO_M02', '고객명' UNION ALL
    SELECT 'ZCHANNEL_NM',       'BW.ZFICO_M02', '채널명' UNION ALL
    SELECT 'ZREGION_NM',        'BW.ZFICO_M02', '지역명'
) s ON oc.COLUMN_NAME = s.COL AND oc.TABLE_NAME = s.TBL;


-- ============================================================
-- 3. Metric (계산 지표 사전)
-- ============================================================
INSERT INTO profit_metric (METRIC_CODE, METRIC_NAME, AGGREGATION, FORMULA, TABLE_NAME, DESCRIPTION, DISPLAY_FORMAT, UNIT, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('GROSS_SALES',  '총매출',        'SUM', 'SUM(ZAMT001)',
 'BW.ZFICO_T01', '총매출액 합계',
 '#,##0', '원', 1, 1, 'system', NOW(), NOW()),

('NET_SALES',    '순매출',        'SUM', 'SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004)',
 'BW.ZFICO_T01', '총매출 - 매출할인 - 매출에누리',
 '#,##0', '원', 2, 1, 'system', NOW(), NOW()),

('COGS',         '매출원가',      'SUM', 'SUM(ZAMT003)',
 'BW.ZFICO_T01', '매출원가 합계',
 '#,##0', '원', 3, 1, 'system', NOW(), NOW()),

('GROSS_PROFIT', '매출총이익',    'SUM', 'SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004) - SUM(ZAMT003)',
 'BW.ZFICO_T01', '순매출 - 매출원가',
 '#,##0', '원', 4, 1, 'system', NOW(), NOW()),

('GP_RATE',      '매출총이익률',  'CALC','(SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004) - SUM(ZAMT003)) / NULLIF(SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004), 0) * 100',
 'BW.ZFICO_T01', '매출총이익 / 순매출 × 100',
 '#,##0.0', '%', 5, 1, 'system', NOW(), NOW()),

('SGA',          '판매관리비',    'SUM', 'SUM(ZAMT005)',
 'BW.ZFICO_T01', '판매관리비 합계',
 '#,##0', '원', 6, 1, 'system', NOW(), NOW()),

('OPER_PROFIT',  '영업이익',      'SUM', 'SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004) - SUM(ZAMT003) - SUM(ZAMT005)',
 'BW.ZFICO_T01', '매출총이익 - 판매관리비',
 '#,##0', '원', 7, 1, 'system', NOW(), NOW()),

('OP_RATE',      '영업이익률',    'CALC','(SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004) - SUM(ZAMT003) - SUM(ZAMT005)) / NULLIF(SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004), 0) * 100',
 'BW.ZFICO_T01', '영업이익 / 순매출 × 100',
 '#,##0.0', '%', 8, 1, 'system', NOW(), NOW()),

('LOGISTICS',    '물류비',        'SUM', 'SUM(ZAMT006)',
 'BW.ZFICO_T01', '물류비 합계',
 '#,##0', '원', 9, 1, 'system', NOW(), NOW()),

('ADVERTISING',  '광고선전비',    'SUM', 'SUM(ZAMT007)',
 'BW.ZFICO_T01', '광고선전비 합계',
 '#,##0', '원', 10, 1, 'system', NOW(), NOW()),

('RND',          '연구개발비',    'SUM', 'SUM(ZAMT008)',
 'BW.ZFICO_T01', '연구개발비 합계',
 '#,##0', '원', 11, 1, 'system', NOW(), NOW()),

('CONTRIB_MARGIN','공헌이익',     'SUM', 'SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004) - SUM(ZAMT003) - SUM(ZAMT006)',
 'BW.ZFICO_T01', '매출총이익 - 물류비',
 '#,##0', '원', 12, 1, 'system', NOW(), NOW()),

('QTY_BOX',      'BOX 수량',     'SUM', 'SUM(ZQTY_BOX)',
 'BW.ZFICO_T01', '판매 BOX 수량 합계',
 '#,##0', 'BOX', 20, 1, 'system', NOW(), NOW()),

('QTY_EA',       'EA 수량',      'SUM', 'SUM(ZQTY_EA)',
 'BW.ZFICO_T01', '판매 EA 수량 합계',
 '#,##0', 'EA', 21, 1, 'system', NOW(), NOW()),

('AVG_PRICE',    '평균단가',      'CALC','SUM(ZAMT001) / NULLIF(SUM(ZQTY_BOX), 0)',
 'BW.ZFICO_T01', '총매출액 / BOX 수량',
 '#,##0', '원/BOX', 22, 1, 'system', NOW(), NOW());


-- ============================================================
-- 4. Metric Synonym (지표 동의어)
-- ============================================================
INSERT INTO profit_metric_synonym (METRIC_ID, SYNONYM_TEXT, SYNONYM_SOURCE, IS_ACTIVE, CREATED_AT)
SELECT m.METRIC_ID, s.SYNONYM_TEXT, 'MANUAL', 1, NOW()
FROM profit_metric m
JOIN (
    SELECT 'GROSS_SALES' AS CODE, '총매출' AS SYNONYM_TEXT UNION ALL
    SELECT 'GROSS_SALES',  '총매출액' UNION ALL
    SELECT 'GROSS_SALES',  'Gross Sales' UNION ALL
    SELECT 'NET_SALES',    '순매출' UNION ALL
    SELECT 'NET_SALES',    '순매출액' UNION ALL
    SELECT 'NET_SALES',    'Net Sales' UNION ALL
    SELECT 'NET_SALES',    '매출액' UNION ALL
    SELECT 'COGS',         '원가' UNION ALL
    SELECT 'COGS',         '매출원가' UNION ALL
    SELECT 'COGS',         'Cost of Goods Sold' UNION ALL
    SELECT 'GROSS_PROFIT', '매출총이익' UNION ALL
    SELECT 'GROSS_PROFIT', 'GP' UNION ALL
    SELECT 'GROSS_PROFIT', '총이익' UNION ALL
    SELECT 'GROSS_PROFIT', 'Gross Profit' UNION ALL
    SELECT 'GP_RATE',      '매출총이익률' UNION ALL
    SELECT 'GP_RATE',      'GP율' UNION ALL
    SELECT 'GP_RATE',      '총이익률' UNION ALL
    SELECT 'GP_RATE',      'GP Rate' UNION ALL
    SELECT 'SGA',          '판관비' UNION ALL
    SELECT 'SGA',          '판매관리비' UNION ALL
    SELECT 'SGA',          'SG&A' UNION ALL
    SELECT 'OPER_PROFIT',  '영업이익' UNION ALL
    SELECT 'OPER_PROFIT',  'OP' UNION ALL
    SELECT 'OPER_PROFIT',  'Operating Profit' UNION ALL
    SELECT 'OP_RATE',      '영업이익률' UNION ALL
    SELECT 'OP_RATE',      'OP율' UNION ALL
    SELECT 'OP_RATE',      'OP Rate' UNION ALL
    SELECT 'LOGISTICS',    '물류비' UNION ALL
    SELECT 'LOGISTICS',    '배송비' UNION ALL
    SELECT 'LOGISTICS',    '운송비' UNION ALL
    SELECT 'ADVERTISING',  '광고비' UNION ALL
    SELECT 'ADVERTISING',  '광고선전비' UNION ALL
    SELECT 'ADVERTISING',  '마케팅비' UNION ALL
    SELECT 'RND',          'R&D' UNION ALL
    SELECT 'RND',          '연구개발비' UNION ALL
    SELECT 'RND',          '개발비' UNION ALL
    SELECT 'CONTRIB_MARGIN','공헌이익' UNION ALL
    SELECT 'CONTRIB_MARGIN','CM' UNION ALL
    SELECT 'CONTRIB_MARGIN','Contribution Margin' UNION ALL
    SELECT 'QTY_BOX',      'BOX수량' UNION ALL
    SELECT 'QTY_BOX',      '박스수량' UNION ALL
    SELECT 'QTY_BOX',      '출고수량' UNION ALL
    SELECT 'QTY_EA',       'EA수량' UNION ALL
    SELECT 'QTY_EA',       '개수' UNION ALL
    SELECT 'AVG_PRICE',    '평균단가' UNION ALL
    SELECT 'AVG_PRICE',    '단가' UNION ALL
    SELECT 'AVG_PRICE',    'ASP'
) s ON m.METRIC_CODE = s.CODE;


-- ============================================================
-- 5. JOIN Condition (테이블 간 연결 조건)
-- ============================================================
INSERT INTO profit_join_condition (JOIN_NAME, LEFT_COLUMN, LEFT_TABLE, RIGHT_COLUMN, RIGHT_TABLE, JOIN_TYPE, OPERATOR, SORT_ORDER, IS_ACTIVE, CREATED_BY, CREATED_AT, UPDATED_AT)
VALUES
('실적↔자재마스터',    'ZMATNR',    'BW.ZFICO_T01', 'ZMATNR',    'BW.ZFICO_M01', 'LEFT', '=', 1, 1, 'system', NOW(), NOW()),
('실적↔거래처마스터',  'ZCUSTOMER', 'BW.ZFICO_T01', 'ZCUSTOMER', 'BW.ZFICO_M02', 'LEFT', '=', 2, 1, 'system', NOW(), NOW());


-- ============================================================
-- 6. Batch Status (배치 실행 이력 샘플)
-- ============================================================
INSERT INTO profit_batch_status (BATCH_NAME, BATCH_TYPE, SOURCE_SYSTEM, TARGET_TABLE, STATUS, TOTAL_ROWS, PROCESSED_ROWS, ERROR_ROWS, PERIOD_YEAR, PERIOD_MONTH, STARTED_AT, COMPLETED_AT, EXECUTION_TIME_MS, CREATED_BY, CREATED_AT)
VALUES
('2025년 1월 마감 데이터 적재',  'MONTHLY_CLOSE', 'SAP BW', 'BW.ZFICO_T01', 'COMPLETED',           125000, 125000, 0,   2025, 1, '2025-02-05 02:00:00', '2025-02-05 02:15:30', 930000,  'batch_admin', '2025-02-05 01:59:00'),
('2025년 2월 마감 데이터 적재',  'MONTHLY_CLOSE', 'SAP BW', 'BW.ZFICO_T01', 'COMPLETED',           132000, 132000, 0,   2025, 2, '2025-03-05 02:00:00', '2025-03-05 02:18:45', 1125000, 'batch_admin', '2025-03-05 01:59:00'),
('2025년 3월 마감 데이터 적재',  'MONTHLY_CLOSE', 'SAP BW', 'BW.ZFICO_T01', 'COMPLETED_WITH_ERRORS',140000, 139850, 150, 2025, 3, '2025-04-04 02:00:00', '2025-04-04 02:22:10', 1330000, 'batch_admin', '2025-04-04 01:59:00'),
('2025년 1월 데이터 정합성 검증','VALIDATION',     'SYSTEM',  'BW.ZFICO_T01', 'COMPLETED',           125000, 125000, 0,   2025, 1, '2025-02-05 03:00:00', '2025-02-05 03:05:20', 320000,  'batch_admin', '2025-02-05 02:59:00'),
('2025년 2월 데이터 정합성 검증','VALIDATION',     'SYSTEM',  'BW.ZFICO_T01', 'COMPLETED',           132000, 132000, 0,   2025, 2, '2025-03-05 03:00:00', '2025-03-05 03:06:15', 375000,  'batch_admin', '2025-03-05 02:59:00'),
('자재마스터 동기화',            'MASTER_SYNC',    'SAP BW', 'BW.ZFICO_M01', 'COMPLETED',           5200,   5200,   0,   2025, 3, '2025-04-01 01:00:00', '2025-04-01 01:01:30', 90000,   'batch_admin', '2025-04-01 00:59:00'),
('거래처마스터 동기화',          'MASTER_SYNC',    'SAP BW', 'BW.ZFICO_M02', 'COMPLETED',           1800,   1800,   0,   2025, 3, '2025-04-01 01:02:00', '2025-04-01 01:02:45', 45000,   'batch_admin', '2025-04-01 01:01:30');


-- ============================================================
-- 7. NL Query History (자연어 질의 이력 샘플)
-- ============================================================
INSERT INTO profit_nl_query_history (USER_ID, USER_NAME, NATURAL_QUERY, GENERATED_SQL, QUERY_MODE, RESULT_COUNT, RESULT_SUMMARY, METRICS_USED, FILTERS_USED, DATA_SOURCE, EXECUTION_TIME_MS, STATUS, FEEDBACK_SCORE, FEEDBACK_COMMENT, IS_BOOKMARKED, CREATED_AT)
VALUES
(1, 'admin', '2025년 1분기 사업부별 순매출 보여줘',
 'SELECT t.ZDIVISION, SUM(t.ZAMT001) - SUM(t.ZAMT002) - SUM(t.ZAMT004) AS NET_SALES FROM BW.ZFICO_T01 t WHERE t.ZYEAR = ''2025'' AND t.ZMONTH IN (''01'',''02'',''03'') GROUP BY t.ZDIVISION ORDER BY NET_SALES DESC',
 'NLQ', 5, '2025년 1분기 사업부별 순매출: 식품사업부 150억, 음료사업부 120억, 생활용품사업부 80억 등',
 'NET_SALES', 'ZYEAR=2025, ZMONTH IN (01,02,03)', 'BW.ZFICO_T01',
 1250, 'SUCCESS', 5, '정확한 결과입니다', 1, '2025-04-10 09:30:00'),

(1, 'admin', '지난달 브랜드별 매출총이익률 Top 10',
 'SELECT m.ZBRAND_NM, (SUM(t.ZAMT001)-SUM(t.ZAMT002)-SUM(t.ZAMT004)-SUM(t.ZAMT003)) / NULLIF(SUM(t.ZAMT001)-SUM(t.ZAMT002)-SUM(t.ZAMT004),0)*100 AS GP_RATE FROM BW.ZFICO_T01 t LEFT JOIN BW.ZFICO_M01 m ON t.ZMATNR=m.ZMATNR WHERE t.ZPERIOD=''202503'' GROUP BY m.ZBRAND_NM ORDER BY GP_RATE DESC LIMIT 10',
 'NLQ', 10, '2025년 3월 브랜드별 GP율 Top10: 프리미엄A 42.3%, 브랜드B 38.1% ...',
 'GP_RATE', 'ZPERIOD=202503', 'BW.ZFICO_T01, BW.ZFICO_M01',
 2100, 'SUCCESS', 4, NULL, 1, '2025-04-10 10:15:00'),

(2, 'analyst01', '서울 지역 거래처 중 매출 상위 20개 거래처',
 'SELECT m2.ZCUST_NM, SUM(t.ZAMT001)-SUM(t.ZAMT002)-SUM(t.ZAMT004) AS NET_SALES FROM BW.ZFICO_T01 t LEFT JOIN BW.ZFICO_M02 m2 ON t.ZCUSTOMER=m2.ZCUSTOMER WHERE m2.ZREGION_NM LIKE ''서울%'' AND t.ZYEAR=''2025'' GROUP BY m2.ZCUST_NM ORDER BY NET_SALES DESC LIMIT 20',
 'NLQ', 20, '서울 지역 매출 상위 20개 거래처 조회 완료',
 'NET_SALES', 'ZREGION_NM LIKE 서울%, ZYEAR=2025', 'BW.ZFICO_T01, BW.ZFICO_M02',
 1850, 'SUCCESS', NULL, NULL, 0, '2025-04-11 14:20:00'),

(2, 'analyst01', '전년 동기 대비 영업이익 증감률',
 NULL, 'NLQ', NULL, NULL, NULL, NULL, NULL,
 NULL, 'FAILED', NULL, NULL, 0, '2025-04-11 15:00:00'),

(1, 'admin', '월별 물류비 추이 차트로 보여줘',
 'SELECT t.ZPERIOD, SUM(t.ZAMT006) AS LOGISTICS FROM BW.ZFICO_T01 t WHERE t.ZYEAR = ''2025'' GROUP BY t.ZPERIOD ORDER BY t.ZPERIOD',
 'NLQ', 3, '2025년 월별 물류비: 1월 5.2억, 2월 4.8억, 3월 6.1억',
 'LOGISTICS', 'ZYEAR=2025', 'BW.ZFICO_T01',
 980, 'SUCCESS', 5, '차트가 깔끔하게 나왔습니다', 0, '2025-04-12 11:00:00');

-- 실패 질의에 에러메시지 업데이트
UPDATE profit_nl_query_history
SET ERROR_MESSAGE = '전년 동기 비교를 위한 기간 매핑에 실패했습니다. "전년 동기"라는 표현을 해석하기 위해 현재 기간 정보가 필요합니다.'
WHERE NATURAL_QUERY = '전년 동기 대비 영업이익 증감률';


-- ============================================================
-- 8. Mapping Inbox (미매핑 표현 수집)
-- ============================================================
INSERT INTO profit_mapping_inbox (UNMAPPED_TERM, TERM_TYPE, ORIGINAL_QUERY, SUGGESTED_COLUMN, SUGGESTED_METRIC_CODE, OCCURRENCE_COUNT, STATUS, CREATED_AT, UPDATED_AT)
VALUES
('전년 동기',        'FILTER',  '전년 동기 대비 영업이익 증감률',          NULL,       NULL,          3, 'PENDING',  NOW(), NOW()),
('YoY',             'FILTER',  '매출 YoY 성장률',                        NULL,       NULL,          2, 'PENDING',  NOW(), NOW()),
('마진',            'METRIC',  '브랜드별 마진 비교',                      NULL,       'GROSS_PROFIT',1, 'PENDING',  NOW(), NOW()),
('톤수',            'COLUMN',  '월별 톤수 기준 출고량',                   'ZQTY_TON', NULL,          1, 'PENDING',  NOW(), NOW()),
('직매장',          'VALUE',   '직매장 채널 매출 현황',                   NULL,       NULL,          2, 'PENDING',  NOW(), NOW()),
('MBS',             'COLUMN',  'MBS별 실적 분석',                        NULL,       NULL,          1, 'PENDING',  NOW(), NOW()),
('변동비',          'METRIC',  '고정비 변동비 구분 분석',                 NULL,       NULL,          1, 'PENDING',  NOW(), NOW()),
('전월 대비',       'FILTER',  '전월 대비 매출 증감',                     NULL,       NULL,          4, 'PENDING',  NOW(), NOW()),
('기여도',          'METRIC',  '사업부별 매출 기여도',                    NULL,       NULL,          2, 'PENDING',  NOW(), NOW());

-- APPROVED 샘플 (이미 처리된 항목)
INSERT INTO profit_mapping_inbox (UNMAPPED_TERM, TERM_TYPE, ORIGINAL_QUERY, SUGGESTED_COLUMN, SUGGESTED_METRIC_CODE, OCCURRENCE_COUNT, STATUS, RESOLVED_BY, RESOLVED_AT, RESOLUTION_NOTE, CREATED_AT, UPDATED_AT)
VALUES
('매출',  'METRIC', '이번달 매출 얼마야', NULL, 'NET_SALES', 15, 'APPROVED', 'admin', NOW(), '매출은 순매출(NET_SALES)로 매핑', DATE_SUB(NOW(), INTERVAL 7 DAY), NOW()),
('이익',  'METRIC', '사업부별 이익 비교', NULL, 'OPER_PROFIT',8, 'APPROVED', 'admin', NOW(), '이익은 영업이익(OPER_PROFIT)으로 매핑', DATE_SUB(NOW(), INTERVAL 5 DAY), NOW());

-- REJECTED 샘플
INSERT INTO profit_mapping_inbox (UNMAPPED_TERM, TERM_TYPE, ORIGINAL_QUERY, SUGGESTED_COLUMN, SUGGESTED_METRIC_CODE, OCCURRENCE_COUNT, STATUS, RESOLVED_BY, RESOLVED_AT, RESOLUTION_NOTE, CREATED_AT, UPDATED_AT)
VALUES
('날씨',  'COLUMN', '날씨별 매출 분석', NULL, NULL, 1, 'REJECTED', 'admin', NOW(), 'BW 데이터에 날씨 정보 없음. 외부 데이터 연동 필요', DATE_SUB(NOW(), INTERVAL 3 DAY), NOW());

-- ============================================================
-- END OF SEED DATA
-- ============================================================
