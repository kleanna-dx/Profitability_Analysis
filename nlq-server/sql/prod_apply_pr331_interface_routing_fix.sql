-- ============================================================
-- [운영 반영용 통합 스크립트] PR #331
-- 인터페이스 예약 실행 RFC 매핑 오류 수정 (interface routing fix)
--
-- 작성일 : 2026-08-03
-- 대상 PR:
--   - PR #331 : 인터페이스 매핑 정합성 보정 + 예약 실행 라우팅 수정
--               (원본 마이그레이션 : sql/045_fix_interface_mapping_and_schedule_data.sql)
--
-- 실행 방법:
--   mysql -u <user> -p <database> < prod_apply_pr331_interface_routing_fix.sql
--   또는
--   mysql> USE <database>;
--   mysql> SOURCE prod_apply_pr331_interface_routing_fix.sql;
--
-- 멱등성:
--   본 스크립트는 여러 번 실행해도 안전합니다.
--   - UPDATE : 동일 값 재적용 시 0행 반영, 오류 없음.
--   - DIAG   : 조회 전용, 데이터 변경 없음.
--
-- ============================================================
-- ▣ 배경
--   [인터페이스 수행관리] 에서 NLP_RFC_002 (제조원가) 를 선택하여 예약해도
--   실제 실행 로그에는 수익성 Z_BI_WEB_EX_BL 이 호출되던 문제.
--
--   원인 분석:
--     (a) batch_master.NLP_RFC_001.rfc_name 이 NULL 로 저장돼 있어
--         executeBatchJob 이 interface_id 기반 해석을 못하고
--         Spring Boot 의 기본값(수익성 RFC)에 의존.
--     (b) executeBatchJob 시그니처가 interface_id 를 받지 않고
--         Spring Boot 에 { cmonth, mode, jobId } 만 전달하여
--         interface_id 별 라우팅이 불가능.
--
--   ⇒ 코드 측 : server.mjs 에서 batch_master 조회 후 매핑 검증 + 라우팅 (PR #331 코드 변경)
--   ⇒ 데이터 측 : 본 스크립트 (rfc_name NULL / 잔존 legacy 값 보정)
--
-- ▣ 정비 항목
--   1) NLP_RFC_001.rfc_name = 'Z_BI_WEB_EX_BL',   IFTBL = 'bw_profitability_data'
--   2) NLP_RFC_002.rfc_name = 'Z_BI_WEB_EX_BL_4', IFTBL = 'sys_aimd_cot015'
--   3) Z_BI_PRE_COST 잔존 정리
--   4) 예약 데이터(batch_schedule) 진단 쿼리 제공
--
-- ▣ 분리 원칙
--   수익성분석 (NLP_RFC_001) 은 rfc_name NULL 보정만 수행.
--   본 UPDATE 는 IFTBL / rfc_param 을 기존 값과 동일하게 강제하므로
--   수익성 실행 경로에 영향 없음. WHERE 절로 interface_id 명시.
--
-- ▣ 롤백
--   본 스크립트 실행 전 batch_master 백업 권장:
--     CREATE TABLE batch_master_backup_pr331 AS SELECT * FROM batch_master;
--   롤백 필요 시 백업 테이블에서 UPDATE 로 복원.
-- ============================================================


-- ============================================================
-- ▣ Section 1. NLP_RFC_001 (수익성분석) 매핑 강제 정합화
-- ------------------------------------------------------------
-- 기대값:
--   rfc_name        = 'Z_BI_WEB_EX_BL'
--   IFTBL           = 'bw_profitability_data'
--   interface_name  = '수익성데이터' (기존값 유지)
--
-- 배경:
--   운영에서 NLP_RFC_001.rfc_name 이 NULL 로 저장되어 있어
--   executeBatchJob 이 interface_id 기반 라우팅을 수행할 수 없었음.
-- ============================================================
UPDATE batch_master
   SET rfc_name        = 'Z_BI_WEB_EX_BL',
       rfc_func_or_url = COALESCE(rfc_func_or_url, 'POST /profit-api/sap-rfc/execute'),
       rfc_param       = COALESCE(rfc_param,
                                  '{"function":"Z_BI_WEB_EX_BL","params":{"I_CMONTH":"{CMONTH}"}}'),
       IFTBL           = 'bw_profitability_data',
       default_mode    = COALESCE(default_mode, 'replace'),
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_001';


-- ============================================================
-- ▣ Section 2. NLP_RFC_002 (제조원가) 매핑 강제 정합화
-- ------------------------------------------------------------
-- 기대값:
--   rfc_name        = 'Z_BI_WEB_EX_BL_4'
--   IFTBL           = 'sys_aimd_cot015'
--   interface_name  = '제조원가 RFC'
--
-- PR #329 로 이미 반영되어 있어야 하나, 안전을 위해 재적용.
-- ============================================================
UPDATE batch_master
   SET interface_name  = '제조원가 RFC',
       rfc_name        = 'Z_BI_WEB_EX_BL_4',
       rfc_func_or_url = 'POST /profit-api/sap-rfc/execute',
       rfc_param       = '{"function":"Z_BI_WEB_EX_BL_4","params":{"I_CMONTH":"{CMONTH}"}}',
       IFTBL           = 'sys_aimd_cot015',
       default_mode    = COALESCE(default_mode, 'replace'),
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_002';


-- ============================================================
-- ▣ Section 3. 잔존 Z_BI_PRE_COST 정리
-- ------------------------------------------------------------
-- 어떤 이유로든 rfc_name 이 옛 함수명(Z_BI_PRE_COST)으로 남은 경우
-- Z_BI_WEB_EX_BL_4 로 교체 및 rfc_param 내 문자열도 치환.
-- ============================================================
UPDATE batch_master
   SET rfc_name  = 'Z_BI_WEB_EX_BL_4',
       rfc_param = REPLACE(IFNULL(rfc_param, ''), 'Z_BI_PRE_COST', 'Z_BI_WEB_EX_BL_4'),
       updated_by = 'admin'
 WHERE rfc_name = 'Z_BI_PRE_COST';


-- ============================================================
-- ▣ Section 4. [DIAG] 예약 데이터 진단
-- ------------------------------------------------------------
-- batch_schedule 자체에는 rfc_name / target_table 컬럼이 없으므로
-- "예약 데이터에 잘못된 rfc_function 이 저장되어 있을 수 있다" 는 우려는
-- 설계상 발생하지 않습니다.
--
-- 아래 쿼리로 실제 예약 데이터의 interface_id 만 검증하십시오:
--
--   SELECT id, interface_id, schedule_type, target_cmonth, exec_mode, is_active
--     FROM batch_schedule ORDER BY id DESC;
--
-- interface_id 가 NULL 이거나 batch_master 에 없는 값이면
-- 실행 시점에 INTERFACE_CONFIG_ERROR 로 자동 실패 처리됩니다 (server.mjs / PR #331).
-- ============================================================


-- ============================================================
-- ▣ Section 5. [DIAG] batch_jobs 이력 진단
-- ------------------------------------------------------------
-- batch_jobs 에는 실행 시 사용자가 선택한 interface_id 를 그대로 기록합니다.
-- 잘못된 legacy 이력을 강제로 재작성하지 말고, 이력관리 화면 및 아래 쿼리로 확인만 하십시오:
--
--   SELECT j.id, j.interface_id, j.rfc_function, j.status, j.created_at
--     FROM batch_jobs j
--    ORDER BY j.id DESC LIMIT 50;
--
-- (interface_id 컬럼이 없는 구버전 batch_jobs 이라면 PR #329 마이그레이션이 먼저 반영되어야 합니다.)
-- ============================================================


-- ============================================================
-- ▣ 검증 쿼리 (반영 후 실행 권장)
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
--
-- [5] 최종 매핑 요약 (기대: NLP_RFC_001, NLP_RFC_002 2행)
--     SELECT interface_id, rfc_name, IFTBL FROM batch_master
--      WHERE interface_id IN ('NLP_RFC_001','NLP_RFC_002')
--      ORDER BY interface_id;
-- ============================================================
