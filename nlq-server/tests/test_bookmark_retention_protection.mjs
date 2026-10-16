/**
 * test_bookmark_retention_protection.mjs
 *
 * [2026-10-16] 즐겨찾기(⭐, is_bookmarked=1) 자동 삭제 보호 regression 방지 테스트
 *
 * 배경:
 *   사용자 신고 — 자연어 질의 사이드바 "질의 이력" 보관주기가 31일인데,
 *   ⭐즐겨찾기 탭의 쿼리도 31일 지나면 사라지는지 궁금. 코드 확인 결과:
 *     - nl_query_history: 31일 경과 + 사용자당 200건 캡 → 즐겨찾기 보호 없음
 *     - builder_query_history: 사용자당 50건 캡 → 즐겨찾기 보호 없음
 *   즉, 사용자가 명시적으로 별표를 찍은 즐겨찾기도 자동 삭제 대상이었음.
 *
 * 수정:
 *   NLQ (nl_query_history):
 *     - 상수 NLQ_BOOKMARK_PROTECT_SQL 정의 (세션 단위 보호 조건)
 *     - purgeExpiredNlqHistory() 의 31일 DELETE 에 보호 조건 추가
 *     - saveHistory() 안의 INSERT-time 31일 DELETE 에 보호 조건 추가
 *     - saveHistory() 안의 200건 캡 DELETE 에 보호 조건 추가
 *     - 세션 단위: 같은 session_id 내 어느 row 라도 is_bookmarked=1 이면 세션 전체 보호
 *       (사이드바 즐겨찾기 탭이 세션 단위로 그룹핑하므로, 세션 내 일부 row 만 삭제되면 재조회 시 맥락 깨짐)
 *     - 레거시 row (session_id IS NULL) 는 개별 row 단위로 is_bookmarked 체크
 *
 *   VQB (builder_query_history):
 *     - saveBuilderHistory() 의 50건 캡 DELETE (user_id 유/무 2곳) 에 is_bookmarked = 0 추가
 *     - VQB 는 세션 개념이 없고 row 단위라 단순 AND is_bookmarked = 0 만 추가
 *
 * 실행: node nlq-server/tests/test_bookmark_retention_protection.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_MJS = resolve(__dirname, '../server.mjs');

const serverSrc = readFileSync(SERVER_MJS, 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, name) {
    if (cond) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name); }
}
function assertMatch(src, re, name) {
    const ok = re.test(src);
    if (ok) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name, '\n  regex:', re); }
}
function assertNoMatch(src, re, name) {
    const ok = !re.test(src);
    if (ok) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name, '\n  regex (should NOT match):', re); }
}

// ============================================================
// A. NLQ_BOOKMARK_PROTECT_SQL 상수 정의
// ============================================================
assertMatch(serverSrc,
    /const\s+NLQ_BOOKMARK_PROTECT_SQL\s*=\s*`/,
    'A-1: NLQ_BOOKMARK_PROTECT_SQL 상수가 정의됨');

assertMatch(serverSrc,
    /NLQ_BOOKMARK_PROTECT_SQL[\s\S]{0,500}session_id\s+IS\s+NOT\s+NULL[\s\S]{0,200}session_id\s+IN/,
    'A-2: 보호 조건에 세션 단위 보호 로직 포함 (session_id IN subquery)');

assertMatch(serverSrc,
    /NLQ_BOOKMARK_PROTECT_SQL[\s\S]{0,500}is_bookmarked\s*=\s*1[\s\S]{0,200}session_id\s+IS\s+NOT\s+NULL/,
    'A-3: 보호 조건이 is_bookmarked=1 AND session_id IS NOT NULL 세션 전체 보호');

assertMatch(serverSrc,
    /NLQ_BOOKMARK_PROTECT_SQL[\s\S]{0,500}session_id\s+IS\s+NULL[\s\S]{0,100}is_bookmarked\s*=\s*1/,
    'A-4: 보호 조건에 레거시 row (session_id IS NULL) 개별 보호 로직 포함');

assertMatch(serverSrc,
    /NLQ_BOOKMARK_PROTECT_SQL\s*=\s*`[\s\S]{0,500}AND\s+NOT\s*\(/,
    'A-5: 보호 조건이 AND NOT (...) 패턴으로 시작 (DELETE WHERE 절에 안전하게 append 가능)');

// ============================================================
// B. purgeExpiredNlqHistory() — 24시간 스케줄 삭제에 보호 적용
// ============================================================
assertMatch(serverSrc,
    /async\s+function\s+purgeExpiredNlqHistory[\s\S]{0,500}DELETE\s+FROM\s+nl_query_history[\s\S]{0,300}INTERVAL\s+\?\s+DAY[\s\S]{0,100}\$\{NLQ_BOOKMARK_PROTECT_SQL\}/,
    'B-1: purgeExpiredNlqHistory() 의 31일 DELETE 쿼리에 NLQ_BOOKMARK_PROTECT_SQL 포함');

// 과거 코드 regression 방지: purgeExpiredNlqHistory 안에 보호 조건 없는 raw DELETE 가 남아있으면 안됨
// (일반 DELETE 는 전부 상수 참조로만 작성돼야 함)
assertNoMatch(serverSrc,
    /async\s+function\s+purgeExpiredNlqHistory[\s\S]{0,500}`DELETE\s+FROM\s+nl_query_history\s+WHERE\s+created_at\s*<\s*\(NOW\(\)\s*-\s*INTERVAL\s*\?\s*DAY\)`\s*,/,
    'B-2: regression — 보호 없는 raw DELETE 가 purgeExpiredNlqHistory 안에 남아있지 않음');

// ============================================================
// C. saveHistory() 내부 — INSERT-time 31일 purge + 200건 cap 둘 다 보호
// ============================================================
assertMatch(serverSrc,
    /async\s+function\s+saveHistory\([\s\S]{0,15000}INSERT\s+INTO\s+nl_query_history[\s\S]{0,2000}DELETE\s+FROM\s+nl_query_history[\s\S]{0,500}INTERVAL\s+\?\s+DAY[\s\S]{0,200}\$\{NLQ_BOOKMARK_PROTECT_SQL\}/,
    'C-1: saveHistory() 안 INSERT-time 31일 DELETE 에 NLQ_BOOKMARK_PROTECT_SQL 포함');

assertMatch(serverSrc,
    /async\s+function\s+saveHistory\([\s\S]{0,15000}LIMIT\s+200[\s\S]{0,500}\$\{NLQ_BOOKMARK_PROTECT_SQL\}/,
    'C-2: saveHistory() 안 200건 cap DELETE 에 NLQ_BOOKMARK_PROTECT_SQL 포함');

// 과거 라인 패턴 (보호 없음) regression 방지
assertNoMatch(serverSrc,
    /`DELETE FROM nl_query_history WHERE user_id = \? AND id NOT IN \(\s*\n\s*SELECT id FROM \(SELECT id FROM nl_query_history WHERE user_id = \? ORDER BY created_at DESC LIMIT 200\) AS tmp\s*\n\s*\)`/,
    'C-3: regression — 보호 없는 old 200건 cap 쿼리가 남아있지 않음');

// ============================================================
// D. VQB saveBuilderHistory() — 50건 캡에 is_bookmarked=0 보호
// ============================================================

// D-1: user_id 있는 쿼리에 is_bookmarked = 0 추가
assertMatch(serverSrc,
    /DELETE\s+FROM\s+builder_query_history\s*\n\s*WHERE\s+user_id\s*=\s*\?\s*\n\s*AND\s+is_bookmarked\s*=\s*0\s*\n\s*AND\s+id\s+NOT\s+IN/,
    'D-1: VQB user_id 있는 50건 cap DELETE 에 AND is_bookmarked = 0 추가');

// D-2: user_id IS NULL 쿼리에도 is_bookmarked = 0 추가
assertMatch(serverSrc,
    /DELETE\s+FROM\s+builder_query_history\s*\n\s*WHERE\s+user_id\s+IS\s+NULL\s*\n\s*AND\s+is_bookmarked\s*=\s*0\s*\n\s*AND\s+id\s+NOT\s+IN/,
    'D-2: VQB user_id IS NULL 50건 cap DELETE 에 AND is_bookmarked = 0 추가');

// D-3: 과거 보호 없는 쿼리 regression 방지
assertNoMatch(serverSrc,
    /`DELETE FROM builder_query_history WHERE user_id = \? AND id NOT IN \(/,
    'D-3: regression — 보호 없는 old VQB cap 쿼리 (user_id=?) 가 남아있지 않음');

assertNoMatch(serverSrc,
    /`DELETE FROM builder_query_history WHERE user_id IS NULL AND id NOT IN \(/,
    'D-4: regression — 보호 없는 old VQB cap 쿼리 (user_id IS NULL) 가 남아있지 않음');

// ============================================================
// E. 사용자 명시 삭제 경로는 영향 받지 않음 (보호 금지 — 북마크여도 삭제돼야 함)
// ============================================================
// 사용자가 사이드바에서 수동 삭제 (/api/history/:id 등) 시 is_bookmarked 체크 금지
// → 이들 쿼리는 보호 조건이 "없어야" 정상 (사용자가 삭제 눌렀는데 북마크여서 안 지워지면 UX 깨짐)
assertMatch(serverSrc,
    /DELETE FROM nl_query_history WHERE id=\? AND user_id=\?'/,
    'E-1: 사용자 명시 삭제 (단일 id) 는 보호 조건 없이 그대로 삭제');

assertMatch(serverSrc,
    /DELETE FROM nl_query_history WHERE session_id=\? AND user_id=\?/,
    'E-2: 사용자 명시 삭제 (session_id) 는 보호 조건 없이 그대로 삭제');

assertMatch(serverSrc,
    /DELETE FROM nl_query_history WHERE user_id = \?'/,
    'E-3: 사용자 전체 삭제 (clear-all) 는 보호 조건 없이 그대로 삭제');

assertMatch(serverSrc,
    /DELETE FROM builder_query_history WHERE id=\? AND user_id=\?/,
    'E-4: VQB 사용자 명시 삭제 (단일 id) 는 보호 조건 없이 그대로 삭제');

assertMatch(serverSrc,
    /DELETE FROM builder_query_history WHERE user_id = \? OR user_id IS NULL/,
    'E-5: VQB 사용자 전체 삭제 (clear-all) 는 보호 조건 없이 그대로 삭제');

// ============================================================
// F. 즐겨찾기 조회 쿼리는 변경 없음 (regression 방지)
// ============================================================
// NLQ 조회: HAVING is_bookmarked = 1 패턴 유지
assertMatch(serverSrc,
    /HAVING is_bookmarked = 1/,
    'F-1: NLQ 즐겨찾기 조회 쿼리 HAVING is_bookmarked = 1 유지');

// VQB 조회: WHERE user_id = ? AND is_bookmarked = 1 패턴 유지
assertMatch(serverSrc,
    /FROM builder_query_history WHERE user_id = \? AND is_bookmarked = 1 ORDER BY created_at DESC/,
    'F-2: VQB 즐겨찾기 조회 쿼리 WHERE is_bookmarked = 1 유지');

// ============================================================
// G. 보관정책 API — 정책 노출 유지
// ============================================================
assertMatch(serverSrc,
    /app\.get\(['"`]\/api\/history\/retention['"`][\s\S]{0,200}days:\s*NLQ_HISTORY_RETENTION_DAYS/,
    'G-1: /api/history/retention 엔드포인트가 NLQ_HISTORY_RETENTION_DAYS 반환 (프론트 안내 문구용)');

assertMatch(serverSrc,
    /const\s+NLQ_HISTORY_RETENTION_DAYS\s*=\s*31/,
    'G-2: NLQ_HISTORY_RETENTION_DAYS = 31 상수 유지');

// ============================================================
// 결과 요약
// ============================================================
console.log('');
console.log('='.repeat(60));
console.log(`결과: PASS ${PASS} / FAIL ${FAIL}`);
console.log('='.repeat(60));
if (FAIL > 0) {
    console.log('\n실패 항목:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
} else {
    console.log('\n✅ 모든 즐겨찾기 보호 regression 테스트 통과');
    process.exit(0);
}
