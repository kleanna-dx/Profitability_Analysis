-- ============================================================
-- module-profit: profit_batch_status 테이블 확장
-- SAP RFC 동기화 배치 정보를 더 상세하게 기록하기 위한 컬럼 추가
-- ============================================================

-- CALMONTH 컬럼 추가 (입력년월, YYYYMM)
ALTER TABLE profit_batch_status
    ADD COLUMN IF NOT EXISTS CALMONTH VARCHAR(6) NULL COMMENT '입력년월 (YYYYMM)' AFTER PERIOD_MONTH;

-- MODE 컬럼 추가 (실행 모드)
ALTER TABLE profit_batch_status
    ADD COLUMN IF NOT EXISTS MODE VARCHAR(20) NULL DEFAULT 'replace' COMMENT '실행모드: replace/append/dry-run' AFTER CALMONTH;

-- DELETED_ROWS 컬럼 추가 (삭제 행 수)
ALTER TABLE profit_batch_status
    ADD COLUMN IF NOT EXISTS DELETED_ROWS BIGINT NULL DEFAULT 0 COMMENT 'DELETE한 기존 행 수' AFTER ERROR_ROWS;

-- 인덱스 추가
ALTER TABLE profit_batch_status
    ADD INDEX IF NOT EXISTS IDX_BATCH_CALMONTH (CALMONTH);
