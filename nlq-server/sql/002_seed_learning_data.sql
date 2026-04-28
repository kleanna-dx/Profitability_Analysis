-- ============================================================
-- 학습관리 시드 데이터 (Ontology / Metric / JOIN)
-- DB: company_board
-- 실행 전 001_create_learning_tables.sql 먼저 실행 필요
-- ============================================================

-- ============================================================
-- 1) Ontology 컬럼 시드
-- ============================================================
INSERT IGNORE INTO ontology_column (column_name, table_name, description, data_type) VALUES
('CALMONTH',      'bw_profitability_data', '달력연도/월',         'VARCHAR(10)'),
('CALDAY',        'bw_profitability_data', '달력일',             'VARCHAR(10)'),
('PROFIT_CTR',    'bw_profitability_data', '손익 센터',          'VARCHAR(20)'),
('PROFIT_CTR_NM', 'bw_profitability_data', '손익센터명',         'VARCHAR(100)'),
('DIVISION',      'bw_profitability_data', '제품군 코드',        'VARCHAR(20)'),
('DIVISION_NM',   'bw_profitability_data', '제품군명',           'VARCHAR(100)'),
('PLANT',         'bw_profitability_data', '플랜트 코드',        'VARCHAR(10)'),
('PLANT_NM',      'bw_profitability_data', '플랜트명',           'VARCHAR(100)'),
('DISTR_CHAN',    'bw_profitability_data', '유통 경로',          'VARCHAR(10)'),
('DISTR_CHAN_NM', 'bw_profitability_data', '유통경로명',         'VARCHAR(100)'),
('ZDISTCHAN',     'bw_profitability_data', '내수/수출구분자',     'VARCHAR(10)'),
('ZDISTCHAN_NM',  'bw_profitability_data', '내수/수출구분자명',   'VARCHAR(100)'),
('SALES_OFF',     'bw_profitability_data', '사업장 코드',        'VARCHAR(20)'),
('SALES_OFF_NM',  'bw_profitability_data', '사업장명',           'VARCHAR(100)'),
('MATL_TYPE',     'bw_profitability_data', '자재유형',           'VARCHAR(10)'),
('PRODH1',        'bw_profitability_data', '제품계층1 코드',     'VARCHAR(10)'),
('PRODH1_NM',     'bw_profitability_data', '제품계층1명',        'VARCHAR(100)'),
('ZBRAND',        'bw_profitability_data', '브랜드1 코드',       'VARCHAR(20)'),
('ZBRAND_NM',     'bw_profitability_data', '브랜드1명',          'VARCHAR(100)'),
('CUSTOMER',      'bw_profitability_data', '고객 코드',          'VARCHAR(20)'),
('CUSTOMER_NM',   'bw_profitability_data', '고객명',             'VARCHAR(200)'),
('MATERIAL',      'bw_profitability_data', '자재 코드',          'VARCHAR(40)'),
('MATERIAL_NM',   'bw_profitability_data', '자재명',             'VARCHAR(200)'),
('CUST_GROUP',    'bw_profitability_data', '고객 그룹',          'VARCHAR(10)'),
('CUST_GROUP_NM', 'bw_profitability_data', '고객그룹명',         'VARCHAR(100)'),
('ZORG_TEAM',     'bw_profitability_data', '영업팀(사업장그룹)',   'VARCHAR(20)'),
('ZJPCODE',       'bw_profitability_data', '지종/제품구분',       'VARCHAR(10)'),
('ZJPCODE_NM',    'bw_profitability_data', '지종/제품구분명',     'VARCHAR(100)'),
('ZQTY_BOX',      'bw_profitability_data', '수량(BOX)',          'DECIMAL(18,3)'),
('ZQTY_BAG',      'bw_profitability_data', '수량(BAG)',          'DECIMAL(18,3)'),
('ZQTY_KE',       'bw_profitability_data', '수량(KG/EA)',        'DECIMAL(18,3)');

-- ============================================================
-- 2) Ontology 동의어 시드
-- ============================================================
INSERT IGNORE INTO ontology_synonym (column_id, synonym_text) VALUES
((SELECT id FROM ontology_column WHERE column_name='CALMONTH'),   '월'),
((SELECT id FROM ontology_column WHERE column_name='CALMONTH'),   '연월'),
((SELECT id FROM ontology_column WHERE column_name='CALDAY'),     '일자'),
((SELECT id FROM ontology_column WHERE column_name='CALDAY'),     '날짜'),
((SELECT id FROM ontology_column WHERE column_name='PROFIT_CTR'), '손익센터'),
((SELECT id FROM ontology_column WHERE column_name='PROFIT_CTR'), 'PC'),
((SELECT id FROM ontology_column WHERE column_name='PROFIT_CTR_NM'), '손익센터명'),
((SELECT id FROM ontology_column WHERE column_name='DIVISION'),   '제품군'),
((SELECT id FROM ontology_column WHERE column_name='DIVISION_NM'),'제품군명'),
((SELECT id FROM ontology_column WHERE column_name='PLANT'),      '플랜트'),
((SELECT id FROM ontology_column WHERE column_name='PLANT'),      '공장'),
((SELECT id FROM ontology_column WHERE column_name='PLANT_NM'),   '플랜트명'),
((SELECT id FROM ontology_column WHERE column_name='DISTR_CHAN'), '유통경로'),
((SELECT id FROM ontology_column WHERE column_name='DISTR_CHAN_NM'), '유통경로명'),
((SELECT id FROM ontology_column WHERE column_name='MATERIAL'),   '자재'),
((SELECT id FROM ontology_column WHERE column_name='MATERIAL'),   '자재코드'),
((SELECT id FROM ontology_column WHERE column_name='CUSTOMER'),   '고객'),
((SELECT id FROM ontology_column WHERE column_name='CUSTOMER'),   '거래처');

-- ============================================================
-- 3) Metric 계산지표 시드
-- ============================================================
INSERT IGNORE INTO metric (metric_code, aggregation, formula, table_name, description) VALUES
('TOTAL_SALES',           'SUM',  'ZAMT001',                                                                                           'bw_profitability_data', '총매출'),
('SALES_INCENTIVE',       'SUM',  'ZAMT002',                                                                                           'bw_profitability_data', '판매장려금'),
('NET_SALES',             'SUM',  'ZAMT003',                                                                                           'bw_profitability_data', '순매출'),
('OTHER_SALES',           'SUM',  'ZAMT004',                                                                                           'bw_profitability_data', '기타매출'),
('COGS_PRODUCT',          'SUM',  'ZAMT005',                                                                                           'bw_profitability_data', '매출원가(제품)'),
('COGS_TOTAL',            'SUM',  'ZAMT034',                                                                                           'bw_profitability_data', '매출원가 계'),
('GROSS_PROFIT',          'SUM',  'ZAMT035',                                                                                           'bw_profitability_data', '매출총이익'),
('GROSS_PROFIT_RATE',     'CALC', 'SUM(ZAMT035) / NULLIF(SUM(ZAMT003),0) * 100',                                                      'bw_profitability_data', '매출총이익률(%)'),
('SGA',                   'SUM',  'ZAMT036',                                                                                           'bw_profitability_data', '판매관리비'),
('OPERATING_PROFIT',      'SUM',  'ZAMT055',                                                                                           'bw_profitability_data', '영업이익'),
('OPERATING_PROFIT_RATE', 'CALC', 'SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100',                                                      'bw_profitability_data', '영업이익률(%)'),
('ORDINARY_PROFIT',       'SUM',  'ZAMT064',                                                                                           'bw_profitability_data', '경상이익'),
('QTY_BOX',               'SUM',  'ZQTY_BOX',                                                                                          'bw_profitability_data', 'BOX수량'),
('QTY_BAG',               'SUM',  'ZQTY_BAG',                                                                                          'bw_profitability_data', 'BAG수량'),
('QTY_KE',                'SUM',  'ZQTY_KE',                                                                                           'bw_profitability_data', 'EA수량'),
('AVG_PRICE_BOX',         'CALC', 'SUM(ZAMT001) / NULLIF(SUM(ZQTY_BOX),0)',                                                           'bw_profitability_data', '평균단가(BOX)'),
('MATERIAL_COST',         'CALC', 'SUM(ZAMT006)+SUM(ZAMT007)+SUM(ZAMT008)+SUM(ZAMT009)+SUM(ZAMT010)+SUM(ZAMT011)',                     'bw_profitability_data', '재료비합계'),
('LABOR_COST',            'CALC', 'SUM(ZAMT012)+SUM(ZAMT013)+SUM(ZAMT014)',                                                            'bw_profitability_data', '인건비합계'),
('MARKETING_COST',        'CALC', 'SUM(ZAMT047)+SUM(ZAMT048)+SUM(ZAMT049)+SUM(ZAMT050)+SUM(ZAMT051)+SUM(ZAMT052)+SUM(ZAMT053)+SUM(ZAMT054)', 'bw_profitability_data', '마케팅비합계');

-- ============================================================
-- 4) Metric 동의어 시드
-- ============================================================
INSERT IGNORE INTO metric_synonym (metric_id, synonym_text) VALUES
((SELECT id FROM metric WHERE metric_code='TOTAL_SALES'),      '총매출'),
((SELECT id FROM metric WHERE metric_code='TOTAL_SALES'),      '매출액'),
((SELECT id FROM metric WHERE metric_code='TOTAL_SALES'),      '총매출액'),
((SELECT id FROM metric WHERE metric_code='NET_SALES'),        '순매출'),
((SELECT id FROM metric WHERE metric_code='NET_SALES'),        '순매출액'),
((SELECT id FROM metric WHERE metric_code='GROSS_PROFIT'),     '매출총이익'),
((SELECT id FROM metric WHERE metric_code='GROSS_PROFIT'),     '매출이익'),
((SELECT id FROM metric WHERE metric_code='OPERATING_PROFIT'), '영업이익'),
((SELECT id FROM metric WHERE metric_code='OPERATING_PROFIT'), '영업손익'),
((SELECT id FROM metric WHERE metric_code='ORDINARY_PROFIT'),  '경상이익'),
((SELECT id FROM metric WHERE metric_code='ORDINARY_PROFIT'),  '경상손익'),
((SELECT id FROM metric WHERE metric_code='QTY_BOX'),          'BOX수량'),
((SELECT id FROM metric WHERE metric_code='QTY_BOX'),          '박스수량'),
((SELECT id FROM metric WHERE metric_code='COGS_TOTAL'),       '매출원가'),
((SELECT id FROM metric WHERE metric_code='SGA'),              '판관비'),
((SELECT id FROM metric WHERE metric_code='SGA'),              '판매관리비'),
((SELECT id FROM metric WHERE metric_code='MARKETING_COST'),   '마케팅비');

-- ============================================================
-- 5) JOIN 조건 시드
-- ============================================================
INSERT IGNORE INTO join_condition (left_column, left_table, right_column, right_table, join_type, operator, description) VALUES
('PLANT',    'bw_profitability_data', 'PLANT',    'plant_master',    'INNER', '=', '플랜트 마스터 조인'),
('CUSTOMER', 'bw_profitability_data', 'CUSTOMER', 'customer_master', 'LEFT',  '=', '고객 마스터 조인'),
('MATERIAL', 'bw_profitability_data', 'MATERIAL', 'material_master', 'LEFT',  '=', '자재 마스터 조인');
