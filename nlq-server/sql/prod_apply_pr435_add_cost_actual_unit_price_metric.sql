-- ============================================================
-- [2026-09-10] PR #435 프로덕션 배포용 스크립트
-- ------------------------------------------------------------
-- 이 파일은 054_seed_cost_actual_unit_price_metric.sql 의 프로덕션
-- 배포용 미러입니다. DBeaver 등에서 직접 실행할 때 편의를 위해
-- 별도 파일로 제공.
--
-- 실행 순서:
--   1) 아래 두 INSERT 실행
--   2) POST /api/rag/build 로 RAG 인덱스 재빌드 (관리자 세션 필요)
--   3) 서버 재기동 or 학습관리 화면에서 [RAG 인덱스 재빌드] 클릭
--
-- 멱등성: INSERT IGNORE 로 중복 실행 안전
-- ============================================================

-- 1) Metric 등록 (3개 도메인)
INSERT IGNORE INTO metric (domain_code, metric_code, aggregation, formula, table_name, description) VALUES
('PS',   'COST_ACTUAL_UNIT_PRICE', 'CALC',
 'SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)',
 'sys_aimd_cot015',
 '실제원가 단가 (원/단위) - 실제원가 총액을 생산수량으로 나눈 단위당 원가'),
('HL',   'COST_ACTUAL_UNIT_PRICE', 'CALC',
 'SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)',
 'sys_aimd_cot015',
 '실제원가 단가 (원/단위) - 실제원가 총액을 생산수량으로 나눈 단위당 원가'),
('MGMT', 'COST_ACTUAL_UNIT_PRICE', 'CALC',
 'SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)',
 'sys_aimd_cot015',
 '실제원가 단가 (원/단위) - 실제원가 총액을 생산수량으로 나눈 단위당 원가');

-- 2) Metric 동의어 등록
INSERT IGNORE INTO metric_synonym (metric_id, synonym_text)
SELECT id, s FROM metric
CROSS JOIN (
  SELECT '실제원가 단가' AS s UNION ALL
  SELECT '실제원가단가'         UNION ALL
  SELECT '단위당 실제원가'      UNION ALL
  SELECT '단위 실제원가'        UNION ALL
  SELECT '실제원가 단위원가'    UNION ALL
  SELECT '실제원가 KG단가'      UNION ALL
  SELECT '실제원가 EA단가'      UNION ALL
  SELECT '단위원가'             UNION ALL
  SELECT '제품 단가'
) syns
WHERE metric_code = 'COST_ACTUAL_UNIT_PRICE'
  AND table_name = 'sys_aimd_cot015';

-- 3) 확인
SELECT domain_code, metric_code, aggregation, formula, table_name, description
  FROM metric WHERE metric_code = 'COST_ACTUAL_UNIT_PRICE'
  ORDER BY domain_code;

SELECT m.domain_code, s.synonym_text
  FROM metric_synonym s JOIN metric m ON s.metric_id = m.id
 WHERE m.metric_code = 'COST_ACTUAL_UNIT_PRICE'
 ORDER BY m.domain_code, s.synonym_text;
