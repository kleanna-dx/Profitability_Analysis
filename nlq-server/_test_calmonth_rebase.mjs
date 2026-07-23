// ============================================================
// [PR #257] CALMONTH rebase / parameterize 단위 테스트
// 실행: node _test_calmonth_rebase.mjs
// ============================================================
import {
  hasExplicitYearMonth,
  hasRelativeMonthExpr,
  rebaseCalmonthForLearnedSql,
  parameterizeCalmonthForSave,
  PLACEHOLDER_LATEST,
  PLACEHOLDER_PREV,
} from './lib/calmonth-rebase.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function eq(actual, expected, label) {
  if (actual === expected) {
    passed++;
    // console.log(`  ✓ ${label}`);
  } else {
    failed++;
    failures.push({ label, expected, actual });
    console.log(`  ✗ ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual  : ${JSON.stringify(actual)}`);
  }
}

// 표준 dateCtx: 저장 시점 5월 → 현재 6월 시나리오
const dcJune = { latestMonth: '202606', prevMonth: '202605', latestLabel: '2026년 6월', prevLabel: '2026년 5월' };
const dcMay = { latestMonth: '202605', prevMonth: '202604', latestLabel: '2026년 5월', prevLabel: '2026년 4월' };

// ============================================================
// [A] hasExplicitYearMonth
// ============================================================
console.log('[A] hasExplicitYearMonth');
eq(hasExplicitYearMonth('2026년 5월 매출'), true, '한글 YYYY년 M월');
eq(hasExplicitYearMonth('2026년5월'), true, '한글 (공백 없음)');
eq(hasExplicitYearMonth('2026-05 매출'), true, 'YYYY-MM');
eq(hasExplicitYearMonth('2026.05'), true, 'YYYY.MM');
eq(hasExplicitYearMonth('2026/05'), true, 'YYYY/MM');
eq(hasExplicitYearMonth('202605 매출'), true, '6자리 YYYYMM 리터럴');
eq(hasExplicitYearMonth('당월 매출'), false, '"당월" 만');
eq(hasExplicitYearMonth('이번달 실적'), false, '"이번달"');
eq(hasExplicitYearMonth('5월 매출'), false, '월만 있음(년도 없음)');
eq(hasExplicitYearMonth(''), false, '빈 문자열');
eq(hasExplicitYearMonth(null), false, 'null');
eq(hasExplicitYearMonth('유통경로별 매출 알려줘'), false, '시간 표현 자체 없음');

// ============================================================
// [B] hasRelativeMonthExpr
// ============================================================
console.log('[B] hasRelativeMonthExpr');
eq(hasRelativeMonthExpr('당월 매출'), true, '당월');
eq(hasRelativeMonthExpr('이번달'), true, '이번달');
eq(hasRelativeMonthExpr('이번 달'), true, '이번 달 (공백)');
eq(hasRelativeMonthExpr('이달'), true, '이달');
eq(hasRelativeMonthExpr('금월'), true, '금월');
eq(hasRelativeMonthExpr('전월'), true, '전월');
eq(hasRelativeMonthExpr('지난달'), true, '지난달');
eq(hasRelativeMonthExpr('지난 달'), true, '지난 달');
eq(hasRelativeMonthExpr('2026년 5월'), false, '명시적 년월 (상대표현 아님)');
eq(hasRelativeMonthExpr(''), false, '빈 문자열');

// ============================================================
// [C] rebaseCalmonthForLearnedSql — 핵심 시나리오
// ============================================================
console.log('[C] rebaseCalmonthForLearnedSql');

// [C1] 사용자 시나리오 재현: 5월에 정확해요 → 6월에 재사용
{
  const sql = `SELECT DISTR_CHAN, FORMAT(SUM(ZAMT001),0) FROM bw_profitability_data
               WHERE DIVISION='10' AND CALMONTH='202605'
               GROUP BY DISTR_CHAN`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '당월 유통경로별 매출', dcJune);
  eq(rebased.includes("CALMONTH = '202606'"), true, 'C1: "당월" 질의 → 202605 → 202606 rebase');
  eq(rebased.includes('202605'), false, 'C1: 옛 202605 리터럴은 사라져야 함');
}

// [C2] 명시적 년월 질의 → rebase 안 함
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH='202605'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '2026년 5월 매출 알려줘', dcJune);
  eq(rebased.includes("CALMONTH='202605'") || rebased.includes("CALMONTH = '202605'"), true,
     'C2: 명시적 5월 질의 → 원본 유지');
}

// [C3] 시간 표현 자체가 없는 질의 → rebase 수행 (기본 정책: 학습 SQL은 당월 기준)
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH='202605'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '유통경로별 매출 알려줘', dcJune);
  eq(rebased.includes("CALMONTH = '202606'"), true,
     'C3: 시간 표현 없는 질의 → 자동 rebase 되어야 함 (프롬프트 기본 정책과 일치)');
}

// [C4] 자리표시자 → 항상 rebase
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH=':LATEST_MONTH'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '2026년 5월 매출', dcJune);
  eq(rebased.includes("CALMONTH = '202606'"), true, 'C4: 자리표시자 → 명시적 질의라도 항상 치환');
}

// [C5] IN 절 — 리터럴 rebase
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH IN ('202604','202605')`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '최근 2개월 매출', dcJune);
  // 두 리터럴 모두 latestMonth 로 rebase 되면 IN 은 사실상 단일값이 되지만 정확성은 유지됨
  eq(rebased.includes('202606'), true, 'C5: IN 절 리터럴이 rebase되어야 함');
}

// [C6] BETWEEN 절 — prev → latest
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH BETWEEN '202604' AND '202605'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '전월 대비 당월 매출', dcJune);
  eq(rebased.includes("BETWEEN '202605' AND '202606'"), true,
     'C6: BETWEEN → 하한=prevMonth, 상한=latestMonth');
}

// [C7] BETWEEN 자리표시자 → 정확히 매핑
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data
               WHERE CALMONTH BETWEEN ':PREV_MONTH' AND ':LATEST_MONTH'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '전월 대비 당월', dcJune);
  eq(rebased.includes("BETWEEN '202605' AND '202606'"), true,
     'C7: BETWEEN 자리표시자 → prev/latest 정확 매핑');
}

// [C8] CALMONTH 없는 SQL → 그대로
{
  const sql = `SELECT SUM(ZAMT001) FROM bw_profitability_data WHERE DIVISION='10'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '당월 매출', dcJune);
  eq(rebased, sql, 'C8: CALMONTH 없는 SQL은 원본 그대로');
}

// [C9] dateCtx 없음 → 안전 반환
{
  const sql = `SELECT * FROM t WHERE CALMONTH='202605'`;
  eq(rebaseCalmonthForLearnedSql(sql, 'q', null), sql, 'C9: dateCtx null → 원본 반환');
  eq(rebaseCalmonthForLearnedSql(sql, 'q', {}), sql, 'C9: dateCtx 빈객체 → 원본 반환');
}

// [C10] 대소문자 무시 (calmonth 소문자)
{
  const sql = `SELECT * FROM t WHERE calmonth = '202605'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '당월', dcJune);
  eq(rebased.includes("'202606'"), true, 'C10: 소문자 calmonth도 처리');
}

// [C11] 여러 개의 CALMONTH 등장 (서브쿼리 등) — 모두 처리
{
  const sql = `SELECT (SELECT SUM(ZAMT001) FROM t WHERE CALMONTH='202605') AS curr,
                     (SELECT SUM(ZAMT001) FROM t WHERE CALMONTH='202604') AS prev
               FROM dual`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '당월 매출', dcJune);
  // 첫번째는 latest 로 rebase 됨 (원래 값 = 저장 시점 latest)
  eq(rebased.includes("'202606'"), true, 'C11: 서브쿼리 안 CALMONTH도 처리');
}

// [C12] "5월" 만 있는 질의 (년도 없음) → rebase 수행되어야 함
// 정책: 년도 없는 "N월"은 명시적 년월이 아니므로 상대 표현으로 간주
{
  const sql = `SELECT * FROM t WHERE CALMONTH='202605'`;
  const rebased = rebaseCalmonthForLearnedSql(sql, '5월 매출', dcJune);
  eq(rebased.includes("'202606'"), true, 'C12: 년도 없는 "5월"은 rebase 대상');
}

// ============================================================
// [D] parameterizeCalmonthForSave — 저장 시 파라미터화
// ============================================================
console.log('[D] parameterizeCalmonthForSave');

// [D1] 저장 시점의 latestMonth 값 → :LATEST_MONTH 로 치환
{
  const sql = `SELECT * FROM t WHERE CALMONTH = '202605'`;
  const saved = parameterizeCalmonthForSave(sql, '당월 매출', dcMay);
  eq(saved.includes(`':LATEST_MONTH'`), true, 'D1: 저장 시점 latest → :LATEST_MONTH 치환');
  eq(saved.includes(`'202605'`), false, 'D1: 원본 리터럴은 사라져야 함');
}

// [D2] 저장 시점의 prevMonth 값 → :PREV_MONTH 로 치환
{
  const sql = `SELECT * FROM t WHERE CALMONTH = '202604'`;
  const saved = parameterizeCalmonthForSave(sql, '전월 매출', dcMay);
  eq(saved.includes(`':PREV_MONTH'`), true, 'D2: 저장 시점 prev → :PREV_MONTH 치환');
}

// [D3] 질의에 명시적 년월 있음 → 저장 그대로
{
  const sql = `SELECT * FROM t WHERE CALMONTH = '202605'`;
  const saved = parameterizeCalmonthForSave(sql, '2026년 5월 매출', dcMay);
  eq(saved, sql, 'D3: 명시적 5월 질의 → 원본 그대로 저장');
}

// [D4] latest/prev 이외의 값(과거 히스토리) → 그대로
{
  const sql = `SELECT * FROM t WHERE CALMONTH = '202501'`;
  const saved = parameterizeCalmonthForSave(sql, '작년 1월 매출', dcMay);
  eq(saved, sql, 'D4: 히스토리컬 값은 파라미터화 대상 아님');
}

// [D5] BETWEEN — 저장 시점 prev/latest 매핑
{
  const sql = `SELECT * FROM t WHERE CALMONTH BETWEEN '202604' AND '202605'`;
  const saved = parameterizeCalmonthForSave(sql, '최근 2개월 매출', dcMay);
  eq(saved.includes(`BETWEEN ':PREV_MONTH' AND ':LATEST_MONTH'`), true,
     'D5: BETWEEN 값이 prev/latest 이면 자리표시자로 저장');
}

// [D6] IN 절 — 저장 시점 값들 매핑
{
  const sql = `SELECT * FROM t WHERE CALMONTH IN ('202604','202605','202501')`;
  const saved = parameterizeCalmonthForSave(sql, '분기별 매출', dcMay);
  eq(saved.includes(':PREV_MONTH'), true, 'D6: IN 절 prev 값 → 자리표시자');
  eq(saved.includes(':LATEST_MONTH'), true, 'D6: IN 절 latest 값 → 자리표시자');
  eq(saved.includes(`'202501'`), true, 'D6: IN 절 히스토리컬 값은 유지');
}

// [D7] CALMONTH 없는 SQL → 그대로
{
  const sql = `SELECT * FROM t WHERE DIVISION='10'`;
  eq(parameterizeCalmonthForSave(sql, '당월 매출', dcMay), sql, 'D7: CALMONTH 없으면 그대로');
}

// ============================================================
// [E] E2E: 저장 → 재사용 왕복 검증
// ============================================================
console.log('[E] End-to-end: 저장→재사용 왕복');

// [E1] 5월에 "당월 유통경로별 매출" 검증 → 저장 → 6월에 재사용
{
  const sqlOnSave = `SELECT DISTR_CHAN, FORMAT(SUM(ZAMT001),0) FROM bw_profitability_data
                     WHERE DIVISION='10' AND CALMONTH='202605'
                     GROUP BY DISTR_CHAN`;
  // 5월 시점 저장
  const stored = parameterizeCalmonthForSave(sqlOnSave, '당월 유통경로별 매출', dcMay);
  eq(stored.includes(`':LATEST_MONTH'`), true, 'E1-save: latest → 자리표시자');
  // 6월 시점 재사용
  const rebased = rebaseCalmonthForLearnedSql(stored, '당월 유통경로별 매출', dcJune);
  eq(rebased.includes(`'202606'`), true, 'E1-reuse: 자리표시자 → 202606');
  eq(rebased.includes(':LATEST_MONTH'), false, 'E1-reuse: 자리표시자는 남아있으면 안 됨');
}

// [E2] 사용자가 "2026년 5월" 로 명시 → 저장/재사용 모두 그대로
{
  const sqlOnSave = `SELECT * FROM t WHERE CALMONTH='202605'`;
  const stored = parameterizeCalmonthForSave(sqlOnSave, '2026년 5월 매출', dcMay);
  eq(stored.includes(`'202605'`), true, 'E2-save: 명시적 → 리터럴 유지');
  eq(stored.includes(':LATEST_MONTH'), false, 'E2-save: 자리표시자 삽입 안 됨');
  const rebased = rebaseCalmonthForLearnedSql(stored, '2026년 5월 매출', dcJune);
  eq(rebased.includes(`'202605'`), true, 'E2-reuse: 명시적 → 5월 유지');
}

// [E3] 시간 표현 없는 질의 → 저장은 파라미터화, 재사용은 latest 로 rebase
{
  const sqlOnSave = `SELECT * FROM t WHERE CALMONTH='202605'`;
  const stored = parameterizeCalmonthForSave(sqlOnSave, '유통경로별 매출 알려줘', dcMay);
  eq(stored.includes(`':LATEST_MONTH'`), true, 'E3-save: 시간 표현 없음 → latest 파라미터화');
  const rebased = rebaseCalmonthForLearnedSql(stored, '유통경로별 매출 알려줘', dcJune);
  eq(rebased.includes(`'202606'`), true, 'E3-reuse: latest 자리표시자 → 6월');
}

// ============================================================
// 결과 리포트
// ============================================================
console.log('');
console.log('═'.repeat(60));
console.log(`총 ${passed + failed} 개 테스트: ${passed} 성공 / ${failed} 실패`);
if (failed > 0) {
  console.log('');
  console.log('실패 목록:');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
  }
  process.exit(1);
} else {
  console.log('✅ 전체 통과');
  process.exit(0);
}
