-- ============================================================
-- [PR #331 / 2026-08-03] 인터페이스 매핑 정합성 보정 + 예약 데이터 정리
-- ------------------------------------------------------------
-- 배경:
--   [인터페이스 수행관리] 에서 NLP_RFC_002 (제조원가) 를 선택하여 예약해도
--   실제 실행 로그에는 수익성 Z_BI_WEB_EX_BL 이 호출되던 문제 발생.
--
--   원인 분석:
--     (a) batch_master.NLP_RFC_001.rfc_name 이 NULL 로 저장돼 있어
--         executeBatchJob 이 interface_id 기반 해석을 못하고
--         Spring Boot 의 기본값(수익성 RFC)에 의존.
--     (b) executeBatchJob 시그니처가 interface_id 를 받지 않고
--         Spring Boot 에 { cmonth, mode, jobId } 만 전달하여
--         interface_id 별 라우팅이 불가능.
--   ⇒ 코드 측: server.mjs 에서 batch_master 조회 후 매핑 검증 + 라우팅으로 수정 (PR #331)
--   ⇒ 데이터 측: 이 마이그레이션에서 rfc_name NULL 및 잘못된 legacy 값 보정.
--
-- 정비 항목:
--   1) NLP_RFC_001.rfc_name = 'Z_BI_WEB_EX_BL', IFTBL = 'bw_profitability_data' 강제
--   2) NLP_RFC_002.rfc_name = 'Z_BI_WEB_EX_BL_4', IFTBL = 'sys_aimd_cot015' 강제
--   3) batch_master 에서 rfc_name/IFTBL 이 어긋난 데이터 잔존 정리
--   4) batch_schedule 에는 interface_id 만 저장되므로 별도 rfc_name 필드 정리 불필요
--      (batch_schedule 스키마 확인 결과 rfc_name / target_table 컬럼 없음.
--       실행 시점에 batch_master 를 조회하는 방식이 올바름.)
--
-- 멱등성:
--   UPDATE 는 동일 값 재적용해도 안전 (0행 반영, 오류 없음).
-- ============================================================


-- ── (1) NLP_RFC_001 (수익성분석) 마스터 강제 정합화 ────────────────
--     기대값:
--       rfc_name        = 'Z_BI_WEB_EX_BL'
--       IFTBL           = 'bw_profitability_data'
--       interface_name  = '수익성데이터' (기존값 유지)
UPDATE batch_master
   SET rfc_name        = 'Z_BI_WEB_EX_BL',
       rfc_func_or_url = COALESCE(rfc_func_or_url, 'POST /profit-api/sap-rfc/execute'),
       rfc_param       = COALESCE(rfc_param,
                                  '{"function":"Z_BI_WEB_EX_BL","params":{"I_CMONTH":"{CMONTH}"}}'),
       IFTBL           = 'bw_profitability_data',
       default_mode    = COALESCE(default_mode, 'replace'),
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_001';


-- ── (2) NLP_RFC_002 (제조원가) 마스터 강제 정합화 ────────────────
--     기대값:
--       rfc_name        = 'Z_BI_WEB_EX_BL_4'
--       IFTBL           = 'sys_aimd_cot015'
--       interface_name  = '제조원가 RFC'
UPDATE batch_master
   SET interface_name  = '제조원가 RFC',
       rfc_name        = 'Z_BI_WEB_EX_BL_4',
       rfc_func_or_url = 'POST /profit-api/sap-rfc/execute',
       rfc_param       = '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}',
       IFTBL           = 'sys_aimd_cot015',
       default_mode    = COALESCE(default_mode, 'replace'),
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_002';


-- ── (3) 잔존 Z_BI_PRE_COST / 잘못된 매핑 정리 ────────────────
--     rfc_name 이 Z_BI_PRE_COST 로 남아있는 행은 Z_BI_WEB_EX_BL_4 로 교체
UPDATE batch_master
   SET rfc_name  = 'Z_BI_WEB_EX_BL_4',
       rfc_param = REPLACE(IFNULL(rfc_param, ''), 'Z_BI_PRE_COST', 'Z_BI_WEB_EX_BL_4'),
       updated_by = 'admin'
 WHERE rfc_name = 'Z_BI_PRE_COST';


-- ── (4) [DIAG] 잘못 저장된 예약 데이터 진단 ────────────────
--     batch_schedule 자체에는 rfc_name / target_table 컬럼이 없으므로
--     "예약 데이터에 잘못된 rfc_function 이 저장되어 있을 수 있다" 는 우려는
--     설계상 발생하지 않습니다.
--     아래 쿼리로 실제 예약 데이터의 interface_id 만 검증하십시오:
--
--     SELECT id, interface_id, schedule_type, target_cmonth, exec_mode, is_active
--       FROM batch_schedule ORDER BY id DESC;
--
--     interface_id 가 NULL 이거나 batch_master 에 없는 값이면
--     실행 시점에 INTERFACE_CONFIG_ERROR 로 자동 실패 처리됩니다 (server.mjs).


-- ── (5) [DIAG] 잘못 저장된 batch_jobs 이력 진단 ────────────────
--     batch_jobs 에는 interface_id 가 저장되므로,
--     "제조원가 예약인데 interface_id=NLP_RFC_001 로 잘못 저장된" 경우가 있는지 확인:
--
--     SELECT COUNT(*) AS wrong_history
--       FROM batch_jobs j
--       JOIN batch_schedule s ON s.id IS NOT NULL  -- 스케줄에서 실행된 이력만 대상은 x
--      WHERE ... ;
--
--   실제로는 batch_jobs 는 실행 시점에 사용자가 선택한 interface_id 를 그대로 기록하므로,
--   잘못된 legacy 데이터를 강제로 재작성하는 대신 이력관리 화면에서 확인만 하십시오.


-- ============================================================
-- 검증 쿼리 (반영 후 실행)
-- ------------------------------------------------------------
-- [1] NLP_RFC_001 / NLP_RFC_002 매핑 확인
--     SELECT interface_id, interface_name, rfc_name, IFTBL, default_mode
--       FROM batch_master WHERE interface_id IN ('NLP_RFC_001','NLP_RFC_002');
--     -- 기대:
--     --   NLP_RFC_001 | 수익성데이터 | Z_BI_WEB_EX_BL   | bw_profitability_data | replace
--     --   NLP_RFC_002 | 제조원가 RFC | Z_BI_WEB_EX_BL_4 | sys_aimd_cot015       | replace
--
-- [2] rfc_name NULL 잔존 여부 (기대: 0행)
--     SELECT interface_id FROM batch_master WHERE rfc_name IS NULL OR rfc_name = '';
--
-- [3] Z_BI_PRE_COST 잔존 여부 (기대: 0행)
--     SELECT interface_id, rfc_name FROM batch_master WHERE rfc_name='Z_BI_PRE_COST';
--
-- [4] 예약 데이터의 interface_id 유효성 (기대: 미매핑 0행)
--     SELECT s.id, s.interface_id
--       FROM batch_schedule s LEFT JOIN batch_master m USING (interface_id)
--      WHERE m.interface_id IS NULL;
-- ============================================================
