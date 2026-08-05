// ============================================================
// [복수 사업부 필터 인식] 회귀 테스트
// ============================================================
// 실행: node _test_division_multi.mjs
//
// 검증 범위:
//   1) detectDivisionInQuery — 배열 반환, 등장 순서 유지, 하위호환
//   2) applyDomainFilter — 문자열/배열 인자 모두 지원, IN 조건 생성
//   3) applyDivisionFromQuery — 복수 감지 시 IN 강제 주입, 단일 조건 덮어쓰기
//   4) normalizeDivisionFilter — DIVISION_NM IN ('HL','PS') 복수 교정
//   5) 전체 파이프라인 — scrub → applyDomainFilter → applyDivisionFromQuery
//
// 로딩 방식:
//   server.mjs 는 최상위에서 DB 풀/Express 초기화 등 side effect 가 있으므로
//   직접 import 하면 회귀 테스트 자체가 서버를 띄우려 시도한다.
//   그래서 필요한 함수들의 소스만 정규식으로 추출해 vm.runInNewContext 로 격리 로드한다.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, 'server.mjs');
const src = fs.readFileSync(SERVER_PATH, 'utf8');

// ------------------------------------------------------------
// helper: 함수 소스 블록을 이름으로 추출 (function <name>() { ... }  최상위 정의만)
//   - 문자열/주석/정규식 리터럴/문자 클래스 안의 '{' '}' 는 depth 계산에서 제외
// ------------------------------------------------------------
function extractFn(fnName) {
  const startRe = new RegExp(`function\\s+${fnName}\\s*\\(`, 'g');
  const m = startRe.exec(src);
  if (!m) throw new Error(`function ${fnName} not found in server.mjs`);
  const braceStart = src.indexOf('{', m.index);
  if (braceStart < 0) throw new Error(`opening brace not found for ${fnName}`);

  let depth = 0;
  let mode = 'code';  // code | sqStr | dqStr | tplStr | lineC | blockC | regex | regexClass
  let j;
  // 정규식 리터럴 판별: 직전의 non-space 토큰이 값(식별자·)·]·문자열)이면 '/' 는 나눗셈,
  // 아니면 정규식 시작. 간단한 근사로 처리.
  function prevNonSpace(idx) {
    for (let k = idx - 1; k >= 0; k--) {
      const c = src[k];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') continue;
      return c;
    }
    return '';
  }
  function couldStartRegex(idx) {
    const c = prevNonSpace(idx);
    if (c === '') return true;
    if (/[)\]\w$]/.test(c)) return false;  // 나눗셈일 가능성
    return true;
  }

  for (j = braceStart; j < src.length; j++) {
    const ch = src[j];
    const next = src[j + 1];

    if (mode === 'lineC') {
      if (ch === '\n') mode = 'code';
      continue;
    }
    if (mode === 'blockC') {
      if (ch === '*' && next === '/') { mode = 'code'; j++; }
      continue;
    }
    if (mode === 'sqStr') {
      if (ch === '\\') { j++; continue; }
      if (ch === "'") mode = 'code';
      continue;
    }
    if (mode === 'dqStr') {
      if (ch === '\\') { j++; continue; }
      if (ch === '"') mode = 'code';
      continue;
    }
    if (mode === 'tplStr') {
      if (ch === '\\') { j++; continue; }
      if (ch === '`') mode = 'code';
      // template literal 안의 ${...} 는 코드지만 여기서는 함수 스코프 depth 계산에
      // 영향 없도록 무시 (문자열 리터럴로 취급). 실제로 우리 대상 함수엔 문제되는 케이스 없음.
      continue;
    }
    if (mode === 'regex') {
      if (ch === '\\') { j++; continue; }
      if (ch === '[') { mode = 'regexClass'; continue; }
      if (ch === '/') {
        mode = 'code';
        // flag 문자 스킵 (g/i/m/s/u/y)
        while (j + 1 < src.length && /[gimsuy]/.test(src[j + 1])) j++;
      }
      continue;
    }
    if (mode === 'regexClass') {
      if (ch === '\\') { j++; continue; }
      if (ch === ']') mode = 'regex';
      continue;
    }
    // code mode
    if (ch === '/' && next === '/') { mode = 'lineC'; j++; continue; }
    if (ch === '/' && next === '*') { mode = 'blockC'; j++; continue; }
    if (ch === '/' && couldStartRegex(j)) { mode = 'regex'; continue; }
    if (ch === "'") { mode = 'sqStr'; continue; }
    if (ch === '"') { mode = 'dqStr'; continue; }
    if (ch === '`') { mode = 'tplStr'; continue; }
    if (ch === '{') { depth++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 0) { j++; break; }
      continue;
    }
  }
  return src.slice(m.index, j);
}

// 유틸 함수는 원문에서 추출하면 정규식 리터럴 안의 '}' 를 함수 종료로 오인식하는
// 케이스가 있어 아래에서 직접 재정의한다 (server.mjs 원본과 동일한 로직).
const escapeRegexSrc = `
function escapeRegex(str) {
  return String(str).replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
}
`;

// EQ_MAP 은 normalizeDivisionFilter 함수 내부 지역변수라 그대로 함께 로드됨
const bundle = [
  escapeRegexSrc,
  extractFn('scrubDivisionFilter'),
  extractFn('applyDomainFilter'),
  extractFn('detectDivisionInQuery'),
  extractFn('normalizeDivisionFilter'),
  extractFn('applyDivisionFromQuery'),
].join('\n\n');

// vm 컨텍스트에 로드 (console 은 조용히 삼킨다 — 로그 잡음 방지)
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
};
vm.createContext(sandbox);
vm.runInContext(bundle, sandbox);
vm.runInContext(`
  globalThis.__exports = {
    scrubDivisionFilter,
    applyDomainFilter,
    detectDivisionInQuery,
    normalizeDivisionFilter,
    applyDivisionFromQuery,
  };
`, sandbox);
const {
  scrubDivisionFilter,
  applyDomainFilter,
  detectDivisionInQuery,
  normalizeDivisionFilter,
  applyDivisionFromQuery,
} = sandbox.__exports;

// ------------------------------------------------------------
// 테스트 러너
// ------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];

function eq(actual, expected, label) {
  const a = typeof actual === 'string' ? actual : JSON.stringify(actual);
  const e = typeof expected === 'string' ? expected : JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✅ ${label}`);
  } else {
    fail++;
    failures.push({ label, expected: e, actual: a });
    console.log(`  ❌ ${label}`);
    console.log(`      expected: ${e}`);
    console.log(`      actual  : ${a}`);
  }
}

function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✅ ${label}`); }
  else { fail++; failures.push({ label }); console.log(`  ❌ ${label}`); }
}

// SQL 정규화 — 공백/대소문자 무시 비교용
function normSql(s) {
  return String(s).replace(/\s+/g, ' ').trim();
}
function sqlEq(actual, expected, label) {
  eq(normSql(actual), normSql(expected), label);
}

// ============================================================
// [1] detectDivisionInQuery — 감지
// ============================================================
console.log('\n▶ [1/5] detectDivisionInQuery — 단일/복수/등장순서/오탐방지');

{
  const r = detectDivisionInQuery('이번 달 매출');
  eq(r.divisions, [], '언급 없음 → divisions=[]');
  eq(r.isMulti, false, '언급 없음 → isMulti=false');
  eq(r.division, null, '언급 없음 → division=null (하위호환)');
}
{
  const r = detectDivisionInQuery('PS 매출');
  eq(r.divisions, ['10'], 'PS 단일 → [10]');
  eq(r.divisionCode, 'PS', '하위호환 divisionCode=PS');
  eq(r.isMulti, false, 'PS 단일 → isMulti=false');
}
{
  const r = detectDivisionInQuery('홈앤라이프 SKU별');
  eq(r.divisions, ['20'], '홈앤라이프 단일 → [20]');
  eq(r.isMulti, false, '한글 별칭 단일 → isMulti=false');
}
{
  const r = detectDivisionInQuery('PS, HL SKU별 매출 TOP 5');
  eq(r.divisions, ['10', '20'], 'PS, HL 복수 → [10,20] (등장순서)');
  eq(r.divisionCodes, ['PS', 'HL'], '코드 순서 [PS,HL]');
  eq(r.isMulti, true, '복수 → isMulti=true');
  eq(r.division, '10', '하위호환 첫 번째=10');
}
{
  const r = detectDivisionInQuery('HL과 PS 비교');
  eq(r.divisions, ['20', '10'], 'HL, PS 순서 → [20,10]');
  eq(r.isMulti, true, '순서 반대여도 isMulti=true');
}
{
  const r = detectDivisionInQuery('페이퍼솔루션 사업부와 홈앤라이프 사업부');
  eq(r.divisions, ['10', '20'], '한글 풀네임 복수 감지');
}
{
  // 오탐 방지
  const r1 = detectDivisionInQuery('HELP 필요해');
  eq(r1.divisions, [], '"HELP" 는 HL 오탐 안 됨');
  const r2 = detectDivisionInQuery('APS 문서');
  eq(r2.divisions, [], '"APS" 는 PS 오탐 안 됨');
  const r3 = detectDivisionInQuery('psi 컬럼');
  eq(r3.divisions, [], '"psi" 는 PS 오탐 안 됨 (뒤에 영문)');
}
{
  const r = detectDivisionInQuery('');
  eq(r.divisions, [], '빈 문자열 안전');
  const r2 = detectDivisionInQuery(null);
  eq(r2.divisions, [], 'null 안전');
}

// ============================================================
// [2] applyDomainFilter — 문자열/배열 인자, IN 생성
// ============================================================
console.log('\n▶ [2/5] applyDomainFilter — 문자열/배열/IN 조건');

{
  // 단일 (기존 동작 회귀)
  const out = applyDomainFilter(
    `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`,
    'PS'
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION = '10' AND (CALMONTH='202608')`,
    '단일 PS → DIVISION=\'10\' AND (...) 회귀'
  );
}
{
  // 배열 — 단일 요소
  const out = applyDomainFilter(
    `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`,
    ['HL']
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION = '20' AND (CALMONTH='202608')`,
    '배열 [HL] → DIVISION=\'20\' (단일로 축약)'
  );
}
{
  // 배열 — 복수
  const out = applyDomainFilter(
    `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`,
    ['PS', 'HL']
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20') AND (CALMONTH='202608')`,
    '배열 [PS,HL] → DIVISION IN (\'10\',\'20\')'
  );
}
{
  // 배열 — 순서 반전
  const out = applyDomainFilter(
    `SELECT * FROM bw_profitability_data`,
    ['HL', 'PS']
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('20','10')`,
    '배열 [HL,PS] → 순서 유지 IN (\'20\',\'10\')'
  );
}
{
  // 배열 — 중복 제거
  const out = applyDomainFilter(
    `SELECT * FROM bw_profitability_data WHERE X=1`,
    ['PS', 'PS', 'HL']
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20') AND (X=1)`,
    '배열 중복 제거'
  );
}
{
  // MGMT 는 no-op
  const inSql = `SELECT * FROM bw_profitability_data WHERE X=1`;
  const out = applyDomainFilter(inSql, 'MGMT');
  eq(out, inSql, 'MGMT → no-op');
}
{
  // 이미 DIVISION 조건 있으면 skip
  const inSql = `SELECT * FROM bw_profitability_data WHERE DIVISION='10' AND X=1`;
  const out = applyDomainFilter(inSql, ['PS', 'HL']);
  eq(out, inSql, '기존 DIVISION 조건 있으면 skip (배열 인자에서도)');
}
{
  // 배열이지만 유효값 없음
  const inSql = `SELECT * FROM bw_profitability_data WHERE X=1`;
  const out = applyDomainFilter(inSql, ['MGMT', null, '']);
  eq(out, inSql, '유효 코드 없는 배열 → no-op');
}

// ============================================================
// [3] applyDivisionFromQuery — 복수 감지 시 IN 강제 주입
// ============================================================
console.log('\n▶ [3/5] applyDivisionFromQuery — 복수 감지 및 단일 조건 덮어쓰기');

{
  // 단일 감지, 기존 조건 없음 → 주입
  const out = applyDivisionFromQuery(
    `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`,
    'HL 매출'
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION = '20' AND (CALMONTH='202608')`,
    '단일 HL 감지 → DIVISION=\'20\' 주입'
  );
}
{
  // 단일 감지, 기존 조건 있음 → skip (기존 정책 유지)
  const inSql = `SELECT * FROM bw_profitability_data WHERE DIVISION='10' AND CALMONTH='202608'`;
  const out = applyDivisionFromQuery(inSql, 'HL 매출');
  eq(out, inSql, '단일 감지 + 기존 조건 → skip (하위호환)');
}
{
  // 복수 감지, 기존 조건 없음 → IN 주입
  const out = applyDivisionFromQuery(
    `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`,
    'PS, HL SKU별 매출 TOP 5'
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20') AND (CALMONTH='202608')`,
    '복수 감지 → DIVISION IN 주입'
  );
}
{
  // ★ 핵심: 복수 감지 + 기존 단일 DIVISION 조건 → 덮어씀
  const inSql = `SELECT * FROM bw_profitability_data WHERE DIVISION='10' AND CALMONTH='202608'`;
  const out = applyDivisionFromQuery(inSql, 'PS 와 HL 비교');
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20') AND (CALMONTH='202608')`,
    '★복수 감지 + 기존 단일 조건 → IN 으로 재작성 (덮어쓰기)'
  );
}
{
  // 복수 감지 + 이미 정확한 IN 조건 → skip (idempotent)
  const inSql = `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20') AND CALMONTH='202608'`;
  const out = applyDivisionFromQuery(inSql, 'PS 와 HL 비교');
  eq(out, inSql, '이미 원하는 IN 조건 있음 → idempotent skip');
}
{
  // 복수 감지 + IN 이지만 원하는 값 일부만 있음 → 덮어씀
  const inSql = `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','30') AND CALMONTH='202608'`;
  const out = applyDivisionFromQuery(inSql, 'PS 와 HL 비교');
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20') AND (CALMONTH='202608')`,
    'IN 이지만 원하는 코드 누락 → 재작성'
  );
}
{
  // 언급 없음 → no-op
  const inSql = `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`;
  const out = applyDivisionFromQuery(inSql, '이번 달 매출');
  eq(out, inSql, '언급 없음 → no-op');
}

// ============================================================
// [4] normalizeDivisionFilter — DIVISION_NM IN 복수 교정
// ============================================================
console.log('\n▶ [4/5] normalizeDivisionFilter — DIVISION_NM IN 복수/단일 교정');

{
  // 기존 회귀: 단일 = 교정
  const out = normalizeDivisionFilter(
    `SELECT * FROM bw_profitability_data WHERE DIVISION_NM='HL' AND CALMONTH='202608'`
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION = '20' AND CALMONTH='202608'`,
    "회귀: DIVISION_NM='HL' → DIVISION='20'"
  );
}
{
  // 기존 회귀: 단일 LIKE 교정
  const out = normalizeDivisionFilter(
    `SELECT * FROM bw_profitability_data WHERE DIVISION_NM LIKE '%페이퍼솔루션%'`
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION = '10'`,
    "회귀: DIVISION_NM LIKE '%페이퍼솔루션%' → DIVISION='10'"
  );
}
{
  // 신규: DIVISION_NM IN ('HL','PS') → DIVISION IN ('20','10')
  const out = normalizeDivisionFilter(
    `SELECT * FROM bw_profitability_data WHERE DIVISION_NM IN ('HL','PS') AND CALMONTH='202608'`
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('20','10') AND CALMONTH='202608'`,
    "신규: DIVISION_NM IN ('HL','PS') → DIVISION IN ('20','10')"
  );
}
{
  // 신규: DIVISION_NM IN ('페이퍼솔루션','홈앤라이프')
  const out = normalizeDivisionFilter(
    `SELECT * FROM bw_profitability_data WHERE DIVISION_NM IN ('페이퍼솔루션','홈앤라이프')`
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20')`,
    "신규: 한글 별칭 IN → DIVISION IN ('10','20')"
  );
}
{
  // 신규: IN 원소 하나 → DIVISION = '...' 로 축약
  const out = normalizeDivisionFilter(
    `SELECT * FROM bw_profitability_data WHERE DIVISION_NM IN ('HL')`
  );
  sqlEq(
    out,
    `SELECT * FROM bw_profitability_data WHERE DIVISION = '20'`,
    "신규: IN ('HL') 단일 원소 → DIVISION='20'"
  );
}
{
  // 신규: 미지의 값 섞이면 건드리지 않음 (안전)
  const inSql = `SELECT * FROM bw_profitability_data WHERE DIVISION_NM IN ('HL','생활용품')`;
  const out = normalizeDivisionFilter(inSql);
  eq(out, inSql, "안전: 미지값 포함 IN → 원본 유지");
}
{
  // NOT IN 은 정책상 skip
  const inSql = `SELECT * FROM bw_profitability_data WHERE DIVISION_NM NOT LIKE '%HL%'`;
  const out = normalizeDivisionFilter(inSql);
  eq(out, inSql, "NOT LIKE → 건드리지 않음 (부정 의미 보존)");
}

// ============================================================
// [5] 전체 파이프라인 — normalize → scrub → applyDomainFilter → applyDivisionFromQuery
// ============================================================
console.log('\n▶ [5/5] 전체 파이프라인 통합 시나리오');

function pipeline(sql, activeDomain, query) {
  let s = sql;
  s = normalizeDivisionFilter(s);
  s = scrubDivisionFilter(s);
  s = applyDomainFilter(s, activeDomain);
  s = applyDivisionFromQuery(s, query);
  return s;
}

{
  // 시나리오 A: PS 도메인 사용자 + "PS, HL SKU별 TOP 5" 질문
  //   → applyDomainFilter 가 DIVISION='10' 을 먼저 넣지만
  //   → applyDivisionFromQuery 가 복수 감지해서 IN 으로 재작성
  const rawSql = `SELECT MATERIAL, SUM(ZAMT001) FROM bw_profitability_data WHERE CALMONTH='202608' GROUP BY MATERIAL`;
  const out = pipeline(rawSql, 'PS', 'PS, HL SKU별 매출 TOP 5');
  assert(
    /DIVISION\s+IN\s*\(\s*'10'\s*,\s*'20'\s*\)/.test(out),
    '★ 시나리오 A: PS 사용자 + "PS, HL" 복수 질의 → 최종 DIVISION IN (\'10\',\'20\')'
  );
  assert(
    !/DIVISION\s*=\s*'10'/.test(out),
    '   ↳ 단일 DIVISION=\'10\' 조건이 남아있지 않음'
  );
}
{
  // 시나리오 B: MGMT 도메인 + "PS, HL 매출" (질의 기반 강제 주입)
  const rawSql = `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`;
  const out = pipeline(rawSql, 'MGMT', 'PS, HL 매출');
  assert(
    /DIVISION\s+IN\s*\(\s*'10'\s*,\s*'20'\s*\)/.test(out),
    '시나리오 B: MGMT + 질의문 "PS, HL" → IN 주입'
  );
}
{
  // 시나리오 C: 학습 SQL 재사용 — 이전에 학습된 SQL 이 DIVISION='10' 을 갖고 있는데
  //   현재 질의는 "PS, HL" 이므로 scrub 후 IN 재주입
  const learnedSql = `SELECT * FROM bw_profitability_data WHERE DIVISION='10' AND CALMONTH='202608'`;
  const out = pipeline(learnedSql, 'MGMT', 'PS와 HL 매출 비교');
  assert(
    /DIVISION\s+IN\s*\(\s*'10'\s*,\s*'20'\s*\)/.test(out),
    '시나리오 C: 학습 SQL (DIVISION=\'10\') + "PS와 HL" 질의 → IN 재주입'
  );
  assert(
    !/DIVISION\s*=\s*'10'/.test(out),
    '   ↳ 이전 단일 조건이 남아있지 않음'
  );
}
{
  // 시나리오 D: GPT 가 올바른 IN 조건을 만든 경우 그대로 유지
  const gptSql = `SELECT * FROM bw_profitability_data WHERE DIVISION IN ('10','20') AND CALMONTH='202608'`;
  const out = pipeline(gptSql, 'MGMT', 'PS와 HL SKU별 매출');
  assert(
    /DIVISION\s+IN\s*\(\s*'10'\s*,\s*'20'\s*\)/.test(out),
    '시나리오 D: GPT 올바른 IN 조건 → 유지 (idempotent)'
  );
}
{
  // 시나리오 E: 단일 사업부 회귀 — 기존 동작이 깨지지 않음
  const rawSql = `SELECT * FROM bw_profitability_data WHERE CALMONTH='202608'`;
  const out = pipeline(rawSql, 'HL', 'HL 이번 달');
  assert(
    /DIVISION\s*=\s*'20'/.test(out),
    '시나리오 E (회귀): HL 도메인 + HL 언급 → DIVISION=\'20\''
  );
  assert(
    !/DIVISION\s+IN\b/.test(out),
    '   ↳ 불필요한 IN 조건 생성 안 됨'
  );
}
{
  // 시나리오 F: LLM 이 잘못 만든 DIVISION_NM 복수 IN → 자동 교정 후 pipeline 유지
  const badSql = `SELECT * FROM bw_profitability_data WHERE DIVISION_NM IN ('PS','HL') AND CALMONTH='202608'`;
  const out = pipeline(badSql, 'MGMT', 'PS 와 HL 매출');
  assert(
    /DIVISION\s+IN\s*\(\s*'10'\s*,\s*'20'\s*\)/.test(out),
    '시나리오 F: DIVISION_NM IN → DIVISION IN 교정 + 유지'
  );
  assert(
    !/DIVISION_NM\s+IN/i.test(out),
    '   ↳ DIVISION_NM IN 원본 조건 제거됨'
  );
}

// ------------------------------------------------------------
// 결과
// ------------------------------------------------------------
console.log('\n=== 검증 결과 ===');
console.log(`  Pass: ${pass}`);
console.log(`  Fail: ${fail}`);
if (fail > 0) {
  console.log('\n실패 케이스:');
  for (const f of failures) {
    console.log(`  - ${f.label}`);
    if (f.expected !== undefined) {
      console.log(`      expected: ${f.expected}`);
      console.log(`      actual  : ${f.actual}`);
    }
  }
  console.log('\n❌ [복수 사업부 필터 인식] 검증 실패');
  process.exit(1);
} else {
  console.log('\n✅ [복수 사업부 필터 인식] 회귀 검증 통과');
}
