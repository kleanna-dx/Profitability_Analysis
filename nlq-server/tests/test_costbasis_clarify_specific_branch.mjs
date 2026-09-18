// ═══════════════════════════════════════════════════════════════════════
// test_costbasis_clarify_specific_branch.mjs
// ─────────────────────────────────────────────────────────────────────────
// [배경 2026-09-18]
//   사용자 신고:
//     A) "제품별 원가요소 조회해줘 (매출원가의 표준원가)" → 개당단가/총액/수량 세트 정상
//     B) "제품별 원가요소 조회해줘" → 명확화 UI [표준원가]/[매출원가의 표준원가] 클릭 → 안 나옴
//
//   두 경로가 사용자 의도상 동일하지만 시스템은 서로 다르게 판정:
//     A) 원 질의에 "매출원가"/"표준원가" 어휘 → columnMatches 에 ZCGUBUN 매칭 → SPECIFIC 분기
//     B) 원 질의에 ZCGUBUN 어휘 없음 → columnMatches 비어있음 → GENERIC 분기
//        (명확화 확정값은 areaCtx.forcedCostBasis 로 별도 전달됨)
//
//   → GENERIC 은 SPECIFIC 과 컬럼 세트가 달라서 표 형태가 달라짐 (원가 대구분/원가구분 컬럼 추가 등)
//
// [수정]
//   HAS_ZCGUBUN_MATCH 판정 시 명확화 확정 상태 (areaCtx.forcedCostBasis.value) 도 함께 고려.
//   → 명확화로 확정되면 SPECIFIC 분기로 판정 → 경로 A 와 동일한 8컬럼 세트 주입.
//
// [테스트 목적]
//   1. buildRAGSystemPrompt 시그니처에 areaCtx 옵션 추가됐는지
//   2. HAS_ZCGUBUN_MATCH 판정 로직에 forcedCostBasis 반영됐는지
//   3. SPECIFIC 분기의 detectedGubun 이 forcedCostBasis.value 로 폴백되는지
//   4. 호출부에서 areaCtx 를 전달하는지
//   5. 회귀 안전: forcedCostBasis 없으면 기존 로직 그대로
// ═══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_MJS = path.join(__dirname, '..', 'server.mjs');
const src = fs.readFileSync(SERVER_MJS, 'utf-8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); pass++; }
  else      { console.log(`  ❌ ${msg}`); fail++; }
}
function section(t) {
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  ${t}`);
  console.log(`──────────────────────────────────────────────────────────`);
}

// ═══════════════════════════════════════════════════════════════════════
// [A] buildRAGSystemPrompt 시그니처 확장 검증
// ═══════════════════════════════════════════════════════════════════════
section('[A] buildRAGSystemPrompt 시그니처');

// A-1: opts 파라미터 추가됨
assert(
  /async function buildRAGSystemPrompt\(query, domainCode, tableWhitelist, opts = \{\}\)/.test(src),
  'A-1: buildRAGSystemPrompt 에 opts = {} 파라미터 추가됨'
);
// A-2: opts.areaCtx 사용
assert(
  src.includes('const _areaCtxFromOpts = opts && opts.areaCtx ? opts.areaCtx : null;'),
  'A-2: opts.areaCtx 를 _areaCtxFromOpts 로 안전하게 추출'
);

// ═══════════════════════════════════════════════════════════════════════
// [B] HAS_ZCGUBUN_MATCH 로직 확장 검증
// ═══════════════════════════════════════════════════════════════════════
section('[B] HAS_ZCGUBUN_MATCH — forcedCostBasis 반영');

// B-1: 기존 columnMatches 기반 판정 (이름 리팩터링)
assert(
  src.includes('const HAS_ZCGUBUN_MATCH_FROM_QUERY = (columnMatches || []).some'),
  'B-1: 기존 로직이 HAS_ZCGUBUN_MATCH_FROM_QUERY 로 분리됨'
);
// B-2: forcedCostBasis 감지 상수
assert(
  /const HAS_FORCED_COST_BASIS = !!\(\s*_areaCtxFromOpts && _areaCtxFromOpts\.forcedCostBasis/.test(src),
  'B-2: HAS_FORCED_COST_BASIS 상수 정의됨 (명확화 확정 여부)'
);
// B-3: 최종 HAS_ZCGUBUN_MATCH = FROM_QUERY OR FORCED
assert(
  src.includes('const HAS_ZCGUBUN_MATCH = HAS_ZCGUBUN_MATCH_FROM_QUERY || HAS_FORCED_COST_BASIS;'),
  'B-3: HAS_ZCGUBUN_MATCH = 원 질의 매칭 OR 명확화 확정 (두 경로 통합)'
);

// ═══════════════════════════════════════════════════════════════════════
// [C] SPECIFIC 분기 detectedGubun 폴백 로직
// ═══════════════════════════════════════════════════════════════════════
section('[C] SPECIFIC 분기 detectedGubun — 명확화 값 폴백');

// C-1: detectedGubun 비어있고 명확화 있으면 폴백
assert(
  src.includes('if (detectedGubun.length === 0 && HAS_FORCED_COST_BASIS) {'),
  'C-1: detectedGubun 비어있고 명확화 있으면 forcedCostBasis 값으로 폴백'
);
// C-2: forcedCostBasis.value 사용
assert(
  src.includes('const fv = _areaCtxFromOpts.forcedCostBasis.value;'),
  'C-2: forcedCostBasis.value 를 detectedGubun 에 push'
);
// C-3: 로그 태그
assert(
  src.includes('[CostBasisHint] 명확화 확정값으로 SPECIFIC 분기 진입'),
  'C-3: 명확화 확정 경로 진입 시 [CostBasisHint] 로그 출력'
);

// ═══════════════════════════════════════════════════════════════════════
// [D] 호출부에서 areaCtx 전달 검증
// ═══════════════════════════════════════════════════════════════════════
section('[D] 호출부 areaCtx 전달');

// D-1: 호출부에 { areaCtx } 전달
assert(
  src.includes('await buildRAGSystemPrompt(_ragSeedQuery, activeDomain, areaCtx.tableWhitelist, { areaCtx })'),
  'D-1: analysis route 호출부에서 { areaCtx } 옵션 전달'
);

// ═══════════════════════════════════════════════════════════════════════
// [E] 4가지 경로 시뮬레이션 — 실제 판정 로직 검증
// ═══════════════════════════════════════════════════════════════════════
section('[E] 4가지 경로 시뮬레이션');

const EXPLICIT_TOTAL_INTENT_RE = /(총액|총금액|총원가|총합|합계|총\s*발생액|총\s*금액)/;
const DELTA_INTENT_RE = /(전월\s*대비|전년\s*대비|MoM|YoY|\d+\s*월\s*대비|대비|비교|증가액|감소액|증감액|증감|증가율|감소율|차이|변동|상승률|하락률)/i;
const GENERIC_COST_INTENT_RE = /(?:^|[^가-힣])(원가|자재원가|제품원가|원가요소|원가\s요소)(?![_가-힣])/;

function decideBranch(query, columnMatches, areaCtx) {
  const HAS_COT015_SCOPE = true;
  const hasExplicitTotalIntent = EXPLICIT_TOTAL_INTENT_RE.test(query);
  const hasDeltaIntent = DELTA_INTENT_RE.test(query);
  const hasGenericCostIntent = GENERIC_COST_INTENT_RE.test(query);
  const HAS_ZCGUBUN_MATCH_FROM_QUERY = columnMatches.some(m => String(m.column_name || '').toUpperCase() === 'ZCGUBUN');
  const HAS_FORCED_COST_BASIS = !!(areaCtx && areaCtx.forcedCostBasis && typeof areaCtx.forcedCostBasis.value === 'string' && areaCtx.forcedCostBasis.value.length > 0);
  const HAS_ZCGUBUN_MATCH = HAS_ZCGUBUN_MATCH_FROM_QUERY || HAS_FORCED_COST_BASIS;
  const canInjectAnyCostHint = HAS_COT015_SCOPE && !hasExplicitTotalIntent;
  if (canInjectAnyCostHint && HAS_ZCGUBUN_MATCH) return hasDeltaIntent ? 'DELTA' : 'SPECIFIC';
  if (canInjectAnyCostHint && !HAS_ZCGUBUN_MATCH && hasGenericCostIntent) return 'GENERIC';
  return '없음';
}

// E-1: 경로 A — 한번에 질의 (원래도 SPECIFIC)
assert(
  decideBranch('제품별 원가요소 조회해줘 (매출원가의 표준원가)',
    [{column_name:'ZCGUBUN', matchedKeyword:'표준원가'}, {column_name:'ZCGUBUN', matchedKeyword:'매출원가'}],
    null) === 'SPECIFIC',
  'E-1: [경로 A] 원 질의에 ZCGUBUN 어휘 → SPECIFIC (기존 정상 동작)'
);

// E-2: 경로 B — 명확화 확정 (이번 수정 대상)
assert(
  decideBranch('제품별 원가요소 조회해줘',
    [{column_name:'COSTELMNT', matchedKeyword:'원가요소'}],
    { forcedCostBasis: { value:'표준원가', zcgubunD:'소비-소비' } }) === 'SPECIFIC',
  'E-2: [경로 B] 명확화 확정 → SPECIFIC (이번 수정으로 GENERIC → SPECIFIC 로 변경)'
);

// E-3: 경로 C — 회귀 안전: 명확화도 없고 원 질의도 ZCGUBUN 없음
assert(
  decideBranch('제품별 원가요소 조회해줘',
    [{column_name:'COSTELMNT', matchedKeyword:'원가요소'}],
    null) === 'GENERIC',
  'E-3: [회귀] 명확화 없고 원 질의 ZCGUBUN 없음 → GENERIC 유지 (안전)'
);

// E-4: 경로 D — 회귀 안전: 총액 명시
assert(
  decideBranch('실제원가 총액 알려줘',
    [{column_name:'ZCGUBUN', matchedKeyword:'실제원가'}],
    null) === '없음',
  'E-4: [회귀] 총액 명시 → 힌트 미주입'
);

// E-5: 경로 E — DELTA + 명확화 (증감 분석)
assert(
  decideBranch('제품별 원가요소 전월대비 증가액',
    [{column_name:'COSTELMNT', matchedKeyword:'원가요소'}],
    { forcedCostBasis: { value:'실제원가' } }) === 'DELTA',
  'E-5: [경로 E] 명확화 + Delta 의도 → DELTA 분기 (SPECIFIC 로 넘어가면서 자동으로 DELTA 판정)'
);

// E-6: 회귀 — areaCtx.forcedCostBasis 있지만 value 가 빈 문자열이면 무시
assert(
  decideBranch('제품별 원가요소 조회',
    [{column_name:'COSTELMNT', matchedKeyword:'원가요소'}],
    { forcedCostBasis: { value:'' } }) === 'GENERIC',
  'E-6: [회귀] forcedCostBasis.value 빈 문자열 → HAS_FORCED_COST_BASIS=false → GENERIC 유지'
);

// E-7: 회귀 — areaCtx 자체가 null 이어도 안전
assert(
  decideBranch('실제원가 알려줘',
    [{column_name:'ZCGUBUN', matchedKeyword:'실제원가'}],
    null) === 'SPECIFIC',
  'E-7: [회귀] areaCtx=null 이어도 원 질의 매칭이 있으면 SPECIFIC 정상'
);

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`총 assertions: ${pass + fail}`);
console.log(`  ✅ PASS: ${pass}`);
console.log(`  ❌ FAIL: ${fail}`);
console.log(`════════════════════════════════════════════════════════════`);
if (fail > 0) process.exit(1);
