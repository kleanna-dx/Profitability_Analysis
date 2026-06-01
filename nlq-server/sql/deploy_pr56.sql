-- ============================================================
-- 운영 배포 스크립트: PR #56
-- 제목: 도메인별 Ontology/Metric 매핑 오류 수정 + NLQ 기준월 안내 개선 + UI 정리
-- 날짜: 2026-06-01
-- ============================================================
-- 
-- ★ 이번 PR에서는 신규 테이블/컬럼 추가(DDL)가 없습니다.
-- ★ 아래는 HL 도메인 Ontology 동의어 데이터 INSERT (DML)만 포함됩니다.
-- ★ 모든 INSERT는 NOT EXISTS 조건으로 중복 실행해도 안전합니다.
--
-- [참고] PR #55의 DDL(sessions 테이블, builder_query_history.domain_code 컬럼)이
--        아직 운영에 미적용이면 015_add_sessions_and_builder_domain.sql을 먼저 실행하세요.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. HL 도메인 Ontology 동의어 등록
--    - "CAM" 질문 시 MARKETING_COST가 아닌 CO_AREA_NM(관리회계 영역명)으로 매핑
-- ────────────────────────────────────────────────────────────

-- CO_AREA_NM (관리회계 영역명) 동의어
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

-- CO_AREA (관리회계 영역) 동의어
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

-- ────────────────────────────────────────────────────────────
-- 2. 배포 후 필수 작업
-- ────────────────────────────────────────────────────────────
-- (a) RAG 인덱스 리빌드 필요 (domain_code 메타데이터 반영)
--     → 관리자 로그인 후 POST /api/rag/build 호출
--     → 또는 학습관리 > RAG 빌드 버튼 클릭
--
-- (b) .env에 SESSION_SECRET 설정 확인 (PR #55에서 추가)
--     SESSION_SECRET=<고정 비밀키 문자열>
-- ============================================================
