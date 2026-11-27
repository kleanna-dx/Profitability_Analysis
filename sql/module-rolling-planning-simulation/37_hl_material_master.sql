-- =====================================================================
-- 37_hl_material_master.sql
-- HL 자재 마스터 (기준정보 › HL 자재 마스터) — SAP 자재 마스터 양식 그대로 (엑셀 업로드 → 향후 RFC)
-- 단위 체계 EA > BAG > BOX > PAL · 환산 한 칸 = 환산수량 환산단위 = 기본수량 기본단위 (예: 30 EA = 1 BAG)
-- 1EA 중량(kg) = 순중량 × 중량단위 환산 ÷ (기본단위 1개에 든 EA 수) — 화면·계산에서 자동 계산 (DB 컬럼 아님)
-- 이전 rpsim_hl_material_conv (자재코드별 1EA 중량 한 칸) 는 이 테이블로 대체 → 삭제
-- 날짜: 2026-11-27
-- 여러 번 실행해도 안전 (IF NOT EXISTS) — 이미 만든 테이블·컬럼은 건너뜀
-- =====================================================================

USE integration;

-- 이전 테이블 삭제 (더 이상 사용하지 않음)
DROP TABLE IF EXISTS rpsim_hl_material_conv;

CREATE TABLE IF NOT EXISTS rpsim_hl_material_master (
    MAT_ID                 BIGINT NOT NULL AUTO_INCREMENT COMMENT 'PK',
    DIVISION               VARCHAR(20) NOT NULL COMMENT '사업부 (HL)',
    BRAND                  VARCHAR(100) NULL COMMENT '브랜드',
    MATERIAL_CODE          VARCHAR(50) NOT NULL COMMENT '자재코드',
    MATERIAL_NAME          VARCHAR(300) NULL COMMENT '자재명',
    CONV_QTY1              DECIMAL(16,4) NULL COMMENT '환산수량1',
    CONV_UNIT1             VARCHAR(10) NULL COMMENT '환산단위1',
    BASE_QTY1              DECIMAL(16,4) NULL COMMENT '기본수량1',
    BASE_UNIT1             VARCHAR(10) NULL COMMENT '기본단위1',
    CONV_QTY2              DECIMAL(16,4) NULL COMMENT '환산수량2',
    CONV_UNIT2             VARCHAR(10) NULL COMMENT '환산단위2',
    BASE_QTY2              DECIMAL(16,4) NULL COMMENT '기본수량2',
    BASE_UNIT2             VARCHAR(10) NULL COMMENT '기본단위2',
    CONV_QTY5              DECIMAL(16,4) NULL COMMENT '환산수량5',
    CONV_UNIT5             VARCHAR(10) NULL COMMENT '환산단위5',
    BASE_QTY5              DECIMAL(16,4) NULL COMMENT '기본수량5',
    BASE_UNIT5             VARCHAR(10) NULL COMMENT '기본단위5',
    NET_WEIGHT             DECIMAL(16,6) NULL COMMENT '순중량 (기본단위 1개당, 예: BAG)',
    WEIGHT_UNIT            VARCHAR(10) NULL COMMENT '중량단위 (KG/G/TON)',
    BASE_MACHINE           VARCHAR(100) NULL COMMENT '기본 생산 호기',
    HIER1_CODE             VARCHAR(50) NULL COMMENT '계층구조1 코드',
    HIER1_NAME             VARCHAR(200) NULL COMMENT '계층구조1 명',
    HIER3_CODE             VARCHAR(50) NULL COMMENT '계층구조3 코드',
    HIER3_NAME             VARCHAR(200) NULL COMMENT '계층구조3 명',
    HIER_CODE              VARCHAR(50) NULL COMMENT '제품계층구조 코드',
    HIER_NAME              VARCHAR(200) NULL COMMENT '제품계층구조 명',
    CREATED_BY             VARCHAR(50) NULL COMMENT '등록자 userId',
    CREATED_AT             DATETIME NULL DEFAULT CURRENT_TIMESTAMP COMMENT '등록일시',
    UPDATED_BY             VARCHAR(50) NULL COMMENT '수정자 userId',
    UPDATED_AT             DATETIME NULL COMMENT '수정일시',
    DELETED_YN             CHAR(1) NOT NULL DEFAULT 'N' COMMENT '삭제 여부 (Y/N, 소프트 삭제)',
    DELETED_BY             VARCHAR(50) NULL COMMENT '삭제자 userId',
    DELETED_AT             DATETIME NULL COMMENT '삭제일시',
    PRIMARY KEY (MAT_ID),
    UNIQUE KEY UK_HL_MATERIAL_MASTER (DIVISION, MATERIAL_CODE),
    INDEX IDX_HL_MATERIAL_MASTER_DEL (DELETED_YN)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
  COMMENT='경영시뮬레이션 – HL 자재 마스터 (SAP 양식)';
