-- ============================================================
-- BW 수익성분석 데이터 테이블 DDL
-- Module: module-profit (RAG 기반 수익성분석 AI 챗봇)
-- DB: MariaDB 10.11+ | CHARSET: utf8mb4 | ENGINE: InnoDB
-- Naming: 테이블 lower_snake_case / 컬럼 UPPER_SNAKE_CASE
-- ============================================================

-- BW 수익성분석 원천 데이터 테이블
-- SAP BW에서 마감 후 적재되는 수익성분석 데이터
DROP TABLE IF EXISTS `bw_profitability_data`;

CREATE TABLE `bw_profitability_data` (
    `ID`                BIGINT          NOT NULL AUTO_INCREMENT  COMMENT 'PK',

    -- ========== 기간 ==========
    `CALMONTH`          VARCHAR(10)     NULL                     COMMENT '달력연도/월 (YYYYMM)',
    `CALDAY`            VARCHAR(10)     NULL                     COMMENT '달력일 (YYYYMMDD)',

    -- ========== 관리회계 영역 ==========
    `CO_AREA`           VARCHAR(20)     NULL                     COMMENT '관리회계 영역',
    `CO_AREA_NM`        VARCHAR(100)    NULL                     COMMENT '관리회계 영역명',

    -- ========== 손익센터 ==========
    `PROFIT_CTR`        VARCHAR(20)     NULL                     COMMENT '손익 센터',
    `PROFIT_CTR_NM`     VARCHAR(100)    NULL                     COMMENT '손익센터명',

    -- ========== 제품군 ==========
    `DIVISION`          VARCHAR(20)     NULL                     COMMENT '제품군',
    `DIVISION_NM`       VARCHAR(100)    NULL                     COMMENT '제품군명',

    -- ========== 플랜트 ==========
    `PLANT`             VARCHAR(20)     NULL                     COMMENT '플랜트',
    `PLANT_NM`          VARCHAR(100)    NULL                     COMMENT '플랜트명',

    -- ========== 유통경로 ==========
    `DISTR_CHAN`         VARCHAR(20)     NULL                     COMMENT '유통 경로',
    `DISTR_CHAN_NM`      VARCHAR(100)    NULL                     COMMENT '유통경로명',

    -- ========== 내수/수출 구분 ==========
    `ZDISTCHAN`         VARCHAR(20)     NULL                     COMMENT '내수/수출구분자(사업장)',
    `ZDISTCHAN_NM`      VARCHAR(100)    NULL                     COMMENT '내수/수출구분자명',

    -- ========== 영업조직 ==========
    `ZORG_TEAM`         VARCHAR(20)     NULL                     COMMENT '영업팀(사업장그룹)',
    `SALES_OFF`         VARCHAR(20)     NULL                     COMMENT '사업장',
    `SALES_OFF_NM`      VARCHAR(200)    NULL                     COMMENT '사업장명',

    -- ========== 자재유형 ==========
    `MATL_TYPE`         VARCHAR(20)     NULL                     COMMENT '자재유형',
    `MATL_TYPE_NM`      VARCHAR(100)    NULL                     COMMENT '자재유형명',

    -- ========== 제품계층 구조 ==========
    `PRODH1`            VARCHAR(20)     NULL                     COMMENT '제품계층 구조레벨 1',
    `PRODH1_NM`         VARCHAR(200)    NULL                     COMMENT '제품계층 구조레벨 1명',
    `PRODH2`            VARCHAR(20)     NULL                     COMMENT '제품 계층구조레벨 2',
    `PRODH2_NM`         VARCHAR(200)    NULL                     COMMENT '제품 계층구조레벨 2명',
    `PRODH3`            VARCHAR(20)     NULL                     COMMENT '제품 계층구조레벨 3',
    `PRODH3_NM`         VARCHAR(200)    NULL                     COMMENT '제품 계층구조레벨 3명',
    `PRODH4`            VARCHAR(20)     NULL                     COMMENT '제품 계층구조레벨 4',
    `PRODH4_NM`         VARCHAR(200)    NULL                     COMMENT '제품 계층구조레벨 4명',

    -- ========== 지종/브랜드 ==========
    `ZJPCODE`           VARCHAR(20)     NULL                     COMMENT '지종/제품구분',
    `ZJPCODE_NM`        VARCHAR(100)    NULL                     COMMENT '지종/제품구분명',
    `ZBRAND`            VARCHAR(20)     NULL                     COMMENT '브랜드 1',
    `ZBRAND_NM`         VARCHAR(200)    NULL                     COMMENT '브랜드 1 명',
    `ZSBRAND`           VARCHAR(20)     NULL                     COMMENT '브랜드 2',
    `ZSBRAND_NM`        VARCHAR(200)    NULL                     COMMENT '브랜드 2 명',

    -- ========== 대금/인도/고객그룹 ==========
    `BILL_TYPE`         VARCHAR(20)     NULL                     COMMENT '대금청구유형',
    `BILL_TYPE_NM`      VARCHAR(100)    NULL                     COMMENT '대금청구유형 명',
    `INCOTERMS`         VARCHAR(20)     NULL                     COMMENT '인도 조건',
    `INCOTERMS_NM`      VARCHAR(100)    NULL                     COMMENT '인도 조건 명',
    `CUST_GROUP`        VARCHAR(20)     NULL                     COMMENT '고객 그룹',
    `CUST_GROUP_NM`     VARCHAR(100)    NULL                     COMMENT '고객그룹 명',
    `CUST_GRP1`         VARCHAR(20)     NULL                     COMMENT '고객 그룹 1',
    `CUST_GRP1_NM`      VARCHAR(100)    NULL                     COMMENT '고객그룹1 명',

    -- ========== 국가 ==========
    `COUNTRY`           VARCHAR(10)     NULL                     COMMENT '국가',
    `COUNTRY_NM`        VARCHAR(100)    NULL                     COMMENT '국가 명',

    -- ========== 영업사원/고객 ==========
    `ZKUNN2`            VARCHAR(20)     NULL                     COMMENT '영업사원',
    `ZKUNN2_NM`         VARCHAR(200)    NULL                     COMMENT '영업사원 명',
    `CUSTOMER`          VARCHAR(20)     NULL                     COMMENT '고객',
    `CUSTOMER_NM`       VARCHAR(200)    NULL                     COMMENT '고객 명',

    -- ========== 자재 ==========
    `MATERIAL`          VARCHAR(50)     NULL                     COMMENT '자재',
    `MATERIAL_NM`       VARCHAR(500)    NULL                     COMMENT '자재명',

    -- ========== 단위 ==========
    `ZBOXUNIT`          VARCHAR(10)     NULL                     COMMENT '수량단위(BOX)',
    `ZBAGUNIT`          VARCHAR(10)     NULL                     COMMENT '수량단위(BAG)',
    `ZUNIT`             VARCHAR(10)     NULL                     COMMENT '수량단위(KG/EA)',
    `CURRENCY`          VARCHAR(10)     NULL                     COMMENT '통화',

    -- ========== 수량 ==========
    `ZQTY_BOX`          DECIMAL(18,4)   NULL DEFAULT 0           COMMENT '수량(BOX)',
    `ZQTY_BAG`          DECIMAL(18,4)   NULL DEFAULT 0           COMMENT '수량(BAG)',
    `ZQTY_KE`           DECIMAL(18,4)   NULL DEFAULT 0           COMMENT '수량(KG/EA)',

    -- ========== 금액 (ZAMT001 ~ ZAMT064) ==========
    `ZAMT001`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '총매출',
    `ZAMT002`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '판매장려금',
    `ZAMT003`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '순매출',
    `ZAMT004`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타매출',
    `ZAMT005`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '매출원가(제품)',
    `ZAMT006`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '재료비-펄프',
    `ZAMT007`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '재료비-고지',
    `ZAMT008`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '재료비-패드',
    `ZAMT009`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '부재료비-약품',
    `ZAMT010`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '부재료비-포장재',
    `ZAMT011`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '재료비-기타',
    `ZAMT012`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '인건비',
    `ZAMT013`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '인건비_경비',
    `ZAMT014`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '인건비_기타',
    `ZAMT015`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '도급비',
    `ZAMT016`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '에너지비',
    `ZAMT017`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '전력비',
    `ZAMT018`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '감가상각비',
    `ZAMT019`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '수선/소모품비',
    `ZAMT020`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타경비',
    `ZAMT021`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타경비_폐기물',
    `ZAMT022`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타경비_세금과공과',
    `ZAMT023`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타경비_지급수수료',
    `ZAMT024`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '외주가공비',
    `ZAMT025`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '매출원가(상품)',
    `ZAMT026`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '매출원가(기타)',
    `ZAMT027`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타원가',
    `ZAMT028`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '단수차이',
    `ZAMT029`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '차이잔액',
    `ZAMT030`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '제조파지정산',
    `ZAMT031`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타매출원가+감모손+평가손',
    `ZAMT032`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '원재료 투입차이',
    `ZAMT033`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타매출원가 배부조',
    `ZAMT034`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '매출원가 계',
    `ZAMT035`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '매출총이익',
    `ZAMT036`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '판매관리비',
    `ZAMT037`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '급여(변동)',
    `ZAMT038`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '국내운반비(변동)',
    `ZAMT039`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '수출운반비(변동)',
    `ZAMT040`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '지급수수료(변동)',
    `ZAMT041`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타판관비(변동)',
    `ZAMT042`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '개발비(변동)',
    `ZAMT043`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '급여(고정)',
    `ZAMT044`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '지급수수료(고정)',
    `ZAMT045`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타판관비(고정)',
    `ZAMT046`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '개발비(고정)',
    `ZAMT047`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '마케팅비',
    `ZAMT048`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '광고비',
    `ZAMT049`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '소모품비',
    `ZAMT050`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '지급수수료-마케팅(변동)',
    `ZAMT051`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '지급수수료-마케팅(고정)',
    `ZAMT052`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '마케팅비_장려금(변동)',
    `ZAMT053`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '판촉비',
    `ZAMT054`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '마케팅비 배부조정',
    `ZAMT055`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '영업이익',
    `ZAMT056`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '영업외수익',
    `ZAMT057`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '이자수익',
    `ZAMT058`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '외환이익',
    `ZAMT059`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타영업외수익',
    `ZAMT060`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '영업외비용',
    `ZAMT061`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '이자비용',
    `ZAMT062`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '외환손실',
    `ZAMT063`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '기타영업외비용',
    `ZAMT064`           DECIMAL(18,2)   NULL DEFAULT 0           COMMENT '경상이익',

    -- ========== 메타 ==========
    `CREATED_AT`        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '생성일시',

    PRIMARY KEY (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='BW 수익성분석 원천 데이터';

-- ========== 인덱스 ==========
CREATE INDEX IDX_BW_PROF_CALMONTH      ON `bw_profitability_data` (`CALMONTH`);
CREATE INDEX IDX_BW_PROF_CALDAY        ON `bw_profitability_data` (`CALDAY`);
CREATE INDEX IDX_BW_PROF_PLANT         ON `bw_profitability_data` (`PLANT`);
CREATE INDEX IDX_BW_PROF_DIVISION      ON `bw_profitability_data` (`DIVISION`);
CREATE INDEX IDX_BW_PROF_PROFIT_CTR    ON `bw_profitability_data` (`PROFIT_CTR`);
CREATE INDEX IDX_BW_PROF_CUSTOMER      ON `bw_profitability_data` (`CUSTOMER`);
CREATE INDEX IDX_BW_PROF_MATERIAL      ON `bw_profitability_data` (`MATERIAL`);
CREATE INDEX IDX_BW_PROF_DISTR_CHAN    ON `bw_profitability_data` (`DISTR_CHAN`);
CREATE INDEX IDX_BW_PROF_SALES_OFF     ON `bw_profitability_data` (`SALES_OFF`);
CREATE INDEX IDX_BW_PROF_ZBRAND        ON `bw_profitability_data` (`ZBRAND`);
CREATE INDEX IDX_BW_PROF_PRODH1        ON `bw_profitability_data` (`PRODH1`);
CREATE INDEX IDX_BW_PROF_CALMONTH_DIV  ON `bw_profitability_data` (`CALMONTH`, `DIVISION`);
CREATE INDEX IDX_BW_PROF_CALMONTH_PLANT ON `bw_profitability_data` (`CALMONTH`, `PLANT`);
