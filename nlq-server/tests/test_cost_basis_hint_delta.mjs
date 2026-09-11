/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_cost_basis_hint_delta.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상: server.mjs 의 "제품별 원가 비교(Delta) 분석 프롬프트 힌트"
 *       및 index.html 의 "증감 컬럼 시각 강조" 로직.
 *
 * 배경 (사용자 신고 2026-09-12):
 *   "전월대비 제품별 실제원가 증가액 TOP 10" 예시질문에서 SUM(TOTAL) 총액
 *   증가액만 비교하고 있음. PR #437 에서 도입한 "단가 기반 조회" 원칙이
 *   비교 분석 쿼리(월별 PIVOT)에는 적용되지 않는 문제.
 *   → 비교 의도 감지 시 PIVOT 확장 힌트를 별도로 주입:
 *      (기간별 총액/수량/단가) × 2기간 + 단위 + "단가 증가액" 컬럼
 *      정렬 기준도 반드시 "단가 증가액" DESC (총액 증가액 아님)
 *
 * 검증 항목:
 *   [A] Delta 의도 감지 정규식 매트릭스
 *   [B] 트리거 조건 매트릭스 (기존 CostBasisHint 트리거 + Delta 의도)
 *   [C] Case 시나리오 (전월대비/전년대비/증가액/차이 등)
 *   [D] server.mjs 소스에 PIVOT 확장 힌트 문구 반영 확인
 *   [E] 회귀 안전성 — 기존 단순 조회 4컬럼 세트 힌트 유지
 *   [F] index.html: isDeltaColumn 유틸 존재 & 정확도
 *   [G] index.html: 증감 컬럼 시각 강조 적용점 존재 확인
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_MJS = path.resolve(__dirname, '../server.mjs');
const INDEX_HTML = path.resolve(__dirname, '../public/index.html');

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

// ── 로직 재현 (server.mjs 와 로직상 동일) ─────────────────────────────
// server.mjs 실제 정규식 (line ~4210 부근) 과 완전히 동일한 순수 로직.
const EXPLICIT_TOTAL_INTENT_RE = /(총액|총금액|총원가|총합|합계|총\s*발생액|총\s*금액)/;
const DELTA_INTENT_RE = /(전월\s*대비|전년\s*대비|전년\s*동월\s*대비|전분기\s*대비|MoM|YoY|\d+\s*월\s*대비|\d+\s*년\s*대비|대비|비교|증가액|감소액|증감액|증감|증가율|감소율|차이|변동|상승률|하락률)/i;

function computeTrigger({ query, columnMatches, tableWhitelist }) {
  const hasCot015Scope = Array.isArray(tableWhitelist)
    && tableWhitelist.includes('sys_aimd_cot015');
  const hasZcgubunMatch = (columnMatches || []).some(m =>
    String(m.column_name || '').toUpperCase() === 'ZCGUBUN'
  );
  const hasExplicitTotalIntent = EXPLICIT_TOTAL_INTENT_RE.test(String(query || ''));
  const hasDeltaIntent = DELTA_INTENT_RE.test(String(query || ''));
  const wouldTriggerBase = hasCot015Scope && hasZcgubunMatch && !hasExplicitTotalIntent;
  const branchPivot = wouldTriggerBase && hasDeltaIntent;
  const branchSimple = wouldTriggerBase && !hasDeltaIntent;
  return {
    hasCot015Scope, hasZcgubunMatch, hasExplicitTotalIntent,
    hasDeltaIntent, wouldTriggerBase, branchPivot, branchSimple,
  };
}

// isDeltaColumn 로직 재현 (index.html 실제 코드와 동일)
function isDeltaColumn(col, label) {
  const s = (String(col || '') + ' ' + String(label || '')).trim();
  if (!s) return false;
  if (/증가액|감소액|증감액|증감률|증가율|감소율|변동액|변동률|상승률|하락률/.test(s)) return true;
  if (/(증감|차이|변동|상승|하락)(\s|$|\(|_)/.test(s)) return true;
  // 영문 시그널 (컬럼명에 흔한 delta_cost / diff_value / change_rate 형태도 감지)
  if (/\b(delta|diff|change|growth|variation)/i.test(s)) return true;
  if (/[Δ▲▼]/.test(s)) return true;
  return false;
}

const zcgubunMatch = (val) => ({
  column_name: 'ZCGUBUN', data_type: 'varchar(20)',
  matchedKeyword: val, synonym: val, source: 'ontology',
});

// ═══════════════════════════════════════════════════════════════════════
// [A] Delta 의도 감지 정규식 매트릭스
// ═══════════════════════════════════════════════════════════════════════
section('[A] Delta 의도 감지 정규식 매트릭스');

const deltaPositive = [
  '전월대비 제품별 실제원가 증가액 TOP 10',
  '전년대비 실제원가 감소액',
  '전년동월대비 증가율',
  '전분기 대비 원가 변동',
  '2026년 7월 대비 8월 실제원가 증가액',
  'MoM 실제원가',
  'YoY 실제원가',
  '실제원가 증감액 TOP 5',
  '원가 차이 큰 제품',
  '실제원가 상승률 TOP 10',
  '실제원가 하락률',
];
for (const q of deltaPositive) {
  assert(DELTA_INTENT_RE.test(q), `Delta 의도 감지: "${q}"`);
}

const deltaNegative = [
  '제품별 실제원가 TOP 5',
  '자재 실제원가 알려줘',
  '제품별 매출원가',
  '설비별 총원가 TOP 5',
];
for (const q of deltaNegative) {
  assert(!DELTA_INTENT_RE.test(q), `Delta 의도 미감지 (정상): "${q}"`);
}

// ═══════════════════════════════════════════════════════════════════════
// [B] 트리거 조건 매트릭스 (기존 CostBasisHint + Delta)
// ═══════════════════════════════════════════════════════════════════════
section('[B] 트리거 조건 매트릭스 (2x2x2x2 조합)');

const WL_COT015 = ['sys_aimd_cot015'];
const WL_OTHER = ['bw_profitability_data'];
const M_ZCG = [zcgubunMatch('실제원가')];
const M_EMPTY = [];

// B-1: 모든 조건 만족 (COT015 + ZCGUBUN + 총액명시X + Delta의도O) → branchPivot
{
  const t = computeTrigger({
    query: '전월대비 제품별 실제원가 증가액 TOP 10',
    columnMatches: M_ZCG, tableWhitelist: WL_COT015,
  });
  assert(t.branchPivot === true, 'B-1: [COT015+ZCG+총액X+Delta] → PIVOT 확장 힌트 발동');
  assert(t.branchSimple === false, 'B-1: 단순 4컬럼 힌트는 발동 안 함');
}

// B-2: Delta 의도 없음 → branchSimple (기존 PR #437 힌트)
{
  const t = computeTrigger({
    query: '제품별 실제원가 TOP 5',
    columnMatches: M_ZCG, tableWhitelist: WL_COT015,
  });
  assert(t.branchSimple === true, 'B-2: [COT015+ZCG+총액X+Delta X] → 단순 4컬럼 힌트 (회귀 안전)');
  assert(t.branchPivot === false, 'B-2: PIVOT 확장 힌트는 발동 안 함');
}

// B-3: 총액 명시 → 전체 스킵 (Delta 있어도)
{
  const t = computeTrigger({
    query: '전월대비 실제원가 총액 증가액 TOP 10',
    columnMatches: M_ZCG, tableWhitelist: WL_COT015,
  });
  assert(t.branchPivot === false, 'B-3: 총액 명시 시 PIVOT 힌트 스킵');
  assert(t.branchSimple === false, 'B-3: 총액 명시 시 단순 힌트도 스킵 (SUM(TOTAL) 허용)');
}

// B-4: ZCGUBUN 매칭 없음 → 전체 스킵
{
  const t = computeTrigger({
    query: '전월대비 매출 증가액 TOP 10',
    columnMatches: M_EMPTY, tableWhitelist: WL_COT015,
  });
  assert(t.branchPivot === false, 'B-4: ZCGUBUN 매칭 없으면 PIVOT 스킵');
  assert(t.branchSimple === false, 'B-4: ZCGUBUN 매칭 없으면 단순 힌트도 스킵');
}

// B-5: 다른 테이블 → 전체 스킵
{
  const t = computeTrigger({
    query: '전월대비 실제원가 증가액 TOP 10',
    columnMatches: M_ZCG, tableWhitelist: WL_OTHER,
  });
  assert(t.branchPivot === false, 'B-5: sys_aimd_cot015 아닌 테이블 → PIVOT 스킵');
  assert(t.branchSimple === false, 'B-5: 다른 테이블 → 단순 힌트도 스킵');
}

// B-6: 정확히 문제되었던 예시질문 케이스
{
  const t = computeTrigger({
    query: '전월대비 제품별 실제원가 증가액 TOP 10',
    columnMatches: M_ZCG, tableWhitelist: WL_COT015,
  });
  assert(t.branchPivot === true, 'B-6: [사용자 신고 케이스] 예시질문 그대로 → PIVOT 힌트 발동');
  assert(t.hasDeltaIntent === true, 'B-6: Delta 의도 True');
  assert(t.hasZcgubunMatch === true, 'B-6: ZCGUBUN 매칭 True');
  assert(t.hasExplicitTotalIntent === false, 'B-6: 총액명시 False');
  assert(t.hasCot015Scope === true, 'B-6: COT015 스코프 True');
}

// ═══════════════════════════════════════════════════════════════════════
// [C] 사용자 시나리오 케이스 (Delta 표현별)
// ═══════════════════════════════════════════════════════════════════════
section('[C] 시나리오 케이스');

const scenarios = [
  { q: '전월대비 제품별 실제원가 증가액 TOP 10', expect: 'pivot', name: 'C-1: 전월대비 증가액' },
  { q: '전년동월 대비 매출원가 증가율', expect: 'pivot', name: 'C-2: 전년동월대비 증가율' },
  { q: '2026년 5월 대비 6월 실제원가 증감액', expect: 'pivot', name: 'C-3: 특정월 대비' },
  { q: 'MoM 실제원가 분석', expect: 'pivot', name: 'C-4: MoM' },
  { q: '실제원가 상승률 TOP 10', expect: 'pivot', name: 'C-5: 상승률' },
  // 단순 조회 (기존 힌트 유지)
  { q: '제품별 실제원가 단가 TOP 5', expect: 'simple', name: 'C-6: 단순 TOP N (회귀)' },
  { q: '자재 실제원가 알려줘', expect: 'simple', name: 'C-7: 단일 조회 (회귀)' },
  // 총액 명시 (전체 스킵)
  { q: '전월대비 실제원가 총액 TOP 10', expect: 'skip', name: 'C-8: 총액 명시 (스킵)' },
];

for (const s of scenarios) {
  const t = computeTrigger({
    query: s.q, columnMatches: M_ZCG, tableWhitelist: WL_COT015,
  });
  if (s.expect === 'pivot') {
    assert(t.branchPivot === true && t.branchSimple === false, `${s.name}: PIVOT 힌트`);
  } else if (s.expect === 'simple') {
    assert(t.branchSimple === true && t.branchPivot === false, `${s.name}: 단순 힌트`);
  } else if (s.expect === 'skip') {
    assert(t.branchPivot === false && t.branchSimple === false, `${s.name}: 힌트 스킵`);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// [D] server.mjs 소스에 PIVOT 확장 힌트 문구 반영 확인
// ═══════════════════════════════════════════════════════════════════════
section('[D] server.mjs 소스 반영 확인');

const serverSrc = fs.readFileSync(SERVER_MJS, 'utf-8');

assert(
  serverSrc.includes('DELTA_INTENT_RE'),
  'D-1: DELTA_INTENT_RE 정규식 상수 존재'
);
assert(
  serverSrc.includes('hasDeltaIntent'),
  'D-2: hasDeltaIntent 플래그 존재'
);
assert(
  serverSrc.includes('제품별 원가 비교 분석'),
  'D-3: Delta 분기 힌트 헤더 문구 존재'
);
assert(
  serverSrc.includes('심플 6컬럼 세트'),
  'D-4: "심플 6컬럼 세트" 문구 존재 (옵션 A 축소 반영)'
);
assert(
  serverSrc.includes("'원가 단가 증가액'"),
  'D-5: "원가 단가 증가액" 컬럼 정의 존재'
);
assert(
  serverSrc.includes('전월 원가 단가'),
  'D-6: 전월 원가 단가 컬럼명 문구 존재'
);
assert(
  serverSrc.includes('당월 원가 단가'),
  'D-7: 당월 원가 단가 컬럼명 문구 존재'
);
assert(
  /단가.*증가액.*DESC/s.test(serverSrc),
  'D-8: "단가 증가액 DESC" 정렬 지시 존재'
);
assert(
  serverSrc.includes('총액 증가액 DESC 금지'),
  'D-9: "총액 증가액 DESC 금지" 명시 존재'
);
assert(
  /NULLIF\(SUM\(CASE WHEN CALMONTH='<전월YYYYMM>' THEN LBKUM/.test(serverSrc),
  'D-10: NULLIF 나눗셈 방지 지시 존재 (전월)'
);
assert(
  /NULLIF\(SUM\(CASE WHEN CALMONTH='<당월YYYYMM>' THEN LBKUM/.test(serverSrc),
  'D-11: NULLIF 나눗셈 방지 지시 존재 (당월)'
);
assert(
  serverSrc.includes('[CostBasisHint] sys_aimd_cot015 + ZCGUBUN='),
  'D-12: Delta 분기 로그 태그 존재'
);
assert(
  serverSrc.includes('Delta의도 → 심플 6컬럼 힌트 주입'),
  'D-13: Delta의도 심플 힌트 로그 메시지 존재'
);

// [2026-09-12 옵션 A] 6컬럼 축소 관련 assertion 추가
assert(
  serverSrc.includes('SELECT 에 절대 넣지 말 것'),
  'D-14: SELECT 금지 컬럼 섹션 존재'
);
assert(
  serverSrc.includes('SUM(TOTAL) 이나 그 CASE WHEN 변형'),
  'D-15: SUM(TOTAL) 노출 금지 문구 존재'
);
assert(
  serverSrc.includes('SUM(LBKUM) 이나 그 CASE WHEN 변형'),
  'D-16: SUM(LBKUM) 노출 금지 문구 존재'
);
assert(
  serverSrc.includes('원가 총액·생산수량 컬럼은 SELECT 에 절대 포함하지 마세요'),
  'D-17: 총액/수량 SELECT 미포함 명시 존재'
);
// Delta 분기 힌트 안에 '원가 총액(원)' alias 정의가 없음을 확인
//   (기존 10컬럼 힌트 잔재가 남지 않았는지 검증)
{
  // Delta 분기 블록만 잘라내서 검사
  const idxStart = serverSrc.indexOf('제품별 원가 비교 분석 — 심플 6컬럼');
  const idxEnd = serverSrc.indexOf('} else {', idxStart);
  const deltaBlock = idxStart >= 0 && idxEnd > idxStart
    ? serverSrc.substring(idxStart, idxEnd)
    : '';
  assert(
    deltaBlock.length > 0,
    'D-18: Delta 분기 블록 추출 성공'
  );
  assert(
    !/AS '전월 원가 총액\(원\)'/.test(deltaBlock),
    'D-19: Delta 분기에 "전월 원가 총액(원)" alias 없음 (10컬럼 잔재 제거)'
  );
  assert(
    !/AS '당월 원가 총액\(원\)'/.test(deltaBlock),
    'D-20: Delta 분기에 "당월 원가 총액(원)" alias 없음 (10컬럼 잔재 제거)'
  );
  assert(
    !/AS '전월 생산수량'/.test(deltaBlock),
    'D-21: Delta 분기에 "전월 생산수량" alias 없음 (10컬럼 잔재 제거)'
  );
  assert(
    !/AS '당월 생산수량'/.test(deltaBlock),
    'D-22: Delta 분기에 "당월 생산수량" alias 없음 (10컬럼 잔재 제거)'
  );
}

// ═══════════════════════════════════════════════════════════════════════
// [E] 회귀 안전성 — 기존 4컬럼 세트 힌트 유지
// ═══════════════════════════════════════════════════════════════════════
section('[E] 회귀 안전성 (기존 힌트 유지)');

assert(
  serverSrc.includes('제품별 원가 조회 — 4컬럼 세트 필수'),
  'E-1: 기존 4컬럼 세트 힌트 헤더 유지'
);
assert(
  /SUM\(TOTAL\)\s+AS '원가 총액\(원\)'/.test(serverSrc),
  'E-2: 기존 힌트 SUM(TOTAL) 컬럼 유지'
);
assert(
  /SUM\(LBKUM\)\s+AS '생산수량'/.test(serverSrc),
  'E-3: 기존 힌트 SUM(LBKUM) 컬럼 유지'
);
assert(
  serverSrc.includes("MAX(BASE_UOM) AS '단위'"),
  'E-4: 기존 힌트 MAX(BASE_UOM) 컬럼 유지'
);
assert(
  serverSrc.includes('AVG(TOTAL / LBKUM)'),
  'E-5: AVG 금지 규칙 유지 (양 분기 공통)'
);
// 두 분기 모두에서 로그가 나오는지 확인
assert(
  (serverSrc.match(/\[CostBasisHint\]/g) || []).length >= 3,
  'E-6: [CostBasisHint] 로그 태그 최소 3회 (PIVOT/단순/스킵)'
);

// ═══════════════════════════════════════════════════════════════════════
// [F] index.html: isDeltaColumn 유틸 존재 & 정확도
// ═══════════════════════════════════════════════════════════════════════
section('[F] index.html isDeltaColumn 정확도');

const positiveNames = [
  { c: '원가 단가 증가액', l: '원가 단가 증가액' },
  { c: '전월대비 증가액(원)', l: '전월대비 증가액(원)' },
  { c: '증감액', l: '증감액' },
  { c: '단가_증감', l: '단가_증감' },
  { c: '실제원가 감소액', l: '실제원가 감소액' },
  { c: '증가율', l: '증가율' },
  { c: '변동액', l: '변동액' },
  { c: '상승률', l: '상승률' },
  { c: '하락률', l: '하락률' },
  { c: 'delta_cost', l: 'delta_cost' },
  { c: 'DIFF', l: 'DIFF' },
  { c: 'Δ원가', l: 'Δ원가' },
  { c: '증가액', l: '전월(2026년 7월)대비 증가액(원)' },
];
for (const p of positiveNames) {
  assert(isDeltaColumn(p.c, p.l), `F-P: Delta 감지 "${p.l}"`);
}

const negativeNames = [
  { c: 'MATERIAL', l: '제품코드' },
  { c: 'MATERIAL_NM', l: '제품명' },
  { c: 'SUM_TOTAL', l: '원가 총액(원)' },
  { c: 'SUM_LBKUM', l: '생산수량' },
  { c: 'BASE_UOM', l: '단위' },
  { c: 'UNIT_PRICE', l: '원가 단가' },
  { c: 'CALMONTH', l: '연월' },
  { c: 'DIVISION', l: '사업부' },
  { c: 'PLANT', l: '플랜트' },
  { c: 'PROFIT_CTR_NM', l: '이익센터명' },
];
for (const n of negativeNames) {
  assert(!isDeltaColumn(n.c, n.l), `F-N: 일반 컬럼 미감지 (정상) "${n.l}"`);
}

// ═══════════════════════════════════════════════════════════════════════
// [G] index.html: 증감 컬럼 시각 강조 적용점 확인
// ═══════════════════════════════════════════════════════════════════════
section('[G] index.html 시각 강조 적용점');

const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf-8');

assert(
  /function isDeltaColumn\s*\(/.test(htmlSrc),
  'G-1: isDeltaColumn 함수 정의 존재'
);
assert(
  htmlSrc.includes('deltaColIdxSet'),
  'G-2: deltaColIdxSet Set 변수 존재'
);
assert(
  /data-delta-col="/.test(htmlSrc),
  'G-3: <th data-delta-col> 속성 존재 (헤더 강조)'
);
assert(
  htmlSrc.includes('#fff4e6'),
  'G-4: 헤더 연한 주황 배경색 (#fff4e6) 존재'
);
assert(
  htmlSrc.includes('#fffaf0'),
  'G-5: 셀 매우 연한 주황 배경색 (#fffaf0) 존재'
);
assert(
  htmlSrc.includes('#dc2626'),
  'G-6: 양수 빨강 텍스트 색상 (#dc2626) 존재'
);
assert(
  htmlSrc.includes('#2563eb'),
  'G-7: 음수 파랑 텍스트 색상 (#2563eb) 존재'
);
assert(
  htmlSrc.includes("signIcon = '▲ '"),
  'G-8: 양수 상승 아이콘 (▲) 존재'
);
assert(
  htmlSrc.includes("signIcon = '▼ '"),
  'G-9: 음수 하락 아이콘 (▼) 존재'
);
assert(
  htmlSrc.includes('deltaColIdxSet: deltaColIdxSet'),
  'G-10: analysisTableState 에 deltaColIdxSet 저장'
);

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(72));
console.log(`총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
console.log('='.repeat(72));

if (failCount > 0) process.exit(1);
