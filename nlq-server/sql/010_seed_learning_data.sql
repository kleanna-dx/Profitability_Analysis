-- ============================================================
-- 학습관리 시드 데이터 (Ontology / Metric / Code Mapping / JOIN)
-- ※ 실행 전 004_create_learning_tables.sql 먼저 실행 필요
-- ※ domain_code 기본값 'PS' (페이퍼솔루션사업부)
-- ============================================================


-- ============================================================
-- 1) Ontology 컬럼 시드 (PS 도메인)
-- ============================================================
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES
('PS', 'CALYEAR',       'bw_profitability_data', '달력연도',             'varchar(10)'),
('PS', 'CALMONTH',      'bw_profitability_data', '달력연도/월',         'varchar(10)'),
('PS', 'CALDAY',        'bw_profitability_data', '달력일',             'varchar(10)'),
('PS', 'CO_AREA',       'bw_profitability_data', '관리회계 영역',       'varchar(10)'),
('PS', 'CO_AREA_NM',    'bw_profitability_data', '관리회계 영역명',     'varchar(100)'),
('PS', 'PROFIT_CTR',    'bw_profitability_data', '손익 센터',          'varchar(20)'),
('PS', 'PROFIT_CTR_NM', 'bw_profitability_data', '손익센터명',         'varchar(100)'),
('PS', 'DIVISION',      'bw_profitability_data', '제품군 코드',        'varchar(5)'),
('PS', 'DIVISION_NM',   'bw_profitability_data', '제품군명',           'varchar(100)'),
('PS', 'PLANT',         'bw_profitability_data', '플랜트 코드',        'varchar(10)'),
('PS', 'PLANT_NM',      'bw_profitability_data', '플랜트명',           'varchar(100)'),
('PS', 'DISTR_CHAN',    'bw_profitability_data', '유통 경로',          'varchar(5)'),
('PS', 'DISTR_CHAN_NM', 'bw_profitability_data', '유통경로명',         'varchar(100)'),
('PS', 'ZDISTCHAN',     'bw_profitability_data', '내수/수출구분자(사업장)', 'varchar(5)'),
('PS', 'ZORG_TEAM',     'bw_profitability_data', '영업팀(사업장그룹)',   'varchar(10)'),
('PS', 'SALES_OFF',     'bw_profitability_data', '사업장 코드',        'varchar(10)'),
('PS', 'SALES_OFF_NM',  'bw_profitability_data', '사업장명',           'varchar(100)'),
('PS', 'MATL_TYPE',     'bw_profitability_data', '자재유형',           'varchar(10)'),
('PS', 'MATL_TYPE_NM',  'bw_profitability_data', '자재유형명',         'varchar(100)'),
('PS', 'MATL_GROUP',    'bw_profitability_data', '자재 그룹',          'varchar(10)'),
('PS', 'MATL_GROUP_NM', 'bw_profitability_data', '자재 그룹명',        'varchar(100)'),
('PS', 'PRODH1',        'bw_profitability_data', '제품계층 구조레벨 1', 'varchar(10)'),
('PS', 'PRODH1_NM',     'bw_profitability_data', '제품군 (제품군 대)',   'varchar(100)'),
('PS', 'PRODH2',        'bw_profitability_data', '제품 계층구조레벨 2', 'varchar(10)'),
('PS', 'PRODH2_NM',     'bw_profitability_data', '지종 (제품군 중)',     'varchar(100)'),
('PS', 'PRODH3',        'bw_profitability_data', '제품 계층구조레벨 3', 'varchar(15)'),
('PS', 'PRODH3_NM',     'bw_profitability_data', '품목군 (제품군 소)',   'varchar(100)'),
('PS', 'PRODH4',        'bw_profitability_data', '제품 계층구조레벨 4', 'varchar(20)'),
('PS', 'PRODH4_NM',     'bw_profitability_data', '스펙, 사이즈, 크기, 지폭', 'varchar(100)'),
('PS', 'ZJPCODE',       'bw_profitability_data', '지종/제품구분',       'varchar(10)'),
('PS', 'ZJPCODE_NM',    'bw_profitability_data', '지종/제품구분명',     'varchar(100)'),
('PS', 'ZBRAND',        'bw_profitability_data', '브랜드 1',           'varchar(10)'),
('PS', 'ZBRAND_NM',     'bw_profitability_data', '브랜드 1 명',        'varchar(100)'),
('PS', 'ZSBRAND',       'bw_profitability_data', '브랜드 2',           'varchar(10)'),
('PS', 'ZSBRAND_NM',    'bw_profitability_data', '브랜드 2 명',        'varchar(100)'),
('PS', 'BILL_TYPE',     'bw_profitability_data', '대금청구유형',       'varchar(10)'),
('PS', 'BILL_TYPE_NM',  'bw_profitability_data', '대금청구유형 명',    'varchar(100)'),
('PS', 'INCOTERMS',     'bw_profitability_data', '인도 조건',          'varchar(5)'),
('PS', 'INCOTERMS_NM',  'bw_profitability_data', '인도 조건 명',       'varchar(100)'),
('PS', 'CUST_GROUP',    'bw_profitability_data', '고객 그룹',          'varchar(5)'),
('PS', 'CUST_GROUP_NM', 'bw_profitability_data', '고객그룹 명',        'varchar(100)'),
('PS', 'CUST_GRP1',     'bw_profitability_data', '고객 그룹 1',        'varchar(5)'),
('PS', 'CUST_GRP1_NM',  'bw_profitability_data', '고객그룹1 명',       'varchar(100)'),
('PS', 'COUNTRY',       'bw_profitability_data', '국가',               'varchar(5)'),
('PS', 'COUNTRY_NM',    'bw_profitability_data', '국가 명',            'varchar(100)'),
('PS', 'ZKUNN2',        'bw_profitability_data', '영업사원',           'varchar(20)'),
('PS', 'ZKUNN2_NM',     'bw_profitability_data', '영업사원 명',        'varchar(100)'),
('PS', 'CUSTOMER',      'bw_profitability_data', '고객',               'varchar(20)'),
('PS', 'CUSTOMER_NM',   'bw_profitability_data', '고객 명',            'varchar(100)'),
('PS', 'MATERIAL',      'bw_profitability_data', '자재',               'varchar(30)'),
('PS', 'MATERIAL_NM',   'bw_profitability_data', '자재 명',            'varchar(100)'),
('PS', 'ZBOXUNIT',      'bw_profitability_data', 'BOX단위',            'varchar(5)'),
('PS', 'ZBAGUNIT',      'bw_profitability_data', 'BAG단위',            'varchar(5)'),
('PS', 'ZUNIT',         'bw_profitability_data', '기준수량단위(KG/EA)', 'varchar(5)'),
('PS', 'CURRENCY',      'bw_profitability_data', '통화',               'varchar(5)'),
('PS', 'ZQTY_BOX',      'bw_profitability_data', '수량(BOX)',          'decimal(18,3)'),
('PS', 'ZQTY_BAG',      'bw_profitability_data', '수량(BAG)',          'bigint(20)'),
('PS', 'ZQTY_KE',       'bw_profitability_data', '수량(KG/EA)',        'decimal(18,3)'),
('PS', 'ZAMT001',       'bw_profitability_data', '총매출',             'bigint(20)'),
('PS', 'ZAMT002',       'bw_profitability_data', '판매장려금',         'bigint(20)'),
('PS', 'ZAMT003',       'bw_profitability_data', '순매출',             'bigint(20)'),
('PS', 'ZAMT004',       'bw_profitability_data', '기타매출',           'bigint(20)'),
('PS', 'ZAMT005',       'bw_profitability_data', '매출원가(제품)',     'bigint(20)'),
('PS', 'ZAMT006',       'bw_profitability_data', '재료비-펄프',        'bigint(20)'),
('PS', 'ZAMT007',       'bw_profitability_data', '재료비-고지',        'bigint(20)'),
('PS', 'ZAMT008',       'bw_profitability_data', '재료비-패드',        'bigint(20)'),
('PS', 'ZAMT009',       'bw_profitability_data', '부재료비-약품',      'bigint(20)'),
('PS', 'ZAMT010',       'bw_profitability_data', '부재료비-포장재',    'bigint(20)'),
('PS', 'ZAMT011',       'bw_profitability_data', '재료비-기타',        'bigint(20)'),
('PS', 'ZAMT012',       'bw_profitability_data', '인건비',             'bigint(20)'),
('PS', 'ZAMT013',       'bw_profitability_data', '인건비_경비',        'bigint(20)'),
('PS', 'ZAMT014',       'bw_profitability_data', '인건비_기타',        'bigint(20)'),
('PS', 'ZAMT015',       'bw_profitability_data', '도급비',             'bigint(20)'),
('PS', 'ZAMT016',       'bw_profitability_data', '에너지비',           'bigint(20)'),
('PS', 'ZAMT017',       'bw_profitability_data', '전력비',             'bigint(20)'),
('PS', 'ZAMT018',       'bw_profitability_data', '감가상각비',         'bigint(20)'),
('PS', 'ZAMT019',       'bw_profitability_data', '수선/소모품비',      'bigint(20)'),
('PS', 'ZAMT020',       'bw_profitability_data', '기타경비',           'bigint(20)'),
('PS', 'ZAMT021',       'bw_profitability_data', '기타경비_폐기물',    'bigint(20)'),
('PS', 'ZAMT022',       'bw_profitability_data', '기타경비_세금과공과', 'bigint(20)'),
('PS', 'ZAMT023',       'bw_profitability_data', '기타경비_지급수수료', 'bigint(20)'),
('PS', 'ZAMT024',       'bw_profitability_data', '외주가공비',         'bigint(20)'),
('PS', 'ZAMT025',       'bw_profitability_data', '매출원가(상품)',     'bigint(20)'),
('PS', 'ZAMT026',       'bw_profitability_data', '매출원가(기타)',     'bigint(20)'),
('PS', 'ZAMT027',       'bw_profitability_data', '기타원가',           'bigint(20)'),
('PS', 'ZAMT028',       'bw_profitability_data', '단수차이',           'bigint(20)'),
('PS', 'ZAMT029',       'bw_profitability_data', '차이잔액',           'bigint(20)'),
('PS', 'ZAMT030',       'bw_profitability_data', '제조파지정산',       'bigint(20)'),
('PS', 'ZAMT031',       'bw_profitability_data', '기타매출원가+감모손+평가손', 'bigint(20)'),
('PS', 'ZAMT032',       'bw_profitability_data', '원재료 투입차이',    'bigint(20)'),
('PS', 'ZAMT033',       'bw_profitability_data', '기타매출원가 배부조', 'bigint(20)'),
('PS', 'ZAMT034',       'bw_profitability_data', '매출원가 계',        'bigint(20)'),
('PS', 'ZAMT035',       'bw_profitability_data', '매출총이익',         'bigint(20)'),
('PS', 'ZAMT036',       'bw_profitability_data', '판매관리비',         'bigint(20)'),
('PS', 'ZAMT037',       'bw_profitability_data', '급여(변동)',         'bigint(20)'),
('PS', 'ZAMT038',       'bw_profitability_data', '국내운반비(변동)',    'bigint(20)'),
('PS', 'ZAMT039',       'bw_profitability_data', '수출운반비(변동)',    'bigint(20)'),
('PS', 'ZAMT040',       'bw_profitability_data', '지급수수료(변동)',    'bigint(20)'),
('PS', 'ZAMT041',       'bw_profitability_data', '기타판관비(변동)',    'bigint(20)'),
('PS', 'ZAMT042',       'bw_profitability_data', '개발비(변동)',       'bigint(20)'),
('PS', 'ZAMT043',       'bw_profitability_data', '급여(고정)',         'bigint(20)'),
('PS', 'ZAMT044',       'bw_profitability_data', '지급수수료(고정)',    'bigint(20)'),
('PS', 'ZAMT045',       'bw_profitability_data', '기타판관비(고정)',    'bigint(20)'),
('PS', 'ZAMT046',       'bw_profitability_data', '개발비(고정)',       'bigint(20)'),
('PS', 'ZAMT047',       'bw_profitability_data', '마케팅비',           'bigint(20)'),
('PS', 'ZAMT048',       'bw_profitability_data', '광고비',             'bigint(20)'),
('PS', 'ZAMT049',       'bw_profitability_data', '소모품비',           'bigint(20)'),
('PS', 'ZAMT050',       'bw_profitability_data', '지급수수료-마케팅(변동)', 'bigint(20)'),
('PS', 'ZAMT051',       'bw_profitability_data', '지급수수료-마케팅(고정)', 'bigint(20)'),
('PS', 'ZAMT052',       'bw_profitability_data', '마케팅비_장려금(변동)', 'bigint(20)'),
('PS', 'ZAMT053',       'bw_profitability_data', '판촉비',             'bigint(20)'),
('PS', 'ZAMT054',       'bw_profitability_data', '마케팅비 배부조정',   'bigint(20)'),
('PS', 'ZAMT055',       'bw_profitability_data', '영업이익',           'bigint(20)'),
('PS', 'ZAMT056',       'bw_profitability_data', '영업외수익',         'bigint(20)'),
('PS', 'ZAMT057',       'bw_profitability_data', '이자수익',           'bigint(20)'),
('PS', 'ZAMT058',       'bw_profitability_data', '외환이익',           'bigint(20)'),
('PS', 'ZAMT059',       'bw_profitability_data', '기타영업외수익',     'bigint(20)'),
('PS', 'ZAMT060',       'bw_profitability_data', '영업외비용',         'bigint(20)'),
('PS', 'ZAMT061',       'bw_profitability_data', '이자비용',           'bigint(20)'),
('PS', 'ZAMT062',       'bw_profitability_data', '외환손실',           'bigint(20)'),
('PS', 'ZAMT063',       'bw_profitability_data', '기타영업외비용',     'bigint(20)'),
('PS', 'ZAMT064',       'bw_profitability_data', '경상이익',           'bigint(20)');


-- ============================================================
-- 2) Ontology 동의어 시드
-- ============================================================
INSERT IGNORE INTO ontology_synonym (column_id, synonym_text) VALUES
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CALYEAR'),      '연도'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CALYEAR'),      '년도'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CALMONTH'),     '월'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CALMONTH'),     '연월'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CALDAY'),       '일자'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CALDAY'),       '날짜'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PROFIT_CTR'),   '손익센터'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PROFIT_CTR'),   'PC'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PROFIT_CTR_NM'),'손익센터명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='DIVISION'),     '제품군'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='DIVISION_NM'),  '제품군명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PLANT'),        '플랜트'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PLANT'),        '공장'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PLANT_NM'),     '플랜트명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='DISTR_CHAN'),   '유통경로'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='DISTR_CHAN_NM'),'유통경로명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='SALES_OFF'),    '사업장'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='SALES_OFF_NM'), '사업장명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZBRAND'),       '브랜드'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZBRAND_NM'),    '브랜드명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZSBRAND'),      '서브브랜드'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZSBRAND_NM'),   '서브브랜드명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CUSTOMER'),     '고객'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CUSTOMER'),     '거래처'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CUSTOMER_NM'),  '고객명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='MATERIAL'),     '자재'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='MATERIAL'),     '자재코드'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='MATERIAL_NM'),  '자재명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='COUNTRY'),      '국가'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='COUNTRY_NM'),   '국가명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZJPCODE'),      '지종'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZJPCODE_NM'),   '지종명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZORG_TEAM'),    '영업팀'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZKUNN2'),       '영업사원'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZKUNN2_NM'),    '영업사원명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CUST_GROUP'),   '고객그룹'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='CUST_GROUP_NM'),'고객그룹명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='MATL_GROUP'),   '자재그룹'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='MATL_GROUP_NM'),'자재그룹명'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PRODH1'),       '제품계층1'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PRODH1_NM'),    '제품군대'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PRODH2'),       '제품계층2'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PRODH2_NM'),    '지종중분류'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PRODH3'),       '제품계층3'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='PRODH3_NM'),    '품목군'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZQTY_BOX'),     'BOX수량'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZQTY_BOX'),     '박스수량'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZQTY_BOX'),     '판매수량'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZQTY_BAG'),     'BAG수량'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZQTY_KE'),      'EA수량'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZQTY_KE'),      'KG수량'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT001'),      '총매출'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT001'),      '매출액'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT003'),      '순매출'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT034'),      '매출원가'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT035'),      '매출총이익'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT036'),      '판관비'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT036'),      '판매관리비'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT055'),      '영업이익'),
((SELECT id FROM ontology_column WHERE domain_code='PS' AND column_name='ZAMT064'),      '경상이익');


-- ============================================================
-- 3) Metric 계산지표 시드 (PS 도메인)
-- ============================================================
INSERT IGNORE INTO metric (domain_code, metric_code, aggregation, formula, table_name, description) VALUES
('PS', 'TOTAL_SALES',           'SUM',  'ZAMT001',                                'bw_profitability_data', '총매출'),
('PS', 'SALES_INCENTIVE',       'SUM',  'ZAMT002',                                'bw_profitability_data', '판매장려금'),
('PS', 'NET_SALES',             'SUM',  'ZAMT003',                                'bw_profitability_data', '순매출'),
('PS', 'OTHER_SALES',           'SUM',  'ZAMT004',                                'bw_profitability_data', '기타매출'),
('PS', 'COGS_PRODUCT',          'SUM',  'ZAMT005',                                'bw_profitability_data', '매출원가(제품)'),
('PS', 'COGS_TOTAL',            'SUM',  'ZAMT034',                                'bw_profitability_data', '매출원가 계'),
('PS', 'GROSS_PROFIT',          'SUM',  'ZAMT035',                                'bw_profitability_data', '매출총이익'),
('PS', 'GROSS_PROFIT_RATE',     'CALC', 'SUM(ZAMT035) / NULLIF(SUM(ZAMT003),0) * 100', 'bw_profitability_data', '매출총이익률(%)'),
('PS', 'SGA',                   'SUM',  'ZAMT036',                                'bw_profitability_data', '판매관리비'),
('PS', 'OPERATING_PROFIT',      'SUM',  'ZAMT055',                                'bw_profitability_data', '영업이익'),
('PS', 'OPERATING_PROFIT_RATE', 'CALC', 'SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100', 'bw_profitability_data', '영업이익률(%)'),
('PS', 'ORDINARY_PROFIT',       'SUM',  'ZAMT064',                                'bw_profitability_data', '경상이익'),
('PS', 'QTY_BOX',               'SUM',  'ZQTY_BOX',                               'bw_profitability_data', 'BOX수량'),
('PS', 'QTY_BAG',               'SUM',  'ZQTY_BAG',                               'bw_profitability_data', 'BAG수량'),
('PS', 'QTY_KE',                'SUM',  'ZQTY_KE',                                'bw_profitability_data', 'EA수량'),
('PS', 'AVG_PRICE_BOX',         'CALC', 'SUM(ZAMT001) / NULLIF(SUM(ZQTY_BOX),0)', 'bw_profitability_data', '평균단가(BOX)'),
('PS', 'MATERIAL_COST',         'CALC', 'SUM(ZAMT006)+SUM(ZAMT007)+SUM(ZAMT008)+SUM(ZAMT009)+SUM(ZAMT010)+SUM(ZAMT011)', 'bw_profitability_data', '재료비합계'),
('PS', 'LABOR_COST',            'CALC', 'SUM(ZAMT012)+SUM(ZAMT013)+SUM(ZAMT014)', 'bw_profitability_data', '인건비합계'),
('PS', 'MARKETING_COST',        'CALC', 'SUM(ZAMT047)+SUM(ZAMT048)+SUM(ZAMT049)+SUM(ZAMT050)+SUM(ZAMT051)+SUM(ZAMT052)+SUM(ZAMT053)+SUM(ZAMT054)', 'bw_profitability_data', '마케팅비합계');


-- ============================================================
-- 4) Metric 동의어 시드
-- ============================================================
INSERT IGNORE INTO metric_synonym (metric_id, synonym_text) VALUES
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='TOTAL_SALES'),           '총매출'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='TOTAL_SALES'),           '매출액'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='TOTAL_SALES'),           '총매출액'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='NET_SALES'),             '순매출'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='NET_SALES'),             '순매출액'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='GROSS_PROFIT'),          '매출총이익'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='GROSS_PROFIT'),          '매출이익'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='GROSS_PROFIT_RATE'),     '매출총이익률'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='GROSS_PROFIT_RATE'),     '매출이익률'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='OPERATING_PROFIT'),      '영업이익'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='OPERATING_PROFIT'),      '영업손익'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='OPERATING_PROFIT_RATE'), '영업이익률'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='ORDINARY_PROFIT'),       '경상이익'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='ORDINARY_PROFIT'),       '경상손익'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='QTY_BOX'),               'BOX수량'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='QTY_BOX'),               '박스수량'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='QTY_BOX'),               '판매수량'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='QTY_BAG'),               'BAG수량'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='QTY_KE'),                'EA수량'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='QTY_KE'),                'KG수량'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='COGS_TOTAL'),            '매출원가'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='SGA'),                   '판관비'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='SGA'),                   '판매관리비'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='MARKETING_COST'),        '마케팅비'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='AVG_PRICE_BOX'),         '평균단가'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='AVG_PRICE_BOX'),         'BOX단가'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='MATERIAL_COST'),         '재료비'),
((SELECT id FROM metric WHERE domain_code='PS' AND metric_code='LABOR_COST'),            '인건비');


-- ============================================================
-- 5) Code Mapping 시드 (손익센터 등 주요 코드)
-- ============================================================
-- ※ code_mapping 데이터는 학습관리 화면에서 등록하거나,
--    별도의 데이터 이관 스크립트로 투입


-- ============================================================
-- 6) JOIN 조건 시드 (PS 도메인)
-- ============================================================
INSERT IGNORE INTO join_condition (domain_code, left_column, left_table, right_column, right_table, join_type, operator, description) VALUES
('PS', 'PLANT',    'bw_profitability_data', 'PLANT',    'plant_master',    'INNER', '=', '플랜트 마스터 조인'),
('PS', 'CUSTOMER', 'bw_profitability_data', 'CUSTOMER', 'customer_master', 'LEFT',  '=', '고객 마스터 조인'),
('PS', 'MATERIAL', 'bw_profitability_data', 'MATERIAL', 'material_master', 'LEFT',  '=', '자재 마스터 조인');


-- ============================================================
-- 7) HL, MGMT 도메인 초기 데이터 (PS 데이터 복사)
-- ※ migration_domain.sql 에도 동일 로직 존재
-- ============================================================

-- ontology_column 복사
INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type)
SELECT 'HL', column_name, table_name, description, data_type
FROM ontology_column WHERE domain_code = 'PS';

INSERT IGNORE INTO ontology_column (domain_code, column_name, table_name, description, data_type)
SELECT 'MGMT', column_name, table_name, description, data_type
FROM ontology_column WHERE domain_code = 'PS';

-- metric 복사
INSERT IGNORE INTO metric (domain_code, metric_code, aggregation, formula, table_name, description)
SELECT 'HL', metric_code, aggregation, formula, table_name, description
FROM metric WHERE domain_code = 'PS';

INSERT IGNORE INTO metric (domain_code, metric_code, aggregation, formula, table_name, description)
SELECT 'MGMT', metric_code, aggregation, formula, table_name, description
FROM metric WHERE domain_code = 'PS';

-- join_condition 복사
INSERT IGNORE INTO join_condition (domain_code, left_column, left_table, right_column, right_table, join_type, operator, description)
SELECT 'HL', left_column, left_table, right_column, right_table, join_type, operator, description
FROM join_condition WHERE domain_code = 'PS'
AND NOT EXISTS (SELECT 1 FROM join_condition j2 WHERE j2.domain_code = 'HL');

INSERT IGNORE INTO join_condition (domain_code, left_column, left_table, right_column, right_table, join_type, operator, description)
SELECT 'MGMT', left_column, left_table, right_column, right_table, join_type, operator, description
FROM join_condition WHERE domain_code = 'PS'
AND NOT EXISTS (SELECT 1 FROM join_condition j2 WHERE j2.domain_code = 'MGMT');

-- code_mapping 복사
INSERT IGNORE INTO code_mapping (domain_code, column_name, column_name_nm, code_value, display_name, table_name, description, is_active)
SELECT 'HL', column_name, column_name_nm, code_value, display_name, table_name, description, is_active
FROM code_mapping WHERE domain_code = 'PS';

INSERT IGNORE INTO code_mapping (domain_code, column_name, column_name_nm, code_value, display_name, table_name, description, is_active)
SELECT 'MGMT', column_name, column_name_nm, code_value, display_name, table_name, description, is_active
FROM code_mapping WHERE domain_code = 'PS';
