// ============================================================
// SQL Read-only Validator 회귀 테스트
// ------------------------------------------------------------
// 사용자 요구사항 6번의 회귀 테스트 케이스 전체 실행:
//   허용: SELECT / WITH ... SELECT / WITH RECURSIVE ... SELECT
//   차단: UPDATE / DELETE / DROP / ALTER / CTE+UPDATE / CTE+DELETE
// 추가 edge case:
//   - INSERT / TRUNCATE / CREATE / REPLACE / RENAME / GRANT / REVOKE / CALL
//   - CTE + INSERT (파서 미지원 → fallback 이 차단해야 함)
//   - INSERT ... SELECT (root type=insert 이므로 차단)
//   - multi-statement (SELECT; DELETE)
//   - UNION / UNION ALL / GROUP BY / HAVING / WINDOW / CASE / 서브쿼리
//   - 실제 오류 케이스 재현: WITH filtered_data ...
// ============================================================

import { isReadOnlyQuery } from './lib/sqlReadOnlyValidator.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function assertAllow(label, sql) {
  const r = isReadOnlyQuery(sql);
  if (r.ok) {
    console.log(`  ✅ ALLOW  ${label}${r.parserFallback ? ' [fallback]' : ''}`);
    pass++;
  } else {
    console.log(`  ❌ ALLOW  ${label}\n     ↳ 잘못 차단됨: ${r.reason}`);
    failures.push({ label, expected: 'ALLOW', got: 'BLOCK', reason: r.reason });
    fail++;
  }
}

function assertBlock(label, sql) {
  const r = isReadOnlyQuery(sql);
  if (!r.ok) {
    console.log(`  ✅ BLOCK  ${label}\n     ↳ 사유: ${r.reason}`);
    pass++;
  } else {
    console.log(`  ❌ BLOCK  ${label}\n     ↳ 잘못 허용됨${r.parserFallback ? ' [fallback]' : ''}`);
    failures.push({ label, expected: 'BLOCK', got: 'ALLOW' });
    fail++;
  }
}

console.log('════════════════════════════════════════════════════════════════');
console.log('  Group 1: 사용자 요구사항 회귀 (허용 대상)');
console.log('════════════════════════════════════════════════════════════════');
assertAllow('plain SELECT', 'SELECT * FROM bw_profitability_data');
assertAllow(
  'WITH ... SELECT',
  `WITH t AS (SELECT * FROM bw_profitability_data) SELECT * FROM t`
);
assertAllow(
  'WITH RECURSIVE ... SELECT',
  `WITH RECURSIVE t AS (
      SELECT 1 AS n UNION ALL SELECT n+1 FROM t WHERE n < 5
    ) SELECT * FROM t`
);

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Group 2: 사용자 요구사항 회귀 (차단 대상)');
console.log('════════════════════════════════════════════════════════════════');
assertBlock('UPDATE', `UPDATE bw_profitability_data SET REVENUE_AMT = 0`);
assertBlock('DELETE', `DELETE FROM bw_profitability_data`);
assertBlock('DROP', `DROP TABLE bw_profitability_data`);
assertBlock('ALTER', `ALTER TABLE bw_profitability_data ADD COLUMN foo INT`);
assertBlock('CTE + UPDATE',
  `WITH t AS (SELECT id FROM bw_profitability_data)
   UPDATE bw_profitability_data SET REVENUE_AMT = 0 WHERE id IN (SELECT id FROM t)`
);
assertBlock('CTE + DELETE',
  `WITH t AS (SELECT id FROM bw_profitability_data)
   DELETE FROM bw_profitability_data WHERE id IN (SELECT id FROM t)`
);

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Group 3: 추가 차단 대상 (DDL/DML/DCL)');
console.log('════════════════════════════════════════════════════════════════');
assertBlock('INSERT', `INSERT INTO bw_profitability_data (id) VALUES (1)`);
assertBlock('INSERT ... SELECT', `INSERT INTO other SELECT * FROM bw_profitability_data`);
assertBlock('TRUNCATE', `TRUNCATE TABLE bw_profitability_data`);
assertBlock('CREATE', `CREATE TABLE foo (id INT)`);
assertBlock('REPLACE', `REPLACE INTO bw_profitability_data (id) VALUES (1)`);
assertBlock('RENAME', `RENAME TABLE bw_profitability_data TO bw_new`);
assertBlock('GRANT', `GRANT SELECT ON *.* TO 'foo'@'%'`);
// REVOKE / CTE+INSERT 는 파서가 실패 → fallback 이 반드시 차단해야 함
assertBlock('REVOKE (fallback)', `REVOKE SELECT ON *.* FROM 'foo'@'%'`);
assertBlock('CTE + INSERT (fallback)',
  `WITH t AS (SELECT id FROM bw_profitability_data)
   INSERT INTO other SELECT * FROM t`
);
assertBlock('multi stmt: SELECT ; DELETE',
  `SELECT * FROM bw_profitability_data; DELETE FROM bw_profitability_data`
);
assertBlock('SQL 주석으로 감추기 시도',
  `/* pretend read */ DELETE FROM bw_profitability_data`
);
assertBlock('세미콜론 여러 개 + 마지막 UPDATE',
  `SELECT 1 ;; UPDATE bw_profitability_data SET x=1`
);

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Group 4: 정상 조회 문법 통과 (UNION/서브쿼리/윈도우/CASE)');
console.log('════════════════════════════════════════════════════════════════');
assertAllow('UNION',
  `SELECT id FROM bw_profitability_data UNION SELECT id FROM bw_profitability_data`);
assertAllow('UNION ALL',
  `SELECT 1 UNION ALL SELECT 2`);
assertAllow('GROUP BY + HAVING',
  `SELECT PROFIT_CENTER_NM, SUM(REVENUE_AMT) FROM bw_profitability_data
   GROUP BY PROFIT_CENTER_NM HAVING SUM(REVENUE_AMT) > 0`);
assertAllow('WINDOW FUNCTION',
  `SELECT PROFIT_CENTER_NM,
          SUM(REVENUE_AMT) OVER (PARTITION BY PROFIT_CENTER_NM) AS s
   FROM bw_profitability_data`);
assertAllow('CASE WHEN',
  `SELECT CASE WHEN REVENUE_AMT > 0 THEN '흑' ELSE '적' END AS flag
   FROM bw_profitability_data`);
assertAllow('subquery in SELECT',
  `SELECT (SELECT SUM(REVENUE_AMT) FROM bw_profitability_data) AS total
   FROM DUAL`);
assertAllow('subquery in FROM',
  `SELECT * FROM (SELECT * FROM bw_profitability_data) sub`);
assertAllow('subquery in WHERE',
  `SELECT * FROM bw_profitability_data
   WHERE PROFIT_CENTER_NM IN (SELECT name FROM other)`);
// 컬럼명에 CREATE_DATE / UPDATED_AT / DELETE_FLAG 등이 포함된 케이스 (기존 로직의 오탐)
assertAllow('컬럼명에 CREATE_DATE 포함',
  `SELECT CREATE_DATE, UPDATED_AT, DELETE_FLAG FROM bw_profitability_data`);
assertAllow('별칭에 UPDATE_COL 포함',
  `SELECT REVENUE_AMT AS UPDATE_COL FROM bw_profitability_data`);
// 문자열 리터럴 안에 파괴 키워드가 있는 경우 (기존 includes() 오탐)
assertAllow('문자열 리터럴 안에 DELETE 문자열',
  `SELECT * FROM bw_profitability_data WHERE PROFIT_CENTER_NM = 'DELETE_ME'`);

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Group 5: 사용자 실제 오류 케이스 재현');
console.log('════════════════════════════════════════════════════════════════');
// 오류를 유발했던 실제 SQL 형태 (WITH filtered_data + WITH ROLLUP)
assertAllow(
  '실제 오류 케이스 (WITH filtered_data + WITH ROLLUP)',
  `WITH filtered_data AS (
      SELECT PROFIT_CENTER_NM, CALMONTH, REVENUE_AMT
      FROM bw_profitability_data
      WHERE CALMONTH BETWEEN '202601' AND '202603'
        AND PROFIT_CENTER_NM IN ('키친타월','원단','미용티슈','두루마리')
   )
   SELECT CALMONTH, SUM(REVENUE_AMT) AS TOTAL_REVENUE
   FROM filtered_data
   GROUP BY CALMONTH WITH ROLLUP`
);

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log('  Group 6: 빈 입력/잘못된 입력');
console.log('════════════════════════════════════════════════════════════════');
assertBlock('빈 문자열', '');
assertBlock('공백만', '    ');
assertBlock('null', null);
assertBlock('undefined', undefined);
assertBlock('숫자 입력', 12345);
// 자연어 텍스트는 `detectDirectSqlQuery` (사용자 입력 시점) 방어 계층이 담당.
// `isReadOnlyQuery` 는 LLM 이 생성한 실제 SQL 문법의 문자열만 다룸 (파이프라인 상 자연어는 이 단계에 도달하지 않음).

console.log('');
console.log('════════════════════════════════════════════════════════════════');
console.log(`  결과: ${pass}/${pass + fail} 통과`);
console.log('════════════════════════════════════════════════════════════════');
if (fail > 0) {
  console.log('실패 항목:');
  for (const f of failures) {
    console.log(`  - [${f.expected} → ${f.got}] ${f.label}${f.reason ? ` (${f.reason})` : ''}`);
  }
  process.exit(1);
}
process.exit(0);
