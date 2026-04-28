-- ============================================================
-- module-profit: RAG 기반 수익성분석 AI 챗봇 모듈
-- 초기 데이터 스크립트 (02_seed_data.sql)
-- 실행 순서: 01_schema.sql 실행 후 이 파일을 실행하세요
-- ============================================================

-- ------------------------------------------------------------
-- 1. Ontology 컬럼 마스터 - 기간 그룹
-- ------------------------------------------------------------
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY)
VALUES
    ('CALMONTH',    '/BIC/OHYOHCO004', '달력연도/월',               'VARCHAR', '기간',         1,  1, 'SYSTEM'),
    ('CALDAY',      '/BIC/OHYOHCO004', '달력일',                   'VARCHAR', '기간',         2,  1, 'SYSTEM');

-- ------------------------------------------------------------
-- 2. Ontology 컬럼 마스터 - 조직/사업부 그룹
-- ------------------------------------------------------------
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY)
VALUES
    ('CO_AREA',     '/BIC/OHYOHCO004', '관리회계 영역',             'VARCHAR', '조직/사업부',   3,  1, 'SYSTEM'),
    ('PROFIT_CTR',  '/BIC/OHYOHCO004', '손익 센터',                'VARCHAR', '조직/사업부',   4,  1, 'SYSTEM'),
    ('DIVISION',    '/BIC/OHYOHCO004', '제품군',                   'VARCHAR', '조직/사업부',   5,  1, 'SYSTEM'),
    ('PLANT',       '/BIC/OHYOHCO004', '플랜트',                   'VARCHAR', '조직/사업부',   6,  1, 'SYSTEM'),
    ('DISTR_CHAN',  '/BIC/OHYOHCO004', '유통 경로',                'VARCHAR', '조직/사업부',   7,  1, 'SYSTEM'),
    ('ZDISTCHAN',   '/BIC/OHYOHCO004', '내수/수출구분자(사업장)',     'VARCHAR', '조직/사업부',   8,  1, 'SYSTEM'),
    ('ZORG_TEAM',   '/BIC/OHYOHCO004', '영업팀(사업장그룹)',         'VARCHAR', '조직/사업부',   9,  1, 'SYSTEM'),
    ('SALES_OFF',   '/BIC/OHYOHCO004', '사업장',                   'VARCHAR', '조직/사업부',  10,  1, 'SYSTEM');

-- ------------------------------------------------------------
-- 3. Ontology 컬럼 마스터 - 자재/제품 그룹
-- ------------------------------------------------------------
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY)
VALUES
    ('ZBRAND',      '/BIC/OHYOHCO004', '브랜드',                   'VARCHAR', '자재/제품',    11,  1, 'SYSTEM'),
    ('ZSBRAND',     '/BIC/OHYOHCO004', '서브 브랜드',               'VARCHAR', '자재/제품',    12,  1, 'SYSTEM'),
    ('ZPCODE',      '/BIC/OHYOHCO004', '지종/제품구분',             'VARCHAR', '자재/제품',    13,  1, 'SYSTEM'),
    ('ZKUNM2',      '/BIC/OHYOHCO004', '영업사원',                  'VARCHAR', '자재/제품',    14,  1, 'SYSTEM'),
    ('ZQTY_BAG',    '/BIC/OHYOHCO004', '수량(BAG)',                'DECIMAL', '자재/제품',    15,  1, 'SYSTEM'),
    ('ZQTY_BOX',    '/BIC/OHYOHCO004', '수량(BOX)',                'DECIMAL', '자재/제품',    16,  1, 'SYSTEM'),
    ('ZQTY_KE',     '/BIC/ZQTY_KE',    '수량(KG/EA)',              'DECIMAL', '자재/제품',    17,  1, 'SYSTEM'),
    ('ZUNIT',       '/BIC/OHYOHCO004', '수량단위(KG/EA)',           'VARCHAR', '자재/제품',    18,  1, 'SYSTEM');

-- ------------------------------------------------------------
-- 4. Ontology 컬럼 마스터 - 금액 컬럼 (Metric 대상)
-- ------------------------------------------------------------
INSERT INTO profit_ontology_column (COLUMN_NAME, TABLE_NAME, COLUMN_DESCRIPTION, DATA_TYPE, COLUMN_GROUP, SORT_ORDER, IS_ACTIVE, CREATED_BY)
VALUES
    ('ZAMT001',     '/BIC/OHYOHCO004', '총매출액',                  'DECIMAL', '금액',         20,  1, 'SYSTEM'),
    ('ZAMT002',     '/BIC/OHYOHCO004', '매출할인',                  'DECIMAL', '금액',         21,  1, 'SYSTEM'),
    ('ZAMT004',     '/BIC/OHYOHCO004', '매출에누리',                'DECIMAL', '금액',         22,  1, 'SYSTEM'),
    ('ZAMT006',     '/BIC/OHYOHCO004', '제품원가(재료비)',           'DECIMAL', '금액',         23,  1, 'SYSTEM'),
    ('ZAMT007',     '/BIC/OHYOHCO004', '제품원가(노무비)',           'DECIMAL', '금액',         24,  1, 'SYSTEM'),
    ('ZAMT008',     '/BIC/OHYOHCO004', '제품원가(경비)',             'DECIMAL', '금액',         25,  1, 'SYSTEM'),
    ('ZAMT024',     '/BIC/OHYOHCO004', '제조원가 조정',             'DECIMAL', '금액',         26,  1, 'SYSTEM'),
    ('ZAMT027',     '/BIC/OHYOHCO004', '판관비(인건비)',             'DECIMAL', '금액',         27,  1, 'SYSTEM'),
    ('ZAMT028',     '/BIC/OHYOHCO004', '판관비(감가상각비)',          'DECIMAL', '금액',         28,  1, 'SYSTEM'),
    ('ZAMT029',     '/BIC/OHYOHCO004', '판관비(운반비)',             'DECIMAL', '금액',         29,  1, 'SYSTEM'),
    ('ZAMT030',     '/BIC/OHYOHCO004', '판관비(기타경비)',           'DECIMAL', '금액',         30,  1, 'SYSTEM'),
    ('ZAMT031',     '/BIC/OHYOHCO004', '판관비(연구개발비)',          'DECIMAL', '금액',         31,  1, 'SYSTEM');

-- ------------------------------------------------------------
-- 5. Ontology 동의어 - 기간
-- ------------------------------------------------------------
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE)
SELECT ONTOLOGY_COLUMN_ID, '연월', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'CALMONTH'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '월별', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'CALMONTH'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '기간', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'CALMONTH'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '달력연도월', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'CALMONTH'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '일별', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'CALDAY'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '날짜', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'CALDAY';

-- ------------------------------------------------------------
-- 6. Ontology 동의어 - 조직/사업부
-- ------------------------------------------------------------
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE)
SELECT ONTOLOGY_COLUMN_ID, '관리회계영역', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'CO_AREA'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '손익센터', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'PROFIT_CTR'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '사업부', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'PROFIT_CTR'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '손익센터별', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'PROFIT_CTR'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '제품군', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'DIVISION'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '플랜트', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'PLANT'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '공장', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'PLANT'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '플랜트별', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'PLANT'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '유통경로', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'DISTR_CHAN'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '채널', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'DISTR_CHAN'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '내수수출구분', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZDISTCHAN'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '내수/수출', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZDISTCHAN'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '내수 vs 수출', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZDISTCHAN'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '영업팀', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZORG_TEAM'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '영업팀별', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZORG_TEAM'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '영업사업장그룹', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZORG_TEAM'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '사업장', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'SALES_OFF';

-- ------------------------------------------------------------
-- 7. Ontology 동의어 - 자재/제품
-- ------------------------------------------------------------
INSERT INTO profit_ontology_synonym (ONTOLOGY_COLUMN_ID, SYNONYM_TEXT, SYNONYM_SOURCE)
SELECT ONTOLOGY_COLUMN_ID, 'bzbrand', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZBRAND'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '브랜드', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZBRAND'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '브랜드1', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZBRAND'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '브랜드별', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZBRAND'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '서브브랜드', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZSBRAND'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '브랜드2', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZSBRAND'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '지종', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZPCODE'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '제품구분', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZPCODE'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '지종/제품구분', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZPCODE'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '영업사원', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZKUNM2'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '수량(BAG)', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZQTY_BAG'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '수량(BOX)', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZQTY_BOX'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '수량(KG/EA)', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZQTY_KE'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '수량단위', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZUNIT'
UNION ALL
SELECT ONTOLOGY_COLUMN_ID, '수량단위(KG/EA)', 'SYSTEM' FROM profit_ontology_column WHERE COLUMN_NAME = 'ZUNIT';


-- ------------------------------------------------------------
-- 8. Metric 계산지표
-- ------------------------------------------------------------
INSERT INTO profit_metric (METRIC_CODE, METRIC_NAME, AGGREGATION, FORMULA, TABLE_NAME, DESCRIPTION, DISPLAY_FORMAT, UNIT, SORT_ORDER, IS_ACTIVE, CREATED_BY)
VALUES
    ('NETSALES',    '순매출',        'SUM', 'ZAMT001 - ZAMT002 - ZAMT004',
     '/BIC/OHYOHCO004', '총매출 - 매출할인 - 매출에누리', '#,###', '원', 1, 1, 'SYSTEM'),

    ('FG_COST',     '제품원가',      'SUM', 'ZAMT006 + ZAMT007 + ZAMT008 - ZAMT024',
     '/BIC/OHYOHCO004', '재료비 + 노무비 + 경비 - 제조원가조정', '#,###', '원', 2, 1, 'SYSTEM'),

    ('ET_COST',     '판관비',        'SUM', 'ZAMT027 + ZAMT028 + ZAMT029 + ZAMT030 + ZAMT031',
     '/BIC/OHYOHCO004', '인건비 + 감가상각비 + 운반비 + 기타경비 + 연구개발비', '#,###', '원', 3, 1, 'SYSTEM'),

    ('GROSS_PROFIT','매출총이익',     'SUM', '(ZAMT001 - ZAMT002 - ZAMT004) - (ZAMT006 + ZAMT007 + ZAMT008 - ZAMT024)',
     '/BIC/OHYOHCO004', '순매출 - 제품원가', '#,###', '원', 4, 1, 'SYSTEM'),

    ('OP_PROFIT',   '영업이익',      'SUM', '(ZAMT001 - ZAMT002 - ZAMT004) - (ZAMT006 + ZAMT007 + ZAMT008 - ZAMT024) - (ZAMT027 + ZAMT028 + ZAMT029 + ZAMT030 + ZAMT031)',
     '/BIC/OHYOHCO004', '매출총이익 - 판관비', '#,###', '원', 5, 1, 'SYSTEM'),

    ('TOTAL_SALES', '총매출',        'SUM', 'ZAMT001',
     '/BIC/OHYOHCO004', '총매출액', '#,###', '원', 6, 1, 'SYSTEM'),

    ('TOTAL_QTY_BAG','총수량(BAG)',   'SUM', 'ZQTY_BAG',
     '/BIC/OHYOHCO004', '총 판매수량 BAG 기준', '#,###', 'BAG', 7, 1, 'SYSTEM'),

    ('TOTAL_QTY_BOX','총수량(BOX)',   'SUM', 'ZQTY_BOX',
     '/BIC/OHYOHCO004', '총 판매수량 BOX 기준', '#,###', 'BOX', 8, 1, 'SYSTEM');


-- ------------------------------------------------------------
-- 9. Metric 동의어
-- ------------------------------------------------------------
INSERT INTO profit_metric_synonym (METRIC_ID, SYNONYM_TEXT, SYNONYM_SOURCE)
SELECT METRIC_ID, '순매출', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'NETSALES'
UNION ALL
SELECT METRIC_ID, '매출', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'NETSALES'
UNION ALL
SELECT METRIC_ID, '매출액', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'NETSALES'
UNION ALL
SELECT METRIC_ID, '순매출액', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'NETSALES'
UNION ALL
SELECT METRIC_ID, '제품원가', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'FG_COST'
UNION ALL
SELECT METRIC_ID, '제조원가', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'FG_COST'
UNION ALL
SELECT METRIC_ID, '원가', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'FG_COST'
UNION ALL
SELECT METRIC_ID, '판관비', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'ET_COST'
UNION ALL
SELECT METRIC_ID, '판매관리비', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'ET_COST'
UNION ALL
SELECT METRIC_ID, '판매비와관리비', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'ET_COST'
UNION ALL
SELECT METRIC_ID, '매출총이익', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'GROSS_PROFIT'
UNION ALL
SELECT METRIC_ID, '매출이익', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'GROSS_PROFIT'
UNION ALL
SELECT METRIC_ID, '총이익', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'GROSS_PROFIT'
UNION ALL
SELECT METRIC_ID, '영업이익', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'OP_PROFIT'
UNION ALL
SELECT METRIC_ID, '영업이익률', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'OP_PROFIT'
UNION ALL
SELECT METRIC_ID, '총매출', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'TOTAL_SALES'
UNION ALL
SELECT METRIC_ID, '총매출액', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'TOTAL_SALES'
UNION ALL
SELECT METRIC_ID, '전체매출', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'TOTAL_SALES'
UNION ALL
SELECT METRIC_ID, '판매수량(BAG)', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'TOTAL_QTY_BAG'
UNION ALL
SELECT METRIC_ID, '판매수량(BOX)', 'SYSTEM' FROM profit_metric WHERE METRIC_CODE = 'TOTAL_QTY_BOX';


-- ------------------------------------------------------------
-- 10. JOIN 조건 정의
-- ------------------------------------------------------------
INSERT INTO profit_join_condition (JOIN_NAME, LEFT_COLUMN, LEFT_TABLE, RIGHT_COLUMN, RIGHT_TABLE, JOIN_TYPE, OPERATOR, SORT_ORDER, IS_ACTIVE, CREATED_BY)
VALUES
    ('플랜트 조인',   'PLANT',  '/BIC/OHYOHCO004', 'PLANT',    '/BIC/OHYOHCO004', 'INNER', '=', 1, 1, 'SYSTEM'),
    ('매출 조인',     'SALES',  '/BIC/OHYOHCO004', 'SALES001', '/BIC/OHYOHCO004', 'LEFT',  '=', 2, 1, 'SYSTEM');


-- ------------------------------------------------------------
-- 11. 샘플 배치 상태
-- ------------------------------------------------------------
INSERT INTO profit_batch_status (BATCH_NAME, BATCH_TYPE, SOURCE_SYSTEM, TARGET_TABLE, STATUS, TOTAL_ROWS, PROCESSED_ROWS, ERROR_ROWS, PERIOD_YEAR, PERIOD_MONTH, STARTED_AT, COMPLETED_AT, EXECUTION_TIME_MS, CREATED_BY)
VALUES
    ('2026년 3월 SAP 마감 → BW 적재', 'SAP_CLOSE', 'SAP ERP', '/BIC/OHYOHCO004', 'COMPLETED', 125000, 125000, 0, 2026, 3, '2026-04-02 02:00:00', '2026-04-02 03:45:22', 6322000, 'BATCH_ADMIN'),
    ('2026년 3월 데이터 검증',          'DATA_VALIDATION', 'BW DB', '/BIC/OHYOHCO004', 'COMPLETED', 125000, 124998, 2, 2026, 3, '2026-04-02 04:00:00', '2026-04-02 04:12:15', 735000, 'BATCH_ADMIN'),
    ('2026년 3월 RAG 인덱스 빌드',      'INDEX_BUILD', 'BW DB', 'profit_ontology_column', 'COMPLETED', 30, 30, 0, 2026, 3, '2026-04-02 04:15:00', '2026-04-02 04:15:45', 45000, 'BATCH_ADMIN'),
    ('2026년 4월 SAP 마감 → BW 적재', 'SAP_CLOSE', 'SAP ERP', '/BIC/OHYOHCO004', 'RUNNING', 130000, 87500, 0, 2026, 4, '2026-04-28 02:00:00', NULL, NULL, 'BATCH_ADMIN');


-- ------------------------------------------------------------
-- 12. 샘플 자연어 질의 이력
-- ------------------------------------------------------------
INSERT INTO profit_nl_query_history (USER_ID, USER_NAME, NATURAL_QUERY, GENERATED_SQL, QUERY_MODE, RESULT_COUNT, RESULT_SUMMARY, METRICS_USED, FILTERS_USED, DATA_SOURCE, EXECUTION_TIME_MS, STATUS, FEEDBACK_SCORE, IS_BOOKMARKED)
VALUES
    (1, 'admin', '손익센터별 총매출 합계',
     'SELECT PROFIT_CTR AS 사업부, SUM(ZAMT001) AS 총매출, FORMAT(SUM(ZAMT001), 0) AS 총매출_천단위표시 FROM `/BIC/OHYOHCO004` GROUP BY PROFIT_CTR ORDER BY SUM(ZAMT001) DESC',
     'NLQ', 2, '제지사업부 23,315,156,162원 / 생활용품사업부 22,094,284,048원', 'TOTAL_SALES', NULL, '/BIC/OHYOHCO004', 342, 'SUCCESS', 5, 0),

    (1, 'admin', '플랜트별 매출 상위 10개',
     'SELECT PLANT AS 플랜트, SUM(ZAMT001) AS 총매출 FROM `/BIC/OHYOHCO004` GROUP BY PLANT ORDER BY SUM(ZAMT001) DESC LIMIT 10',
     'NLQ', 10, '상위 10개 플랜트별 총매출 조회 완료', 'TOTAL_SALES', NULL, '/BIC/OHYOHCO004', 289, 'SUCCESS', 4, 1),

    (1, 'admin', '제품별 매출 TOP 5',
     'SELECT ZBRAND AS 브랜드, SUM(ZAMT001 - ZAMT002 - ZAMT004) AS 순매출 FROM `/BIC/OHYOHCO004` GROUP BY ZBRAND ORDER BY 순매출 DESC LIMIT 5',
     'NLQ', 5, '상위 5개 브랜드별 순매출 조회 완료', 'NETSALES', NULL, '/BIC/OHYOHCO004', 415, 'SUCCESS', NULL, 0),

    (1, 'admin', '내수 vs 수출 매출 비교',
     'SELECT ZDISTCHAN AS 내수수출구분, SUM(ZAMT001 - ZAMT002 - ZAMT004) AS 순매출, SUM(ZAMT001) AS 총매출 FROM `/BIC/OHYOHCO004` GROUP BY ZDISTCHAN',
     'NLQ', 2, '내수/수출 구분별 매출 비교 완료', 'NETSALES,TOTAL_SALES', NULL, '/BIC/OHYOHCO004', 267, 'SUCCESS', NULL, 0),

    (2, 'user01', '영업팀별 영업이익 순위',
     'SELECT ZORG_TEAM AS 영업팀, SUM((ZAMT001 - ZAMT002 - ZAMT004) - (ZAMT006 + ZAMT007 + ZAMT008 - ZAMT024) - (ZAMT027 + ZAMT028 + ZAMT029 + ZAMT030 + ZAMT031)) AS 영업이익 FROM `/BIC/OHYOHCO004` GROUP BY ZORG_TEAM ORDER BY 영업이익 DESC',
     'NLQ', 8, '영업팀별 영업이익 순위 조회 완료', 'OP_PROFIT', NULL, '/BIC/OHYOHCO004', 523, 'SUCCESS', 5, 1);


-- ------------------------------------------------------------
-- 13. 샘플 매핑 인박스 (미매핑 용어)
-- ------------------------------------------------------------
INSERT INTO profit_mapping_inbox (UNMAPPED_TERM, TERM_TYPE, ORIGINAL_QUERY, OCCURRENCE_COUNT, STATUS)
VALUES
    ('마진율',       'METRIC',  '브랜드별 마진율 추이',                3, 'PENDING'),
    ('고객그룹',     'COLUMN',  '고객그룹별 매출총이익',               2, 'PENDING'),
    ('전년대비',     'FILTER',  '전년대비 매출 증가율',                5, 'PENDING'),
    ('월별 추이',    'FILTER',  '월별 총매출 추이',                   4, 'PENDING'),
    ('재고회전율',   'METRIC',  '제품군별 재고회전율',                 1, 'PENDING');
