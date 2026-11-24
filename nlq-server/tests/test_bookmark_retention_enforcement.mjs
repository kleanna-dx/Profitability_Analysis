// ============================================================
// test_bookmark_retention_enforcement.mjs
//
// [목적] 즐겨찾기(⭐) 자동 삭제 방어선 강화 검증.
//
// [배경] 사용자 신고 (2026-11-23):
//   "31일 보관주기 지나도 즐겨찾기 내역은 유지되게, 파기 안되게 하기로 했는데, 왜 계속 없어져?
//    이전에 요청했는데 제대로 동작하지 않는 것 같으니, UI뿐 아니라 실제 삭제 배치/쿼리까지 확인해서 수정"
//
//   이전 작업 (e8d2830, 2026-10-16) 에서 NLQ_BOOKMARK_PROTECT_SQL 세션 단위 보호를
//   적용했지만, 사용자님이 "한달 전 즐겨찾기 테스트" 데이터가 실제로 사라진 것을 확인.
//
// [설계]
//   사용자님 지정 4가지 시나리오:
//     1. 31일 초과 + 일반 질의          → 삭제됨          (expected: deleted)
//     2. 31일 초과 + 즐겨찾기(⭐)        → 삭제되지 않음    (expected: survived)
//     3. 31일 초과 + 즐겨찾기 해제        → 다음 삭제 대상   (expected: eligible for deletion)
//     4. 31일 미만 + 일반/즐겨찾기        → 유지            (expected: survived)
//
// [방어선 — 이중 방어]
//   1차 (row 단위): AND is_bookmarked = 0
//     → 북마크된 row 는 어떤 경우에도 DELETE WHERE 절에서 배제됨
//   2차 (세션 단위): 세션 내 어느 row 라도 is_bookmarked=1 이면 세션 전체 보호
//     → 사이드바 재조회 시 세션 맥락 유지 (일부 row 만 삭제되면 UX 깨짐)
//
// [검증]
//   섹션 A: 상수 정의 검증 (NLQ_BOOKMARK_PROTECT_SQL 에 is_bookmarked = 0 포함)
//   섹션 B: DELETE 쿼리 지점 3곳 모두에 이중 방어 적용됨
//   섹션 C: 로깅 강화 — 삭제 대상 수 + 보호된 수 명시
//   섹션 D: 별표 토글 API — affected_rows 검증 로직 존재
//   섹션 E: 사용자님 지정 4가지 시나리오 재현 (정규식 패턴 검증)
//   섹션 F: regression — MATERIAL_NM/CUSTOMER_NM REPLACE+LIKE 등 다른 로직 변경 없음
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, '..', 'server.mjs');
const serverSrc = fs.readFileSync(serverPath, 'utf-8');

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(cond, label) {
    if (cond) {
        console.log(`PASS: ${label}`);
        passCount++;
    } else {
        console.log(`FAIL: ${label}`);
        failCount++;
        failures.push(label);
    }
}
function assertMatch(src, regex, label) {
    assert(regex.test(src), `${label}\n  regex: ${regex}`);
}
function assertNoMatch(src, regex, label) {
    assert(!regex.test(src), `${label}\n  regex (should NOT match): ${regex}`);
}

// ============================================================
// 섹션 A: NLQ_BOOKMARK_PROTECT_SQL 상수 정의 검증 (이중 방어)
// ============================================================

// A-1: 상수 선언 자체 존재
assertMatch(serverSrc,
    /const\s+NLQ_BOOKMARK_PROTECT_SQL\s*=\s*`/,
    'A-1: const NLQ_BOOKMARK_PROTECT_SQL 상수 선언 존재');

// A-2: 1차 방어 (row 단위) — AND is_bookmarked = 0
//   사용자 요구: "31일 경과 AND 즐겨찾기 아님" 만 삭제
assertMatch(serverSrc,
    /const\s+NLQ_BOOKMARK_PROTECT_SQL\s*=\s*`\s*\n?\s*AND\s+is_bookmarked\s*=\s*0/,
    'A-2: 1차 방어 — AND is_bookmarked = 0 (row 단위 직접 보호) — 사용자 요구 "즐겨찾기 아님" 강제');

// A-3: 2차 방어 (세션 단위) — 세션 내 어느 row 라도 북마크면 세션 전체 보호
assertMatch(serverSrc,
    /NLQ_BOOKMARK_PROTECT_SQL[\s\S]{0,1000}SELECT\s+DISTINCT\s+session_id\s+FROM\s+nl_query_history[\s\S]{0,200}WHERE\s+is_bookmarked\s*=\s*1\s+AND\s+session_id\s+IS\s+NOT\s+NULL/,
    'A-3: 2차 방어 — 세션 단위 보호 subquery (SELECT DISTINCT session_id WHERE is_bookmarked=1)');

// A-4: 레거시 row (session_id IS NULL) 보호
assertMatch(serverSrc,
    /NLQ_BOOKMARK_PROTECT_SQL[\s\S]{0,1500}session_id\s+IS\s+NULL\s+AND\s+is_bookmarked\s*=\s*1/,
    'A-4: 레거시 row (session_id IS NULL AND is_bookmarked = 1) 보호');

// A-5: 설계 주석 — 사용자 요구 근거 기록 (verbatim)
//   주석은 상수 선언 '전'에 있으므로, 상수 선언 라인과 상관없이 전체 소스에서 검색
assertMatch(serverSrc,
    /31일\s*경과\s*AND\s*즐겨찾기\s*아님/,
    'A-5: 설계 주석 — 사용자 요구 "31일 경과 AND 즐겨찾기 아님" 명시 (추적성)');

// A-6: 설계 주석 — "이중 방어선" 또는 "이중" 명시
assertMatch(serverSrc,
    /이중\s*방어선|이중\s*방어/,
    'A-6: 설계 주석 — "이중 방어" 또는 "이중 방어선" 설명 명시');

// ============================================================
// 섹션 B: DELETE 쿼리 3곳 모두에 NLQ_BOOKMARK_PROTECT_SQL 적용됨
// ============================================================

// B-1: purgeExpiredNlqHistory() DELETE 에 적용
assertMatch(serverSrc,
    /async\s+function\s+purgeExpiredNlqHistory\s*\(\s*\)[\s\S]{0,2000}DELETE\s+FROM\s+nl_query_history[\s\S]{0,300}\$\{NLQ_BOOKMARK_PROTECT_SQL\}/,
    'B-1: purgeExpiredNlqHistory() DELETE 에 NLQ_BOOKMARK_PROTECT_SQL 적용');

// B-2: saveHistory() INSERT-time 31일 purge 에 적용
assertMatch(serverSrc,
    /saveHistory[\s\S]{0,5000}DELETE\s+FROM\s+nl_query_history[\s\S]{0,300}INSERT-time\s*purge[\s\S]{0,5000}\$\{NLQ_BOOKMARK_PROTECT_SQL\}/i,
    'B-2: saveHistory() INSERT-time 31일 purge 에 NLQ_BOOKMARK_PROTECT_SQL 적용');

// B-3: saveHistory() 200건 cap 에 적용
assertMatch(serverSrc,
    /DELETE\s+FROM\s+nl_query_history[\s\S]{0,200}id\s+NOT\s+IN[\s\S]{0,300}LIMIT\s+200[\s\S]{0,200}\$\{NLQ_BOOKMARK_PROTECT_SQL\}/,
    'B-3: saveHistory() 200건 cap DELETE 에 NLQ_BOOKMARK_PROTECT_SQL 적용');

// B-4: NLQ_BOOKMARK_PROTECT_SQL 참조 지점 >= 3곳 (함수 정의 + DELETE 3곳)
const protectSqlRefCount = (serverSrc.match(/\$\{NLQ_BOOKMARK_PROTECT_SQL\}/g) || []).length;
assert(protectSqlRefCount >= 3,
    `B-4: NLQ_BOOKMARK_PROTECT_SQL 참조 지점 >= 3곳 (실제: ${protectSqlRefCount})`);

// ============================================================
// 섹션 C: 로깅 강화 — 삭제 대상 수 + 보호된 수 명시
// ============================================================

// C-1: purge 전 미리 조회 (삭제 대상 투명화)
assertMatch(serverSrc,
    /purgeExpiredNlqHistory[\s\S]{0,2000}SELECT\s+id,\s*user_id,\s*session_id,\s*is_bookmarked[\s\S]{0,300}FROM\s+nl_query_history[\s\S]{0,300}WHERE\s+created_at\s*<\s*\(NOW\(\)/,
    'C-1: purge 전 삭제 대상 미리 조회 (로깅용)');

// C-2: 로깅 메시지 — "삭제 X건, 즐겨찾기 보호 Y건" 패턴
assertMatch(serverSrc,
    /\[HistoryRetention\][\s\S]{0,300}삭제[\s\S]{0,100}즐겨찾기\s*보호/,
    'C-2: 로깅 메시지 "삭제 X건, 즐겨찾기 보호 Y건" 패턴 존재');

// C-3: 보호된 row ID 리스트 로깅 (최대 20개)
assertMatch(serverSrc,
    /\[HistoryRetention\]\s*즐겨찾기\s*보호된\s*row/,
    'C-3: 보호된 row ID 리스트 로깅 ("즐겨찾기 보호된 row")');

// ============================================================
// 섹션 D: 별표 토글 API — affected_rows 검증 로직
// ============================================================

// D-1: 별표 토글 API 자체 존재
assertMatch(serverSrc,
    /app\.patch\s*\(\s*['"]\/api\/history\/session\/:sessionKey\/bookmark['"]/,
    'D-1: PATCH /api/history/session/:sessionKey/bookmark API 존재');

// D-2: UPDATE 결과 변수 구조 분해 할당 (updateResult)
assertMatch(serverSrc,
    /\[updateResult\]\s*=\s*await\s+pool\.query\s*\(\s*['"]UPDATE\s+nl_query_history\s+SET\s+is_bookmarked/,
    'D-2: UPDATE 결과를 updateResult 변수로 받음 (destructuring)');

// D-3: affectedRows 추출 + 검증
assertMatch(serverSrc,
    /const\s+affectedRows\s*=\s*updateResult\?\.\s*affectedRows\s*\|\|\s*0/,
    'D-3: affectedRows 추출 (nullish 안전 처리)');

// D-4: affectedRows === 0 경우 404 + 경고 로그
assertMatch(serverSrc,
    /if\s*\(\s*affectedRows\s*===\s*0\s*\)[\s\S]{0,300}console\.warn[\s\S]{0,300}UPDATE\s*0건[\s\S]{0,300}status\s*\(\s*404\s*\)/,
    'D-4: affectedRows === 0 → console.warn + 404 응답');

// D-5: 정상 UPDATE 시 로깅 (session, user, is_bookmarked 값 명시)
assertMatch(serverSrc,
    /\[Bookmark\]\s*UPDATE\s*\$\{affectedRows\}건\s*적용/,
    'D-5: 정상 UPDATE 시 "[Bookmark] UPDATE X건 적용" 로깅');

// ============================================================
// 섹션 E: 사용자님 지정 4가지 시나리오 재현 — WHERE 절 패턴 검증
// ============================================================
//
// 사용자님 요구 (verbatim):
//   WHERE created_at < DATE_SUB(NOW(), INTERVAL 31 DAY)
//     AND favorite_yn <> 'Y'    ← 이 프로젝트에서는 is_bookmarked = 0 에 해당
//
// 즉, 최종 DELETE WHERE 절은 다음과 같이 구성되어야 함:
//   DELETE FROM nl_query_history
//    WHERE created_at < (NOW() - INTERVAL 31 DAY)   ← 31일 경과
//      AND is_bookmarked = 0                        ← 즐겨찾기 아님 (1차)
//      AND NOT (세션에 북마크 있음 OR 레거시 북마크) ← 2차
//
// 아래 테스트는 "실제로 이 패턴이 조립되는지" 를 server.mjs 전체 소스에서 검증.
// ============================================================

// E-1: NLQ_HISTORY_RETENTION_DAYS = 31 상수 유지 (regression — 보관일 변경 없음)
assertMatch(serverSrc,
    /const\s+NLQ_HISTORY_RETENTION_DAYS\s*=\s*31\s*;/,
    'E-1: NLQ_HISTORY_RETENTION_DAYS = 31 상수 (사용자 요구 "31일 경과")');

// E-2: 모든 DELETE 쿼리 시작 패턴 — "WHERE created_at < (NOW() - INTERVAL ? DAY)"
const deleteWithIntervalCount = (serverSrc.match(/DELETE\s+FROM\s+nl_query_history\s*\n\s*WHERE\s+created_at\s*<\s*\(NOW\(\)\s*-\s*INTERVAL\s*\?\s*DAY\)/g) || []).length;
assert(deleteWithIntervalCount >= 2,
    `E-2: DELETE ... WHERE created_at < (NOW() - INTERVAL ? DAY) 패턴 >= 2곳 (실제: ${deleteWithIntervalCount}) — 24시간 purge + INSERT-time purge`);

// E-3: 시나리오 1 — "31일 초과 + 일반 질의 → 삭제됨"
//   조건: created_at < NOW() - 31day AND is_bookmarked = 0 AND (세션 북마크 없음)
//   → 이 조건 만족하는 row 는 purge 쿼리의 매칭 대상이 됨 (삭제됨)
//   DELETE 쿼리의 WHERE 절 다음에 NLQ_BOOKMARK_PROTECT_SQL (= AND is_bookmarked = 0 AND NOT (...))
//   가 붙으면 자연스럽게 시나리오 1 통과
assertMatch(serverSrc,
    /DELETE\s+FROM\s+nl_query_history[\s\S]{0,300}INTERVAL\s*\?\s*DAY[\s\S]{0,100}\$\{NLQ_BOOKMARK_PROTECT_SQL\}/,
    'E-3: 시나리오 1 — 31일 초과 + 일반 질의 삭제 쿼리 패턴 (INTERVAL + PROTECT_SQL)');

// E-4: 시나리오 2 — "31일 초과 + 즐겨찾기 → 삭제되지 않음"
//   보호: AND is_bookmarked = 0 조건이 들어가므로 is_bookmarked=1 row 는 WHERE 통과 못함
//   → A-2 (is_bookmarked = 0) + B-1~B-3 (3곳 적용) 로 이미 검증됨
//   추가: 세션 보호도 동시에 작동함을 확인
assertMatch(serverSrc,
    /const\s+NLQ_BOOKMARK_PROTECT_SQL\s*=\s*`[\s\S]{0,500}AND\s+is_bookmarked\s*=\s*0[\s\S]{0,500}AND\s+NOT\s*\(/,
    'E-4: 시나리오 2 — 즐겨찾기 보호: is_bookmarked=0 AND NOT (...) 이중 조건 순서 확정');

// E-5: 시나리오 3 — "31일 초과 + 즐겨찾기 해제 → 다음 삭제 대상"
//   즐겨찾기 해제 = UPDATE SET is_bookmarked=0 → 이후 purge 때 is_bookmarked = 0 조건 통과 → 삭제됨
//   토글 API 가 is_bookmarked 를 0 으로 세팅할 수 있어야 함
assertMatch(serverSrc,
    /currentRows\[0\]\.is_bookmarked\s*\?\s*0\s*:\s*1/,
    'E-5: 시나리오 3 — 토글 로직 "현재값 ? 0 : 1" (즐겨찾기 해제 시 is_bookmarked=0 저장 가능)');

// E-6: 시나리오 4 — "31일 미만 + 일반/즐겨찾기 → 유지"
//   조건: created_at >= NOW() - 31day → WHERE created_at < ... 조건에 매칭 안 됨
//   → 북마크 여부 무관하게 유지됨 (DELETE WHERE 절 자체에 매칭 안 되므로)
//   DELETE 쿼리에 "WHERE created_at < (NOW() - INTERVAL ? DAY)" 조건이 반드시 존재해야 함
assertMatch(serverSrc,
    /purgeExpiredNlqHistory[\s\S]{0,2000}WHERE\s+created_at\s*<\s*\(NOW\(\)\s*-\s*INTERVAL\s*\?\s*DAY\)/,
    'E-6: 시나리오 4 — 31일 미만 row 는 WHERE created_at < ... 조건에 매칭 안 됨 (유지)');

// ============================================================
// 섹션 F: regression — 다른 로직 변경 없음
// ============================================================

// F-1: MATERIAL_NM / CUSTOMER_NM REPLACE+LIKE 규칙 유지
assertMatch(serverSrc,
    /REPLACE\(MATERIAL_NM,\s*'\s*',\s*''\)\s*LIKE/,
    'F-1: MATERIAL_NM REPLACE+LIKE 기존 규칙 유지 (regression 방지)');

// F-2: 명칭(_NM) 컬럼 LIKE 규칙 유지 (PR #564)
assertMatch(serverSrc,
    /\[★★★★★\s*명칭\(_NM\)\s*컬럼\s*조건\s*생성\s*규칙/,
    'F-2: 명칭(_NM) 컬럼 LIKE 규칙 블록 유지 (PR #564 regression 방지)');

// F-3: AreaGuard (PR #562) 유지
assertMatch(serverSrc,
    /function\s+assertNlqSqlAreaIsolation\s*\(\s*sql\s*,\s*area\s*\)/,
    'F-3: assertNlqSqlAreaIsolation 영역 격리 가드 유지 (PR #562 regression 방지)');

// F-4: forcedCostBasis 영역 격리 (PR #563) 유지
assertMatch(serverSrc,
    /if\s*\(\s*areaCtx\.area\s*!==\s*['"]manufacturing-cost['"]\s*&&\s*req\.body\?\.forcedCostBasis\s*\)/,
    'F-4: forcedCostBasis 수익성분석 영역 차단 (PR #563 regression 방지)');

// F-5: 사용자 명시 삭제 (/api/history/:id DELETE) 는 보호 안 받음 (의도적)
assertMatch(serverSrc,
    /DELETE\s+FROM\s+nl_query_history\s+WHERE\s+id=\?\s+AND\s+user_id=\?/,
    'F-5: 사용자 명시 삭제 (/api/history/:id) 쿼리 유지 — 이 경로는 보호 안 받음 (정상)');

// F-6: VQB builder_query_history 50건 cap 에 is_bookmarked = 0 기존 조건 유지
assertMatch(serverSrc,
    /DELETE\s+FROM\s+builder_query_history[\s\S]{0,200}AND\s+is_bookmarked\s*=\s*0/,
    'F-6: VQB builder_query_history DELETE 에 is_bookmarked = 0 기존 조건 유지');

// ============================================================
// 섹션 G: 수정 추적성 마커
// ============================================================

// G-1: [2026-11-23] 강화 마커 (최소 3곳)
const strengthenMarkerCount = (serverSrc.match(/2026-11-23/g) || []).length;
assert(strengthenMarkerCount >= 3,
    `G-1: [2026-11-23] 강화 마커 >= 3곳 (Fix #1/#2/#3) — 실제: ${strengthenMarkerCount}`);

// G-2: 사용자 요구 인용 ("사라짐" 또는 "유지되게")
assertMatch(serverSrc,
    /사용자\s*신고[\s\S]{0,500}사라짐|즐겨찾기[\s\S]{0,100}사라짐|즐겨찾기[\s\S]{0,100}유지/,
    'G-2: 사용자 신고 근거 주석 ("즐겨찾기 사라짐" 또는 "유지")');

// ============================================================
// 결과 출력
// ============================================================

console.log('');
console.log('========================================');
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
console.log('========================================');

if (failCount > 0) {
    console.log('');
    console.log('실패한 assertion 목록:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');
    console.log('==================================================');
    console.log(`BOOKMARK RETENTION ENFORCEMENT TEST — PASS: ${passCount}, FAIL: ${failCount}`);
    console.log('==================================================');
    process.exit(1);
}

console.log('');
console.log('==================================================');
console.log(`BOOKMARK RETENTION ENFORCEMENT TEST — PASS: ${passCount}, FAIL: ${failCount}`);
console.log('==================================================');
