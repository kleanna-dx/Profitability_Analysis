-- ============================================================
-- 기준정보 업로드 로그 테이블
-- 엑셀 업로드 시 건별 성공/실패 + 실패사유 기록
-- 날짜: 2026-10-19
-- ============================================================

CREATE TABLE IF NOT EXISTS rpsim_upload_log (
    LOG_ID          BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'PK',
    UPLOAD_BATCH_ID VARCHAR(50)  NOT NULL                COMMENT '업로드 배치 ID (같은 엑셀 파일 업로드 건)',
    REF_TYPE        VARCHAR(50)  NOT NULL                COMMENT '기준정보 유형 (machine-speeds, waste-rates 등)',
    ROW_INDEX       INT          NOT NULL DEFAULT 0      COMMENT '엑셀 행 번호',
    ROW_DATA        TEXT         NULL                    COMMENT '업로드 시도한 데이터 (JSON)',
    STATUS          VARCHAR(10)  NOT NULL DEFAULT 'FAIL' COMMENT '결과 (SUCCESS/FAIL)',
    ERROR_MESSAGE   VARCHAR(500) NULL                    COMMENT '실패 사유',
    UPLOADED_BY     VARCHAR(50)  NULL                    COMMENT '업로드 사용자',
    DIVISION        VARCHAR(20)  NOT NULL DEFAULT 'PS'   COMMENT '사업부',
    CREATED_AT      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (LOG_ID),
    INDEX IDX_UPLOAD_BATCH (UPLOAD_BATCH_ID),
    INDEX IDX_UPLOAD_REF (REF_TYPE, CREATED_AT)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 기준정보 업로드 로그 (건별 성공/실패 + 사유)';
