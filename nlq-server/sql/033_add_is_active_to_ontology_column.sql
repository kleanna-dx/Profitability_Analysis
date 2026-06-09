-- =====================================================================
-- 033_add_is_active_to_ontology_column.sql
-- ---------------------------------------------------------------------
-- 목적: ontology_column 테이블에 활성/비활성 플래그(is_active) 추가.
--       기본값 1(활성)로, 기존 행은 모두 자동 활성 처리됨.
--       비활성(0) 처리된 컬럼은:
--         - [자연어질의(NLQ)] BASE_SYSTEM_PROMPT 동적 화이트리스트 / RAG 컨텍스트 / 동의어 매칭에서 제외
--         - [비주얼 쿼리빌더] /api/builder/columns 응답에서 제외
--
-- 정책: MariaDB 네이티브 IF [NOT] EXISTS 만 사용 (SET @var / PREPARE / EXECUTE 금지)
--       멱등성 보장: 재실행해도 오류 없이 통과
-- 작성일: 2026-06-09
-- =====================================================================

-- 1) is_active 컬럼 추가 (멱등)
ALTER TABLE ontology_column
  ADD COLUMN IF NOT EXISTS is_active TINYINT(1) NOT NULL DEFAULT 1
  COMMENT '활성 여부 (1=활성/NLQ·빌더 노출, 0=비활성/노출 제외)';

-- 2) (안전장치) 혹시 NULL 이 들어가 있을 경우 기본 활성으로 보정
UPDATE ontology_column
  SET is_active = 1
  WHERE is_active IS NULL;

-- 3) 조회 성능을 위한 인덱스(멱등)
ALTER TABLE ontology_column
  ADD INDEX IF NOT EXISTS idx_ontology_column_active (domain_code, is_active);

-- 4) 검증용 SELECT
SELECT
  COUNT(*)                                   AS total_rows,
  SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_rows,
  SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_rows
FROM ontology_column;
