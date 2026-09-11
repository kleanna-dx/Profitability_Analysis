/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_cost_basis_generic.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상:
 *   1) server.mjs 의 "제품별 원가 GENERIC 조회" 프롬프트 힌트
 *      ("원가" 단독 질의 시 ZCGUBUN 미확정, ZCGUBUN_D + ZCGUBUN 전체 노출)
 *   2) validateCostBasisSqlIntegrity() SQL 무결성 검증 함수
 *      V1) alias '원가/실제원가/원가 단가' + expression SUM(TOTAL) 단독 → 위반
 *      V2) GENERIC 원가 조회에서 WHERE ZCGUBUN 임의 확정 → 위반
 *
 * 배경 (사용자 신고 2026-09-13):
 *   "F2A11220-05000720B 자재 원가 알려줘" 질의에서 시스템이 SUM(TOTAL) 만 반환.
 *   → "원가" 는 ZCGUBUN synonym 에 등록되지 않아 CostBasisHint 트리거 발동 실패.
 *   → LLM 이 기본 프롬프트로 SUM(TOTAL) 단독 반환.
 *
 * 사용자 요구:
 *   - "원가" 단독 → ZCGUBUN 임의 확정 금지 → 전체 원가유형 조회 (ZCGUBUN_D + ZCGUBUN)
 *   - 결과 컬럼: 자재코드/자재명/원가 대구분/원가구분/원가 총액/생산수량/단위/원가 단가
 *   - ORDER BY: ZCGUBUN_D, CASE WHEN ZCGUBUN='표준원가' THEN 2 ELSE 1 END
 *   - LBKUM=0 인 행은 원가 단가 NULL, TOTAL 을 단가에 넣지 말 것
 *   - SQL post-validation: alias 왜곡 및 WHERE ZCGUBUN 임의 확정 감지
 *
 * 검증 항목:
 *   [A] GENERIC_COST_INTENT_RE 정규식 매트릭스
 *   [B] SPECIFIC vs GENERIC 구분 (implicit branch resolution)
 *   [C] 6 Case 사용자 시나리오
 *   [D] server.mjs 소스에 GENERIC 힌트 문구 반영 확인
 *   [E] validateCostBasisSqlIntegrity — V1 (alias/expression 무결성)
 *   [F] validateCostBasisSqlIntegrity — V2 (WHERE ZCGUBUN 임의 확정 감지)
 *   [G] 회귀 안전성 — 기존 SPECIFIC/DELTA 분기 유지
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_MJS = path.resolve(__dirname, '../server.mjs');

let passCount = 0;
let failCount = 0;
function assert(cond, msg) {
  if (cond) { passCount++; console.log('  ✅ ' + msg); }
  else      { failCount++; console.log('  ❌ ' + msg); }
}
function section(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

// ── 로직 재현 (server.mjs 와 동일) ────────────────────────────────────
const EXPLICIT_TOTAL_INTENT_RE = /(총액|총금액|총원가|총합|합계|총\s*발생액|총\s*금액)/;
const DELTA_INTENT_RE = /(전월\s*대비|전년\s*대비|전년\s*동월\s*대비|전분기\s*대비|MoM|YoY|\d+\s*월\s*대비|\d+\s*년\s*대비|대비|비교|증가액|감소액|증감액|증감|증가율|감소율|차이|변동|상승률|하락률)/i;
const GENERIC_COST_INTENT_RE = /(?:^|[^가-힣])(원가|제조원가|자재원가|제품원가)(?![가-힣])/;
const SPECIFIC_ZCGUBUN_IN_QUERY_RE = /(실제\s*원가|표준\s*원가|매출\s*원가)/;

function detectBranch({ query, columnMatches, tableWhitelist }) {
  const q = String(query || '');
  const inScope = Array.isArray(tableWhitelist) && tableWhitelist.includes('sys_aimd_cot015');
  const hasZcgubunMatch = (columnMatches || []).some(m =>
    String(m.column_name || '').toUpperCase() === 'ZCGUBUN'
  );
  const hasTotalIntent = EXPLICIT_TOTAL_INTENT_RE.test(q);
  const hasDelta = DELTA_INTENT_RE.test(q);
  const hasGeneric = GENERIC_COST_INTENT_RE.test(q);

  if (!inScope) return 'no_scope';
  if (hasTotalIntent) return 'skip_total_intent';
  if (hasZcgubunMatch && hasDelta) return 'DELTA';
  if (hasZcgubunMatch && !hasDelta) return 'SPECIFIC';
  if (!hasZcgubunMatch && hasGeneric && !hasDelta) return 'GENERIC';
  return 'no_match';
}

// validateCostBasisSqlIntegrity 로직 재현
function validateCostBasisSqlIntegrity({ sql, query, columnMatches, tableWhitelist } = {}) {
  const violations = [];
  const sqlStr = String(sql || '');
  const queryStr = String(query || '');

  const inCot015Scope = Array.isArray(tableWhitelist) && tableWhitelist.includes('sys_aimd_cot015');
  if (!inCot015Scope) return { valid: true, reason: 'not_in_scope', violations };
  if (!/\bsys_aimd_cot015\b/i.test(sqlStr)) return { valid: true, reason: 'sql_not_using_cot015', violations };

  const hasExplicitTotalIntent = EXPLICIT_TOTAL_INTENT_RE.test(queryStr);

  // V1
  if (!hasExplicitTotalIntent) {
    const selectMatch = sqlStr.match(/SELECT\s+([\s\S]+?)\s+FROM\s+/i);
    if (selectMatch) {
      const selectClause = selectMatch[1];
      const items = [];
      let depth = 0, start = 0;
      for (let i = 0; i < selectClause.length; i++) {
        const ch = selectClause[i];
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) {
          items.push(selectClause.substring(start, i).trim());
          start = i + 1;
        }
      }
      items.push(selectClause.substring(start).trim());

      const ALIAS_CAPTURE_RE = /AS\s+(['"`])([^'"`]+)\1|AS\s+([A-Za-z0-9_가-힣]+)/i;
      const COST_ALIAS_SIGNAL_RE = /(?:^|[\s_])?(원가|실제\s*원가|매출\s*원가|표준\s*원가|제조\s*원가|원가\s*단가|단가|자재\s*원가|제품\s*원가)(?:[\s_(]|$)/;
      const TOTAL_ALIAS_SIGNAL_RE = /(총액|총금액|합계|총원가|총합)/;
      const HAS_UNIT_DIVISION_RE = /SUM\s*\(\s*TOTAL\s*\)\s*\/\s*NULLIF\s*\(\s*SUM\s*\(\s*LBKUM\s*\)/i;

      for (const item of items) {
        const aliasCap = item.match(ALIAS_CAPTURE_RE);
        if (!aliasCap) continue;
        const aliasText = aliasCap[2] || aliasCap[3] || '';
        if (TOTAL_ALIAS_SIGNAL_RE.test(aliasText)) continue;
        if (!COST_ALIAS_SIGNAL_RE.test(' ' + aliasText + ' ')) continue;

        const aliasIdx = item.search(/\bAS\b/i);
        const exprPart = aliasIdx > 0 ? item.substring(0, aliasIdx).trim() : item.trim();

        const isPureSumTotal = /^\s*SUM\s*\(\s*TOTAL\s*\)\s*$/i.test(exprPart);
        const hasUnitDivision = HAS_UNIT_DIVISION_RE.test(exprPart);

        if (isPureSumTotal && !hasUnitDivision) {
          violations.push(`V1: alias "${aliasText}" 인데 SUM(TOTAL) 단독`);
        }
      }
    }
  }

  // V2
  const hasGenericCostIntent = GENERIC_COST_INTENT_RE.test(queryStr);
  const hasSpecificZcgubunInQuery = SPECIFIC_ZCGUBUN_IN_QUERY_RE.test(queryStr);
  const hasZcgubunConcreteMatch = Array.isArray(columnMatches)
    ? columnMatches.some(m => String(m.column_name || '').toUpperCase() === 'ZCGUBUN')
    : hasSpecificZcgubunInQuery;
  if (hasGenericCostIntent && !hasZcgubunConcreteMatch && !hasExplicitTotalIntent) {
    const ZCGUBUN_FILTER_RE = /\bZCGUBUN\s*(?:=\s*['"][^'"]+['"]|IN\s*\([^)]+\))/i;
    if (ZCGUBUN_FILTER_RE.test(sqlStr)) {
      violations.push('V2: GENERIC 원가에 WHERE ZCGUBUN 임의 확정');
    }
  }

  return { valid: violations.length === 0, reason: violations.length === 0 ? 'ok' : 'violations', violations };
}

// 헬퍼
const zcgubunMatch = (val) => ({
  column_name: 'ZCGUBUN', matchedKeyword: val, synonym: val, source: 'ontology',
});
const WL = ['sys_aimd_cot015'];

// ═══════════════════════════════════════════════════════════════════════
// [A] GENERIC_COST_INTENT_RE 정규식 매트릭스
// ═══════════════════════════════════════════════════════════════════════
section('[A] GENERIC_COST_INTENT_RE 정규식');

const genericPositive = [
  'F2A11220-05000720B 자재 원가 알려줘',
  '자재 원가 알려줘',
  '원가 알려줘',
  '제조원가 알려줘',
  '자재원가 조회',
  '제품원가 확인',
  'F2A11220-05000720B 원가',
  '2026년 8월 원가 알려줘',
];
for (const q of genericPositive) {
  assert(GENERIC_COST_INTENT_RE.test(q), `Generic 감지: "${q}"`);
}

// SPECIFIC ZCGUBUN 이 붙은 경우 GENERIC 매칭에서 제외돼야 함
//   (SPECIFIC_ZCGUBUN_IN_QUERY_RE 로 별도 필터되며, GENERIC_COST_INTENT_RE 는
//    "실제원가/표준원가/매출원가" 단어를 매칭할 수도 있지만 lookbehind [^가-힣]
//    조건에 의해 앞이 한글이면 제외됨)
const genericNegative = [
  '자재 실제원가 알려줘',       // '원가' 앞에 '제' (한글) → 미매칭
  '자재 매출원가 알려줘',       // '원가' 앞에 '출' (한글) → 미매칭
  '자재 표준원가 알려줘',       // '원가' 앞에 '준' (한글) → 미매칭
  '자재 실제원가 총액 알려줘',   // 위와 동일
  '자재 매출',                  // "원가" 없음
  '설비별 총원가 TOP 5',        // '원가' 앞에 '총' → 미매칭
];
for (const q of genericNegative) {
  assert(!GENERIC_COST_INTENT_RE.test(q), `Generic 미감지 (정상): "${q}"`);
}

// SPECIFIC 정규식
const specificPositive = ['실제원가', '매출원가', '표준원가', '실제 원가', '매출 원가'];
for (const q of specificPositive) {
  assert(SPECIFIC_ZCGUBUN_IN_QUERY_RE.test(q), `Specific 감지: "${q}"`);
}

// ═══════════════════════════════════════════════════════════════════════
// [B] SPECIFIC vs GENERIC 분기 해결
// ═══════════════════════════════════════════════════════════════════════
section('[B] SPECIFIC / GENERIC 분기 해결');

// GENERIC: "원가" 만, ZCGUBUN 매칭 없음
{
  const b = detectBranch({
    query: 'F2A11220-05000720B 자재 원가 알려줘',
    columnMatches: [], tableWhitelist: WL,
  });
  assert(b === 'GENERIC', 'B-1: "자재 원가 알려줘" → GENERIC 분기');
}

// SPECIFIC: 실제원가 명시 + ZCGUBUN 매칭
{
  const b = detectBranch({
    query: 'F2A11220-05000720B 자재 실제원가 알려줘',
    columnMatches: [zcgubunMatch('실제원가')], tableWhitelist: WL,
  });
  assert(b === 'SPECIFIC', 'B-2: "자재 실제원가 알려줘" → SPECIFIC 분기');
}

// SPECIFIC: 매출원가
{
  const b = detectBranch({
    query: 'F2A11220-05000720B 매출원가 알려줘',
    columnMatches: [zcgubunMatch('매출원가')], tableWhitelist: WL,
  });
  assert(b === 'SPECIFIC', 'B-3: "매출원가 알려줘" → SPECIFIC 분기');
}

// SPECIFIC: 표준원가
{
  const b = detectBranch({
    query: 'F2A11220-05000720B 표준원가 알려줘',
    columnMatches: [zcgubunMatch('표준원가')], tableWhitelist: WL,
  });
  assert(b === 'SPECIFIC', 'B-4: "표준원가 알려줘" → SPECIFIC 분기');
}

// SKIP: 총액 명시
{
  const b = detectBranch({
    query: '실제원가 총액 알려줘',
    columnMatches: [zcgubunMatch('실제원가')], tableWhitelist: WL,
  });
  assert(b === 'skip_total_intent', 'B-5: 총액 명시 → 힌트 스킵');
}

// DELTA: 증가액
{
  const b = detectBranch({
    query: '전월대비 실제원가 증가액 TOP 10',
    columnMatches: [zcgubunMatch('실제원가')], tableWhitelist: WL,
  });
  assert(b === 'DELTA', 'B-6: "전월대비 증가액" → DELTA 분기');
}

// no_scope: 다른 테이블
{
  const b = detectBranch({
    query: '자재 원가 알려줘',
    columnMatches: [], tableWhitelist: ['bw_profitability_data'],
  });
  assert(b === 'no_scope', 'B-7: 다른 테이블 → no_scope');
}

// ═══════════════════════════════════════════════════════════════════════
// [C] 6 Case 사용자 시나리오
// ═══════════════════════════════════════════════════════════════════════
section('[C] 사용자 요구 6 Case 시나리오');

const cases = [
  { q: 'F2A11220-05000720B 자재 원가 알려줘',      cm: [], expect: 'GENERIC',  name: 'C-1: 자재 원가 (GENERIC)' },
  { q: 'F2A11220-05000720B 자재 실제원가 알려줘',  cm: [zcgubunMatch('실제원가')], expect: 'SPECIFIC', name: 'C-2: 자재 실제원가 (SPECIFIC)' },
  { q: 'F2A11220-05000720B 자재 매출원가 알려줘',  cm: [zcgubunMatch('매출원가')], expect: 'SPECIFIC', name: 'C-3: 자재 매출원가 (SPECIFIC)' },
  { q: 'F2A11220-05000720B 자재 표준원가 알려줘',  cm: [zcgubunMatch('표준원가')], expect: 'SPECIFIC', name: 'C-4: 자재 표준원가 (SPECIFIC)' },
  { q: 'F2A11220-05000720B 자재 원가 알려줘',      cm: [], expect: 'GENERIC',  name: 'C-5: LBKUM=0 케이스도 GENERIC (SQL 레벨에서 NULLIF 방어)' },
  { q: 'F2A11220-05000720B 실제원가 총액 알려줘',  cm: [zcgubunMatch('실제원가')], expect: 'skip_total_intent', name: 'C-6: 총액 명시 (스킵)' },
];
for (const s of cases) {
  const b = detectBranch({ query: s.q, columnMatches: s.cm, tableWhitelist: WL });
  assert(b === s.expect, `${s.name}: 예상=${s.expect}, 실제=${b}`);
}

// ═══════════════════════════════════════════════════════════════════════
// [D] server.mjs 소스에 GENERIC 힌트 문구 반영 확인
// ═══════════════════════════════════════════════════════════════════════
section('[D] server.mjs 소스 반영 확인');

const serverSrc = fs.readFileSync(SERVER_MJS, 'utf-8');

assert(serverSrc.includes('GENERIC_COST_INTENT_RE'), 'D-1: GENERIC_COST_INTENT_RE 정규식 상수 존재');
assert(serverSrc.includes('hasGenericCostIntent'), 'D-2: hasGenericCostIntent 플래그 존재');
assert(serverSrc.includes('제품별 원가 GENERIC 조회'), 'D-3: GENERIC 분기 힌트 헤더 문구 존재');
assert(serverSrc.includes('ZCGUBUN 을 실제원가나 매출원가 중 하나로 **임의 확정하지 마세요**'), 'D-4: 임의 확정 금지 문구 존재');
assert(serverSrc.includes("MATERIAL          AS '자재코드'"), 'D-5: SELECT 1번 자재코드 존재');
assert(serverSrc.includes("ZCGUBUN_D         AS '원가 대구분'"), 'D-6: SELECT 3번 원가 대구분 존재');
assert(serverSrc.includes("ZCGUBUN           AS '원가구분'"), 'D-7: SELECT 4번 원가구분 존재');
assert(serverSrc.includes("SUM(TOTAL)        AS '원가 총액'"), 'D-8: SELECT 5번 원가 총액 존재');
assert(serverSrc.includes("SUM(LBKUM)        AS '생산수량'"), 'D-9: SELECT 6번 생산수량 존재');
assert(serverSrc.includes("ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) AS '원가 단가'"), 'D-10: SELECT 8번 원가 단가 존재');
assert(serverSrc.includes('GROUP BY MATERIAL, ZCGUBUN_D, ZCGUBUN'), 'D-11: GROUP BY 3중 지시 존재');
assert(serverSrc.includes("CASE WHEN ZCGUBUN = '표준원가' THEN 2 ELSE 1 END"), 'D-12: 표준원가 마지막 ORDER BY 존재');
assert(serverSrc.includes("WHERE 절에 ZCGUBUN 필터를 **절대 넣지 마세요**"), 'D-13: ZCGUBUN WHERE 금지 지시 존재');
assert(serverSrc.includes('8컬럼 GENERIC 힌트 주입'), 'D-14: GENERIC 로그 태그 존재');
assert(serverSrc.includes('validateCostBasisSqlIntegrity'), 'D-15: post-validation 함수 정의 존재');
assert(serverSrc.includes('[CostBasisIntegrity]'), 'D-16: post-validation 로그 태그 존재');

// ═══════════════════════════════════════════════════════════════════════
// [E] validateCostBasisSqlIntegrity — V1 (alias/expression 무결성)
// ═══════════════════════════════════════════════════════════════════════
section('[E] V1: alias/expression 무결성');

// E-1: alias='원가' + SUM(TOTAL) 단독 → 위반
{
  const sql = "SELECT MATERIAL AS '자재코드', SUM(TOTAL) AS '원가' FROM sys_aimd_cot015 WHERE MATERIAL='X' GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 원가 알려줘', tableWhitelist: WL });
  assert(!r.valid, 'E-1: alias 원가 + SUM(TOTAL) 단독 → 위반 감지');
  assert(r.violations.some(v => v.startsWith('V1:')), 'E-1: V1 위반 유형');
}

// E-2: alias='실제원가' + SUM(TOTAL) 단독 → 위반
{
  const sql = "SELECT MATERIAL AS '자재코드', SUM(TOTAL) AS '실제원가' FROM sys_aimd_cot015 WHERE ZCGUBUN='실제원가' GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 실제원가 알려줘', tableWhitelist: WL });
  assert(!r.valid, 'E-2: alias 실제원가 + SUM(TOTAL) 단독 → 위반 감지');
}

// E-3: alias='원가 총액' + SUM(TOTAL) → 정상 (총액은 SUM 정상)
{
  const sql = "SELECT MATERIAL AS '자재코드', SUM(TOTAL) AS '원가 총액' FROM sys_aimd_cot015 GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 원가 알려줘', tableWhitelist: WL });
  assert(r.valid, 'E-3: alias 원가 총액 + SUM(TOTAL) → 정상');
}

// E-4: alias='원가 단가' + 정상 나눗셈 → 통과
{
  const sql = "SELECT MATERIAL AS '자재코드', ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM),0), 0) AS '원가 단가' FROM sys_aimd_cot015 GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 실제원가 알려줘', tableWhitelist: WL });
  assert(r.valid, 'E-4: 정상 원가 단가 산식 → 통과');
}

// E-5: 총액 명시 시 SUM(TOTAL) alias='원가' 도 허용 (예외)
{
  const sql = "SELECT MATERIAL AS '자재코드', SUM(TOTAL) AS '원가' FROM sys_aimd_cot015 GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '실제원가 총액 알려줘', tableWhitelist: WL });
  assert(r.valid, 'E-5: 총액 명시 시 SUM(TOTAL) alias 원가 허용');
}

// E-6: sys_aimd_cot015 미사용 → 검증 스킵
{
  const sql = "SELECT SUM(ZAMT001) AS '원가' FROM bw_profitability_data";
  const r = validateCostBasisSqlIntegrity({ sql, query: '원가 알려줘', tableWhitelist: WL });
  assert(r.valid, 'E-6: cot015 미사용 SQL → 검증 스킵');
}

// E-7: 스코프 밖 → 검증 스킵
{
  const sql = "SELECT SUM(TOTAL) AS '원가' FROM sys_aimd_cot015";
  const r = validateCostBasisSqlIntegrity({ sql, query: '원가 알려줘', tableWhitelist: ['bw_profitability_data'] });
  assert(r.valid, 'E-7: cot015 스코프 밖 → 검증 스킵');
}

// ═══════════════════════════════════════════════════════════════════════
// [F] validateCostBasisSqlIntegrity — V2 (WHERE ZCGUBUN 임의 확정)
// ═══════════════════════════════════════════════════════════════════════
section('[F] V2: WHERE ZCGUBUN 임의 확정 감지');

// F-1: "원가" 만 물었는데 WHERE ZCGUBUN='실제원가' → 위반
{
  const sql = "SELECT MATERIAL AS '자재코드', ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM),0), 0) AS '원가 단가' FROM sys_aimd_cot015 WHERE ZCGUBUN='실제원가' GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 원가 알려줘', tableWhitelist: WL });
  assert(!r.valid, 'F-1: GENERIC 원가에 WHERE ZCGUBUN=\'실제원가\' → 위반 감지');
  assert(r.violations.some(v => v.startsWith('V2:')), 'F-1: V2 위반 유형');
}

// F-2: "원가" + WHERE ZCGUBUN IN(...) → 위반
{
  const sql = "SELECT MATERIAL, SUM(TOTAL) AS '원가 총액', ROUND(SUM(TOTAL)/NULLIF(SUM(LBKUM),0),0) AS '원가 단가' FROM sys_aimd_cot015 WHERE ZCGUBUN IN ('실제원가','표준원가') GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 원가 알려줘', tableWhitelist: WL });
  assert(!r.valid, 'F-2: GENERIC 원가에 WHERE ZCGUBUN IN(...) → 위반 감지');
}

// F-3: "원가" + WHERE ZCGUBUN 없음 → 정상
{
  const sql = "SELECT MATERIAL, ZCGUBUN_D, ZCGUBUN, SUM(TOTAL) AS '원가 총액', ROUND(SUM(TOTAL)/NULLIF(SUM(LBKUM),0),0) AS '원가 단가' FROM sys_aimd_cot015 WHERE MATERIAL='X' GROUP BY MATERIAL, ZCGUBUN_D, ZCGUBUN";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 원가 알려줘', tableWhitelist: WL });
  assert(r.valid, 'F-3: GENERIC 원가 + ZCGUBUN WHERE 없음 → 정상');
}

// F-4: "실제원가" 명시 + WHERE ZCGUBUN='실제원가' → 정상 (사용자가 지정)
{
  const sql = "SELECT MATERIAL, ROUND(SUM(TOTAL)/NULLIF(SUM(LBKUM),0),0) AS '원가 단가' FROM sys_aimd_cot015 WHERE ZCGUBUN='실제원가' GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '자재 실제원가 알려줘', tableWhitelist: WL });
  assert(r.valid, 'F-4: SPECIFIC 실제원가 + WHERE ZCGUBUN=\'실제원가\' → 정상');
}

// F-5: "원가 총액" + WHERE ZCGUBUN='실제원가' → 정상 (총액 명시)
{
  const sql = "SELECT MATERIAL, SUM(TOTAL) AS '원가 총액' FROM sys_aimd_cot015 WHERE ZCGUBUN='실제원가' GROUP BY MATERIAL";
  const r = validateCostBasisSqlIntegrity({ sql, query: '실제원가 총액 알려줘', tableWhitelist: WL });
  assert(r.valid, 'F-5: 총액 명시 → 검증 통과');
}

// ═══════════════════════════════════════════════════════════════════════
// [G] 회귀 안전성 — 기존 SPECIFIC/DELTA 분기 유지
// ═══════════════════════════════════════════════════════════════════════
section('[G] 회귀 안전성');

assert(serverSrc.includes('제품별 원가 조회 — 4컬럼 세트 필수'), 'G-1: 기존 SPECIFIC 힌트 유지');
assert(serverSrc.includes('심플 6컬럼 세트'), 'G-2: 기존 DELTA 심플 힌트 유지');
assert(serverSrc.includes('총액명시없음 → 4컬럼 세트 프롬프트 힌트 주입'), 'G-3: SPECIFIC 로그 태그 유지');
assert(serverSrc.includes('Delta의도 → 심플 6컬럼 힌트 주입'), 'G-4: DELTA 로그 태그 유지');
// [CostBasisHint] 태그가 최소 4회 (SPECIFIC 주입 / DELTA 주입 / GENERIC 주입 / 스킵) 
assert((serverSrc.match(/\[CostBasisHint\]/g) || []).length >= 4, 'G-5: CostBasisHint 로그 태그 4회 이상');
// GENERIC 분기 else if 체인 순서 확인
const branchOrder = serverSrc.match(/if \(hasDeltaIntent\)|GENERIC 원가 감지 \(ZCGUBUN 미확정\)|사용자가 "총액" 명시/g);
assert(Array.isArray(branchOrder) && branchOrder.length >= 3, 'G-6: 3분기 + 스킵 경로 모두 존재');

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(72));
console.log(`총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
console.log('='.repeat(72));

if (failCount > 0) process.exit(1);
