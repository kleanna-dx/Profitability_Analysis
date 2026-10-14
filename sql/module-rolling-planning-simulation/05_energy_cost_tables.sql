-- ============================================================
-- 에너지비(스팀/연료비) 계산 신규 테이블 9개
-- 현업 담당자 인터뷰 확정 규칙 기반
-- 날짜: 2026-10-14
-- ============================================================

-- ------------------------------------------------------------
-- 1. rpsim_boiler_master (보일러 마스터)
--    복합보일러/LNG/폐합성소각로/유동상소각로/외부보일러
--    시간당 스팀량, 가동조건 등 — 코드 하드코딩 금지
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_boiler_master (
    BOILER_ID        BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    BOILER_CODE      VARCHAR(30)  NOT NULL                COMMENT '보일러 코드',
    BOILER_NAME      VARCHAR(100) NOT NULL                COMMENT '보일러명',
    BOILER_TYPE      VARCHAR(30)  NOT NULL                COMMENT '유형 (COGEN/LNG/INCIN_SYNTH/INCIN_FLUID/EXTERNAL)',
    STEAM_PER_HOUR   DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '시간당 스팀량 (톤/hr)',
    CAPACITY_NOTE    VARCHAR(200) NULL                    COMMENT '용량 비고 (60톤/hr 등)',
    IS_ACTIVE        TINYINT(1)   NOT NULL DEFAULT 1      COMMENT '활성 여부',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    DISPLAY_ORDER    INT          NOT NULL DEFAULT 0      COMMENT '표시 순서',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (BOILER_ID),
    UNIQUE KEY UK_BOILER_CODE (BOILER_CODE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 보일러 마스터 (하드코딩 금지)';


-- ------------------------------------------------------------
-- 2. rpsim_boiler_plan (보일러별 월별 가동계획)
--    기본값 = 계획, 시뮬레이션에서 덮어쓰기 가능
--    정비일정: 평월 2일 운휴, 9~10월 대정비 14일 등
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_boiler_plan (
    PLAN_ID          BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    MONTH            INT          NOT NULL                COMMENT '적용 월 (1~12)',
    BOILER_CODE      VARCHAR(30)  NOT NULL                COMMENT '보일러 코드',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    TOTAL_DAYS       DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '월 총일수',
    SHUTDOWN_DAYS    DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '운휴일수 (정비+계획운휴)',
    OPERATION_DAYS   DECIMAL(6,2) NOT NULL DEFAULT 0      COMMENT '가동일수 = 총일수 - 운휴일수',
    OPERATION_HOURS  DECIMAL(8,2) NOT NULL DEFAULT 0      COMMENT '가동시간 (h) = 가동일수 × 24',
    MEMO             VARCHAR(200) NULL                    COMMENT '비고 (대정비/격월정비 등)',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (PLAN_ID),
    UNIQUE KEY UK_BOILER_PLAN (YEAR, MONTH, BOILER_CODE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 보일러별 월별 가동계획';


-- ------------------------------------------------------------
-- 3. rpsim_steam_unit_rate (호기별 스팀사용 원단위)
--    스팀필요량 = Σ 호기별 생산톤 × 원단위 + 기타사용량
--    ※ 원단위는 생산량과 완전 비례하지 않음 (한계 주석 필드)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_steam_unit_rate (
    RATE_ID          BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    MACHINE_CODE     VARCHAR(20)  NOT NULL                COMMENT '호기 코드 (PM2/PM3 등)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    STEAM_PER_TON    DECIMAL(8,4) NOT NULL DEFAULT 0      COMMENT '스팀사용 원단위 (톤스팀/톤제품)',
    ETC_USAGE_TON    DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '기타사용량 (톤/월, 비생산사용 포함)',
    LIMIT_NOTE       VARCHAR(500) NULL                    COMMENT '한계 주석 (저/고평량 비중 영향, 이동계획용 원단 > 생산용)',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (RATE_ID),
    UNIQUE KEY UK_STEAM_UNIT (YEAR, MACHINE_CODE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 호기별 스팀사용 원단위 (한계 주석 포함)';


-- ------------------------------------------------------------
-- 4. rpsim_steam_price_interval (복합보일러 구간별 스팀단가)
--    사용량/기간 구간에 따라 단가 상이
--    연 6월~5월 체계로 갱신 (엑셀값 18,370~21,310원/톤)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_steam_price_interval (
    PRICE_ID         BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    CONTRACT_YEAR    VARCHAR(10)  NOT NULL                COMMENT '계약연도 (2026-2027 등, 6월~5월 체계)',
    INTERVAL_SEQ     INT          NOT NULL                COMMENT '구간 순번',
    INTERVAL_NAME    VARCHAR(100) NOT NULL                COMMENT '구간명 (기본구간/초과구간 등)',
    MIN_USAGE_TON    DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '구간 시작 사용량 (톤)',
    MAX_USAGE_TON    DECIMAL(12,2) NULL                   COMMENT '구간 종료 사용량 (NULL=무제한)',
    PRICE_PER_TON    DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '스팀단가 (원/톤)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (PRICE_ID),
    INDEX IDX_STEAM_PRICE (CONTRACT_YEAR, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 복합보일러 구간별 스팀단가 (6월~5월 체계)';


-- ------------------------------------------------------------
-- 5. rpsim_cogen_deduction (유틸리티 공급 차감 + 고정 차감)
--    유틸리티 공급 차감(물 등) + 감가상각/처분수익/지상권
--    매년 5월 정산 — 이동계획상 고정값 처리로 충분
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_cogen_deduction (
    DEDUCTION_ID     BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    ITEM_TYPE        VARCHAR(30)  NOT NULL                COMMENT '항목 (UTILITY/DEPRECIATION/DISPOSAL_GAIN/LAND_RENT)',
    ITEM_NAME        VARCHAR(100) NOT NULL                COMMENT '항목명',
    MONTHLY_AMOUNT   DECIMAL(18,2) NOT NULL DEFAULT 0     COMMENT '월평균 고정금액 (원, 부호: 차감−)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (DEDUCTION_ID),
    UNIQUE KEY UK_COGEN_DEDUCT (YEAR, ITEM_TYPE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 유틸리티/고정 차감 항목 (월평균 고정)';


-- ------------------------------------------------------------
-- 6. rpsim_boiler_cost_rate (보일러별 연료/운영 단가)
--    LNG단가, 소각로 고정비/스팀단가, 외부 구매단가
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_boiler_cost_rate (
    COST_RATE_ID     BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    BOILER_CODE      VARCHAR(30)  NOT NULL                COMMENT '보일러 코드',
    RATE_TYPE        VARCHAR(30)  NOT NULL                COMMENT '단가유형 (FUEL_RATE/FIXED_COST/STEAM_RATE/PURCHASE_RATE)',
    RATE_NAME        VARCHAR(100) NOT NULL                COMMENT '단가명',
    RATE_VALUE       DECIMAL(18,4) NOT NULL DEFAULT 0     COMMENT '단가 값',
    RATE_UNIT        VARCHAR(50)  NULL                    COMMENT '단위 (원/㎥, 원/톤, 원/hr 등)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (COST_RATE_ID),
    UNIQUE KEY UK_BOILER_COST (YEAR, BOILER_CODE, RATE_TYPE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 보일러별 연료/운영 단가';


-- ------------------------------------------------------------
-- 7. rpsim_burner_lng_rate (버너 LNG 원단위)
--    건조 직화, 생산량 완전 비례
--    호기별·연도별 ㎥/톤제품
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_burner_lng_rate (
    BURNER_RATE_ID   BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    MACHINE_CODE     VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    LNG_PER_TON      DECIMAL(8,4) NOT NULL DEFAULT 0      COMMENT '버너 LNG 원단위 (㎥/톤제품)',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (BURNER_RATE_ID),
    UNIQUE KEY UK_BURNER_LNG (YEAR, MACHINE_CODE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 버너 LNG 원단위 (생산량 비례)';


-- ------------------------------------------------------------
-- 8. rpsim_steam_alloc_ratio (호기별 스팀사용 배분 비율)
--    스팀 관련 비용을 호기별로 배분 (제지3 약 85~87% 등)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_steam_alloc_ratio (
    ALLOC_ID         BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    MACHINE_CODE     VARCHAR(20)  NOT NULL                COMMENT '호기 코드',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    ALLOC_RATIO      DECIMAL(8,6) NOT NULL DEFAULT 0      COMMENT '배분 비율 (0~1, 전 호기 합=1)',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (ALLOC_ID),
    UNIQUE KEY UK_STEAM_ALLOC (YEAR, MACHINE_CODE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 호기별 스팀사용 배분 비율';


-- ------------------------------------------------------------
-- 9. rpsim_energy_monthly (월 에너지비 계산 결과)
--    보일러별 연료비 합계 + 버너 LNG − 고정 차감 = 월 총 에너지비
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_energy_monthly (
    ENERGY_ID           BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                  VARCHAR(6)   NOT NULL                COMMENT 'YYYYMM',
    DIVISION            VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    -- 스팀
    STEAM_REQUIRED_TON  DECIMAL(18,2) NULL   COMMENT '스팀 필요량 (톤)',
    STEAM_PRODUCED_TON  DECIMAL(18,2) NULL   COMMENT '스팀 생산량 (톤)',
    STEAM_SURPLUS_TON   DECIMAL(18,2) NULL   COMMENT '잉여 스팀 (톤, 밴트)',
    -- 보일러별 비용
    COGEN_COST_KRW      DECIMAL(18,2) NULL   COMMENT '복합보일러 비용 (원)',
    LNG_BOILER_COST_KRW DECIMAL(18,2) NULL   COMMENT 'LNG보일러 비용 (원)',
    INCIN_COST_KRW      DECIMAL(18,2) NULL   COMMENT '소각로 비용 (원)',
    EXTERNAL_COST_KRW   DECIMAL(18,2) NULL   COMMENT '외부보일러 비용 (원)',
    BURNER_LNG_COST_KRW DECIMAL(18,2) NULL   COMMENT '버너 LNG 비용 (원)',
    -- 차감
    DEDUCTION_TOTAL_KRW DECIMAL(18,2) NULL   COMMENT '고정 차감 합계 (원, 감가상각+처분수익+지상권)',
    -- 최종
    ENERGY_TOTAL_KRW    DECIMAL(18,2) NULL   COMMENT '월 총 에너지비 (원)',
    COST_PER_TON_STEAM  DECIMAL(12,2) NULL   COMMENT '스팀톤당 연료비 (천원/톤.스팀)',
    COST_PER_TON_PROD   DECIMAL(12,2) NULL   COMMENT '제품톤당 연료비 (천원/톤.제품)',
    CALC_STATUS         VARCHAR(20)  NOT NULL DEFAULT 'DRAFT' COMMENT '상태 (DRAFT/CALCULATED/CONFIRMED)',
    CREATED_AT          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT          DATETIME     NULL,
    PRIMARY KEY (ENERGY_ID),
    UNIQUE KEY UK_ENERGY_MONTHLY (YM, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 월 에너지비 결과 (보일러+버너−차감)';
