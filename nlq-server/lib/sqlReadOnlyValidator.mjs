// ============================================================
// SQL Read-only Validator
// ------------------------------------------------------------
// 목적:
//   - LLM이 생성한 SQL 또는 사용자가 API로 전달한 SQL이 실제로
//     "DB 상태를 변경하지 않는 read-only 조회 SQL"인지 검증.
//   - 기존 `sql.trim().toUpperCase().startsWith('SELECT')` +
//     `forbidden.includes(kw)` 방식은:
//       1) WITH ... SELECT (CTE) 형태의 정상 조회 SQL을 무조건 차단
//       2) 컬럼명/별칭에 CREATE_DATE·UPDATED_AT 같은 문자열이 포함되면 오탐
//     하는 결함이 있어, node-sql-parser 로 AST 파싱한 뒤 root
//     statement type 을 검사하는 방식으로 교체함.
//
// 판정 규칙:
//   1) node-sql-parser 로 SQL 을 MariaDB dialect 로 파싱
//   2) astify() 가 반환한 statement 배열의 모든 root type 이 'select' 이면 read-only
//   3) update/delete/insert/replace/create/drop/... 이 하나라도 있으면 차단
//      → WITH cte AS (...) UPDATE ... 도 root type 이 'update' 로 판별됨
//   4) 파서가 예외를 던지면 (일부 MariaDB 확장 문법 미지원) fallback 으로
//      주석/문자열 리터럴 제거 후 정규식으로 read-only head 만 허용
//
// 반환:
//   - 통과: { ok: true, parserFallback?: boolean, parserError?: string }
//   - 차단: { ok: false, reason: string }
// ============================================================

import nodeSqlParserPkg from 'node-sql-parser';
const { Parser: NodeSqlParser } = nodeSqlParserPkg;

const _parser = new NodeSqlParser();

// AST root type 이 아래 집합에 속하면 명백한 데이터 변경 구문
const DESTRUCTIVE_AST_TYPES = new Set([
  'update', 'delete', 'insert', 'replace', 'create', 'drop', 'alter',
  'truncate', 'rename', 'grant', 'revoke', 'call', 'use', 'set',
  'lock', 'unlock', 'load', 'handler', 'do', 'analyze', 'optimize',
  'repair', 'reset', 'flush', 'kill', 'purge', 'change', 'start',
  'commit', 'rollback', 'savepoint', 'release', 'begin',
]);

// 파서 실패 시 fallback 용: 주석/문자열 리터럴 제거
export function stripSqlCommentsAndStrings(sql) {
  let s = String(sql);
  s = s.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = s.replace(/(^|\s)--[^\n]*/g, '$1 ');
  s = s.replace(/(^|\s)#[^\n]*/g, '$1 ');
  s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
  s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
  return s;
}

// fallback: 파서 실패 시 최소한의 보수적 read-only 판별
export function isReadOnlyByRegex(sql) {
  const cleaned = stripSqlCommentsAndStrings(sql).trim();
  if (!cleaned) return { ok: false, reason: 'SQL이 비어있습니다.' };

  const statements = cleaned.split(/;+/).map(s => s.trim()).filter(Boolean);
  if (statements.length === 0) return { ok: false, reason: 'SQL이 비어있습니다.' };

  const READ_HEAD_RE =
    /^(?:\(\s*)*(?:WITH\s+(?:RECURSIVE\s+)?[\s\S]+?\)\s*)*\s*(SELECT|VALUES|TABLE)\b/i;
  const DESTRUCTIVE_HEAD_RE =
    /^(?:\(\s*)*(?:WITH\s+(?:RECURSIVE\s+)?[\s\S]+?\)\s*)*\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|TRUNCATE|RENAME|GRANT|REVOKE|CALL|USE|SET|LOCK|UNLOCK|LOAD|HANDLER|DO|ANALYZE|OPTIMIZE|REPAIR|FLUSH|KILL|EXEC|EXECUTE|MERGE)\b/i;

  for (const stmt of statements) {
    if (DESTRUCTIVE_HEAD_RE.test(stmt)) {
      const m = stmt.match(DESTRUCTIVE_HEAD_RE);
      return { ok: false, reason: `데이터 변경 구문(${m[1].toUpperCase()})은 허용되지 않습니다.` };
    }
    if (!READ_HEAD_RE.test(stmt)) {
      return { ok: false, reason: 'SELECT/WITH...SELECT 형태의 조회 SQL만 허용됩니다.' };
    }
  }
  return { ok: true };
}

// 메인: AST 우선 판별, 실패 시 정규식 fallback
export function isReadOnlyQuery(sql) {
  if (!sql || typeof sql !== 'string' || !sql.trim()) {
    return { ok: false, reason: 'SQL이 비어있습니다.' };
  }

  try {
    const ast = _parser.astify(sql, { database: 'MariaDB' });
    const list = Array.isArray(ast) ? ast : [ast];
    if (list.length === 0) {
      return { ok: false, reason: 'SQL이 비어있습니다.' };
    }
    for (const stmt of list) {
      const t = (stmt && stmt.type) ? String(stmt.type).toLowerCase() : '';
      if (t !== 'select') {
        if (DESTRUCTIVE_AST_TYPES.has(t)) {
          return { ok: false, reason: `데이터 변경 구문(${t.toUpperCase()})은 허용되지 않습니다.` };
        }
        return { ok: false, reason: `허용되지 않는 SQL 구문(${t || 'unknown'})입니다.` };
      }
    }
    return { ok: true };
  } catch (parseErr) {
    // 파서가 지원하지 않는 MariaDB 확장 문법 → fallback 검증
    const fb = isReadOnlyByRegex(sql);
    if (!fb.ok) return fb;
    return { ok: true, parserFallback: true, parserError: (parseErr && parseErr.message) ? parseErr.message.slice(0, 200) : 'parser error' };
  }
}
