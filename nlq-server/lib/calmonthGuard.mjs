// ============================================================
// [2026-09-10] "기간 미지정 → 최신 마감월" 공통 정책 게이트
// ------------------------------------------------------------
// 목적:
//   LLM 이 생성한 SQL (또는 학습 SQL 재사용) 에 CALMONTH 조건이 전혀
//   없는 경우, 마감 완료된 최신 데이터 월(CALMONTH=latestMonth) 을
//   자동으로 WHERE 조건에 주입하여 "기간 미지정 → 최신월" 정책을
//   결정적으로 강제한다.
//
// 배경:
//   - 수익성분석(bw_profitability_data) 는 LLM 프롬프트 규칙과
//     applyMetricFormulaReplacement 후처리로 지금까지는 대체로 CALMONTH
//     가 채워졌지만, LLM 이 확률적으로 CALMONTH 조건을 빠뜨리는 경우가
//     여전히 존재.
//   - 제조원가(sys_aimd_cot015 / sys_aimd_cot043) 는 프롬프트 규칙이
//     수익성분석 중심으로 작성되어 있어 LLM 이 CALMONTH 를 자주 누락.
//     사용자 신고: "제품별 실제원가 TOP 5" → CALMONTH 조건 없이 실행되어
//     전체 기간 합계가 나오는 문제.
//
// 근본 원인 요약:
//   - Analysis route: buildAggregationSqlFromPlan 이 항상 CALMONTH WHERE
//     절을 결정적으로 삽입 (안전).
//   - Aggregate route: LLM 이 직접 SQL 을 생성 → 프롬프트 지시를 놓치면
//     CALMONTH 조건이 빠짐. **서버측 방어망이 없음** (본 모듈이 이 방어망).
//
// 정책:
//   1) SQL 이 대상 테이블(DIVISION_ENABLED_TABLES_RE) 을 참조하지 않으면 no-op.
//   2) SQL 에 이미 어떤 형태로든 CALMONTH 조건이 있으면 no-op
//      (=/BETWEEN/IN/LIKE 'YYYY%'/LEFT(CALMONTH,4)='YYYY'/>= AND <= 조합).
//   3) SQL 에 CALYEAR 조건이 있으면 no-op (연도 단위로 이미 명시).
//   4) 사용자가 "전체 기간", "전 기간", "모든 기간", "누적/누계",
//      "전체 연도", "연도 전체", "전 연도", "모든 연도", "전기간"
//      등을 명시하면 no-op (사용자 의도 존중).
//   5) 그 외에는 최상위 WHERE 절 앞부분에 CALMONTH = 'YYYYMM' 주입.
//      (applyDomainFilter 와 동일한 findWhereEnd 로직으로 WHERE 종료점을
//       안전 스캔하고, WHERE 가 없으면 FROM <table> 뒤에 새 WHERE 생성)
//
// 하드코딩 방지:
//   latestMonth 는 항상 파라미터로 주입 (호출부에서 getDataDateContext()
//   결과를 넘김). 마감월이 202608 → 202609 로 변경되면 별도 코드 수정
//   없이 자동으로 CALMONTH = '202609' 로 바뀐다.
// ============================================================

// ── 대상 테이블 whitelist (server.mjs 의 DIVISION_ENABLED_TABLES_RE 와 동일) ──
//   두 곳에 상수가 존재하지만 서로 완전히 독립적으로 검사되므로 결합도는
//   없다. 새 테이블이 추가되면 양쪽 모두 갱신 필요 (테스트로 회귀 방지).
export const DIVISION_ENABLED_TABLES_RE = /\b(bw_profitability_data|sys_aimd_cot015|sys_aimd_cot043)\b/i;

// ── "전체 기간" 명시 표현 감지 정규식 ──────────────────────────────
//   - 공백 유무 무관 매칭 (예: "전체기간"/"전체 기간" 모두 매칭)
//   - "전기간"(붙여쓰기) 도 지원
//   - "누적"/"누계" (전 기간 합산 의미)
//   - "역대", "전체 데이터", "모든 데이터" 도 데이터 전체를 의미하므로 포함
//   - 단순히 "전체" 만으로는 부족 (예: "전체 제품별", "전체 부서별" 처럼
//     대상 축의 전체를 의미하는 경우가 많으므로 "기간/연도/데이터" 와의
//     결합만 예외로 인정).
export const ALL_PERIOD_INTENT_RE = /(전체\s*기간|전\s*기간|전기간|모든\s*기간|전체\s*연도|연도\s*전체|전\s*연도|모든\s*연도|누적|누계|역대|전체\s*데이터|모든\s*데이터)/;

export function hasExplicitAllPeriodIntent(userQuery) {
  if (!userQuery || typeof userQuery !== 'string') return false;
  return ALL_PERIOD_INTENT_RE.test(userQuery);
}

// ── SQL 에 CALMONTH 조건이 어떤 형태로든 있는지 판정 ────────────────
//   server.mjs 의 extractPeriodInfoFromSql 과 동일한 패턴을 검사한다.
//   여기서는 존재 여부 boolean 만 필요하므로 값 파싱은 생략.
//   지원 형태: = / BETWEEN / IN / LIKE 'YYYY%' / LEFT(CALMONTH,4)='YYYY' /
//              >= AND <= 조합 (같은 SQL 내에 두 조건 모두 있을 때)
export function sqlHasCalmonthCondition(sql) {
  if (!sql || typeof sql !== 'string') return false;
  const S = sql;
  if (/CALMONTH\s+BETWEEN\s+['"]\d{6}['"]\s+AND\s+['"]\d{6}['"]/i.test(S)) return true;
  if (/CALMONTH\s*>=\s*['"]\d{6}['"]/i.test(S) && /CALMONTH\s*<=\s*['"]\d{6}['"]/i.test(S)) return true;
  if (/CALMONTH\s+IN\s*\([^)]+\)/i.test(S)) return true;
  if (/CALMONTH\s+LIKE\s+['"]\d{4}[%_]['"]/i.test(S)) return true;
  if (/LEFT\s*\(\s*CALMONTH\s*,\s*4\s*\)\s*=\s*['"]\d{4}['"]/i.test(S)) return true;
  if (/CALMONTH\s*=\s*['"]\d{6}['"]/i.test(S)) return true;
  return false;
}

// ── 지역 헬퍼: WHERE 절 종료 지점 안전 스캔 ────────────────────────
//   applyDomainFilter 와 동일 정책. 문자열 리터럴/괄호 뎁스를 인식해
//   REPLACE(col, ' ', '') 같은 함수 호출 안의 ')' 를 WHERE 종료로
//   오인하지 않도록 함.
function findWhereEnd(rest) {
  const whereEndKeywords = /^(GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION)\b/i;
  let depth = 0;
  let inStr = false;
  let strCh = null;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (inStr) {
      if (ch === strCh) {
        if (rest[i + 1] === strCh) { i++; continue; }
        inStr = false;
        strCh = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = true; strCh = ch; continue;
    }
    if (ch === '(') { depth++; continue; }
    if (ch === ')') {
      if (depth === 0) return i;
      depth--; continue;
    }
    if (depth !== 0) continue;
    if (ch === ';') return i;
    if (whereEndKeywords.test(rest.slice(i))) return i;
  }
  return -1;
}

// ── 메인 게이트 함수 ────────────────────────────────────────────────
// 파라미터:
//   inputSql    : LLM 또는 학습 SQL
//   latestMonth : 'YYYYMM' (dateCtx.latestMonth)
//   userQuery   : 사용자 자연어 원문 (전체 기간 예외 감지에 사용)
//
// 반환:
//   { sql: string, injected: boolean, skipReason: string|null }
export function ensureCalmonthFilter(inputSql, latestMonth, userQuery) {
  const result = { sql: inputSql, injected: false, skipReason: null };
  if (!inputSql || typeof inputSql !== 'string') {
    result.skipReason = 'no_sql';
    return result;
  }
  const ym = String(latestMonth || '').replace(/[^0-9]/g, '');
  if (ym.length !== 6) {
    // latestMonth 가 없는 극단 케이스 — 안전하게 원본 반환
    result.skipReason = 'no_latest_month';
    return result;
  }

  // (1) 대상 테이블 whitelist 밖이면 skip
  if (!DIVISION_ENABLED_TABLES_RE.test(inputSql)) {
    result.skipReason = 'not_target_table';
    return result;
  }

  // (2) 이미 CALMONTH 조건이 있으면 skip
  if (sqlHasCalmonthCondition(inputSql)) {
    result.skipReason = 'already_has_calmonth';
    return result;
  }

  // (3) CALYEAR 조건이 있으면 skip (연도 단위로 사용자 의도 명시된 상태)
  //   형태: CALYEAR = 2026 / CALYEAR = '2026' / CALYEAR IN (...) / CALYEAR BETWEEN ...
  if (/\bCALYEAR\s*(?:=|<>|!=|<|>|<=|>=|\sIN\b|\sBETWEEN\b|\sLIKE\b)/i.test(inputSql)) {
    result.skipReason = 'has_calyear';
    return result;
  }

  // (4) 사용자가 "전체 기간" 명시 → 사용자 의도 존중 (skip)
  if (hasExplicitAllPeriodIntent(userQuery)) {
    result.skipReason = 'explicit_all_period';
    return result;
  }

  // (5) 최상위 WHERE 절 앞에 CALMONTH = 'YYYYMM' 주입
  const calmonthClause = `CALMONTH = '${ym}'`;
  const whereRegex = /\bWHERE\b\s+/i;
  const whereMatch = whereRegex.exec(inputSql);

  let out;
  if (whereMatch) {
    // 최상위 WHERE 절이 있음 → 그 앞부분에 CALMONTH AND 를 삽입
    // (applyDomainFilter 와 동일: 기존 조건을 괄호로 감싸고 앞에 새 조건 부착)
    const before = inputSql.slice(0, whereMatch.index + whereMatch[0].length);
    const rest = inputSql.slice(whereMatch.index + whereMatch[0].length);
    const endIdx = findWhereEnd(rest);
    let cond, tail;
    if (endIdx >= 0) {
      cond = rest.slice(0, endIdx).trim();
      tail = rest.slice(endIdx);
    } else {
      cond = rest.trim();
      tail = '';
    }
    const wrapped = cond ? `${calmonthClause} AND (${cond})` : calmonthClause;
    const sep = tail && !tail.startsWith(' ') && !tail.startsWith(';') && !tail.startsWith(')') ? ' ' : '';
    out = `${before}${wrapped}${sep}${tail}`;
  } else {
    // WHERE 가 없음 → FROM <target-table> [alias] 뒤에 WHERE 새로 추가
    const reservedAfterFrom = /^(?:WHERE|GROUP|HAVING|ORDER|LIMIT|UNION|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON)$/i;
    const fromRegex = /\bFROM\s+(?:bw_profitability_data|sys_aimd_cot015|sys_aimd_cot043)\b(\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/i;
    const fromMatch = fromRegex.exec(inputSql);
    if (!fromMatch) {
      result.skipReason = 'no_from_match';
      return result;
    }
    let matchLen = fromMatch[0].length;
    if (fromMatch[2] && reservedAfterFrom.test(fromMatch[2])) {
      matchLen = fromMatch[0].length - fromMatch[1].length;
    }
    const insertPos = fromMatch.index + matchLen;
    const before = inputSql.slice(0, insertPos);
    const rest = inputSql.slice(insertPos);
    const endIdx = findWhereEnd(rest);
    if (endIdx > 0) {
      const head = rest.slice(0, endIdx);
      const tail = rest.slice(endIdx);
      out = `${before}${head} WHERE ${calmonthClause} ${tail}`;
    } else if (endIdx === 0) {
      out = `${before} WHERE ${calmonthClause} ${rest}`;
    } else {
      out = `${before} WHERE ${calmonthClause}${rest}`;
    }
  }

  if (out !== inputSql) {
    result.sql = out;
    result.injected = true;
  }
  return result;
}
