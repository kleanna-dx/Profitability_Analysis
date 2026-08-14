-- ============================================================
-- [2026-08-13] RFC 연계용 원가요소별 금액 테이블 sys_aimd_cot043 생성
-- ------------------------------------------------------------
-- 목적:
--   SAP RFC 로 수신되는 원가요소별 금액 데이터(코스트센터 단위)를 저장.
--   AIMD 시스템 관리용 테이블 명명 규칙: sys_aimd_{table_name}
--   (sys_aimd_cot015 / sys_aimd_login_log 등과 동일 컨벤션)
--
-- 필드 원천:
--   사용자 제공 필드 정의서 (원본 9개 필드)
--   원본 9개 필드 + DB 자체 채번 seq 1개 = 총 10개 컬럼
--
-- SAP 타입 → DB 타입 변환 기준 (사용자 스펙 명시):
--   NUMC → VARCHAR   (연월/코드 값은 앞자리 0 보존 위해 문자열로 저장)
--   CHAR → VARCHAR   (원본 길이 유지)
--   CUKY → VARCHAR
--   CURR → BIGINT    (원단위 정수로 저장; RFC 어댑터가 소수 변환 담당)
--
-- 기본키(seq):
--   RFC 원본에는 seq 필드가 없으나, bw_profitability_data / sys_aimd_cot015 와
--   동일하게 DB 에서 AUTO_INCREMENT 로 자체 채번. RFC 요청·응답에는 seq 를
--   포함하지 않고 INSERT 시 DB 가 자동 채움.
--
-- 컬럼 순서:
--   seq 를 맨 앞에 두고, 이후는 원본 필드 정의서 순서(CALMONTH → AMOUNT)를 유지.
--   (RFC 응답 → DB INSERT 매핑을 사람이 눈으로 검증하기 쉽도록)
--
-- 인덱스:
--   조회 성능을 위해 CALMONTH / COSTCENTER / ZCOSTCOMP / COSTELMNT 단일 인덱스와
--   대표 조합 (CALMONTH+COSTCENTER) 인덱스를 추가. sys_aimd_cot015 의
--   인덱스 정책과 동일한 접근.
--
-- 멱등성:
--   CREATE TABLE IF NOT EXISTS 로 안전하게 재실행 가능.
--
-- 의존:
--   없음 (독립 테이블).
--
-- 후속 작업 (본 PR 범위 밖):
--   - EXPECTED_INTERFACE_MAPPING 에 신규 interface_id 등록
--   - batch_master 에 RFC 함수명 / IFTBL='sys_aimd_cot043' 등록
--   - Spring Boot SapRfcSyncService 에 sys_aimd_cot043 매핑 추가
--   - CURR → BIGINT 변환 시 소수점 처리 방식 확인 (반올림/절삭 여부)
-- ============================================================

CREATE TABLE IF NOT EXISTS sys_aimd_cot043 (
  seq             BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY COMMENT 'DB 자체 채번 PK (RFC 원본에 없음, INSERT 시 자동)',

  -- 원본 RFC 필드 (필드 정의서 순서 유지)
  CALMONTH        VARCHAR(6)   NULL COMMENT '달력연도/월 (NUMC 6)',
  ZCOSTCOMP       VARCHAR(3)   NULL COMMENT '원가 구성요소 (NUMC 3)',
  ZCOSTCOMP_NM    VARCHAR(40)  NULL COMMENT '원가 구성요소명 (CHAR 40)',
  COSTELMNT       VARCHAR(10)  NULL COMMENT '원가 요소 (CHAR 10)',
  COSTELMNT_NM    VARCHAR(40)  NULL COMMENT '원가 요소명 (CHAR 40)',
  COSTCENTER      VARCHAR(10)  NULL COMMENT '코스트 센터 (CHAR 10)',
  COSTCENTER_NM   VARCHAR(20)  NULL COMMENT '코스트 센터명 (CHAR 20)',
  CURRENCY        VARCHAR(5)   NULL COMMENT '통화 (CUKY 5)',
  AMOUNT          BIGINT       NULL COMMENT '금액 (원본 CURR 17,2 → BIGINT; 원단위 정수 저장, RFC 어댑터가 소수 변환 담당)',

  -- 조회 성능 인덱스 (연월/코스트센터/원가구성요소/원가요소 조합이 대부분의 필터 조건)
  INDEX idx_cot043_calmonth              (CALMONTH),
  INDEX idx_cot043_costcenter            (COSTCENTER),
  INDEX idx_cot043_zcostcomp             (ZCOSTCOMP),
  INDEX idx_cot043_costelmnt             (COSTELMNT),
  INDEX idx_cot043_calmonth_costcenter   (CALMONTH, COSTCENTER)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='SAP RFC 연계 - 원가요소별 금액 (seq + 9 필드)';

-- ============================================================
-- 검증 쿼리 (운영 반영 후 실행하여 결과 확인)
-- ------------------------------------------------------------
-- 1) 테이블 존재 확인
--    SHOW TABLES LIKE 'sys_aimd_cot043';
--
-- 2) 스키마 확인 (컬럼/타입/길이/코멘트)
--    SHOW CREATE TABLE sys_aimd_cot043\G
--
-- 3) 컬럼 개수 확인 (기대: 10개 = seq + 9개 필드)
--    SELECT COUNT(*) AS col_count
--      FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME = 'sys_aimd_cot043';
--
-- 4) 인덱스 목록 확인 (PRIMARY + 5개 조회 인덱스)
--    SHOW INDEX FROM sys_aimd_cot043;
--
-- 5) 샘플 INSERT 검증 (seq 컬럼을 지정하지 않아도 자동 채번되는지 확인)
--    INSERT INTO sys_aimd_cot043
--      (CALMONTH, ZCOSTCOMP, ZCOSTCOMP_NM, COSTELMNT, COSTELMNT_NM,
--       COSTCENTER, COSTCENTER_NM, CURRENCY, AMOUNT)
--    VALUES
--      ('202608', '001', '재료비', '5100001000', '펄프',
--       'C1000', '초지1호기', 'KRW', 12345678);
--    SELECT seq, CALMONTH, ZCOSTCOMP, COSTELMNT, COSTCENTER, AMOUNT
--      FROM sys_aimd_cot043 ORDER BY seq DESC LIMIT 1;
--    -- 사용 후 정리: DELETE FROM sys_aimd_cot043 WHERE COSTCENTER='C1000' AND CALMONTH='202608';
-- ============================================================
