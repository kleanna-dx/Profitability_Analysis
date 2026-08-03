-- ============================================================
-- [2026-08-03] RFC 연계용 제조원가 테이블 sys_aimd_cot015 생성
-- ------------------------------------------------------------
-- 목적:
--   SAP BW ZCOT015 (원가요소별 원가) 데이터를 RFC 로 수신해 저장하기 위한 테이블.
--   AIMD 시스템 관리용 테이블 명명 규칙: sys_aimd_{table_name}
--   (sys_aimd_areas / sys_aimd_error_reports 등과 동일 컨벤션)
--
-- 필드 원천:
--   깨끗한나라_BW 원가요소별 원가 필드 리스트_20260731 (첨부 엑셀 ZCOT015)
--   ZCOT015 원본 35개 필드 + DB 자체 채번 seq 1개 = 총 36개 컬럼
--
-- SAP 타입 → DB 타입 변환 기준 (사용자 스펙 명시):
--   NUMC → VARCHAR   (연월 등 숫자 문자열은 문자열로 저장)
--   CHAR → VARCHAR
--   UNIT → VARCHAR
--   CUKY → VARCHAR
--   QUAN → DECIMAL   (LBKUM 는 소수 3자리 유지)
--   CURR → BIGINT    (원단위 정수로 저장; RFC 어댑터가 소수 변환 담당)
--
-- 기본키(seq):
--   RFC 원본에는 seq 필드가 없으나, bw_profitability_data 와 동일하게
--   DB 에서 AUTO_INCREMENT 로 자체 채번. RFC 요청·응답에는 seq 를 포함하지 않고
--   INSERT 시 DB 가 자동 채움.
--
-- 컬럼 순서:
--   seq 를 맨 앞에 두고, 이후는 원본 ZCOT015 필드 순서를 그대로 유지.
--   (RFC 응답 → DB INSERT 매핑을 사람이 눈으로 검증하기 쉽도록)
--
-- 멱등성:
--   CREATE TABLE IF NOT EXISTS 로 안전하게 재실행 가능.
--
-- 의존:
--   없음 (독립 테이블).
-- ============================================================

CREATE TABLE IF NOT EXISTS sys_aimd_cot015 (
  seq          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'DB 자체 채번 PK (RFC 원본에 없음, INSERT 시 자동)',

  -- 원본 ZCOT015 필드 (엑셀 순서 유지)
  CALMONTH     VARCHAR(6)   NULL COMMENT '달력연도/월 (NUMC 6)',
  PLANT        VARCHAR(4)   NULL COMMENT '플랜트 (CHAR 4)',
  PLANT_NM     VARCHAR(40)  NULL COMMENT '플랜트명 (CHAR 40)',
  MATERIAL     VARCHAR(18)  NULL COMMENT '자재 (CHAR 18)',
  MATERIAL_NM  VARCHAR(40)  NULL COMMENT '자재명 (CHAR 40)',
  ZCGUBUN_D    VARCHAR(20)  NULL COMMENT '표준원가추정(대구분) (CHAR 20)',
  ZCGUBUN      VARCHAR(20)  NULL COMMENT '원가구분(구분) (CHAR 20)',
  BASE_UOM     VARCHAR(3)   NULL COMMENT '기본 단위 (UNIT 3)',
  LBKUM        DECIMAL(17,3) NULL COMMENT '생산수량(매출수량) (QUAN 17,3)',
  CURRENCY     VARCHAR(5)   NULL COMMENT '통화 (CUKY 5)',

  -- 원가 금액 (CURR → BIGINT; 원본은 소수 2자리이나 사용자 스펙에 따라 정수로 저장)
  TOTAL        BIGINT       NULL COMMENT '합계금액 (CURR 17,2 → BIGINT)',
  KST_V        BIGINT       NULL COMMENT '변동비 합계 (CURR 17,2 → BIGINT)',
  KST_F        BIGINT       NULL COMMENT '고정비 합계 (CURR 17,2 → BIGINT)',
  KST001       BIGINT       NULL COMMENT '재료비-펄프 (CURR 17,2 → BIGINT)',
  KST002       BIGINT       NULL COMMENT '재료비-고지 (CURR 17,2 → BIGINT)',
  KST004       BIGINT       NULL COMMENT '재료비-패드 (CURR 17,2 → BIGINT)',
  KST006       BIGINT       NULL COMMENT '부재료비-약품 (CURR 17,2 → BIGINT)',
  KST008       BIGINT       NULL COMMENT '부재료비-포장재 (CURR 17,2 → BIGINT)',
  KST010       BIGINT       NULL COMMENT '재료비-기타 (CURR 17,2 → BIGINT)',
  KST012       BIGINT       NULL COMMENT '인건비 (CURR 17,2 → BIGINT)',
  KST014       BIGINT       NULL COMMENT '도급비 (CURR 17,2 → BIGINT)',
  KST015       BIGINT       NULL COMMENT '에너지비 (CURR 17,2 → BIGINT)',
  KST017       BIGINT       NULL COMMENT '감가상각비 (CURR 17,2 → BIGINT)',
  KST019       BIGINT       NULL COMMENT '수선/소모품비 (CURR 17,2 → BIGINT)',
  KST021       BIGINT       NULL COMMENT '기타경비 (CURR 17,2 → BIGINT)',
  KST025       BIGINT       NULL COMMENT '외주가공비 (CURR 17,2 → BIGINT)',
  KST027       BIGINT       NULL COMMENT '인건비-경비 (CURR 17,2 → BIGINT)',
  KST029       BIGINT       NULL COMMENT '인건비_기타 (CURR 17,2 → BIGINT)',
  KST031       BIGINT       NULL COMMENT '전력비 (CURR 17,2 → BIGINT)',
  KST033       BIGINT       NULL COMMENT '세금과공과 (CURR 17,2 → BIGINT)',
  KST035       BIGINT       NULL COMMENT '지급수수료 (CURR 17,2 → BIGINT)',
  KST037       BIGINT       NULL COMMENT '기타경비_폐기물 (CURR 17,2 → BIGINT)',
  KST039       BIGINT       NULL COMMENT '생산량(입고용) (CURR 17,2 → BIGINT)',
  TOTAL1       BIGINT       NULL COMMENT '현재월 표준가 (CURR 17,2 → BIGINT)',
  TOTAL2       BIGINT       NULL COMMENT '이전월 표준가 (CURR 17,2 → BIGINT)',

  -- 조회 성능 인덱스 (연월/플랜트/자재 조합이 대부분의 필터 조건)
  INDEX idx_cot015_calmonth              (CALMONTH),
  INDEX idx_cot015_plant                 (PLANT),
  INDEX idx_cot015_material              (MATERIAL),
  INDEX idx_cot015_calmonth_plant        (CALMONTH, PLANT),
  INDEX idx_cot015_calmonth_plant_matl   (CALMONTH, PLANT, MATERIAL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='SAP BW ZCOT015 RFC 연계 - 원가요소별 원가 (seq + 35 필드)';

-- ============================================================
-- 검증 쿼리 (운영 반영 후 실행하여 결과 확인)
-- ------------------------------------------------------------
-- 1) 테이블 존재 확인
--    SHOW TABLES LIKE 'sys_aimd_cot015';
--
-- 2) 스키마 확인 (컬럼/타입/길이/코멘트)
--    SHOW CREATE TABLE sys_aimd_cot015\G
--
-- 3) 컬럼 개수 확인 (기대: 36개 = seq + 35개 필드)
--    SELECT COUNT(*) AS col_count
--      FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME = 'sys_aimd_cot015';
--
-- 4) 인덱스 목록 확인 (PRIMARY + 5개 조회 인덱스)
--    SHOW INDEX FROM sys_aimd_cot015;
--
-- 5) 샘플 INSERT 검증 (seq 컬럼을 지정하지 않아도 자동 채번되는지 확인)
--    INSERT INTO sys_aimd_cot015
--      (CALMONTH, PLANT, PLANT_NM, MATERIAL, MATERIAL_NM,
--       ZCGUBUN_D, ZCGUBUN, BASE_UOM, LBKUM, CURRENCY, TOTAL)
--    VALUES
--      ('202601', '1000', '테스트플랜트', 'M0001', '테스트자재',
--       '표준', '변동', 'EA', 100.123, 'KRW', 999999);
--    SELECT seq, CALMONTH, PLANT, MATERIAL, LBKUM, TOTAL FROM sys_aimd_cot015 ORDER BY seq DESC LIMIT 1;
--    -- 사용 후 정리: DELETE FROM sys_aimd_cot015 WHERE MATERIAL='M0001';
-- ============================================================
