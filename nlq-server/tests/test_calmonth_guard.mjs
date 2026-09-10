/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_calmonth_guard.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상: nlq-server/lib/calmonthGuard.mjs 의 "기간 미지정 -> 최신 마감월"
 *       공통 정책 게이트.
 *
 * 검증 목표 (사용자 요구 Case 1~7 + 확장):
 *   Case 1  기간 없는 제조원가 질의 (cot015) -> CALMONTH 자동 주입
 *   Case 2  질의에 "2026년 7월" 명시 (SQL 에 CALMONTH='202607' 이미 있음) -> skip
 *   Case 3  "당월" 표현 + LLM 이 이미 CALMONTH 로 변환 -> skip
 *   Case 4  예시질문 클릭 경로 (동일 자연어 -> 동일 게이트 적용)
 *   Case 5  부서별원가 (cot043) 기간 미지정 -> 자동 주입
 *   Case 6  호기별원가 (cot043) 기간 미지정 -> 자동 주입
 *   Case 7  "전체 기간" 명시 -> skip (사용자 의도 존중)
 *
 * 확장 회귀 케이스:
 *   Case 8  bw_profitability_data (수익성분석) 기간 미지정 -> 주입
 *   Case 9  whitelist 밖 테이블 -> no-op
 *   Case 10 다양한 CALMONTH 형태 (BETWEEN/IN/LIKE/LEFT/>= AND <=) -> skip
 *   Case 11 CALYEAR 조건이 있으면 skip
 *   Case 12 WHERE 없는 SQL 에 신규 WHERE 생성
 *   Case 13 테이블 별칭 지원
 *   Case 14 문자열 리터럴 안의 괄호 오탐 방지 (REPLACE 등)
 *   Case 15 GROUP BY / ORDER BY / LIMIT 조합 안전 삽입
 *   Case 16 latestMonth 누락 시 안전하게 원본 반환
 *   Case 17 "전체 기간" 예외 다양한 표현 boundary 검증
 *   Case 18 이미 CALMONTH + "전체 기간" 동시 -> skip (우선순위)
 *   Case 19 사용자 재현 시나리오 완전 재현
 *   Case 20 하드코딩 방지 — latestMonth 만 바꾸면 SQL 도 함께 변경
 */

import {
  ensureCalmonthFilter,
  hasExplicitAllPeriodIntent,
  sqlHasCalmonthCondition,
  ALL_PERIOD_INTENT_RE,
  DIVISION_ENABLED_TABLES_RE,
} from '../lib/calmonthGuard.mjs';

let passCount = 0;
let failCount = 0;

function assert(cond, msg) {
  if (cond) {
    passCount++;
    console.log('  ✅ ' + msg);
  } else {
    failCount++;
    console.log('  ❌ ' + msg);
  }
}
function section(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

const LATEST = '202608';

// ══════════════════════════════════════════════════════════════════════════
section('Case 1: 제조원가 (cot015) 기간 없는 질의 -> CALMONTH 자동 주입');
// ══════════════════════════════════════════════════════════════════════════
{
  // 사용자 재현 케이스: "제품별 실제원가 TOP 5"
  const sql = `SELECT MATERIAL AS '제품코드', MAX(MATERIAL_NM) AS '제품명', SUM(TOTAL) AS '실제원가 합계(원)' `
            + `FROM sys_aimd_cot015 WHERE DIVISION = '10' AND ZCGUBUN = '실제원가' `
            + `GROUP BY MATERIAL ORDER BY SUM(TOTAL) DESC LIMIT 5`;
  const r = ensureCalmonthFilter(sql, LATEST, '제품별 실제원가 TOP 5');
  assert(r.injected === true, '주입 발생 (injected=true)');
  assert(r.skipReason === null, 'skipReason 없음');
  assert(r.sql.includes("CALMONTH = '202608'"), `CALMONTH = '202608' 조건 포함`);
  assert(r.sql.includes("DIVISION = '10'"), '기존 DIVISION 조건 유지');
  assert(r.sql.includes("ZCGUBUN = '실제원가'"), '기존 ZCGUBUN 조건 유지');
  assert(r.sql.includes('LIMIT 5'), 'LIMIT 5 유지');
  assert(r.sql.includes('GROUP BY MATERIAL'), 'GROUP BY 유지');
  // 삽입 위치가 WHERE 절 앞부분
  assert(/WHERE\s+CALMONTH\s*=\s*'202608'\s+AND\s+\(/.test(r.sql),
    'CALMONTH 조건이 WHERE 절 앞에 붙고 기존 조건이 괄호로 감싸짐');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 2: 질의에 "2026년 7월" 명시 -> SQL 에 이미 CALMONTH -> skip');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 `
            + `WHERE DIVISION = '10' AND CALMONTH = '202607' AND ZCGUBUN = '실제원가' `
            + `GROUP BY MATERIAL`;
  const r = ensureCalmonthFilter(sql, LATEST, '2026년 7월 제품별 실제원가 TOP 5');
  assert(r.injected === false, '주입 안 됨 (injected=false)');
  assert(r.skipReason === 'already_has_calmonth', 'skipReason=already_has_calmonth');
  assert(r.sql === sql, 'SQL 무변경');
  assert(r.sql.includes("CALMONTH = '202607'"), '사용자 지정 CALMONTH 유지');
  assert(!r.sql.includes("'202608'"), 'latestMonth (202608) 는 삽입되지 않음');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 3: "당월" 표현 + SQL 에 CALMONTH 이미 있음 -> skip');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 `
            + `WHERE CALMONTH = '202608' AND ZCGUBUN = '실제원가' GROUP BY MATERIAL`;
  const r = ensureCalmonthFilter(sql, LATEST, '당월 제품별 실제원가 TOP 5');
  assert(r.injected === false, '주입 안 됨 (LLM 이 이미 처리)');
  assert(r.skipReason === 'already_has_calmonth', 'skipReason=already_has_calmonth');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 4: 예시질문 클릭 경로 (동일 게이트 적용)');
// ══════════════════════════════════════════════════════════════════════════
{
  // 예시질문 클릭 -> sendQuery(s) -> 서버 /api/nlq -> 동일한 SQL 후처리 게이트
  // 우회 경로 없음. 여기서는 예시질문 문자열이 자연어 그대로 서버에 도달하는
  // 시나리오를 시뮬레이션한다.
  const exampleQuery = '제품별 실제원가 TOP 5';   // 실제 index.html chip 문자열
  const sql = `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 `
            + `WHERE ZCGUBUN = '실제원가' GROUP BY MATERIAL ORDER BY 2 DESC LIMIT 5`;
  const r = ensureCalmonthFilter(sql, LATEST, exampleQuery);
  assert(r.injected === true, '예시질문 경로에서도 게이트 발동');
  assert(r.sql.includes("CALMONTH = '202608'"), `CALMONTH = '202608' 주입 (예시질문도 동일)`);
  assert(r.sql.includes('LIMIT 5'), 'LIMIT 5 유지');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 5: 부서별원가 (cot043) 기간 없음 -> 자동 주입');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT COSTCENTER, MAX(COSTCENTER_NM), SUM(AMOUNT) FROM sys_aimd_cot043 `
            + `WHERE DIVISION = '20' GROUP BY COSTCENTER`;
  const r = ensureCalmonthFilter(sql, LATEST, '부서별 원가');
  assert(r.injected === true, '주입 발생');
  assert(r.sql.includes("CALMONTH = '202608'"), `CALMONTH = '202608' 주입`);
  assert(r.sql.includes("DIVISION = '20'"), '기존 DIVISION 유지');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 6: 호기별원가 (cot043, COSTCENTER IN 필터 있음) -> 자동 주입');
// ══════════════════════════════════════════════════════════════════════════
{
  // applyForcedTableFilter 가 호기 COSTCENTER IN(...) 를 이미 주입한 상태
  const sql = `SELECT COSTCENTER, SUM(AMOUNT) FROM sys_aimd_cot043 `
            + `WHERE COSTCENTER IN ('MC01','MC02','MC03') GROUP BY COSTCENTER`;
  const r = ensureCalmonthFilter(sql, LATEST, '호기별 원가');
  assert(r.injected === true, '주입 발생');
  assert(r.sql.includes("CALMONTH = '202608'"), 'CALMONTH 주입');
  assert(r.sql.includes("COSTCENTER IN ('MC01','MC02','MC03')"), '호기 COSTCENTER IN 유지');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 7: "전체 기간" 명시 -> skip (사용자 의도 존중)');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 `
            + `WHERE ZCGUBUN = '실제원가' GROUP BY MATERIAL ORDER BY 2 DESC LIMIT 5`;
  const r = ensureCalmonthFilter(sql, LATEST, '전체 기간 제품별 실제원가 TOP 5');
  assert(r.injected === false, '주입 안 됨');
  assert(r.skipReason === 'explicit_all_period', 'skipReason=explicit_all_period');
  assert(r.sql === sql, 'SQL 무변경 (사용자 의도 존중)');
  assert(!r.sql.includes('CALMONTH'), 'CALMONTH 조건 없음');

  // "전 기간" (공백 포함)
  const r2 = ensureCalmonthFilter(sql, LATEST, '전 기간 제품별 실제원가 TOP 5');
  assert(r2.skipReason === 'explicit_all_period', '"전 기간" 도 예외 처리');

  // "전기간" (붙여쓰기)
  const r3 = ensureCalmonthFilter(sql, LATEST, '전기간 제품별 실제원가 TOP 5');
  assert(r3.skipReason === 'explicit_all_period', '"전기간" (붙여쓰기) 도 예외 처리');

  // "모든 기간"
  const r4 = ensureCalmonthFilter(sql, LATEST, '모든 기간 제품별 실제원가');
  assert(r4.skipReason === 'explicit_all_period', '"모든 기간" 도 예외 처리');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 8: 수익성분석 (bw_profitability_data) 기간 없음 -> 자동 주입');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT MATERIAL, SUM(ZAMT001) FROM bw_profitability_data `
            + `WHERE DIVISION = '10' GROUP BY MATERIAL LIMIT 10`;
  const r = ensureCalmonthFilter(sql, LATEST, '제품별 매출');
  assert(r.injected === true, '수익성분석 SQL 도 게이트 발동 (backward compat)');
  assert(r.sql.includes("CALMONTH = '202608'"), 'CALMONTH 주입');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 9: whitelist 밖 테이블 -> no-op');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT * FROM users WHERE role = 'admin'`;
  const r = ensureCalmonthFilter(sql, LATEST, '관리자 목록');
  assert(r.injected === false, '주입 안 됨');
  assert(r.skipReason === 'not_target_table', 'skipReason=not_target_table');
  assert(r.sql === sql, 'SQL 무변경');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 10: 다양한 CALMONTH 형태에서 skip');
// ══════════════════════════════════════════════════════════════════════════
{
  // BETWEEN
  const sqlBetween = `SELECT * FROM sys_aimd_cot015 WHERE CALMONTH BETWEEN '202601' AND '202606'`;
  const rBet = ensureCalmonthFilter(sqlBetween, LATEST, '상반기');
  assert(rBet.injected === false && rBet.skipReason === 'already_has_calmonth',
    'BETWEEN 형태 -> skip');

  // IN
  const sqlIn = `SELECT * FROM sys_aimd_cot015 WHERE CALMONTH IN ('202601','202603','202605')`;
  const rIn = ensureCalmonthFilter(sqlIn, LATEST, '');
  assert(rIn.injected === false && rIn.skipReason === 'already_has_calmonth',
    'IN 형태 -> skip');

  // LIKE 'YYYY%'
  const sqlLike = `SELECT * FROM sys_aimd_cot015 WHERE CALMONTH LIKE '2026%'`;
  const rLk = ensureCalmonthFilter(sqlLike, LATEST, '');
  assert(rLk.injected === false && rLk.skipReason === 'already_has_calmonth',
    `LIKE 'YYYY%' 형태 -> skip`);

  // LEFT(CALMONTH,4)='YYYY'
  const sqlLeft = `SELECT * FROM sys_aimd_cot015 WHERE LEFT(CALMONTH,4)='2026'`;
  const rLeft = ensureCalmonthFilter(sqlLeft, LATEST, '');
  assert(rLeft.injected === false && rLeft.skipReason === 'already_has_calmonth',
    `LEFT(CALMONTH,4)='YYYY' 형태 -> skip`);

  // >= AND <= 조합
  const sqlRange = `SELECT * FROM sys_aimd_cot015 WHERE CALMONTH >= '202601' AND CALMONTH <= '202608'`;
  const rRange = ensureCalmonthFilter(sqlRange, LATEST, '');
  assert(rRange.injected === false && rRange.skipReason === 'already_has_calmonth',
    '>= AND <= 조합 -> skip');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 11: CALYEAR 조건이 있으면 skip');
// ══════════════════════════════════════════════════════════════════════════
{
  // CALYEAR = 2026 (숫자)
  const sql1 = `SELECT * FROM sys_aimd_cot015 WHERE CALYEAR = 2026`;
  const r1 = ensureCalmonthFilter(sql1, LATEST, '2026년 원가');
  assert(r1.injected === false && r1.skipReason === 'has_calyear', 'CALYEAR = 2026 -> skip');

  // CALYEAR = '2026' (문자열)
  const sql2 = `SELECT * FROM sys_aimd_cot015 WHERE CALYEAR = '2026'`;
  const r2 = ensureCalmonthFilter(sql2, LATEST, '2026년 원가');
  assert(r2.injected === false && r2.skipReason === 'has_calyear', `CALYEAR = '2026' -> skip`);

  // CALYEAR IN (2025, 2026)
  const sql3 = `SELECT * FROM sys_aimd_cot015 WHERE CALYEAR IN (2025, 2026)`;
  const r3 = ensureCalmonthFilter(sql3, LATEST, '');
  assert(r3.injected === false && r3.skipReason === 'has_calyear', 'CALYEAR IN (...) -> skip');

  // CALYEAR BETWEEN 2024 AND 2026
  const sql4 = `SELECT * FROM sys_aimd_cot015 WHERE CALYEAR BETWEEN 2024 AND 2026`;
  const r4 = ensureCalmonthFilter(sql4, LATEST, '');
  assert(r4.injected === false && r4.skipReason === 'has_calyear', 'CALYEAR BETWEEN -> skip');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 12: WHERE 없는 SQL 에 신규 WHERE 생성');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL`;
  const r = ensureCalmonthFilter(sql, LATEST, '제품별 원가');
  assert(r.injected === true, '주입 발생');
  assert(/FROM\s+sys_aimd_cot015\s+WHERE\s+CALMONTH\s*=\s*'202608'\s+GROUP\s+BY/i.test(r.sql),
    'FROM ... WHERE CALMONTH=... GROUP BY ... 형태로 정상 삽입');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 13: 테이블 별칭 사용 시 지원');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT c.MATERIAL, SUM(c.TOTAL) FROM sys_aimd_cot015 c `
            + `WHERE c.DIVISION = '10' GROUP BY c.MATERIAL`;
  const r = ensureCalmonthFilter(sql, LATEST, '제품별 원가');
  assert(r.injected === true, '별칭 있는 SQL 에도 주입 발생');
  assert(r.sql.includes("CALMONTH = '202608'"), 'CALMONTH 주입');
  assert(r.sql.includes("c.DIVISION = '10'"), '별칭 조건 유지');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 14: 문자열 리터럴 안의 괄호 오탐 방지');
// ══════════════════════════════════════════════════════════════════════════
{
  // REPLACE(MATERIAL_NM, ' ', '') 같은 함수 호출 안의 ')' 가 WHERE 종료로
  // 오인되지 않아야 함 (applyDomainFilter 와 동일 안전 스캔 정책)
  const sql = `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 `
            + `WHERE REPLACE(MATERIAL_NM, ' ', '') LIKE '%test%' GROUP BY MATERIAL`;
  const r = ensureCalmonthFilter(sql, LATEST, '테스트');
  assert(r.injected === true, '주입 발생');
  assert(r.sql.includes("CALMONTH = '202608'"), 'CALMONTH 주입');
  assert(r.sql.includes("REPLACE(MATERIAL_NM, ' ', '')"), 'REPLACE 함수 호출 유지');
  // 함수 호출 안의 ')' 가 WHERE 종료로 오인되지 않아야 함
  assert(/WHERE\s+CALMONTH\s*=\s*'202608'\s+AND\s+\(REPLACE/.test(r.sql),
    'WHERE 절 안에 정상 삽입');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 15: GROUP BY / ORDER BY / LIMIT 조합 안전 삽입');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT MATERIAL AS '제품', SUM(TOTAL) AS '합계' FROM sys_aimd_cot015 `
            + `WHERE ZCGUBUN = '실제원가' GROUP BY MATERIAL ORDER BY SUM(TOTAL) DESC LIMIT 10`;
  const r = ensureCalmonthFilter(sql, LATEST, '실제원가 TOP 10');
  assert(r.injected === true, '주입 발생');
  assert(r.sql.includes("ORDER BY SUM(TOTAL) DESC"), 'ORDER BY 유지');
  assert(r.sql.includes("LIMIT 10"), 'LIMIT 10 유지');
  assert(r.sql.includes("GROUP BY MATERIAL"), 'GROUP BY 유지');
  // WHERE 절 종료가 GROUP BY 앞에서 정확히 인식되어야 함
  assert(/WHERE\s+CALMONTH\s*=\s*'202608'\s+AND\s+\(ZCGUBUN\s*=\s*'실제원가'\)\s+GROUP\s+BY/.test(r.sql),
    'CALMONTH AND (기존조건) GROUP BY 순서로 정상 배치');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 16: latestMonth 누락 시 안전하게 원본 반환');
// ══════════════════════════════════════════════════════════════════════════
{
  const sql = `SELECT * FROM sys_aimd_cot015 WHERE DIVISION = '10'`;
  // 빈 문자열
  const r1 = ensureCalmonthFilter(sql, '', '테스트');
  assert(r1.injected === false && r1.skipReason === 'no_latest_month',
    `latestMonth='' -> skip (no_latest_month)`);
  assert(r1.sql === sql, 'SQL 무변경');

  // null
  const r2 = ensureCalmonthFilter(sql, null, '테스트');
  assert(r2.injected === false && r2.skipReason === 'no_latest_month',
    `latestMonth=null -> skip`);

  // 잘못된 형식 (5자리)
  const r3 = ensureCalmonthFilter(sql, '20268', '테스트');
  assert(r3.injected === false && r3.skipReason === 'no_latest_month',
    'latestMonth=20268 (5자리) -> skip');

  // undefined
  const r4 = ensureCalmonthFilter(sql, undefined, '테스트');
  assert(r4.injected === false && r4.skipReason === 'no_latest_month',
    'latestMonth=undefined -> skip');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 17: 전체 기간 예외 다양한 표현 boundary');
// ══════════════════════════════════════════════════════════════════════════
{
  const cases = [
    ['전체 기간', true, '전체 기간'],
    ['전 기간', true, '전 기간'],
    ['전기간', true, '전기간 (붙여쓰기)'],
    ['모든 기간', true, '모든 기간'],
    ['모든기간', true, '모든기간 (붙여쓰기)'],
    ['전체 연도', true, '전체 연도'],
    ['연도 전체', true, '연도 전체'],
    ['전 연도', true, '전 연도'],
    ['모든 연도', true, '모든 연도'],
    ['누적', true, '누적'],
    ['누계', true, '누계'],
    ['역대', true, '역대'],
    ['전체 데이터', true, '전체 데이터'],
    ['모든 데이터', true, '모든 데이터'],
    // 비매칭 케이스 (긍정 오탐 방지)
    ['제품별 전체 원가', false, '"전체 원가" 는 매칭 안 됨'],
    ['전체 제품별 원가', false, '"전체 제품별" 은 매칭 안 됨 (기간/연도/데이터 결합 아님)'],
    ['2026년 전체 실제원가', false, '"2026년 전체" 는 매칭 안 됨'],
  ];
  cases.forEach(([q, expected, label]) => {
    const got = hasExplicitAllPeriodIntent(q);
    assert(got === expected, `"${label}" -> hasExplicitAllPeriodIntent=${expected}`);
  });
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 18: 이미 CALMONTH 있는데 "전체 기간" 표현도 있음 -> skip (우선순위)');
// ══════════════════════════════════════════════════════════════════════════
{
  // 우선순위: already_has_calmonth 가 explicit_all_period 보다 먼저 걸림
  const sql = `SELECT * FROM sys_aimd_cot015 WHERE CALMONTH = '202607'`;
  const r = ensureCalmonthFilter(sql, LATEST, '전체 기간 조회');
  assert(r.injected === false, '주입 안 됨');
  assert(r.skipReason === 'already_has_calmonth',
    'skipReason=already_has_calmonth (already_has_calmonth 가 우선 걸림)');
  assert(r.sql === sql, 'SQL 무변경');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 19: 사용자 재현 시나리오 완전 재현');
// ══════════════════════════════════════════════════════════════════════════
{
  // 사용자 신고 SQL 을 그대로 재현
  const problematicSql = `SELECT
    MATERIAL AS '제품코드',
    MAX(MATERIAL_NM) AS '제품명',
    SUM(TOTAL) AS '실제원가 합계(원)'
FROM sys_aimd_cot015
WHERE DIVISION = '10'
  AND ZCGUBUN = '실제원가'
GROUP BY MATERIAL
ORDER BY SUM(TOTAL) DESC
LIMIT 5`;
  const r = ensureCalmonthFilter(problematicSql, '202608', '제품별 실제원가 TOP 5');
  assert(r.injected === true, '문제 SQL 에 CALMONTH 자동 주입');

  // Expected SQL 의 핵심 조건들이 모두 있어야 함
  assert(r.sql.includes("CALMONTH = '202608'"), `Expected: CALMONTH = '202608' ✓`);
  assert(r.sql.includes("DIVISION = '10'"), `Expected: DIVISION = '10' ✓`);
  assert(r.sql.includes("ZCGUBUN = '실제원가'"), `Expected: ZCGUBUN = '실제원가' ✓`);
  assert(r.sql.includes("GROUP BY MATERIAL"), 'GROUP BY MATERIAL 유지');
  assert(r.sql.includes("ORDER BY SUM(TOTAL) DESC"), 'ORDER BY 유지');
  assert(r.sql.includes("LIMIT 5"), 'LIMIT 5 유지');
  console.log('\n  [INFO] 사용자 신고 SQL 자동 정정 결과:');
  console.log(r.sql.replace(/^/gm, '    '));
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 20: 하드코딩 방지 — latestMonth 만 바꾸면 SQL 도 함께 변경');
// ══════════════════════════════════════════════════════════════════════════
{
  // "202608 을 하드코딩하지 말라" 요구사항 검증
  const sql = `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL`;

  const r1 = ensureCalmonthFilter(sql, '202608', '제품별 원가');
  assert(r1.sql.includes("CALMONTH = '202608'"), `latestMonth=202608 -> CALMONTH = '202608'`);

  const r2 = ensureCalmonthFilter(sql, '202609', '제품별 원가');
  assert(r2.sql.includes("CALMONTH = '202609'"), `latestMonth=202609 -> CALMONTH = '202609' (자동 변경)`);

  const r3 = ensureCalmonthFilter(sql, '202512', '제품별 원가');
  assert(r3.sql.includes("CALMONTH = '202512'"), `latestMonth=202512 -> CALMONTH = '202512'`);

  // 어느 케이스든 입력 latestMonth 에 따라 조건 값이 정확히 대응
  assert(!r1.sql.includes("'202609'") && !r2.sql.includes("'202608'"),
    '입력 latestMonth 에 따라 조건 값이 정확히 대응 (하드코딩 아님)');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 21: sqlHasCalmonthCondition 단위 검증');
// ══════════════════════════════════════════════════════════════════════════
{
  assert(sqlHasCalmonthCondition("WHERE CALMONTH = '202608'") === true, '= 형태');
  assert(sqlHasCalmonthCondition("WHERE CALMONTH BETWEEN '202601' AND '202606'") === true, 'BETWEEN 형태');
  assert(sqlHasCalmonthCondition("WHERE CALMONTH IN ('202601','202602')") === true, 'IN 형태');
  assert(sqlHasCalmonthCondition("WHERE CALMONTH LIKE '2026%'") === true, 'LIKE 형태');
  assert(sqlHasCalmonthCondition("WHERE LEFT(CALMONTH,4)='2026'") === true, 'LEFT 형태');
  assert(sqlHasCalmonthCondition("WHERE CALMONTH >= '202601' AND CALMONTH <= '202608'") === true, '>= AND <= 형태');
  assert(sqlHasCalmonthCondition("WHERE DIVISION = '10'") === false, 'CALMONTH 없음');
  assert(sqlHasCalmonthCondition("") === false, '빈 문자열');
  assert(sqlHasCalmonthCondition(null) === false, 'null');
  assert(sqlHasCalmonthCondition(undefined) === false, 'undefined');
}

// ══════════════════════════════════════════════════════════════════════════
section('Case 22: 상수/정규식 모듈 export 확인');
// ══════════════════════════════════════════════════════════════════════════
{
  assert(DIVISION_ENABLED_TABLES_RE instanceof RegExp, 'DIVISION_ENABLED_TABLES_RE 는 RegExp');
  assert(DIVISION_ENABLED_TABLES_RE.test('bw_profitability_data'), 'bw_profitability_data 매칭');
  assert(DIVISION_ENABLED_TABLES_RE.test('sys_aimd_cot015'), 'sys_aimd_cot015 매칭');
  assert(DIVISION_ENABLED_TABLES_RE.test('sys_aimd_cot043'), 'sys_aimd_cot043 매칭');
  assert(!DIVISION_ENABLED_TABLES_RE.test('users'), 'users 는 비매칭');

  assert(ALL_PERIOD_INTENT_RE instanceof RegExp, 'ALL_PERIOD_INTENT_RE 는 RegExp');
  assert(ALL_PERIOD_INTENT_RE.test('전체 기간'), '"전체 기간" 매칭');
  assert(!ALL_PERIOD_INTENT_RE.test('제품별 원가'), '"제품별 원가" 비매칭');
}

// ══════════════════════════════════════════════════════════════════════════
section('결과 요약');
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
if (failCount > 0) process.exit(1);
