// ============================================================
// [PR #257] 학습 SQL CALMONTH 시간 리터럴 재바인딩 / 파라미터화
// ------------------------------------------------------------
// 배경:
//   - "정확해요" 로 검증되어 sql_feedback 테이블에 저장된 SQL 은
//     검증 시점의 CALMONTH 리터럴(예: '202605') 이 그대로 박제되어 있음.
//   - 사용자가 다음 달에 같은 질의를 하면, 학습 SQL 재사용 경로에서
//     AI 호출 없이 그대로 실행되므로 잘못된 월(과거) 데이터를 반환.
//
// 해결 전략 (축 A + 축 B 동시 적용):
//   - 축 A) rebaseCalmonthForLearnedSql(sql, query, dateCtx)
//     : 학습 SQL 을 재사용하기 직전, 필요 시 CALMONTH 값을
//       현재 latestMonth / prevMonth 로 동적 재바인딩.
//     : 저장된 자리표시자(:LATEST_MONTH / :PREV_MONTH) 는 항상 치환.
//     : 리터럴 6자리 값('YYYYMM') 은 사용자가 질의에서 명시적 년월을
//       언급하지 않았을 때만 치환 (질의 명시 우선 정책).
//   - 축 B) parameterizeCalmonthForSave(sql, query, dateCtx)
//     : "정확해요" / "SQL 수정하기" 로 sql_feedback 에 저장될 때,
//       질의에 명시적 년월이 없다면 SQL 안의 CALMONTH='latest' /
//       CALMONTH='prev' 를 자리표시자로 치환하여 미래 지향적 저장.
//
// 위 두 함수 모두 lib 로 분리해서 순수 함수로 만들어 단위 테스트 용이.
// ============================================================

/**
 * CALMONTH 자리표시자 상수.
 * DB 저장 시 리터럴 6자리 대신 이 값이 들어감.
 */
export const PLACEHOLDER_LATEST = ':LATEST_MONTH';
export const PLACEHOLDER_PREV = ':PREV_MONTH';

/**
 * 질의 문자열에 "명시적 년월 표현" 이 있는지 판정.
 *
 * 명시적 년월 = 년(YYYY) 이 함께 붙는 경우:
 *   - "2026년 5월" / "2026년5월"
 *   - "2026-05" / "2026.05" / "2026/05"
 *   - "202605" (6자리 리터럴)
 *
 * ★ "5월" 처럼 년도 없이 월만 있는 경우는 "명시적 년월" 이 아님.
 *   → 상대적 기간 표현으로 간주하여 rebase 대상이 됨.
 *
 * @param {string} query
 * @returns {boolean}
 */
export function hasExplicitYearMonth(query) {
  if (!query || typeof query !== 'string') return false;
  // YYYY년 M월 / YYYY년 MM월
  if (/\d{4}\s*년\s*\d{1,2}\s*월/.test(query)) return true;
  // YYYY-MM / YYYY.MM / YYYY/MM
  if (/\d{4}\s*[-./]\s*\d{1,2}\b/.test(query)) return true;
  // YYYYMM (단독 6자리 숫자)
  if (/(^|\D)(20\d{2})(0[1-9]|1[0-2])(\D|$)/.test(query)) return true;
  return false;
}

/**
 * 질의 문자열에 "상대적 기간 표현" 이 있는지 판정.
 * ("당월", "이번달", "이달", "최근달", "전월", "지난달" 등)
 *
 * @param {string} query
 * @returns {boolean}
 */
export function hasRelativeMonthExpr(query) {
  if (!query || typeof query !== 'string') return false;
  if (/(당월|이번\s*달|이달|금월|최근\s*달|최근월)/.test(query)) return true;
  if (/(전월|지난\s*달|저번\s*달|작년\s*동월)/.test(query)) return true;
  return false;
}

/**
 * CALMONTH 리터럴 하나를 새 월로 치환할지 판정.
 *
 * 정책:
 *   - 자리표시자(:LATEST_MONTH, :PREV_MONTH) → 항상 치환 대상
 *   - 리터럴 6자리 → 질의에 명시적 년월이 없을 때만 치환 대상
 *     (질의 명시 우선 — 사용자가 "2026년 5월" 이라 했으면 그 값 존중)
 *
 * @param {string} literal SQL 안의 CALMONTH 값 (따옴표 제외)
 * @param {boolean} hasExplicit 질의에 명시적 년월이 있는지
 * @returns {boolean}
 */
function shouldRebaseLiteral(literal, hasExplicit) {
  if (!literal) return false;
  if (literal === PLACEHOLDER_LATEST || literal === PLACEHOLDER_PREV) return true;
  if (hasExplicit) return false; // 질의 명시 값은 존중
  // 6자리 YYYYMM 형태만 안전하게 치환 (다른 형식은 건드리지 않음)
  return /^20\d{2}(0[1-9]|1[0-2])$/.test(literal);
}

/**
 * SQL 안의 CALMONTH 값 하나를 rebase 결과 값으로 변환.
 * 저장된 값이 latestMonth 였는지 prevMonth 였는지 알 수 없으므로
 * 정책:
 *   - 자리표시자 → 매핑 그대로 치환
 *   - 리터럴 값 == 저장 시점의 latestMonth 로 간주하여 dateCtx.latestMonth 로 치환
 *   - (예외) 리터럴 값 == 저장 시점 prevMonth 인지 판정은 곤란하므로
 *     기본적으로 latestMonth 재바인딩만 수행.
 *     실무상 학습 SQL 은 대부분 "당월" 기준으로 저장되므로 이 근사면 충분.
 *
 * @param {string} literal
 * @param {{latestMonth:string,prevMonth:string}} dateCtx
 * @returns {string}
 */
function rebaseOneLiteral(literal, dateCtx) {
  if (literal === PLACEHOLDER_LATEST) return dateCtx.latestMonth;
  if (literal === PLACEHOLDER_PREV) return dateCtx.prevMonth;
  // 리터럴 6자리 → latestMonth 로 재바인딩
  return dateCtx.latestMonth;
}

/**
 * 학습 SQL 재사용 직전, CALMONTH 값을 현재 dateCtx 로 재바인딩.
 *
 * 대응 패턴 (대소문자 무시):
 *   - CALMONTH = 'YYYYMM'                → rebase 대상
 *   - CALMONTH = ':LATEST_MONTH'         → rebase 대상 (자리표시자)
 *   - CALMONTH = ':PREV_MONTH'           → rebase 대상 (자리표시자)
 *   - CALMONTH IN ('202604','202605')    → 각 값을 검사, rebase 대상만 치환
 *   - CALMONTH BETWEEN 'YYYYMM' AND 'YYYYMM' → 각 값 검사
 *   - CALMONTH >= / <= / > / <           → 각 리터럴 검사
 *
 * 미대응 (안전하게 원본 유지):
 *   - CALMONTH LIKE 'pattern'
 *   - 서브쿼리 안의 복잡한 표현
 *   - CALMONTH 가 없는 SQL
 *
 * @param {string} sql
 * @param {string} query
 * @param {{latestMonth:string,prevMonth:string}} dateCtx
 * @returns {string} rebase 결과 SQL
 */
export function rebaseCalmonthForLearnedSql(sql, query, dateCtx) {
  if (!sql || typeof sql !== 'string') return sql;
  if (!dateCtx || !dateCtx.latestMonth) return sql;
  if (!/\bCALMONTH\b/i.test(sql)) return sql;

  const hasExplicit = hasExplicitYearMonth(query || '');

  // 문자열 리터럴 매치 헬퍼 (자리표시자 or 6자리)
  // ':LATEST_MONTH' / ':PREV_MONTH' / '202605' 등
  const literalPattern = "'((?::LATEST_MONTH|:PREV_MONTH|[^']*))'";

  let out = sql;
  let changed = false;

  // 패턴 1: CALMONTH <op> '값'  (=, <>, !=, <, >, <=, >=)
  out = out.replace(
    new RegExp(`\\bCALMONTH\\s*(=|<>|!=|<=|>=|<|>)\\s*${literalPattern}`, 'gi'),
    (match, op, litRaw) => {
      if (!shouldRebaseLiteral(litRaw, hasExplicit)) return match;
      const newLit = rebaseOneLiteral(litRaw, dateCtx);
      changed = true;
      return `CALMONTH ${op} '${newLit}'`;
    }
  );

  // 패턴 2: CALMONTH BETWEEN 'A' AND 'B'
  out = out.replace(
    new RegExp(`\\bCALMONTH\\s+BETWEEN\\s+${literalPattern}\\s+AND\\s+${literalPattern}`, 'gi'),
    (match, aRaw, bRaw) => {
      const aRe = shouldRebaseLiteral(aRaw, hasExplicit);
      const bRe = shouldRebaseLiteral(bRaw, hasExplicit);
      if (!aRe && !bRe) return match;
      // 관습: BETWEEN prev AND latest 형태 → 자리표시자면 정확히 매핑,
      //       리터럴 6자리면 A=prevMonth, B=latestMonth 로 rebase
      let newA, newB;
      if (aRaw === PLACEHOLDER_LATEST || aRaw === PLACEHOLDER_PREV) {
        newA = rebaseOneLiteral(aRaw, dateCtx);
      } else if (aRe) {
        newA = dateCtx.prevMonth; // BETWEEN 의 하한
      } else {
        newA = aRaw;
      }
      if (bRaw === PLACEHOLDER_LATEST || bRaw === PLACEHOLDER_PREV) {
        newB = rebaseOneLiteral(bRaw, dateCtx);
      } else if (bRe) {
        newB = dateCtx.latestMonth; // BETWEEN 의 상한
      } else {
        newB = bRaw;
      }
      changed = true;
      return `CALMONTH BETWEEN '${newA}' AND '${newB}'`;
    }
  );

  // 패턴 3: CALMONTH IN (...) — 각 원소 문자열을 개별 검사
  out = out.replace(
    /\bCALMONTH\s+(NOT\s+)?IN\s*\(([^)]*)\)/gi,
    (match, notOp, inner) => {
      // inner 안의 각 리터럴을 파싱해서 rebase
      let localChanged = false;
      const parts = inner.split(',');
      const rebased = parts.map((p) => {
        const trimmed = p.trim();
        // 'value' 형태만 대상
        const litMatch = trimmed.match(/^'((?::LATEST_MONTH|:PREV_MONTH|[^']*))'$/);
        if (!litMatch) return p;
        const litRaw = litMatch[1];
        if (!shouldRebaseLiteral(litRaw, hasExplicit)) return p;
        const newLit = rebaseOneLiteral(litRaw, dateCtx);
        localChanged = true;
        // 원래 공백/포맷 최대한 보존: 양 옆 공백만 유지
        return p.replace(/'[^']*'/, `'${newLit}'`);
      });
      if (localChanged) changed = true;
      return `CALMONTH ${notOp || ''}IN (${rebased.join(',')})`;
    }
  );

  if (changed) {
    // 상위 호출자에서 로깅함. 여기선 부수효과 없이 값만 반환.
  }
  return out;
}

/**
 * "정확해요" / "SQL 수정하기" 로 sql_feedback 에 저장되기 직전,
 * CALMONTH 리터럴을 자리표시자로 치환하여 미래 지향적으로 저장.
 *
 * 정책:
 *   - 질의에 명시적 년월(2026년 5월 / 2026-05 등)이 있으면 → 그대로 저장
 *     (사용자가 명시한 특정 월은 절대적 참조이므로 파라미터화 X)
 *   - 그 외 (상대적 기간 표현 / 시간 표현 없음):
 *     * SQL 안의 CALMONTH 리터럴 값이 저장 시점 dateCtx.latestMonth 와 같으면 → ':LATEST_MONTH'
 *     * dateCtx.prevMonth 와 같으면 → ':PREV_MONTH'
 *     * 그 외 값은 그대로 유지 (히스토리컬 참조 등)
 *
 * 지원 패턴: 위 rebase 함수와 동일 (=/<>/!=/<=/>=/</> , BETWEEN, IN)
 *
 * @param {string} sql
 * @param {string} query
 * @param {{latestMonth:string,prevMonth:string}} dateCtx
 * @returns {string}
 */
export function parameterizeCalmonthForSave(sql, query, dateCtx) {
  if (!sql || typeof sql !== 'string') return sql;
  if (!dateCtx || !dateCtx.latestMonth) return sql;
  if (!/\bCALMONTH\b/i.test(sql)) return sql;
  if (hasExplicitYearMonth(query || '')) return sql;

  const latest = dateCtx.latestMonth;
  const prev = dateCtx.prevMonth;

  const paramForValue = (val) => {
    if (val === latest) return PLACEHOLDER_LATEST;
    if (val === prev) return PLACEHOLDER_PREV;
    return null;
  };

  let out = sql;

  // 패턴 1: CALMONTH <op> 'YYYYMM'
  out = out.replace(
    /\bCALMONTH\s*(=|<>|!=|<=|>=|<|>)\s*'([^']+)'/gi,
    (match, op, val) => {
      const p = paramForValue(val);
      if (!p) return match;
      return `CALMONTH ${op} '${p}'`;
    }
  );

  // 패턴 2: CALMONTH BETWEEN 'A' AND 'B'
  out = out.replace(
    /\bCALMONTH\s+BETWEEN\s+'([^']+)'\s+AND\s+'([^']+)'/gi,
    (match, a, b) => {
      const pa = paramForValue(a);
      const pb = paramForValue(b);
      if (!pa && !pb) return match;
      return `CALMONTH BETWEEN '${pa || a}' AND '${pb || b}'`;
    }
  );

  // 패턴 3: CALMONTH IN (...)
  out = out.replace(
    /\bCALMONTH\s+(NOT\s+)?IN\s*\(([^)]*)\)/gi,
    (match, notOp, inner) => {
      let localChanged = false;
      const parts = inner.split(',');
      const paramed = parts.map((p) => {
        const trimmed = p.trim();
        const litMatch = trimmed.match(/^'([^']+)'$/);
        if (!litMatch) return p;
        const val = litMatch[1];
        const paramed = paramForValue(val);
        if (!paramed) return p;
        localChanged = true;
        return p.replace(/'[^']+'/, `'${paramed}'`);
      });
      if (!localChanged) return match;
      return `CALMONTH ${notOp || ''}IN (${paramed.join(',')})`;
    }
  );

  return out;
}
