-- ============================================================
-- [운영 반영용 통합 스크립트] PR #328 + PR #329
-- 제조원가 RFC (Z_BI_WEB_EX_BL_4) 도입 및 sys_aimd_cot015 테이블 생성
--
-- 작성일 : 2026-08-03
-- 대상 PR: 
--   - PR #328 : sys_aimd_cot015 테이블 생성 (원본 043 마이그레이션)
--   - PR #329 : NLP_RFC_002 함수명 변경 Z_BI_PRE_COST → Z_BI_WEB_EX_BL_4 (원본 044 마이그레이션)
--
-- 실행 방법:
--   mysql -u <user> -p <database> < prod_apply_pr328_pr329_mfg_cost_rfc.sql
--   또는
--   mysql> USE <database>;
--   mysql> SOURCE prod_apply_pr328_pr329_mfg_cost_rfc.sql;
--
-- 멱등성:
--   본 스크립트는 여러 번 실행해도 안전합니다.
--   - CREATE TABLE IF NOT EXISTS : 이미 있으면 건너뜀
--   - UPDATE                     : 동일 값 재적용 시 0행 반영, 오류 없음
--   - INSERT ... WHERE NOT EXISTS: 이미 있으면 건너뜀
--
-- 분리 원칙:
--   수익성분석 (NLP_RFC_001 / Z_BI_WEB_EX_BL / bw_profitability_data)
--   에는 절대 영향 없습니다. WHERE 절로 NLP_RFC_002 만 명시적으로 지정.
--
-- 롤백:
--   본 스크립트 실행 전 batch_master 백업 권장:
--     CREATE TABLE batch_master_backup_pr329 AS SELECT * FROM batch_master;
--   테이블 롤백은 아래 검증쿼리로 상태 확인 후 필요 시 수동 진행.
-- ============================================================


-- ============================================================
-- ▣ Section 1. sys_aimd_cot015 테이블 생성 (PR #328 = sql/043)
-- ------------------------------------------------------------
-- SAP BW ZCOT015 (원가요소별 원가) 데이터를 RFC 로 수신해 저장하는 테이블.
-- 원본 35개 필드 + DB 자체 채번 seq 1개 = 총 36개 컬럼.
--
-- SAP 타입 → DB 타입 변환:
--   NUMC/CHAR/UNIT/CUKY → VARCHAR
--   QUAN                → DECIMAL(17,3)  (LBKUM 소수 3자리 유지)
--   CURR                → BIGINT         (원단위 정수 저장, RFC 어댑터가 반올림)
--
-- seq : bw_profitability_data 와 동일하게 AUTO_INCREMENT 자체 채번
--       RFC 요청/응답에는 seq 없음, INSERT 시 DB 가 자동 채움
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
-- ▣ Section 2. NLP_RFC_002 인터페이스 마스터 업데이트 (PR #329 = sql/044)
-- ------------------------------------------------------------
-- 운영에 등록된 인터페이스 NLP_RFC_002 (제조원가) 의 RFC 함수명을
-- 기존 Z_BI_PRE_COST 에서 Z_BI_WEB_EX_BL_4 로 일괄 변경.
--
-- 함께 정비:
--   1) rfc_name       : Z_BI_PRE_COST → Z_BI_WEB_EX_BL_4
--   2) rfc_param      : JSON body 내부 function 값도 Z_BI_WEB_EX_BL_4 로 교체
--   3) IFTBL          : NULL → sys_aimd_cot015 (실제 적재 테이블 매핑)
--   4) interface_name : '제조원가' → '제조원가 RFC'
--   5) rfc_func_or_url / default_mode / remark 정비
--
-- 분리 원칙:
--   수익성 (NLP_RFC_001) 은 절대 건드리지 않음 (WHERE 절 명시).
-- ============================================================

-- (2-1) NLP_RFC_002 마스터 정보를 Z_BI_WEB_EX_BL_4 기준으로 통일
UPDATE batch_master
   SET interface_name  = '제조원가 RFC',
       sender          = 'SAP',
       receiver        = 'analytics',
       rfc_name        = 'Z_BI_WEB_EX_BL_4',
       rfc_func_or_url = 'POST /profit-api/sap-rfc/execute',
       rfc_param       = '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}',
       IFTBL           = 'sys_aimd_cot015',
       default_mode    = 'replace',
       remark          = '제조원가 RFC (Z_BI_WEB_EX_BL_4) — sys_aimd_cot015 적재 / 월마감 후 실행',
       is_active       = 1,
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_002';

-- (2-2) 신규 환경(운영에 NLP_RFC_002 행이 아예 없을 경우) 대비 안전 INSERT
INSERT INTO batch_master
  (interface_id,   interface_name,  sender, receiver,    rfc_name,           rfc_func_or_url,                     rfc_param,                                                              IFTBL,               default_mode, remark,                                                                                    is_active, created_by)
SELECT
  'NLP_RFC_002',   '제조원가 RFC',  'SAP', 'analytics', 'Z_BI_WEB_EX_BL_4', 'POST /profit-api/sap-rfc/execute',  '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}',     'sys_aimd_cot015',   'replace',    '제조원가 RFC (Z_BI_WEB_EX_BL_4) — sys_aimd_cot015 적재 / 월마감 후 실행',  1,         'admin'
 WHERE NOT EXISTS (SELECT 1 FROM batch_master WHERE interface_id = 'NLP_RFC_002');

-- (2-3) 잔존 Z_BI_PRE_COST 정리
--       (legacy 시드 또는 수동 편집으로 다른 interface_id 아래 남아있을 수 있음)
--       해당 행이 없으면 UPDATE 는 0행 반영, 오류 없음.
UPDATE batch_master
   SET rfc_name  = 'Z_BI_WEB_EX_BL_4',
       rfc_param = REPLACE(IFNULL(rfc_param, ''), 'Z_BI_PRE_COST', 'Z_BI_WEB_EX_BL_4'),
       updated_by = 'admin'
 WHERE rfc_name = 'Z_BI_PRE_COST';


-- ============================================================
-- ▣ Section 3. 운영 반영 후 검증 쿼리
-- ------------------------------------------------------------
-- 아래 쿼리들을 실행하여 정상 반영을 확인하십시오.
--   (주석 처리되어 있으므로 필요 시 수동 실행)
-- ============================================================

-- ▶ 3-1) sys_aimd_cot015 테이블 존재 확인
--    SHOW TABLES LIKE 'sys_aimd_cot015';
--    -- 기대: sys_aimd_cot015 1행 반환

-- ▶ 3-2) sys_aimd_cot015 컬럼 개수 확인 (기대: 36 = seq + 35)
--    SELECT COUNT(*) AS col_count
--      FROM INFORMATION_SCHEMA.COLUMNS
--     WHERE TABLE_SCHEMA = DATABASE()
--       AND TABLE_NAME = 'sys_aimd_cot015';
--    -- 기대: 36

-- ▶ 3-3) sys_aimd_cot015 인덱스 확인 (PRIMARY + 5개 조회 인덱스 = 총 6개)
--    SHOW INDEX FROM sys_aimd_cot015;

-- ▶ 3-4) NLP_RFC_002 상태 (rfc_name = Z_BI_WEB_EX_BL_4, IFTBL = sys_aimd_cot015)
--    SELECT interface_id, interface_name, rfc_name, rfc_param, IFTBL, default_mode, is_active
--      FROM batch_master
--     WHERE interface_id = 'NLP_RFC_002' \G

-- ▶ 3-5) NLP_RFC_001 (수익성) 영향 없음 확인
--    SELECT interface_id, interface_name, rfc_name, IFTBL
--      FROM batch_master
--     WHERE interface_id = 'NLP_RFC_001';
--    -- 기대: rfc_name = 'Z_BI_WEB_EX_BL' (또는 NULL), IFTBL = 'bw_profitability_data'

-- ▶ 3-6) Z_BI_PRE_COST 잔존 참조 (기대: 0행)
--    SELECT interface_id, rfc_name, rfc_param
--      FROM batch_master
--     WHERE rfc_name = 'Z_BI_PRE_COST'
--        OR rfc_param LIKE '%Z_BI_PRE_COST%';
--    -- 기대: Empty set

-- ▶ 3-7) 샘플 INSERT 로 seq 자동 채번 검증 (선택)
--    INSERT INTO sys_aimd_cot015
--      (CALMONTH, PLANT, PLANT_NM, MATERIAL, MATERIAL_NM,
--       ZCGUBUN_D, ZCGUBUN, BASE_UOM, LBKUM, CURRENCY, TOTAL)
--    VALUES
--      ('202601', '1000', '테스트플랜트', 'M0001', '테스트자재',
--       '표준', '변동', 'EA', 100.123, 'KRW', 999999);
--    SELECT seq, CALMONTH, PLANT, MATERIAL, LBKUM, TOTAL
--      FROM sys_aimd_cot015 ORDER BY seq DESC LIMIT 1;
--    -- 사용 후 정리:
--    DELETE FROM sys_aimd_cot015 WHERE MATERIAL = 'M0001';

-- ============================================================
-- ▣ 반영 완료 체크리스트
-- ------------------------------------------------------------
--   □ 1. sys_aimd_cot015 테이블 생성됨 (3-1, 3-2, 3-3)
--   □ 2. NLP_RFC_002.rfc_name  = 'Z_BI_WEB_EX_BL_4' (3-4)
--   □ 3. NLP_RFC_002.IFTBL     = 'sys_aimd_cot015' (3-4)
--   □ 4. NLP_RFC_001 무변경    (3-5)
--   □ 5. Z_BI_PRE_COST 잔존 0건 (3-6)
-- ============================================================
