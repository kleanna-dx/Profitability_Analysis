-- =====================================================================
-- 27_alter_raw_bic_prefix.sql
-- DB 컬럼명을 SAP T_DATA 필드명과 동일하게 BIC_ 접두어 추가
-- SAP BW T_DATA에서 BIC_ZPROCESS, BIC_ZMACHINE 등으로 전달되므로
-- DB 컬럼도 동일하게 맞춰 매핑 없이 직접 적재 가능하도록 변경
-- =====================================================================

-- ─────────────────────────────────────────────────────
-- 1) rpsim_raw_material — BIC_ 접두어 추가 (27개 컬럼)
-- ─────────────────────────────────────────────────────

-- 인덱스 먼저 삭제 (컬럼명 변경 전)
ALTER TABLE rpsim_raw_material DROP INDEX IF EXISTS idx_rpsim_raw_mat_machine;

ALTER TABLE rpsim_raw_material
    CHANGE COLUMN ZPROCESS       BIC_ZPROCESS       VARCHAR(3)   DEFAULT NULL COMMENT '공정',
    CHANGE COLUMN ZPROCESS_NM    BIC_ZPROCESS_NM    VARCHAR(40)  DEFAULT NULL COMMENT '공정명',
    CHANGE COLUMN ZMACHINE       BIC_ZMACHINE       VARCHAR(4)   DEFAULT NULL COMMENT '생산호기',
    CHANGE COLUMN ZMACHINE_NM    BIC_ZMACHINE_NM    VARCHAR(40)  DEFAULT NULL COMMENT '생산호기명',
    CHANGE COLUMN ZUNIT          BIC_ZUNIT          VARCHAR(3)   DEFAULT NULL COMMENT '기준수량단위(KG/EA)',
    CHANGE COLUMN ZPRD_UNIT      BIC_ZPRD_UNIT      VARCHAR(3)   DEFAULT NULL COMMENT '단위(생산수량)',
    CHANGE COLUMN ZSCR_UNIT      BIC_ZSCR_UNIT      VARCHAR(3)   DEFAULT NULL COMMENT '단위(폐품수량)',
    CHANGE COLUMN ZJPCODE        BIC_ZJPCODE        VARCHAR(30)  DEFAULT NULL COMMENT '지종/제품구분',
    CHANGE COLUMN ZJPCODE_NM     BIC_ZJPCODE_NM     VARCHAR(40)  DEFAULT NULL COMMENT '지종/제품구분명',
    CHANGE COLUMN ZMATGROUP      BIC_ZMATGROUP      VARCHAR(9)   DEFAULT NULL COMMENT '자재그룹(대분류)',
    CHANGE COLUMN ZMATGROUP_NM   BIC_ZMATGROUP_NM   VARCHAR(40)  DEFAULT NULL COMMENT '자재그룹(대분류)명',
    CHANGE COLUMN ZPUNIT         BIC_ZPUNIT         DECIMAL(17,3) DEFAULT 0 COMMENT '계획 원단위(KG/Ton)',
    CHANGE COLUMN ZREQ_QTY       BIC_ZREQ_QTY       DECIMAL(17,3) DEFAULT 0 COMMENT '구성부품수량',
    CHANGE COLUMN ZBASEQTY       BIC_ZBASEQTY       DECIMAL(17,3) DEFAULT 0 COMMENT '기준수량',
    CHANGE COLUMN ZTUNIT         BIC_ZTUNIT         DECIMAL(17,3) DEFAULT 0 COMMENT '계획 원단위(폐품포함)',
    CHANGE COLUMN ZRDCD_M01      BIC_ZRDCD_M01      BIGINT       DEFAULT 0 COMMENT '계획 단가',
    CHANGE COLUMN ZPDTBQTY       BIC_ZPDTBQTY       DECIMAL(17,3) DEFAULT 0 COMMENT '계획 배부수량',
    CHANGE COLUMN ZTPQTY         BIC_ZTPQTY         DECIMAL(17,3) DEFAULT 0 COMMENT '총생산량',
    CHANGE COLUMN ZPRD_QTY       BIC_ZPRD_QTY       DECIMAL(17,3) DEFAULT 0 COMMENT '생산수량',
    CHANGE COLUMN ZSCR_QTY       BIC_ZSCR_QTY       DECIMAL(17,3) DEFAULT 0 COMMENT '폐품수량',
    CHANGE COLUMN ZLUNIT         BIC_ZLUNIT         DECIMAL(17,3) DEFAULT 0 COMMENT '실제 원단위(KG/Ton)',
    CHANGE COLUMN ZDTB_QTY       BIC_ZDTB_QTY       DECIMAL(17,3) DEFAULT 0 COMMENT '실제 배부수량',
    CHANGE COLUMN ZTPRICE        BIC_ZTPRICE        BIGINT       DEFAULT 0 COMMENT '실제단가',
    CHANGE COLUMN ZTRAWMATR      BIC_ZTRAWMATR      BIGINT       DEFAULT 0 COMMENT '실제 재료비',
    CHANGE COLUMN ZZLBKUM60      BIC_ZZLBKUM60      DECIMAL(17,3) DEFAULT 0 COMMENT '출고수량',
    CHANGE COLUMN ZRAMT_060      BIC_ZRAMT_060      BIGINT       DEFAULT 0 COMMENT '출고금액',
    CHANGE COLUMN ZTUSEDIF       BIC_ZTUSEDIF       BIGINT       DEFAULT 0 COMMENT '계획대비 사용량 차이',
    CHANGE COLUMN ZTPRIDIF       BIC_ZTPRIDIF       BIGINT       DEFAULT 0 COMMENT '계획대비 단가 차이';

-- 인덱스 재생성
CREATE INDEX idx_rpsim_raw_mat_machine ON rpsim_raw_material (BIC_ZMACHINE);

-- ─────────────────────────────────────────────────────
-- 2) rpsim_raw_inventory — BIC_ 접두어 추가 (10개 컬럼)
-- ─────────────────────────────────────────────────────

ALTER TABLE rpsim_raw_inventory
    CHANGE COLUMN ZMATGROUP      BIC_ZMATGROUP      VARCHAR(9)   DEFAULT NULL COMMENT '자재그룹(대분류)',
    CHANGE COLUMN ZMATGROUP_NM   BIC_ZMATGROUP_NM   VARCHAR(40)  DEFAULT NULL COMMENT '자재그룹(대분류)명',
    CHANGE COLUMN ZLBKUM         BIC_ZLBKUM         DECIMAL(17,3) DEFAULT 0 COMMENT '기초-수량',
    CHANGE COLUMN ZRNETPR        BIC_ZRNETPR        BIGINT       DEFAULT 0 COMMENT '기초-실제단가',
    CHANGE COLUMN ZLBKUM020      BIC_ZLBKUM020      DECIMAL(17,3) DEFAULT 0 COMMENT '입고-수량',
    CHANGE COLUMN ZRNETPR20      BIC_ZRNETPR20      BIGINT       DEFAULT 0 COMMENT '입고-표준단가',
    CHANGE COLUMN ZLBKUM60       BIC_ZLBKUM60       DECIMAL(17,3) DEFAULT 0 COMMENT '출고-수량',
    CHANGE COLUMN ZRNETPR60      BIC_ZRNETPR60      BIGINT       DEFAULT 0 COMMENT '출고-실제단가',
    CHANGE COLUMN ZLBKUM101      BIC_ZLBKUM101      DECIMAL(17,3) DEFAULT 0 COMMENT '기말-수량',
    CHANGE COLUMN ZRNETP110      BIC_ZRNETP110      BIGINT       DEFAULT 0 COMMENT '기말-실제단가';
