-- ============================================================
-- [PR #TBD / 2026-10-16] 즐겨찾기(⭐) 자동 삭제 보호
-- ------------------------------------------------------------
-- 배경:
--   사용자 신고 — 자연어 질의 사이드바 "질의 이력" 보관주기가 31일인데,
--   ⭐즐겨찾기 탭에 저장한 쿼리도 31일 지나면 사라지는지 궁금.
--
--   코드 분석 결과:
--     [NLQ] nl_query_history
--       - 시간 기준: 31일 경과 행 자동 DELETE  → 즐겨찾기 보호 조건 없음
--       - 건수 기준: 사용자당 최신 200건 유지  → 즐겨찾기 보호 조건 없음
--       - 실행: INSERT 시점 + 서버 시작 30초 후 + 24시간 주기
--
--     [VQB] builder_query_history
--       - 건수 기준: 사용자당 최신 50건 유지   → 즐겨찾기 보호 조건 없음
--       - 실행: INSERT 시점
--
--   즉, 사용자가 명시적으로 별표를 찍은 즐겨찾기도 자동 삭제 대상이었음.
--   운영 쪽에서 "별표 쳐둔 쿼리가 어느 날 갑자기 없어졌다" 고객 문의 발생 가능.
--
-- 해결 (애플리케이션 코드만 수정 — 스키마 변경 없음):
--   nlq-server/server.mjs 의 5개 DELETE 쿼리에 즐겨찾기 보호 조건 추가.
--
--   NLQ (nl_query_history) 3곳:
--     - 세션 단위 보호 — "같은 session_id 내 어느 row 라도 is_bookmarked=1 이면
--                        해당 세션 전체(모든 row) 보호".
--     - 이유: 사이드바 즐겨찾기 탭이 세션 단위로 그룹핑하므로(server.mjs 라인 ~14834)
--             세션 내 일부 row 만 삭제되면 재조회 시 맥락이 깨짐.
--     - 레거시 row (session_id IS NULL) 는 개별 row 단위로 is_bookmarked 체크.
--     - 공통 상수 NLQ_BOOKMARK_PROTECT_SQL 로 추출하여 3곳 동일 적용.
--
--   VQB (builder_query_history) 2곳:
--     - row 단위 보호 — AND is_bookmarked = 0 조건만 추가 (세션 개념 없음).
--     - user_id 있는 쿼리 / user_id IS NULL 쿼리 둘 다 적용.
--
--   영향 받지 않는 쿼리 (의도적으로 보호 조건 없음):
--     - 사용자 명시 삭제 (/api/history/:id, /api/builder/history/:id 등)
--     - 사용자 전체 삭제 (clear-all)
--     → 사용자가 "삭제" 버튼을 누른 경우에는 즐겨찾기 여부와 무관하게 삭제돼야 함.
--
-- 검증:
--   nlq-server/tests/test_bookmark_retention_protection.mjs — 23 assertions
--     A. NLQ_BOOKMARK_PROTECT_SQL 상수 정의 검증
--     B. purgeExpiredNlqHistory() 24시간 스케줄에 보호 적용
--     C. saveHistory() 안 INSERT-time 31일 purge + 200건 cap 둘 다 보호
--     D. VQB 50건 cap (user_id 유/무 2곳) is_bookmarked=0 보호
--     E. 사용자 명시 삭제 경로는 영향 받지 않음 (regression 방지)
--     F. 즐겨찾기 조회 쿼리는 변경 없음 (regression 방지)
--     G. 보관정책 상수 (NLQ_HISTORY_RETENTION_DAYS=31) 유지
--
--   전체 회귀 테스트 36개 파일 모두 PASS (test_vqb_business_area_history 43 포함).
--
-- 운영 적용:
--   스키마 변경 없음 — 별도 DDL 실행 불필요.
--   서버 재시작만으로 즉시 반영됨 (nlq-server/server.mjs 변경).
--
--   재시작 후 즉시 확인 쿼리:
--     SELECT COUNT(*) AS bookmarked_count
--       FROM nl_query_history
--      WHERE is_bookmarked = 1
--        AND created_at < (NOW() - INTERVAL 31 DAY);
--     -- 이 쿼리 결과가 양수이고, 서버 재시작 30초 후에도 그대로 유지되면
--     -- → 보호 로직이 정상 동작하는 것 (삭제되지 않고 살아있음)
--     -- 재시작 전에는 24시간 주기 purge 에 의해 0 이었음.
--
-- Rollback:
--   server.mjs 를 PR 적용 전 상태로 되돌리면 됨 (DB 변경 없음).
-- ============================================================

-- ------------------------------------------------------------
-- [섹션 1] 스키마 변경 없음을 확인하는 검증 쿼리
-- ------------------------------------------------------------
-- nl_query_history, builder_query_history 의 기존 컬럼은 변경되지 않습니다.
-- 아래 쿼리로 적용 전/후 컬럼 수가 동일함을 확인할 수 있습니다.

SELECT
  TABLE_NAME,
  COUNT(*) AS column_count
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('nl_query_history', 'builder_query_history')
GROUP BY TABLE_NAME;

-- ------------------------------------------------------------
-- [섹션 2] 적용 후 즐겨찾기 보호 상태 조회 (참고용)
-- ------------------------------------------------------------
-- 현재 DB 에 저장된 즐겨찾기 중 31일 경과한 쿼리가 몇 건인지 확인.
-- 서버 재시작 후에도 이 값이 유지되면 보호 로직이 정상 동작하는 것.

-- NLQ: 즐겨찾기된 세션 중 31일 경과한 세션 개수
SELECT
  'NLQ: 31일 경과 북마크 세션' AS metric,
  COUNT(DISTINCT COALESCE(session_id, CONCAT('legacy_', id))) AS value
FROM nl_query_history
WHERE is_bookmarked = 1
  AND created_at < (NOW() - INTERVAL 31 DAY);

-- NLQ: 사용자별 즐겨찾기 세션 수 (top 10)
SELECT
  user_id,
  COUNT(DISTINCT COALESCE(session_id, CONCAT('legacy_', id))) AS bookmarked_sessions
FROM nl_query_history
WHERE is_bookmarked = 1
GROUP BY user_id
ORDER BY bookmarked_sessions DESC
LIMIT 10;

-- VQB: 즐겨찾기된 row 중 50건 캡 적용 후에도 보호될 row 수
SELECT
  'VQB: 북마크된 row 전체' AS metric,
  COUNT(*) AS value
FROM builder_query_history
WHERE is_bookmarked = 1;

-- VQB: 사용자별 즐겨찾기 수 (top 10) — 50건 넘어도 보호됨
SELECT
  user_id,
  COUNT(*) AS bookmarked_rows,
  (SELECT COUNT(*) FROM builder_query_history b2 WHERE b2.user_id = b1.user_id) AS total_rows
FROM builder_query_history b1
WHERE is_bookmarked = 1
GROUP BY user_id
ORDER BY bookmarked_rows DESC
LIMIT 10;
