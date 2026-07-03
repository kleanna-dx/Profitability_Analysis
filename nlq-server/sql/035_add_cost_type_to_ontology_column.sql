-- ============================================================
-- Migration: 035_add_cost_type_to_ontology_column.sql
-- Purpose: ontology_column 테이블에 원가/비용 구분 메타데이터 컬럼 추가
--
-- Background:
--   사용자가 자연어질의에서 "원가항목", "비용항목" 같은 묶음 단위로 질문했을 때
--   시스템이 어떤 ZAMT 컬럼들을 비교해야 하는지 알 수 있게 하기 위한 메타데이터.
--
-- Values:
--   NULL  → 구분값 없음 (기본, 원가/비용 관련 없음)
--   '원가' → 원가 항목 (예: ZAMT006, ZAMT007, ZAMT008, ...)
--   '비용' → 비용 항목 (예: ZAMT048, ZAMT049, ZAMT051, ...)
--
-- Usage:
--   자연어질의에서 "원가항목", "비용항목" 키워드가 감지되면 GPT 프롬프트에
--   해당 그룹의 컬럼 목록이 [원가 항목 그룹]/[비용 항목 그룹] 섹션으로 노출됨.
--   GPT는 이 목록을 UNION ALL 로 각 컬럼을 SUM 하여 비교하는 SQL 생성.
-- ============================================================

ALTER TABLE ontology_column
ADD COLUMN cost_type VARCHAR(10) DEFAULT NULL
COMMENT '원가/비용 구분 (원가|비용|NULL). 자연어질의 "원가항목/비용항목" 매칭용 메타데이터'
AFTER is_active;

CREATE INDEX idx_ontology_cost_type ON ontology_column(cost_type);
