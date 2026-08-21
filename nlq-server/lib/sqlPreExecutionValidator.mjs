// ============================================================
// SQL Pre-Execution Validator
// ------------------------------------------------------------
// 목적:
//   - LLM 이 생성한 SQL 을 실제 DB 로 실행하기 전에 명백한 오류 패턴을
//     탐지하여, MariaDB 의 "Invalid use of group function" 같은
//     runtime 오류를 사전에 잡거나 자동 재요청 트리거로 사용.
//
// 검사 항목:
//   1) 각 SELECT 노드의 WHERE 서브트리에 aggregate function 사용
//      → MariaDB 에서 즉시 오류. (HAVING 절로 옮겨야 함)
//   2) GROUP BY 없이 SELECT 안에서 집계함수와 일반 컬럼(column_ref) 혼용
//      → sql_mode 에 따라 오류/경고 대상.
//
// 구현:
//   - 1차: node-sql-parser AST 를 사용한 정밀 검사
//     · 각 SELECT 노드의 where 서브트리만 검사
//     · where 안의 서브쿼리(select) 로는 walker 가 진입하지 않음
//       → WHERE x > (SELECT AVG(y) FROM t) 같은 정상 케이스는 통과
//   - 2차 (파서 실패 시 fallback): CTE 본문(괄호)을 최상위 SELECT 앞까지 잘라내고
//     기존 정규식 로직 실행 → multi-CTE 오탐 방지
//
// 반환:
//   { valid: true } 또는 { valid: false, reason: string }
//
// [2026-08-21] BUG A 수정 배경:
//   기존 validateSqlPreExecution 은 "첫 WHERE 이후 다음 GROUP BY/UNION/... 까지"
//   를 WHERE 절로 간주. multi-CTE SQL 에서 첫 CTE 의 WHERE 와 후속 CTE 의
//   SELECT/UNION 을 하나의 문자열로 취급하여, 후속 CTE 의 SELECT 절 SUM 을
//   "WHERE 절 안의 SUM" 이라고 오탐 → 정상 SQL 이 400 으로 차단됨.
// ============================================================

import nodeSqlParserPkg from 'node-sql-parser';
const { Parser: NodeSqlParser } = nodeSqlParserPkg;

const _parser = new NodeSqlParser();

// ── AST walker: 노드 안에서 aggr_func 를 찾되, select 서브트리로는 재귀하지 않음
//    (서브쿼리 안의 집계는 정상이므로 우리 관심사가 아님)
function _hasAggregateFuncOutsideSubquery(node) {
  if (!node || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    for (const item of node) {
      const found = _hasAggregateFuncOutsideSubquery(item);
      if (found) return found;
    }
    return null;
  }

  // aggr_func 노드 발견 → 종료
  if (node.type === 'aggr_func' && node.name) {
    return String(node.name).toUpperCase();
  }

  // select 서브쿼리로는 진입 금지
  if (node.type === 'select') return null;

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'columns_list' || key === 'tableList' || key === 'columnList') continue;
    const child = node[key];
    if (child && typeof child === 'object') {
      const found = _hasAggregateFuncOutsideSubquery(child);
      if (found) return found;
    }
  }
  return null;
}

// ── AST walker: 모든 SELECT 노드 수집 (CTE / FROM 서브쿼리 / WHERE 서브쿼리 등 포함)
function _collectSelectNodes(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) _collectSelectNodes(item, out);
    return;
  }
  if (node.type === 'select') {
    out.push(node);
    if (Array.isArray(node.with)) {
      for (const w of node.with) {
        const cteStmt = (w && w.stmt) ? (w.stmt.ast || w.stmt) : null;
        if (cteStmt) _collectSelectNodes(cteStmt, out);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'with') continue;
      const child = node[key];
      if (child && typeof child === 'object') _collectSelectNodes(child, out);
    }
    return;
  }
  for (const key of Object.keys(node)) {
    const child = node[key];
    if (child && typeof child === 'object') _collectSelectNodes(child, out);
  }
}

// ── fallback: CTE 본문(괄호 안)을 최상위 SELECT 앞까지 잘라냄
//    최상위 SELECT ... FROM ... WHERE ... 만 남기고 정규식 로직에 넘김
export function _stripCtesForFallback(sql) {
  if (!/^\s*WITH\b/i.test(sql)) return sql;

  const upper = sql.toUpperCase();
  let depth = 0;
  let inSq = false;
  let inDq = false;
  let inBt = false;
  let i = 0;
  const withMatch = upper.match(/^\s*WITH\b/);
  if (!withMatch) return sql;
  i = withMatch[0].length;

  for (; i < sql.length; i++) {
    const ch = sql[i];
    if (inSq) { if (ch === "'" && sql[i - 1] !== '\\') inSq = false; continue; }
    if (inDq) { if (ch === '"' && sql[i - 1] !== '\\') inDq = false; continue; }
    if (inBt) { if (ch === '`') inBt = false; continue; }
    if (ch === "'") { inSq = true; continue; }
    if (ch === '"') { inDq = true; continue; }
    if (ch === '`') { inBt = true; continue; }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth === 0) {
      if (upper.startsWith('SELECT', i) && /\W/.test(sql[i - 1] || ' ') && /\W/.test(sql[i + 6] || ' ')) {
        return sql.slice(i);
      }
    }
  }
  return sql;
}

// ── 정규식 fallback 검증 (파서 실패 시 사용)
function _validateByRegexFallback(sql) {
  const scanSql = _stripCtesForFallback(sql);
  const scanUpper = scanSql.toUpperCase();

  // 검사 1: WHERE 절에 집계함수
  const whereStart = scanUpper.search(/\bWHERE\b/);
  if (whereStart >= 0) {
    const afterWhere = scanSql.slice(whereStart);
    const terminatorMatch = afterWhere.match(/\b(GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION)\b/i);
    const whereEnd = terminatorMatch ? whereStart + terminatorMatch.index : scanSql.length;
    const whereClause = scanSql.slice(whereStart, whereEnd);

    let stripped = whereClause;
    let prev;
    do {
      prev = stripped;
      stripped = stripped.replace(/\([^()]*\)/g, '');
    } while (stripped !== prev);

    const aggFnPattern = /\b(SUM|AVG|COUNT|MAX|MIN)\b/i;
    if (aggFnPattern.test(stripped)) {
      const matched = stripped.match(aggFnPattern);
      return {
        valid: false,
        reason: `WHERE 절에 집계함수 ${matched[1].toUpperCase()}()가 사용되었습니다. 집계 결과로 필터링하려면 HAVING 절을 사용해야 합니다.`,
      };
    }
  }

  // 검사 2: GROUP BY 없이 집계 + 일반 컬럼 혼용
  const selectMatch = scanSql.match(/SELECT\s+([\s\S]*?)\s+FROM\s/i);
  if (selectMatch) {
    const selectClause = selectMatch[1];
    const hasAgg = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(selectClause);
    const hasGroupBy = /\bGROUP\s+BY\b/i.test(scanSql);

    if (hasAgg && !hasGroupBy) {
      const items = [];
      let depth2 = 0, buf = '';
      for (const ch of selectClause) {
        if (ch === '(') depth2++;
        else if (ch === ')') depth2--;
        if (ch === ',' && depth2 === 0) { items.push(buf.trim()); buf = ''; }
        else buf += ch;
      }
      if (buf.trim()) items.push(buf.trim());

      let plainColumnCount = 0;
      let aggColumnCount = 0;
      for (const item of items) {
        const expr = item.split(/\s+AS\s+/i)[0].trim();
        if (/\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(expr)) aggColumnCount++;
        else if (expr && expr !== '*') {
          if (!/^['"]/.test(expr) && !/^\d+(\.\d+)?$/.test(expr)) {
            if (!/\b(CASE|IF|COALESCE|IFNULL|NULLIF)\s*[\(\s]/i.test(expr)) plainColumnCount++;
          }
        }
      }
      if (aggColumnCount > 0 && plainColumnCount > 0) {
        return {
          valid: false,
          reason: `GROUP BY 없이 집계함수와 일반 컬럼(${plainColumnCount}개)이 SELECT 절에 혼용되었습니다. GROUP BY 절을 추가하거나 일반 컬럼을 제거해야 합니다.`,
        };
      }
    }
  }

  return { valid: true };
}

// ── 메인 함수: AST 우선, 실패 시 정규식 fallback
export function validateSqlPreExecution(sql) {
  if (!sql || typeof sql !== 'string') {
    return { valid: false, reason: 'SQL이 비어있습니다.' };
  }

  // 1차: AST 기반 정밀 검사
  try {
    const ast = _parser.astify(sql, { database: 'MariaDB' });
    const roots = Array.isArray(ast) ? ast : [ast];

    const selectNodes = [];
    for (const r of roots) _collectSelectNodes(r, selectNodes);

    // 검사 1: 각 SELECT 노드의 where 서브트리에 aggr_func
    for (const sel of selectNodes) {
      if (!sel.where) continue;
      const aggName = _hasAggregateFuncOutsideSubquery(sel.where);
      if (aggName) {
        return {
          valid: false,
          reason: `WHERE 절에 집계함수 ${aggName}()가 사용되었습니다. 집계 결과로 필터링하려면 HAVING 절을 사용해야 합니다.`,
        };
      }
    }

    // 검사 2: GROUP BY 없이 집계 + 일반 컬럼 혼용
    for (const sel of selectNodes) {
      if (!Array.isArray(sel.columns)) continue;
      const hasGroupBy = Array.isArray(sel.groupby) ? sel.groupby.length > 0
        : (sel.groupby && Array.isArray(sel.groupby.columns) ? sel.groupby.columns.length > 0 : false);
      if (hasGroupBy) continue;

      let aggColumnCount = 0;
      let plainColumnCount = 0;
      for (const col of sel.columns) {
        if (!col || !col.expr) continue;
        const expr = col.expr;
        const aggInThis = _hasAggregateFuncOutsideSubquery(expr);
        if (aggInThis) aggColumnCount++;
        else if (expr.type === 'column_ref' && expr.column !== '*') plainColumnCount++;
      }
      if (aggColumnCount > 0 && plainColumnCount > 0) {
        return {
          valid: false,
          reason: `GROUP BY 없이 집계함수와 일반 컬럼(${plainColumnCount}개)이 SELECT 절에 혼용되었습니다. GROUP BY 절을 추가하거나 일반 컬럼을 제거해야 합니다.`,
        };
      }
    }

    return { valid: true };
  } catch (astErr) {
    // 2차: 정규식 fallback
    return _validateByRegexFallback(sql);
  }
}
