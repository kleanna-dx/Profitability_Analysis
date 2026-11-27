-- =====================================================================
-- 34_material_forecast.sql
-- 원부재료비 차월 예상 — 수기입력 저장값 (UK: 예상월+사업부+호기+행구분+항목코드)
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

CREATE TABLE IF NOT EXISTS rpsim_material_forecast (
    FORECAST_ID            BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    YM                     VARCHAR(6) NOT NULL COMMENT '예상 년월 (YYYYMM)',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부',
    MACHINE_CODE           VARCHAR(20) NOT NULL COMMENT '호기 코드',
    ROW_TYPE               VARCHAR(10) NOT NULL COMMENT '행 구분 (PROD=지종 생산량 / MAT=자재)',
    ITEM_CODE              VARCHAR(50) NOT NULL COMMENT '지종 또는 자재코드',
    ITEM_NAME              VARCHAR(200) NULL COMMENT '지종명/자재명',
    PROD_TON               DECIMAL(18,3) NULL COMMENT '차월 생산량 (톤)',
    USAGE_QTY              DECIMAL(20,3) NULL COMMENT '차월 사용량',
    UNIT_RATE              DECIMAL(18,4) NULL COMMENT '원단위',
    RECEIPT_PRICE          DECIMAL(18,4) NULL COMMENT '입고단가',
    OPENING_PRICE          DECIMAL(18,4) NULL COMMENT '기초단가',
    USE_PRICE              DECIMAL(18,4) NULL COMMENT '사용단가',
    ISSUE_NOTE             VARCHAR(1000) NULL COMMENT '이슈 메모',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (FORECAST_ID),
    UNIQUE KEY UK_MAT_FORECAST (YM, DIVISION, MACHINE_CODE, ROW_TYPE, ITEM_CODE),
    INDEX IDX_MATERIAL_FORECAST_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – 원부재료비 차월 예상';
