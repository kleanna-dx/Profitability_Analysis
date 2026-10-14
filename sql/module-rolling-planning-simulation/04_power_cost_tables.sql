-- ============================================================
-- 전력비 계산 신규 테이블 6개
-- 현업 담당자 인터뷰 확정 규칙 기반
-- 날짜: 2026-10-14
-- ============================================================

-- ------------------------------------------------------------
-- 1. rpsim_pw_timezone_def (부하별 시간대 정의)
--    계절별·요일구분별 경부하/중부하/최대부하 시간 정의
--    코드 하드코딩 금지 — 이 테이블 데이터로만 관리
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_timezone_def (
    TIMEZONE_DEF_ID  BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YEAR             INT          NOT NULL                COMMENT '적용 연도',
    SEASON           VARCHAR(20)  NOT NULL                COMMENT '시즌 (summer/winter/spring_fall)',
    DAY_TYPE         VARCHAR(20)  NOT NULL                COMMENT '요일구분 (weekday/saturday/holiday)',
    LOAD_CLASS       VARCHAR(20)  NOT NULL                COMMENT '부하구분 (peak/mid/off)',
    START_HOUR       INT          NOT NULL                COMMENT '시작시 (0~23)',
    END_HOUR         INT          NOT NULL                COMMENT '종료시 (1~24, 24=자정)',
    HOURS            DECIMAL(4,1) NOT NULL                COMMENT '해당 구간 시간 수',
    DISCOUNT_RATE    DECIMAL(5,4) NOT NULL DEFAULT 0      COMMENT '할인율 (봄가을 주말 경부하 50%=0.5 등)',
    MEMO             VARCHAR(200) NULL                    COMMENT '비고 (계절 특례 설명 등)',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (TIMEZONE_DEF_ID),
    INDEX IDX_PW_TZDEF_LOOKUP (YEAR, SEASON, DAY_TYPE, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 부하별 시간대 정의 (하드코딩 금지, 데이터 관리)';


-- ------------------------------------------------------------
-- 2. rpsim_pw_load_demand (부하별 시간당 사용량)
--    월별·사업부별 경부하/중부하/최대부하 시간당 사용량(kW)
--    보정 규칙: 세 부하 합계 ≠ 총 전력사용량이면 비례 배분
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_load_demand (
    LOAD_DEMAND_ID   BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM               VARCHAR(6)   NOT NULL                COMMENT 'YYYYMM',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    LOAD_CLASS       VARCHAR(20)  NOT NULL                COMMENT '부하구분 (peak/mid/off)',
    HOURLY_USAGE_KW  DECIMAL(12,2) NOT NULL DEFAULT 0     COMMENT '시간당 사용량 (kW)',
    MEMO             VARCHAR(200) NULL                    COMMENT '비고',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (LOAD_DEMAND_ID),
    UNIQUE KEY UK_PW_LOAD_DEMAND (YM, DIVISION, LOAD_CLASS)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 부하별 시간당 사용량 (월별 관리)';


-- ------------------------------------------------------------
-- 3. rpsim_pw_peak_demand (최대수요전력 이력)
--    월 측정 최대수요가 현재 유효값보다 크면 교체 → 12개월간 유지
--    만기 후 실적 재반영
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_peak_demand (
    PEAK_DEMAND_ID   BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM               VARCHAR(6)   NOT NULL                COMMENT '측정 YYYYMM',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    MEASURED_KW      DECIMAL(12,2) NOT NULL               COMMENT '월 측정 최대수요 (kW)',
    EFFECTIVE_KW     DECIMAL(12,2) NOT NULL               COMMENT '적용 최대수요 (kW) — 캐리 규칙 적용 후',
    CARRY_ORIGIN_YM  VARCHAR(6)   NULL                    COMMENT '캐리 원본 월 (언제의 실적이 적용 중인지)',
    CARRY_EXPIRE_YM  VARCHAR(6)   NULL                    COMMENT '캐리 만기 월',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (PEAK_DEMAND_ID),
    UNIQUE KEY UK_PW_PEAK_DEMAND (YM, DIVISION)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 최대수요전력 이력 (12개월 캐리 규칙)';


-- ------------------------------------------------------------
-- 4. rpsim_pw_machine_usage_ratio (설비별 전력사용 배분 비율)
--    총 전기요금 × 설비별 비율 → 설비별 전력비
--    월별 갱신 가능
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_machine_usage_ratio (
    RATIO_ID         BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM               VARCHAR(6)   NOT NULL                COMMENT 'YYYYMM',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    LINE_CODE        VARCHAR(20)  NOT NULL                COMMENT '설비(호기) 코드',
    USAGE_RATIO      DECIMAL(8,6) NOT NULL DEFAULT 0      COMMENT '사용 비율 (0~1, 전 설비 합계=1)',
    MEMO             VARCHAR(200) NULL,
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (RATIO_ID),
    UNIQUE KEY UK_PW_MACHINE_RATIO (YM, DIVISION, LINE_CODE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 설비별 전력사용 배분 비율 (월별 갱신)';


-- ------------------------------------------------------------
-- 5. rpsim_pw_fixed_item (고정층 항목 — 환급/지급)
--    부호 규칙: 지출 +, 환급/차감 −
--    DR환급, 부하차단, 복합보일러, ESS 등 월별 금액 직접 입력
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_fixed_item (
    FIXED_ITEM_ID    BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM               VARCHAR(6)   NOT NULL                COMMENT 'YYYYMM',
    DIVISION         VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    ITEM_CODE        VARCHAR(30)  NOT NULL                COMMENT '항목코드 (DR_REFUND/LOAD_CUT/BOILER_DEDUCT/ESS_PAYMENT/POWER_FIXED)',
    ITEM_NAME        VARCHAR(100) NOT NULL                COMMENT '항목명',
    AMOUNT_KRW       DECIMAL(18,2) NOT NULL DEFAULT 0     COMMENT '금액 (원) — 지출+, 환급/차감−',
    CALC_FORMULA     VARCHAR(500) NULL                    COMMENT '계산식 메모 (검증용)',
    MEMO             VARCHAR(500) NULL                    COMMENT '비고',
    CREATED_AT       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT       DATETIME     NULL,
    PRIMARY KEY (FIXED_ITEM_ID),
    UNIQUE KEY UK_PW_FIXED_ITEM (YM, DIVISION, ITEM_CODE)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 전력비 고정층 항목 (환급/지급, 부호: 지출+, 환급−)';


-- ------------------------------------------------------------
-- 6. rpsim_pw_monthly_summary (월 총 전력비 계산 결과)
--    변동층(한전요금) + 고정층 = 월 총 전력비
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rpsim_pw_monthly_summary (
    SUMMARY_ID          BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                  VARCHAR(6)   NOT NULL                COMMENT 'YYYYMM',
    DIVISION            VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    -- 변동층 (한전요금)
    TOTAL_USAGE_KWH     DECIMAL(18,4) NULL   COMMENT '총 전력사용량 (kWh)',
    PEAK_USAGE_KWH      DECIMAL(18,4) NULL   COMMENT '최대부하 사용량 (kWh)',
    MID_USAGE_KWH       DECIMAL(18,4) NULL   COMMENT '중부하 사용량 (kWh)',
    OFF_USAGE_KWH       DECIMAL(18,4) NULL   COMMENT '경부하 사용량 (kWh)',
    ENERGY_COST_KRW     DECIMAL(18,2) NULL   COMMENT '에너지요금 = Σ(부하별 사용량×단가)',
    DEMAND_COST_KRW     DECIMAL(18,2) NULL   COMMENT '기본요금 = 최대수요(kW)×8,190원',
    POWER_FACTOR_KRW    DECIMAL(18,2) NULL   COMMENT '역률요금 (고정값, 약 65~70만원)',
    POWER_FUND_KRW      DECIMAL(18,2) NULL   COMMENT '전력기금 = 소계×0.027',
    VARIABLE_TOTAL_KRW  DECIMAL(18,2) NULL   COMMENT '변동층 합계 (한전요금 소계)',
    -- 고정층 (환급/지급)
    DR_REFUND_KRW       DECIMAL(18,2) NULL   COMMENT 'DR 환급금 (−)',
    LOAD_CUT_KRW        DECIMAL(18,2) NULL   COMMENT '고객부하차단 보상금 (−)',
    BOILER_DEDUCT_KRW   DECIMAL(18,2) NULL   COMMENT '복합보일러 전력비 차감 (−)',
    ESS_PAYMENT_KRW     DECIMAL(18,2) NULL   COMMENT 'ESS(SPC) 지급금 (+)',
    FIXED_TOTAL_KRW     DECIMAL(18,2) NULL   COMMENT '고정층 합계',
    -- 최종
    MONTHLY_TOTAL_KRW   DECIMAL(18,2) NULL   COMMENT '월 총 전력비 = 변동층 + 고정층',
    COST_PER_TON_KRW    DECIMAL(12,2) NULL   COMMENT '톤당 전력비 (원/톤)',
    CALC_STATUS         VARCHAR(20)  NOT NULL DEFAULT 'DRAFT' COMMENT '계산 상태 (DRAFT/CALCULATED/CONFIRMED)',
    CREATED_AT          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UPDATED_AT          DATETIME     NULL,
    PRIMARY KEY (SUMMARY_ID),
    UNIQUE KEY UK_PW_MONTHLY (YM, DIVISION),
    INDEX IDX_PW_MONTHLY_YM (YM)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 월 총 전력비 결과 (변동층+고정층)';
