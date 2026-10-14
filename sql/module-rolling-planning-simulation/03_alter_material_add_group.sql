-- ============================================================
-- rpsim_material 테이블에 SAP BW 자재그룹 컬럼 추가
-- 실행 대상: 이미 01_schema.sql로 테이블이 생성된 운영/개발 DB
-- 날짜: 2026-10-14
-- ============================================================

-- 자재 그룹 코드 (SAP BW ZOHPP100/101 컬럼21: 자재 그룹)
ALTER TABLE rpsim_material
    ADD COLUMN IF NOT EXISTS MATERIAL_GROUP VARCHAR(20) NULL COMMENT '자재 그룹 코드' AFTER UNIT_OF_MEASURE;

-- 자재 그룹명 (SAP BW 컬럼22: 자재 그룹명)
ALTER TABLE rpsim_material
    ADD COLUMN IF NOT EXISTS MATERIAL_GROUP_NAME VARCHAR(200) NULL COMMENT '자재 그룹명' AFTER MATERIAL_GROUP;

-- 자재그룹 대분류 코드 (SAP BW 컬럼25: 자재그룹(대분류))
ALTER TABLE rpsim_material
    ADD COLUMN IF NOT EXISTS MATERIAL_GROUP_LARGE VARCHAR(20) NULL COMMENT '자재그룹 대분류 코드' AFTER MATERIAL_GROUP_NAME;

-- 자재그룹 대분류명 (SAP BW 컬럼26: 자재그룹(대분류)명)
ALTER TABLE rpsim_material
    ADD COLUMN IF NOT EXISTS MATERIAL_GROUP_LARGE_NAME VARCHAR(200) NULL COMMENT '자재그룹 대분류명' AFTER MATERIAL_GROUP_LARGE;
