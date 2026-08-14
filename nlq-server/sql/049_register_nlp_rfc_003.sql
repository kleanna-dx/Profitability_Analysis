-- ============================================================
-- [2026-08-14] 신규 인터페이스 NLP_RFC_003 등록 (재작성)
--             (제조원가 RFC 2 / Z_BI_WEB_EX_BL_5 / sys_aimd_cot043)
-- ------------------------------------------------------------
-- ▶ 배경 (이 파일이 049 로 재작성된 이유):
--   기존 048_register_nlp_rfc_003.sql 은 batch_master 컬럼 목록에
--   'allowed_modes' / 'exec_command' 를 포함하는 오래된 시드 형식으로
--   작성되었으나, 두 컬럼은 PR #92-② (031_drop_allowed_modes_exec_command.sql
--   / deploy_pr85_to_pr92.sql) 에서 이미 DROP 되어 현재 스키마에 없음.
--   → 048 실행 시 "Unknown column 'allowed_modes' in 'INSERT INTO'" 오류로 실패.
--   본 049 파일은 실제 운영 스키마(SHOW COLUMNS FROM batch_master 확인 결과)
--   에 맞춰 15개 컬럼만 사용하도록 재작성됨.
--   048 파일은 삭제됨.
--
-- ▶ 반영 대상 테이블:
--   batch_master 1건 (신규 INSERT / 기존 있으면 UPDATE)
--   ※ 다른 테이블은 자동 채워지므로 별도 시드 불필요:
--     - batch_jobs      : 실행 시점에 사용자가 선택한 interface_id 로 자동 기록
--     - batch_schedule  : 스케줄 등록 화면에서 사용자가 별도 등록
--     - sys_aimd_cot043 : 047_create_sys_aimd_cot043.sql 로 이미 생성 완료
--
-- ▶ 실제 batch_master 스키마 (2026-08-14 운영 SHOW COLUMNS 결과):
--   interface_id     varchar(50)  NOT NULL  PRIMARY KEY
--   interface_name   varchar(200) NOT NULL
--   sender           varchar(50)  NOT NULL  DEFAULT 'SAP'
--   receiver         varchar(50)  NOT NULL  DEFAULT 'analytics'
--   rfc_name         varchar(100) NULL      (KEY)
--   rfc_func_or_url  varchar(500) NULL
--   rfc_param        text         NULL
--   IFTBL            varchar(100) NULL
--   default_mode     varchar(20)  NOT NULL  DEFAULT 'replace'
--   remark           text         NULL
--   is_active        tinyint(1)   NOT NULL  DEFAULT 1  (KEY)
--   created_by       varchar(50)  NULL
--   updated_by       varchar(50)  NULL
--   created_at       datetime     NULL      DEFAULT CURRENT_TIMESTAMP
--   updated_at       datetime     NULL      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
--   ※ allowed_modes / exec_command 컬럼은 존재하지 않음 (PR #92-② 에서 DROP 됨).
--
-- ▶ 등록되는 값 (사용자 지정):
--   interface_id    : 'NLP_RFC_003'
--   interface_name  : '제조원가 RFC 2'
--   sender          : 'SAP'
--   receiver        : 'analytics'
--   rfc_name        : 'Z_BI_WEB_EX_BL_5'
--   rfc_func_or_url : 'POST /profit-api/sap-rfc/execute'
--   rfc_param       : '{"function":"Z_BI_WEB_EX_BL_5","params":{"I_CMONTH":"{CMONTH}"}}'
--   IFTBL           : 'sys_aimd_cot043'
--   default_mode    : 'replace'
--   remark          : '제조원가 RFC 2 (Z_BI_WEB_EX_BL_5) — sys_aimd_cot043 적재'
--   is_active       : 1
--   created_by      : 'admin'
--
-- ▶ 멱등성:
--   INSERT ... WHERE NOT EXISTS 로 이미 있으면 INSERT 스킵.
--   후속 UPDATE 로 값 정합성 재확인.
--   기존 인터페이스(NLP_RFC_001 / NLP_RFC_002) 는 WHERE 절 명시로 절대 건드리지 않음.
-- ============================================================

-- (1) NLP_RFC_003 신규 INSERT (없을 때만)
INSERT INTO batch_master
  (interface_id,   interface_name,     sender, receiver,     rfc_name,             rfc_func_or_url,                     rfc_param,                                                              IFTBL,               default_mode, remark,                                                        is_active, created_by)
SELECT
  'NLP_RFC_003',   '제조원가 RFC 2',   'SAP',  'analytics', 'Z_BI_WEB_EX_BL_5',   'POST /profit-api/sap-rfc/execute',  '{"function":"Z_BI_WEB_EX_BL_5","params":{"I_CMONTH":"{CMONTH}"}}',      'sys_aimd_cot043',   'replace',    '제조원가 RFC 2 (Z_BI_WEB_EX_BL_5) — sys_aimd_cot043 적재',    1,         'admin'
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
       remark          = '제조원가 RFC 2 (Z_BI_WEB_EX_BL_5) — sys_aimd_cot043 적재',
       is_active       = 1,
       updated_by      = 'admin'
 WHERE interface_id = 'NLP_RFC_003';


-- ============================================================
-- 검증 쿼리 (운영 반영 후 실행하여 결과 확인)
-- ------------------------------------------------------------
-- 1) NLP_RFC_003 등록 확인 (기대: 1행)
--    SELECT interface_id, interface_name, sender, receiver, rfc_name,
--           rfc_func_or_url, rfc_param, IFTBL, default_mode, remark, is_active
--      FROM batch_master
--     WHERE interface_id = 'NLP_RFC_003' \G
--
-- 2) 3개 인터페이스 상태 비교
--    SELECT interface_id, interface_name, rfc_name, IFTBL, is_active
--      FROM batch_master
--     WHERE interface_id IN ('NLP_RFC_001', 'NLP_RFC_002', 'NLP_RFC_003')
--     ORDER BY interface_id;
--    -- 기대:
--    --   NLP_RFC_001 | 수익성데이터        | Z_BI_WEB_EX_BL    | bw_profitability_data | 1
--    --   NLP_RFC_002 | 제조원가 RFC        | Z_BI_WEB_EX_BL_4  | sys_aimd_cot015       | 1
--    --   NLP_RFC_003 | 제조원가 RFC 2      | Z_BI_WEB_EX_BL_5  | sys_aimd_cot043       | 1
--
-- 3) sys_aimd_cot043 테이블 존재 확인 (선행 마이그레이션 047)
--    SHOW TABLES LIKE 'sys_aimd_cot043';
--    -- 기대: sys_aimd_cot043 1행 반환
-- ============================================================
