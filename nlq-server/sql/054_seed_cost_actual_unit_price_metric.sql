-- ============================================================
-- [2026-09-10] 제조원가 "실제원가 단가" Metric 등록 (PR #435)
-- ------------------------------------------------------------
-- 배경 (사용자 신고):
--   "제품별 실제원가 TOP 5" 조회 시 시스템이 SUM(TOTAL) 총액 기준으로
--   정렬 → 생산량이 많아 총액이 큰 제품이 상위에 노출되어 실제 단가가
--   높은 제품과 구분이 안 되는 문제.
--
-- 사용자 요구:
--   "제품별 실제원가"는 총 발생금액이 아니라 단위당 실제원가
--   (SUM(TOTAL) / SUM(LBKUM)) 를 기준으로 조회해야 함.
--
-- 해결 방향:
--   1) UI 예시질문 문구를 "제품별 실제원가 단가 TOP 5" 로 변경
--      (index.html __unified__ / cost-product 두 곳)
--   2) 학습관리(Metric) 에 "실제원가 단가" 산식을 정식 등록 → LLM 프롬프트
--      에 자동 노출되어 "단가" 라는 어휘가 나올 때마다 결정적으로 이 산식
--      사용 (이번 파일)
--   3) 동의어(metric_synonym) 로 "실제원가 단가 / 실제원가단가 /
--      단위당 실제원가 / 단위 실제원가 / 원가 단가" 등 다양한 표현 커버
--
-- 스코프:
--   sys_aimd_cot015 (제품별원가) 만 대상. sys_aimd_cot043 은 부서/호기
--   단위라 "단가" 개념이 다르므로 별도.
--
-- 도메인 배포:
--   3개 도메인 (PS / HL / MGMT) 각각 등록.
--   (sys_aimd_cot015 는 3개 도메인 모두에서 접근 가능한 제조원가 공통 테이블)
--
-- 산식:
--   SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)
--   - TOTAL : 실제원가 총액 (BIGINT)
--   - LBKUM : 생산수량 (DECIMAL 17,3)
--   - NULLIF 로 0 나누기 오류 방지 (생산수량 0 인 제품은 결과 NULL)
--
-- 하드코딩 방지:
--   특정 자재코드는 이 파일 어디에도 등장하지 않음. 임의의 MATERIAL 값에
--   동일 산식이 적용됨 (WHERE MATERIAL=... 은 LLM 이 사용자 질의에서 추출).
--
-- Metric aggregation = 'CALC' 인 이유:
--   산식에 이미 SUM() 이 두 번 들어있어 상위에서 다시 SUM() 으로 감싸면
--   중첩 집계 오류. server.mjs 의 buildRAGSystemPrompt / matchSynonymsDirectly
--   는 CALC 계열을 "column-level" 로 인식하여 그대로 사용함
--   (GROSS_PROFIT_RATE / OPERATING_PROFIT_RATE 와 동일 패턴).
--
-- 멱등성:
--   INSERT IGNORE + metric_synonym 은 서브쿼리로 metric_id 를 참조.
--   중복 실행 안전.
--
-- ⚠️ 실행 후 반드시 RAG 인덱스 재빌드:
--     POST /api/rag/build   (관리자 로그인 세션 필요)
--   또는 서버 재기동 후 학습관리 화면에서 [RAG 인덱스 재빌드] 버튼 클릭.
--   그렇지 않으면 rag_embeddings 에 신규 metric 이 반영되지 않아 LLM
--   프롬프트의 "학습관리 등록 지표" 섹션에 안 나타남.
-- ============================================================


-- ═══════════════════════════════════════════════════════════
-- 1) Metric 등록 (3개 도메인 × 1개 지표)
-- ═══════════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════════
-- 2) Metric 동의어 등록
-- ------------------------------------------------------------
-- 아래 동의어는 사용자가 자연어로 부를 수 있는 다양한 표현들.
-- "실제원가" 만 언급된 경우는 이 동의어 목록에 없어 metric 매칭 안 됨
-- (사용자 의도가 총액인지 단가인지 불명확). 사용자가 예시질문 문구
-- "실제원가 단가" 등으로 단가 의도를 명시하면 이 metric 이 매칭됨.
--
-- 단가 의도가 없이 "실제원가" 만 언급된 경우의 처리 흐름:
--   (a) 필터 조건: ZCGUBUN='실제원가' 로 이미 걸림
--   (b) 조회 대상: LLM 이 "단가/총액/생산수량" 여러 measure 를 함께
--       SELECT 하도록 프롬프트 규칙에서 유도 (별도 PR 필요 시 후속 조치)
-- ═══════════════════════════════════════════════════════════
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


-- ═══════════════════════════════════════════════════════════
-- 확인 쿼리 (실행 후 검증용, 주석 처리 - 필요 시 주석 해제)
-- ═══════════════════════════════════════════════════════════
-- SELECT domain_code, metric_code, aggregation, formula, table_name, description
--   FROM metric WHERE metric_code='COST_ACTUAL_UNIT_PRICE';
--
-- SELECT m.domain_code, m.metric_code, s.synonym_text
--   FROM metric_synonym s JOIN metric m ON s.metric_id = m.id
--  WHERE m.metric_code='COST_ACTUAL_UNIT_PRICE'
--  ORDER BY m.domain_code, s.synonym_text;
