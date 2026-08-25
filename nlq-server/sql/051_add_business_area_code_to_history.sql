-- ============================================================
-- [PR #393 / 2026-08-25] nl_query_history 에 business_area_code 추가
-- ------------------------------------------------------------
-- 배경:
--   사이드바 [질의 이력] 에서 각 질문이 수익성분석/제조원가 중 어느
--   업무영역에서 실행되었는지 시각적으로 구분해야 함 (사용자 요구사항).
--   - 표시 형식: [수익|제조] [PS|HL|통합] 질문 텍스트
--     예) [수익] [통합] 손익센터별 총매출 합계
--         [제조] [PS] 제품별 실제원가 TOP 5
--   - 질문 문구 추측 금지 → 질의 실행 당시 실제 선택된 업무영역 값
--     (프론트가 전송한 req.body.area) 을 그대로 저장해야 함.
--
-- 해결:
--   nl_query_history 에 business_area_code VARCHAR(32) 컬럼 추가.
--   - 저장값:
--       'PROFITABILITY'      → 수익성분석 탭 (프론트 배지 [수익])
--       'MANUFACTURING_COST' → 제조원가 탭   (프론트 배지 [제조])
--       NULL                 → 업무영역 컨텍스트 없이 저장된 기존 이력
--                              (프론트에서 배지 미표시 = 기존과 동일 표시)
--   - 값 컨벤션: sys_aimd_areas.area_code (SNAKE_CASE) 와 동일.
--     서버는 resolveAreaContext() 가 반환하는 kebab-case 를
--     saveHistory 호출 직전에 SNAKE_CASE 로 정규화하여 저장.
--   - 위치: domain_code 옆에 배치 (두 컬럼 모두 요청 컨텍스트 분류용).
--   - NULL 허용: 하위호환 (기존 이력 무영향).
--
-- 프론트 매핑 (nlq-server/public/index.html renderHistoryList):
--   PROFITABILITY      → [수익] (배경 #e0f2fe, 텍스트 #0284c7)
--   MANUFACTURING_COST → [제조] (배경 #ffedd5, 텍스트 #c2410c)
--   NULL               → 배지 미렌더
--
-- 참고:
--   서버(server.mjs) 도 동일한 idempotent ALTER TABLE 마이그레이션을
--   startup 시점에 실행하므로, 애플리케이션 배포만으로도 스키마가
--   맞춰짐. 본 SQL 파일은 운영 DBA 가 직접 적용하고자 할 때, 그리고
--   히스토리 추적을 위한 기록으로 함께 제공.
-- ============================================================

-- MariaDB / MySQL 모두 IF NOT EXISTS 를 ALTER TABLE ADD COLUMN 에서
-- 지원하지 않는 버전이 있으므로, 존재 여부를 확인 후 조건부 실행.
-- (037_add_request_id_to_history.sql 와 동일한 안전 패턴 사용)

SET @schema := DATABASE();

-- business_area_code 컬럼 추가
SET @col_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = @schema
    AND TABLE_NAME   = 'nl_query_history'
    AND COLUMN_NAME  = 'business_area_code'
);
SET @stmt := IF(@col_exists = 0,
  'ALTER TABLE nl_query_history ADD COLUMN business_area_code VARCHAR(32) DEFAULT NULL COMMENT ''질의 실행 당시 선택된 업무영역 코드 (PROFITABILITY/MANUFACTURING_COST/NULL, PR #393)'' AFTER domain_code',
  'SELECT 1'
);
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 검증
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @schema
  AND TABLE_NAME   = 'nl_query_history'
  AND COLUMN_NAME  = 'business_area_code';
