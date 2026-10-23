-- =====================================================================
-- 25_alter_itf_history_log_text.sql
-- 인터페이스 이력에 상세 로그 + RFC 실행 정보 추가
-- 수익성분석 batch_jobs 구조와 동일하게 맞춤
-- =====================================================================

-- 1) 상세 실행 로그 (단계별 진행 상황)
ALTER TABLE rpsim_itf_history
    ADD COLUMN LOG_TEXT LONGTEXT DEFAULT NULL COMMENT '상세 실행 로그' AFTER ERROR_MESSAGE;

-- 2) RFC 실행 정보 (이력에서 어떤 RFC를 어떤 파라미터로 호출했는지 기록)
ALTER TABLE rpsim_itf_history
    ADD COLUMN RFC_NAME VARCHAR(100) DEFAULT NULL COMMENT 'RFC 함수명' AFTER JOB_TYPE,
    ADD COLUMN TARGET_TABLE VARCHAR(100) DEFAULT NULL COMMENT '적재 대상 테이블' AFTER RFC_NAME,
    ADD COLUMN CMONTH VARCHAR(6) DEFAULT NULL COMMENT '입력년월 YYYYMM' AFTER TARGET_TABLE;

-- 3) 삭제 행수 + INSERT 행수 분리
ALTER TABLE rpsim_itf_history
    ADD COLUMN INSERTED_ROWS INT DEFAULT 0 COMMENT 'INSERT 행수' AFTER PROCESS_COUNT,
    ADD COLUMN DELETED_ROWS INT DEFAULT 0 COMMENT 'DELETE 행수' AFTER INSERTED_ROWS;
