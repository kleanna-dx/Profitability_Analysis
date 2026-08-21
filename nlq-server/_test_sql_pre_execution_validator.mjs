// ============================================================
// Regression Test: validateSqlPreExecution (BUG A 수정 검증)
// ------------------------------------------------------------
// 배경:
//   - 기존 validateSqlPreExecution 은 multi-CTE SQL 의 WHERE 범위를
//     오검출하여 정상 SQL 을 "WHERE 안 SUM" 이라고 오탐 (BUG A).
//   - 이 테스트는 (1) 실제 사용자가 보고한 실패 SQL, (2) 진짜 WHERE 내 SUM,
//     (3) CTE 내부/서브쿼리 안 SUM 등을 커버하여 회귀를 방지.
//
// 실행:
//   node nlq-server/_test_sql_pre_execution_validator.mjs
// ============================================================

import { validateSqlPreExecution } from './lib/sqlPreExecutionValidator.mjs';

let passed = 0, failed = 0;
const failures = [];

function test(label, sql, expectedValid, expectedReasonSubstr) {
  const got = validateSqlPreExecution(sql);
  const okValid = got.valid === expectedValid;
  const okReason = !expectedReasonSubstr
    || (got.reason && got.reason.includes(expectedReasonSubstr));
  if (okValid && okReason) {
    passed++;
    console.log(`  ✅ PASS: ${label}`);
  } else {
    failed++;
    failures.push({ label, sql: sql.slice(0, 120), expected: { valid: expectedValid, reason: expectedReasonSubstr }, got });
    console.log(`  ❌ FAIL: ${label}`);
    console.log(`     expected: valid=${expectedValid}${expectedReasonSubstr ? `, reason ~ "${expectedReasonSubstr}"` : ''}`);
    console.log(`     got:      valid=${got.valid}${got.reason ? `, reason="${got.reason}"` : ''}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Group 1: BUG A 회귀 방지 — multi-CTE 정상 SQL 은 반드시 통과해야 함
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[Group 1] BUG A 회귀 방지 — multi-CTE 정상 SQL 통과');

// 사용자가 보고한 실제 실패 SQL (2026-08-21 로그)
test(
  '1-1) 사용자 실제 실패 SQL: 4-CTE + UNION ALL + 후속 CTE SELECT 안 SUM',
  `WITH product_keywords AS (SELECT '키친타월' AS keyword UNION ALL SELECT '원단' AS keyword UNION ALL SELECT '미용티슈' AS keyword UNION ALL SELECT '두루마리' AS keyword),
   filtered_data AS (
     SELECT d.CALMONTH, d.ZAMT001 FROM bw_profitability_data d
     WHERE d.CALMONTH BETWEEN '202605' AND '202606'
       AND EXISTS (SELECT 1 FROM product_keywords pk WHERE REPLACE(d.MATERIAL_NM, ' ', '') LIKE CONCAT('%', pk.keyword, '%'))
   ),
   monthly_sales AS (SELECT CALMONTH, SUM(ZAMT001) AS total_sales FROM filtered_data GROUP BY CALMONTH),
   result_data AS (
     SELECT 1 AS sort_order, CALMONTH AS period_label, total_sales FROM monthly_sales
     UNION ALL
     SELECT 2 AS sort_order, '합계' AS period_label, SUM(total_sales) AS total_sales FROM monthly_sales
   )
   SELECT period_label, total_sales FROM result_data ORDER BY sort_order`,
  true
);

test(
  '1-2) 단순 CTE: WITH t AS (SELECT ...) SELECT SUM(x) FROM t',
  `WITH t AS (SELECT x FROM tbl WHERE d BETWEEN '202601' AND '202603')
   SELECT SUM(x) AS total FROM t`,
  true
);

test(
  '1-3) 2-CTE: 첫 CTE WHERE + 둘째 CTE SELECT 안 SUM (사용자 케이스 축약)',
  `WITH a AS (SELECT x, d FROM tbl WHERE d = '202601'),
   b AS (SELECT SUM(x) AS s FROM a)
   SELECT s FROM b`,
  true
);

test(
  '1-4) CTE + UNION ALL 안 SUM (합계 행 패턴)',
  `WITH monthly AS (SELECT d, SUM(x) AS s FROM tbl GROUP BY d)
   SELECT d, s FROM monthly
   UNION ALL
   SELECT '합계', SUM(s) FROM monthly`,
  true
);

test(
  '1-5) RECURSIVE CTE',
  `WITH RECURSIVE nums AS (
     SELECT 1 AS n
     UNION ALL
     SELECT n + 1 FROM nums WHERE n < 10
   )
   SELECT SUM(n) FROM nums`,
  true
);

// ═══════════════════════════════════════════════════════════════════════
// Group 2: 진짜 WHERE 내 집계함수 — 여전히 차단되어야 함
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[Group 2] 진짜 WHERE 내 집계함수 — 차단');

test(
  '2-1) WHERE SUM(x) > 100 (직접)',
  `SELECT dept FROM emp WHERE SUM(salary) > 100 GROUP BY dept`,
  false,
  'WHERE 절에 집계함수 SUM'
);

test(
  '2-2) WHERE AVG(x) > 100',
  `SELECT dept FROM emp WHERE AVG(salary) > 100`,
  false,
  'WHERE 절에 집계함수 AVG'
);

test(
  '2-3) WHERE COUNT(*) > 5',
  `SELECT dept FROM emp WHERE COUNT(*) > 5`,
  false,
  'WHERE 절에 집계함수 COUNT'
);

test(
  '2-4) CTE 내부 SELECT 의 WHERE 안에 SUM',
  `WITH a AS (SELECT x FROM tbl WHERE SUM(y) > 10) SELECT * FROM a`,
  false,
  'WHERE 절에 집계함수 SUM'
);

// ═══════════════════════════════════════════════════════════════════════
// Group 3: WHERE 안 서브쿼리 안 집계함수 — 정상 (통과)
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[Group 3] WHERE 안 서브쿼리 안 집계함수 — 정상 통과');

test(
  '3-1) WHERE x > (SELECT AVG(y) FROM t)',
  `SELECT * FROM emp WHERE salary > (SELECT AVG(salary) FROM emp)`,
  true
);

test(
  '3-2) WHERE EXISTS (SELECT SUM(...) ...)',
  `SELECT * FROM tbl d WHERE EXISTS (SELECT 1 FROM other o WHERE o.k = d.k HAVING SUM(o.v) > 0)`,
  true
);

test(
  '3-3) WHERE x IN (SELECT SUM(y) FROM t GROUP BY z)',
  `SELECT * FROM tbl WHERE x IN (SELECT SUM(y) FROM t GROUP BY z)`,
  true
);

// ═══════════════════════════════════════════════════════════════════════
// Group 4: GROUP BY 없이 집계 + 일반 컬럼 혼용 — 차단 (기존 정책 유지)
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[Group 4] GROUP BY 없이 집계 + 일반 컬럼 혼용 — 차단');

test(
  '4-1) SELECT name, SUM(x) FROM t (GROUP BY 없음)',
  `SELECT name, SUM(x) AS s FROM tbl`,
  false,
  '집계함수와 일반 컬럼'
);

test(
  '4-2) SELECT name, SUM(x) FROM t GROUP BY name (정상)',
  `SELECT name, SUM(x) AS s FROM tbl GROUP BY name`,
  true
);

test(
  '4-3) SELECT SUM(x), SUM(y) FROM t (단일 행 집계, 정상)',
  `SELECT SUM(x) AS a, SUM(y) AS b FROM tbl`,
  true
);

// ═══════════════════════════════════════════════════════════════════════
// Group 5: 정상 SQL 패턴 — 통과
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[Group 5] 정상 SQL 패턴 — 통과');

test(
  '5-1) 단순 SELECT',
  `SELECT * FROM tbl WHERE d = '202601'`,
  true
);

test(
  '5-2) HAVING 안 SUM',
  `SELECT dept, SUM(x) FROM tbl GROUP BY dept HAVING SUM(x) > 100`,
  true
);

test(
  '5-3) JOIN + WHERE',
  `SELECT a.x, b.y FROM t1 a JOIN t2 b ON a.k = b.k WHERE a.d = '202601'`,
  true
);

test(
  '5-4) SUBQUERY IN FROM',
  `SELECT s FROM (SELECT SUM(x) AS s FROM tbl) sub`,
  true
);

// ═══════════════════════════════════════════════════════════════════════
// Group 6: 엣지 케이스
// ═══════════════════════════════════════════════════════════════════════
console.log('\n[Group 6] 엣지 케이스');

test(
  '6-1) 빈 SQL',
  '',
  false,
  '비어있'
);

test(
  '6-2) null',
  null,
  false,
  '비어있'
);

test(
  '6-3) 컬럼명에 SUM 문자열 포함 (SUMMARY 같은 컬럼) — 통과되어야',
  `SELECT summary_col FROM tbl WHERE summary_col IS NOT NULL`,
  true
);

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════════════════════════════════`);
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
console.log(`═══════════════════════════════════════════════════════════════════════`);

if (failed > 0) {
  console.log('\n❌ FAILURES:');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
    console.log(`      sql: ${f.sql.replace(/\s+/g, ' ')}...`);
    console.log(`      expected: ${JSON.stringify(f.expected)}`);
    console.log(`      got:      ${JSON.stringify(f.got)}`);
  }
  process.exit(1);
} else {
  console.log(`\n✅ ALL TESTS PASSED`);
  process.exit(0);
}
