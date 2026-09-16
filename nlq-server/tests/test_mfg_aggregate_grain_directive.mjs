// [PR#457] 제조원가 aggregate 라우트 grain 지시 대칭성 회귀 테스트
//
//   목적: aggregate 라우트(buildRAGSystemPrompt 이후 systemPrompt += 블록)에서
//         detectOverallTotalIntent 판정 결과에 따라 프롬프트 지시가 대칭적으로 붙는지 검증.
//
//   시나리오:
//     1) 총합 intent 없음 ("2026년 8월 인건비 알려줘")
//        → subArea='cost-product' 일 때 "GROUP BY MATERIAL" 강제 지시 존재
//        → 1행 전체 합계 지시 부재
//     2) 총합 intent 있음 ("2026년 8월 총 인건비 알려줘")
//        → "GROUP BY 절 없이" 지시 존재
//        → "GROUP BY MATERIAL" 강제 지시 부재
//
//   방법: server.mjs 파일 텍스트를 읽어 해당 블록이 존재하고, detectOverallTotalIntent
//         함수를 실행해서 각 질의에 대한 판정 → 그에 따라 프롬프트에 어떤 지시가
//         붙어야 하는지 로직 재현 후 프롬프트 생성 함수를 격리 실행.
//
//   중요: 이 테스트는 LLM 호출 없이 순수 로직 검증. 새로운 하드코딩 규칙을 만드는
//         것이 아니라 기존 detectOverallTotalIntent 함수를 재사용해서 대칭성만 검증.

import { readFileSync } from 'node:fs';

const serverMjs = readFileSync('/home/user/webapp/nlq-server/server.mjs', 'utf8');

// ─────────────────────────────────────────────────────────────────
// 1. detectOverallTotalIntent 함수 격리 로드
// ─────────────────────────────────────────────────────────────────
const startMarker = 'function detectOverallTotalIntent(query) {';
const startIdx = serverMjs.indexOf(startMarker);
if (startIdx === -1) throw new Error('detectOverallTotalIntent 함수 시작점 없음');
let cursor = startIdx + startMarker.length;
let braceDepth = 1;
while (cursor < serverMjs.length && braceDepth > 0) {
  const ch = serverMjs[cursor];
  if (ch === '{') braceDepth++;
  else if (ch === '}') braceDepth--;
  cursor++;
}
const funcBody = serverMjs.slice(startIdx, cursor);
const globalized = funcBody.replace(
  'function detectOverallTotalIntent(query) {',
  'globalThis.detectOverallTotalIntent = function(query) {'
);
eval(globalized);
const detectOverallTotalIntent = globalThis.detectOverallTotalIntent;

// ─────────────────────────────────────────────────────────────────
// 2. aggregate 라우트의 grain 지시 로직 재현 (server.mjs L11552~ 대칭 검증용)
//    수정 후 로직과 완전히 동일해야 함.
// ─────────────────────────────────────────────────────────────────
function simulateAggregateGrainDirective(query, areaCtx) {
  let systemPrompt = '';
  if (areaCtx?.area === 'manufacturing-cost' && areaCtx?.subArea) {
    const overallIntent = detectOverallTotalIntent(query);
    const subAreaLabel = (
      areaCtx.subArea === 'cost-product' ? '제품별원가' :
      areaCtx.subArea === 'cost-dept'    ? '부서별원가' :
      areaCtx.subArea === 'cost-machine' ? '호기별원가' : areaCtx.subArea
    );
    if (overallIntent.isOverall) {
      const filterNote = (
        areaCtx.subArea === 'cost-dept'    ? '\n- 호기(설비) COSTCENTER 코드는 백엔드가 자동으로 제외합니다. WHERE 절에 COSTCENTER 조건을 넣지 마세요.' :
        areaCtx.subArea === 'cost-machine' ? '\n- 호기(설비) COSTCENTER 코드만 백엔드가 자동 필터링합니다. WHERE 절에 COSTCENTER 조건을 넣지 마세요.' : ''
      );
      systemPrompt += `\n\n[★★★ 세부업무영역 = ${subAreaLabel} — 전체 합계 요청 ★★★]
- 사용자가 "${overallIntent.matchedKeyword}" 표현을 사용하여 **전체 합계(1행)** 를 요청했습니다.
- 반드시 **GROUP BY 절 없이** SUM(...) 단독 SELECT 로 작성하세요. 결과는 정확히 1행이어야 합니다.
- SELECT 절에 MATERIAL / MATERIAL_NM / COSTCENTER / COSTCENTER_NM 등 세부 분류 컬럼을 포함하지 마세요.
- 조회 범위(테이블·부서/호기 코드 대상)는 세부업무영역이 결정하며, 서버가 자동 주입합니다.${filterNote}
- 예) "총 인건비 알려줘" → SELECT FORMAT(SUM(...),0) AS '인건비(원)' FROM ... WHERE ... (GROUP BY X, 1행)`;
    } else {
      if (areaCtx.subArea === 'cost-product') {
        systemPrompt += `\n\n[★★★ 세부업무영역 = 제품별원가 — 일반 조회 (총합 표현 없음) ★★★]
- 사용자 질의에 "총 / 총합 / 합계 / 전체 합계" 같은 전체 합계 표현이 **없습니다**.
- 반드시 **GROUP BY MATERIAL** 을 포함하고, dimension 에 [MATERIAL, MATERIAL_NM] 을 넣어 **제품별 여러 행** 으로 반환하세요.
- 절대 1행 전체 SUM 만 반환하지 마세요. 결과는 제품별 여러 행이어야 합니다.
- SELECT 예시:
    SELECT MATERIAL AS '자재코드',
           MAX(MATERIAL_NM) AS '자재명',
           FORMAT(SUM(<금액컬럼>),0) AS '<지표명>(원)'
    FROM <table>
    WHERE <기간·기타 조건>
    GROUP BY MATERIAL
    ORDER BY SUM(<금액컬럼>) DESC
- 기존 필터(CALMONTH, DIVISION, MATERIAL filter, ZCGUBUN, 기타 사용자 명시 조건)는 그대로 유지하세요.`;
      } else if (areaCtx.subArea === 'cost-dept') {
        systemPrompt += `\n\n[★★★ 세부업무영역 = 부서별원가 — 일반 조회 (총합 표현 없음) ★★★]
- 사용자 질의에 "총 / 총합 / 합계 / 전체 합계" 같은 전체 합계 표현이 **없습니다**.
- 반드시 **GROUP BY COSTCENTER** 를 포함하고, dimension 에 [COSTCENTER, COSTCENTER_NM] (COSTCENTER_NM 없으면 [COSTCENTER] 단독) 을 넣어 **부서별 여러 행** 으로 반환하세요.
- 절대 1행 전체 SUM 만 반환하지 마세요. 결과는 부서별 여러 행이어야 합니다.
- 호기(설비) COSTCENTER 코드는 백엔드가 자동으로 제외합니다. WHERE 절에 COSTCENTER 조건을 넣지 마세요.
- 기존 필터(CALMONTH, DIVISION, 기타 사용자 명시 조건)는 그대로 유지하세요.`;
      } else if (areaCtx.subArea === 'cost-machine') {
        systemPrompt += `\n\n[★★★ 세부업무영역 = 호기별원가 — 일반 조회 (총합 표현 없음) ★★★]
- 사용자 질의에 "총 / 총합 / 합계 / 전체 합계" 같은 전체 합계 표현이 **없습니다**.
- 반드시 **GROUP BY COSTCENTER** 를 포함하고, dimension 에 [COSTCENTER, COSTCENTER_NM] (COSTCENTER_NM 없으면 [COSTCENTER] 단독) 을 넣어 **호기별 여러 행** 으로 반환하세요.
- 절대 1행 전체 SUM 만 반환하지 마세요. 결과는 호기별 여러 행이어야 합니다.
- 호기(설비) COSTCENTER 코드만 백엔드가 자동 필터링합니다. WHERE 절에 COSTCENTER 조건을 넣지 마세요.
- 기존 필터(CALMONTH, DIVISION, 기타 사용자 명시 조건)는 그대로 유지하세요.`;
      }
    }
  }
  return systemPrompt;
}

// ─────────────────────────────────────────────────────────────────
// 3. server.mjs 소스에 새로운 대칭 로직이 실제로 반영되어 있는지 확인
// ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { console.log(`✓ PASS  ${msg}`); passed++; }
  else       { console.log(`❌ FAIL  ${msg}`); failed++; failures.push(msg); }
}

console.log('\n=== 그룹 A: server.mjs 소스에 대칭 로직 반영 여부 확인 ===');
// 총합 있을 때 지시 (기존)
assert(
  serverMjs.includes('전체 합계 요청 ★★★') && serverMjs.includes('반드시 **GROUP BY 절 없이**'),
  'server.mjs 에 총합 intent 있을 때 GROUP BY 해제 지시 존재'
);
// 총합 없을 때 지시 (신규 대칭 추가)
assert(
  serverMjs.includes('일반 조회 (총합 표현 없음) ★★★'),
  'server.mjs 에 총합 intent 없을 때 grain 강제 지시 헤더 존재'
);
assert(
  serverMjs.includes('반드시 **GROUP BY MATERIAL**'),
  'server.mjs 에 cost-product 일반 조회 시 GROUP BY MATERIAL 강제 지시 존재'
);
assert(
  serverMjs.includes('반드시 **GROUP BY COSTCENTER**'),
  'server.mjs 에 cost-dept / cost-machine 일반 조회 시 GROUP BY COSTCENTER 강제 지시 존재'
);
assert(
  serverMjs.includes('SubAreaGrainDirective:Aggregate'),
  'server.mjs 에 aggregate 라우트 grain 지시 로그 태그 존재'
);
// 기존 시행 필터 유지 문구 (사용자 요구사항 #6 회귀 방지)
assert(
  serverMjs.includes('기존 필터(CALMONTH, DIVISION, MATERIAL filter, ZCGUBUN, 기타 사용자 명시 조건)는 그대로 유지'),
  'cost-product 지시에 CALMONTH/DIVISION/MATERIAL/ZCGUBUN 필터 유지 안내 존재'
);

console.log('\n=== 그룹 B: cost-product / aggregate — 총합 intent 없음 → GROUP BY MATERIAL 강제 ===');
const areaCtxProduct = { area: 'manufacturing-cost', subArea: 'cost-product' };
{
  const q = '2026년 8월 인건비를 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('제품별원가 — 일반 조회 (총합 표현 없음)'), `[${q}] 일반 조회 헤더 포함`);
  assert(prompt.includes('GROUP BY MATERIAL'), `[${q}] GROUP BY MATERIAL 지시 포함`);
  assert(prompt.includes('[MATERIAL, MATERIAL_NM]'), `[${q}] dimension=[MATERIAL, MATERIAL_NM] 지시 포함`);
  assert(!prompt.includes('전체 합계 요청 ★★★'), `[${q}] "전체 합계 요청" 지시 미포함`);
  assert(!prompt.includes('GROUP BY 절 없이'), `[${q}] "GROUP BY 절 없이" 지시 미포함`);
}
{
  const q = '2026년 8월 전력비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('GROUP BY MATERIAL'), `[${q}] GROUP BY MATERIAL 지시 포함`);
  assert(!prompt.includes('전체 합계 요청'), `[${q}] 전체 합계 지시 미포함`);
}
{
  const q = '2026년 8월 도급비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('GROUP BY MATERIAL'), `[${q}] GROUP BY MATERIAL 지시 포함`);
  assert(!prompt.includes('전체 합계 요청'), `[${q}] 전체 합계 지시 미포함`);
}
{
  // "인건비 알려줘" (기간 없음) 도 일반 조회 취급
  const q = '인건비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('GROUP BY MATERIAL'), `[${q}] GROUP BY MATERIAL 지시 포함`);
}

console.log('\n=== 그룹 C: cost-product / aggregate — 총합 intent 있음 → GROUP BY 해제 ===');
{
  const q = '2026년 8월 총 인건비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('전체 합계 요청 ★★★'), `[${q}] 전체 합계 요청 헤더 포함`);
  assert(prompt.includes('GROUP BY 절 없이'), `[${q}] GROUP BY 해제 지시 포함`);
  assert(!prompt.includes('일반 조회 (총합 표현 없음)'), `[${q}] 일반 조회 지시 미포함 (배타)`);
  assert(!prompt.includes('반드시 **GROUP BY MATERIAL**'), `[${q}] GROUP BY MATERIAL 강제 미포함 (배타)`);
}
{
  const q = '2026년 8월 인건비 총합 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('GROUP BY 절 없이'), `[${q}] GROUP BY 해제 지시 포함`);
  assert(!prompt.includes('반드시 **GROUP BY MATERIAL**'), `[${q}] 일반 grain 지시 미포함`);
}
{
  const q = '2026년 8월 인건비 합계 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('GROUP BY 절 없이'), `[${q}] GROUP BY 해제 지시 포함`);
  assert(!prompt.includes('반드시 **GROUP BY MATERIAL**'), `[${q}] 일반 grain 지시 미포함`);
}
{
  const q = '2026년 8월 총 전력비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  assert(prompt.includes('GROUP BY 절 없이'), `[${q}] GROUP BY 해제 지시 포함`);
}

console.log('\n=== 그룹 D: cost-dept / cost-machine — 대칭 동작 확인 ===');
{
  const q = '2026년 8월 인건비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, { area: 'manufacturing-cost', subArea: 'cost-dept' });
  assert(prompt.includes('부서별원가 — 일반 조회'), `[cost-dept: ${q}] 부서별원가 일반 조회 헤더 포함`);
  assert(prompt.includes('GROUP BY COSTCENTER'), `[cost-dept: ${q}] GROUP BY COSTCENTER 지시 포함`);
}
{
  const q = '2026년 8월 총 인건비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, { area: 'manufacturing-cost', subArea: 'cost-dept' });
  assert(prompt.includes('GROUP BY 절 없이'), `[cost-dept: ${q}] GROUP BY 해제 지시 포함`);
  assert(prompt.includes('호기(설비) COSTCENTER 코드는 백엔드가 자동으로 제외'), `[cost-dept 총합] 호기 제외 안내 포함`);
}
{
  const q = '2026년 8월 인건비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, { area: 'manufacturing-cost', subArea: 'cost-machine' });
  assert(prompt.includes('호기별원가 — 일반 조회'), `[cost-machine: ${q}] 호기별원가 일반 조회 헤더 포함`);
  assert(prompt.includes('GROUP BY COSTCENTER'), `[cost-machine: ${q}] GROUP BY COSTCENTER 지시 포함`);
}

console.log('\n=== 그룹 E: 비대상 영역 — 프롬프트 미주입 (수익성분석 자연어 로직 무영향) ===');
{
  const q = '2026년 8월 인건비 알려줘';
  const prompt1 = simulateAggregateGrainDirective(q, null);
  assert(prompt1 === '', `areaCtx null → 프롬프트 미주입`);
  const prompt2 = simulateAggregateGrainDirective(q, { area: 'profitability', subArea: null });
  assert(prompt2 === '', `수익성분석 영역 → 프롬프트 미주입`);
  const prompt3 = simulateAggregateGrainDirective(q, { area: 'manufacturing-cost', subArea: null });
  assert(prompt3 === '', `subArea 없음 → 프롬프트 미주입`);
}

console.log('\n=== 그룹 F: 사용자 요구사항 #7 회귀 테스트 — 최종 동작 규칙 재현 ===');
// 요구사항 #7 의 5가지 케이스 완전 재현
{
  const cases = [
    { q: '2026년 8월 인건비 알려줘',     expectOverall: false, mustHave: 'GROUP BY MATERIAL' },
    { q: '2026년 8월 총 인건비 알려줘',   expectOverall: true,  mustHave: 'GROUP BY 절 없이' },
    { q: '2026년 8월 인건비 합계 알려줘', expectOverall: true,  mustHave: 'GROUP BY 절 없이' },
    { q: '2026년 8월 전력비 알려줘',     expectOverall: false, mustHave: 'GROUP BY MATERIAL' },
    { q: '2026년 8월 총 전력비 알려줘',   expectOverall: true,  mustHave: 'GROUP BY 절 없이' },
  ];
  for (const c of cases) {
    const intent = detectOverallTotalIntent(c.q);
    assert(intent.isOverall === c.expectOverall, `intent 판정 "${c.q}" → isOverall=${c.expectOverall}`);
    const prompt = simulateAggregateGrainDirective(c.q, areaCtxProduct);
    assert(prompt.includes(c.mustHave), `프롬프트 지시 "${c.q}" → "${c.mustHave}" 포함`);
  }
}

console.log('\n=== 그룹 G: 사용자 요구사항 #6 — 기존 필터 유지 문구 확인 ===');
{
  const q = '2026년 8월 인건비 알려줘';
  const prompt = simulateAggregateGrainDirective(q, areaCtxProduct);
  // 일반 조회 지시에 CALMONTH/DIVISION/MATERIAL filter/ZCGUBUN 유지 안내가 들어가야 함
  assert(prompt.includes('CALMONTH'), `[${q}] CALMONTH 유지 안내 포함`);
  assert(prompt.includes('DIVISION'), `[${q}] DIVISION 유지 안내 포함`);
  assert(prompt.includes('MATERIAL filter'), `[${q}] MATERIAL filter 유지 안내 포함`);
  assert(prompt.includes('ZCGUBUN'), `[${q}] ZCGUBUN 유지 안내 포함`);
}

console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===`);
if (failed > 0) {
  console.log('\n실패 항목:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
