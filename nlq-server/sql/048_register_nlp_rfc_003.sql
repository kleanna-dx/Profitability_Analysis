-- ============================================================
-- [2026-08-13] 신규 인터페이스 NLP_RFC_003 등록
--             (제조원가 RFC 2 / Z_BI_WEB_EX_BL_5 / sys_aimd_cot043)
-- ------------------------------------------------------------
-- 목적:
--   SAP RFC 를 통해 원가요소별 금액 데이터를 수신하고 신규 테이블
--   sys_aimd_cot043 에 적재하기 위한 인터페이스 마스터(batch_master)
--   시드를 추가한다.
--
-- 반영 대상 테이블:
--   batch_master 1건 (신규 INSERT)
--   ※ 다른 테이블은 자동으로 채워지므로 별도 시드 불필요:
--     - batch_jobs      : 실행 시점에 사용자가 선택한 interface_id 로 자동 기록
--     - batch_schedule  : 스케줄 등록 화면에서 사용자가 별도 등록
--     - sys_aimd_cot043 : 047_create_sys_aimd_cot043.sql 로 이미 생성 완료
--
-- 컬럼 값 산정 근거 (기존 NLP_RFC_002 시드 참조):
--   interface_id    : 'NLP_RFC_003'
--   interface_name  : '제조원가 RFC 2'                ← 사용자 지정
--   sender          : 'SAP'
--   receiver        : 'analytics'
--   rfc_name        : 'Z_BI_WEB_EX_BL_5'              ← 사용자 지정 신규 RFC 함수명
--   rfc_func_or_url : 'POST /profit-api/sap-rfc/execute' (기존 인터페이스 공통)
--   rfc_param       : '{"function":"Z_BI_WEB_EX_BL_5","params":{"I_CMONTH":"{CMONTH}"}}'
--   IFTBL           : 'sys_aimd_cot043'               ← 신규 적재 테이블
--   default_mode    : 'replace'
--   allowed_modes   : 'replace,append,dry-run'
--   exec_command    : 'SAP_RFC_SYNC'
--   remark          : '제조원가 RFC 2 (Z_BI_WEB_EX_BL_5) — sys_aimd_cot043 적재'
--   is_active       : 1
--   created_by      : 'admin'
--
-- 멱등성:
--   INSERT ... WHERE NOT EXISTS 로 이미 있으면 INSERT 스킵.
--   기존 인터페이스(NLP_RFC_001 / NLP_RFC_002) 는 WHERE 절 명시로 절대 건드리지 않음.
--
-- 함께 반영되는 코드 수정 (본 PR 에 포함):
--   nlq-server/server.mjs L14962~14965 EXPECTED_INTERFACE_MAPPING 에 NLP_RFC_003 추가
--     'NLP_RFC_003': { rfc_name: 'Z_BI_WEB_EX_BL_5', target_table: 'sys_aimd_cot043' }
--
-- 후속 작업 (본 PR 범위 밖 — 별도 저장소):
--   Spring Boot SapRfcSyncService 에 sys_aimd_cot043 DB 컬럼 매핑 추가
--     (CURR → BIGINT 변환 방식 포함)
-- ============================================================

-- (1) NLP_RFC_003 신규 INSERT (없을 때만)
INSERT INTO batch_master
  (interface_id,   interface_name,     sender, receiver,     rfc_name,             rfc_func_or_url,                     rfc_param,                                                              IFTBL,               default_mode, allowed_modes,               exec_command,    remark,                                                                is_active, created_by)
SELECT
  'NLP_RFC_003',   '제조원가 RFC 2',   'SAP',  'analytics', 'Z_BI_WEB_EX_BL_5',   'POST /profit-api/sap-rfc/execute',  '{"function":"Z_BI_WEB_EX_BL_5","params":{"I_CMONTH":"{CMONTH}"}}',      'sys_aimd_cot043',   'replace',    'replace,append,dry-run',   'SAP_RFC_SYNC',  '제조원가 RFC 2 (Z_BI_WEB_EX_BL_5) — sys_aimd_cot043 적재',            1,         'admin'
 WHERE NOT EXISTS (SELECT 1 FROM batch_master WHERE interface_id = 'NLP_RFC_003');

-- (2) 이미 존재하는 경우 대비 — 값 정합성 재확인 (멱등성 강화)
--     운영자가 임시로 다른 값을 넣어둔 상태면 사용자 스펙대로 정렬해줌.
--     NLP_RFC_001 / NLP_RFC_002 는 WHERE 절 명시로 절대 영향 없음.
UPDATE batch_master
   SET interface_name  = '제조원가 RFC 2',
       sender          = 'SAP',
       receiver        = 'analytics',
       rfc_name        = 'Z_BI_WEB_EX_BL_5',
       rfc_func_or_url = 'POST /profit-api/sap-rfc/execute',
       rfc_param       = '{"function":"Z_BI_WEB_EX_BL_5","params":{"I_CMONTH":"{CMONTH}"}}',
       IFTBL           = 'sys_aimd_cot043',
       default_mode    = 'replace',
       allowed_modes   = 'replace,append,dry-run',
       exec_command    = 'SAP_RFC_SYNC',
       remark          = '제조원가 RFC 2 (Z_BI_WEB_EX_BL_5) — sys_aimd_cot043 적재',
       is_active       = 1,
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_003';


-- ============================================================
-- 검증 쿼리 (운영 반영 후 실행하여 결과 확인)
-- ------------------------------------------------------------
-- 1) NLP_RFC_003 등록 확인 (기대: 1행)
--    SELECT interface_id, interface_name, sender, receiver, rfc_name,
--           rfc_func_or_url, rfc_param, IFTBL, default_mode,
--           allowed_modes, exec_command, is_active
--      FROM batch_master
--     WHERE interface_id = 'NLP_RFC_003' \G
--
-- 2) 기대 매핑 검증
--    - rfc_name = 'Z_BI_WEB_EX_BL_5'
--    - IFTBL    = 'sys_aimd_cot043'
--    - is_active = 1
--
-- 3) 기존 인터페이스 영향 없음 확인
--    SELECT interface_id, interface_name, rfc_name, IFTBL, is_active
--      FROM batch_master
--     WHERE interface_id IN ('NLP_RFC_001', 'NLP_RFC_002', 'NLP_RFC_003')
--     ORDER BY interface_id;
--    -- 기대:
--    --   NLP_RFC_001 | 수익성데이터            | Z_BI_WEB_EX_BL    | bw_profitability_data | 1
--    --   NLP_RFC_002 | 제조원가 RFC            | Z_BI_WEB_EX_BL_4  | sys_aimd_cot015       | 1
--    --   NLP_RFC_003 | 제조원가 RFC 2          | Z_BI_WEB_EX_BL_5  | sys_aimd_cot043       | 1
--
-- 4) sys_aimd_cot043 테이블 존재 확인 (선행 마이그레이션 047)
--    SHOW TABLES LIKE 'sys_aimd_cot043';
--    -- 기대: sys_aimd_cot043 1행 반환
-- ============================================================
