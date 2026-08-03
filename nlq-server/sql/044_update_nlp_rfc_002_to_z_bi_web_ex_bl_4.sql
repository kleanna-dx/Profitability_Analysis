-- ============================================================
-- [2026-08-03] 제조원가 RFC 함수명 변경 (Z_BI_PRE_COST → Z_BI_WEB_EX_BL_4)
--              + sys_aimd_cot015 매핑
-- ------------------------------------------------------------
-- 목적:
--   운영에 등록된 인터페이스 NLP_RFC_002 (제조원가) 의 RFC 함수명을
--   기존 Z_BI_PRE_COST 에서 Z_BI_WEB_EX_BL_4 로 일괄 변경.
--   수익성분석 RFC (Z_BI_WEB_EX_BL) 와 동일한 호출 방식 사용:
--     - I_CMONTH (YYYYMM) 파라미터 전달
--     - T_DATA 응답 테이블 수신
--     - sys_aimd_cot015 에 적재 (PR #328 에서 생성)
--
-- 함께 정비하는 내용:
--   1) rfc_name : Z_BI_PRE_COST → Z_BI_WEB_EX_BL_4
--   2) rfc_param: JSON body 내부 function 값도 Z_BI_WEB_EX_BL_4 로 교체
--   3) IFTBL   : NULL → sys_aimd_cot015 (인터페이스 수행/이력 통계 및
--                monthly API 가 인터페이스별 실제 적재 테이블을 조회하기 위한 매핑)
--   4) interface_name : '제조원가' → '제조원가 RFC'
--                       ('수익성분석 RFC' 처럼 상단/이력에서 명시적이도록 통일)
--   5) rfc_func_or_url / default_mode / exec_command / remark 정비
--
-- 분리 원칙:
--   - 수익성분석 (NLP_RFC_001) 은 절대 건드리지 않음 (WHERE 절 명시).
--   - Z_BI_WEB_EX_BL_4 는 Z_BI_WEB_EX_BL 과 시그니처는 같지만 별개 RFC.
--
-- 멱등성:
--   - 이미 Z_BI_WEB_EX_BL_4 로 바뀌어 있어도 UPDATE 는 동일 값을 다시 씀 (안전).
--   - sys_aimd_cot015 테이블 존재 여부는 043 마이그레이션이 담당 (여기서는 매핑만).
-- ============================================================

-- (1) NLP_RFC_002 마스터 정보를 Z_BI_WEB_EX_BL_4 기준으로 통일
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

-- (2) 혹시 아직 마스터에 NLP_RFC_002 행이 없는 신규 환경이면 신규 INSERT
--     (026 시드에서 IF NOT EXISTS 로 삽입하므로 대부분 없을 것이나, 안전 장치)
INSERT INTO batch_master
  (interface_id,   interface_name,  sender, receiver,    rfc_name,           rfc_func_or_url,                     rfc_param,                                                              IFTBL,               default_mode, remark,                                                                                    is_active, created_by)
SELECT
  'NLP_RFC_002',   '제조원가 RFC',  'SAP', 'analytics', 'Z_BI_WEB_EX_BL_4', 'POST /profit-api/sap-rfc/execute',  '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}',     'sys_aimd_cot015',   'replace',    '제조원가 RFC (Z_BI_WEB_EX_BL_4) — sys_aimd_cot015 적재 / 월마감 후 실행',  1,         'admin'
 WHERE NOT EXISTS (SELECT 1 FROM batch_master WHERE interface_id = 'NLP_RFC_002');

-- (3) [화면 표시 정합성] 이력관리 등에서 이전 함수명 Z_BI_PRE_COST 가 남아있지 않도록,
--     혹시 legacy 시드/수동 편집으로 SNOP_RFC_002 같은 다른 interface_id 아래에
--     Z_BI_PRE_COST 가 걸려 있다면 함께 새 함수명으로 갈아치움.
--     (해당 행이 없으면 UPDATE 는 0행 반영, 오류 없음)
UPDATE batch_master
   SET rfc_name  = 'Z_BI_WEB_EX_BL_4',
       rfc_param = REPLACE(IFNULL(rfc_param, ''), 'Z_BI_PRE_COST', 'Z_BI_WEB_EX_BL_4'),
       updated_by = 'admin'
 WHERE rfc_name = 'Z_BI_PRE_COST';

-- ============================================================
-- 검증 쿼리
-- ------------------------------------------------------------
-- 1) NLP_RFC_002 상태
--    SELECT interface_id, interface_name, rfc_name, rfc_param, IFTBL, default_mode, is_active
--      FROM batch_master WHERE interface_id = 'NLP_RFC_002' \G
--
-- 2) 수익성 (NLP_RFC_001) 이 영향받지 않았는지 확인
--    SELECT interface_id, interface_name, rfc_name, IFTBL
--      FROM batch_master WHERE interface_id = 'NLP_RFC_001';
--    -- 기대: rfc_name = 'Z_BI_WEB_EX_BL' (또는 NULL) , IFTBL = 'bw_profitability_data'
--
-- 3) Z_BI_PRE_COST 참조 잔존 여부 확인 (기대: 0행)
--    SELECT interface_id, rfc_name, rfc_param FROM batch_master
--     WHERE rfc_name = 'Z_BI_PRE_COST' OR rfc_param LIKE '%Z_BI_PRE_COST%';
-- ============================================================
