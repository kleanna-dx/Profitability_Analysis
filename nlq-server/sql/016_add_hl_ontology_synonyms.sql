-- ============================================================
-- 016: HL 도메인 Ontology 동의어 등록
-- - CAM → CO_AREA_NM (관리회계 영역명)
-- - 관리영역/관리회계영역 → CO_AREA (관리회계 영역)
-- - 관리영역명/관리회계영역명/CAM명 → CO_AREA_NM (관리회계 영역명)
-- ============================================================

-- CO_AREA_NM (관리회계 영역명) — column_id는 HL 도메인의 CO_AREA_NM
-- 주의: column_id는 ontology_column 테이블에서 domain_code='HL' AND column_name='CO_AREA_NM'인 id
INSERT INTO ontology_synonym (column_id, synonym_text)
SELECT oc.id, 'CAM'
FROM ontology_column oc
WHERE oc.domain_code = 'HL' AND oc.column_name = 'CO_AREA_NM'
  AND NOT EXISTS (
    SELECT 1 FROM ontology_synonym os WHERE os.column_id = oc.id AND os.synonym_text = 'CAM'
  );

INSERT INTO ontology_synonym (column_id, synonym_text)
SELECT oc.id, 'CAM명'
FROM ontology_column oc
WHERE oc.domain_code = 'HL' AND oc.column_name = 'CO_AREA_NM'
  AND NOT EXISTS (
    SELECT 1 FROM ontology_synonym os WHERE os.column_id = oc.id AND os.synonym_text = 'CAM명'
  );

INSERT INTO ontology_synonym (column_id, synonym_text)
SELECT oc.id, '관리영역명'
FROM ontology_column oc
WHERE oc.domain_code = 'HL' AND oc.column_name = 'CO_AREA_NM'
  AND NOT EXISTS (
    SELECT 1 FROM ontology_synonym os WHERE os.column_id = oc.id AND os.synonym_text = '관리영역명'
  );

INSERT INTO ontology_synonym (column_id, synonym_text)
SELECT oc.id, '관리회계영역명'
FROM ontology_column oc
WHERE oc.domain_code = 'HL' AND oc.column_name = 'CO_AREA_NM'
  AND NOT EXISTS (
    SELECT 1 FROM ontology_synonym os WHERE os.column_id = oc.id AND os.synonym_text = '관리회계영역명'
  );

-- CO_AREA (관리회계 영역)
INSERT INTO ontology_synonym (column_id, synonym_text)
SELECT oc.id, '관리영역'
FROM ontology_column oc
WHERE oc.domain_code = 'HL' AND oc.column_name = 'CO_AREA'
  AND NOT EXISTS (
    SELECT 1 FROM ontology_synonym os WHERE os.column_id = oc.id AND os.synonym_text = '관리영역'
  );

INSERT INTO ontology_synonym (column_id, synonym_text)
SELECT oc.id, '관리회계영역'
FROM ontology_column oc
WHERE oc.domain_code = 'HL' AND oc.column_name = 'CO_AREA'
  AND NOT EXISTS (
    SELECT 1 FROM ontology_synonym os WHERE os.column_id = oc.id AND os.synonym_text = '관리회계영역'
  );
