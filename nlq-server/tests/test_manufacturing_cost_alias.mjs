// [PR#465] "제조원가" = "실제원가" 고정 매핑 회귀 테스트
//
//   대상:
//     - detectManufacturingCostAlias(query) — "제조원가" 감지 → { matched, zcgubun:'실제원가' }
//     - detectExplicitZcgubunInQuery(query) — "제조원가" 는 explicit=true, zcgubun='실제원가'
//     - detectStandardCostSubtypeInQuery(query) — "제조원가의 표준원가" 도 실제원가 계열
//     - server.mjs GENERIC_COST_INTENT_RE — "제조원가" 제외
//     - server.mjs SPECIFIC_ZCGUBUN_IN_QUERY_RE — "제조원가" 포함
//
//   시나리오 (사용자 요구사항 #7 회귀 테스트):
//     Case 1: "제품별 제조원가 조회해줘"           → ZCGUBUN='실제원가', clarification 없음
//     Case 2: "제품별 원가요소 조회해줘(제조원가)"  → ZCGUBUN='실제원가', clarification 없음
//     Case 3: "제품별 원가요소 조회해줘"          → 원가 종류 불명확 → 1차 clarification
//     Case 4: "매출원가 조회해줘"                  → ZCGUBUN='매출원가'
//     Case 5: "제조원가의 표준원가 조회해줘"       → ZCGUBUN='표준원가', ZCGUBUN_D='입고-생산'
//
//   중요: 이 테스트는 순수 로직 검증 (LLM/DB 호출 없음).

import { readFileSync } from 'node:fs';

const serverMjs = readFileSync('/home/user/webapp/nlq-server/server.mjs', 'utf8');

// ─────────────────────────────────────────────────────────────────
// 함수 격리 로드
// ─────────────────────────────────────────────────────────────────
function loadFunction(name) {
  const startMarker = `function ${name}(`;
  const startIdx = serverMjs.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`${name} 함수 시작점 없음`);
  let openIdx = serverMjs.indexOf('{', startIdx);
  if (openIdx === -1) throw new Error(`${name} { 없음`);
  let cursor = openIdx + 1;
  let braceDepth = 1;
  while (cursor < serverMjs.length && braceDepth > 0) {
    const ch = serverMjs[cursor];
    if (ch === '{') braceDepth++;
    else if (ch === '}') braceDepth--;
    cursor++;
  }
  const funcBody = serverMjs.slice(startIdx, cursor);
  const globalized = funcBody.replace(
    new RegExp(`^function ${name}\\(`),
    `globalThis.${name} = function(`
  );
  eval(globalized);
  return globalThis[name];
}

// MANUFACTURING_COST_TERM_MAP 은 detectManufacturingCostAlias 내부에서 참조하므로
// 격리 로드 시 함께 전역에 노출.
// (server.mjs 의 const 선언을 그대로 실행)
const mapDeclMatch = serverMjs.match(/const MANUFACTURING_COST_TERM_MAP = \{[\s\S]*?\n\};/);
if (!mapDeclMatch) throw new Error('MANUFACTURING_COST_TERM_MAP 선언을 찾지 못함');
eval(mapDeclMatch[0].replace('const MANUFACTURING_COST_TERM_MAP', 'globalThis.MANUFACTURING_COST_TERM_MAP'));

const detectManufacturingCostAlias = loadFunction('detectManufacturingCostAlias');
// detectExplicitZcgubunInQuery 는 detectStandardCostSubtypeInQuery + detectManufacturingCostAlias 참조
const detectStandardCostSubtypeInQuery = loadFunction('detectStandardCostSubtypeInQuery');
globalThis.detectStandardCostSubtypeInQuery = detectStandardCostSubtypeInQuery;
globalThis.detectManufacturingCostAlias = detectManufacturingCostAlias;
const detectExplicitZcgubunInQuery = loadFunction('detectExplicitZcgubunInQuery');

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { console.log(`✓ PASS  ${msg}`); passed++; }
  else       { console.log(`❌ FAIL  ${msg}`); failed++; failures.push(msg); }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 A: MANUFACTURING_COST_TERM_MAP 정의 확인 ===');
// ═══════════════════════════════════════════════════════════════
{
  const m = globalThis.MANUFACTURING_COST_TERM_MAP;
  assert(!!m, 'MANUFACTURING_COST_TERM_MAP 정의 존재');
  assert(!!m['제조원가'], '"제조원가" 키 존재');
  assert(m['제조원가'].canonicalName === '실제원가', 'canonicalName="실제원가"');
  assert(m['제조원가'].column === 'ZCGUBUN', 'column="ZCGUBUN"');
  assert(m['제조원가'].value === '실제원가', 'value="실제원가"');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 B: detectManufacturingCostAlias — "제조원가" 감지 ===');
// ═══════════════════════════════════════════════════════════════
{
  const cases = [
    { q: '제품별 제조원가 조회해줘',    matched: true },
    { q: '제조원가 알려줘',              matched: true },
    { q: '2026년 8월 제조원가',           matched: true },
    { q: '제조 원가 알려줘',              matched: true },   // 공백 허용
    // 매칭 안 됨
    { q: '실제원가 알려줘',              matched: false },
    { q: '매출원가 알려줘',              matched: false },
    { q: '표준원가 알려줘',              matched: false },
    { q: '원가 알려줘',                  matched: false },
    { q: '자재원가',                     matched: false },
    { q: '제품원가',                     matched: false },
    { q: '',                             matched: false },
  ];
  for (const c of cases) {
    const r = detectManufacturingCostAlias(c.q);
    assert(r.matched === c.matched, `matched=${c.matched} for "${c.q}"`);
    if (c.matched) {
      assert(r.zcgubun === '실제원가', `"${c.q}" → zcgubun='실제원가' (canonical)`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 C: detectExplicitZcgubunInQuery — "제조원가" 처리 ===');
// ═══════════════════════════════════════════════════════════════
{
  // "제조원가" 단독 → explicit=true, zcgubun='실제원가'
  const r1 = detectExplicitZcgubunInQuery('제품별 제조원가 조회해줘');
  assert(r1.explicit === true && r1.zcgubun === '실제원가' && r1.zcgubunD === null,
    `"제품별 제조원가 조회해줘" → explicit=true, zcgubun='실제원가', zcgubunD=null`);

  // "제조원가" 포함된 질의 → 실제원가로 확정
  const r2 = detectExplicitZcgubunInQuery('2026년 8월 제조원가 알려줘');
  assert(r2.explicit === true && r2.zcgubun === '실제원가',
    `"2026년 8월 제조원가 알려줘" → zcgubun='실제원가'`);

  // "원가요소 조회해줘(제조원가)" → 실제원가로 확정
  const r3 = detectExplicitZcgubunInQuery('제품별 원가요소 조회해줘(제조원가)');
  assert(r3.explicit === true && r3.zcgubun === '실제원가',
    `"제품별 원가요소 조회해줘(제조원가)" → zcgubun='실제원가'`);

  // 기존 케이스는 그대로 유지
  const r4 = detectExplicitZcgubunInQuery('실제원가 알려줘');
  assert(r4.explicit === true && r4.zcgubun === '실제원가', `기존: 실제원가 → explicit=true`);

  const r5 = detectExplicitZcgubunInQuery('매출원가 알려줘');
  assert(r5.explicit === true && r5.zcgubun === '매출원가', `기존: 매출원가 → explicit=true`);

  // "표준원가" 단독 → 여전히 explicit=false (2차 clarification 필요)
  const r6 = detectExplicitZcgubunInQuery('표준원가 알려줘');
  assert(r6.explicit === false && r6.zcgubun === '표준원가',
    `기존: 표준원가 단독 → explicit=false (2차 clarification)`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 D: detectStandardCostSubtypeInQuery — "제조원가의 표준원가" ===');
// ═══════════════════════════════════════════════════════════════
{
  // "제조원가의 표준원가" → 실제원가의 표준원가와 동일 → zcgubunD='입고-생산'
  const r1 = detectStandardCostSubtypeInQuery('제조원가의 표준원가 조회해줘');
  assert(r1.matched === true && r1.zcgubunD === '입고-생산',
    `"제조원가의 표준원가" → zcgubunD='입고-생산' (요구사항 #6)`);

  // 공백 허용
  const r2 = detectStandardCostSubtypeInQuery('제조 원가 의 표준 원가');
  assert(r2.matched === true && r2.zcgubunD === '입고-생산',
    `"제조 원가 의 표준 원가" (공백) → zcgubunD='입고-생산'`);

  // 역순도 매칭
  const r3 = detectStandardCostSubtypeInQuery('표준원가의 제조원가');
  assert(r3.matched === true && r3.zcgubunD === '입고-생산',
    `"표준원가의 제조원가" (역순) → zcgubunD='입고-생산'`);

  // 실제원가의 표준원가와 동일 결과
  const rActual = detectStandardCostSubtypeInQuery('실제원가의 표준원가');
  assert(r1.zcgubunD === rActual.zcgubunD,
    `"제조원가의 표준원가" 와 "실제원가의 표준원가" 결과 동일 (요구사항 #6)`);

  // 매출원가의 표준원가는 여전히 소비-소비
  const rSales = detectStandardCostSubtypeInQuery('매출원가의 표준원가');
  assert(rSales.matched === true && rSales.zcgubunD === '소비-소비',
    `기존: 매출원가의 표준원가 → zcgubunD='소비-소비'`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 E: "제조원가" + 표준원가 조합 우선순위 ===');
// ═══════════════════════════════════════════════════════════════
{
  // "제조원가의 표준원가" 는 표준원가 서브타입 판정이 우선 → zcgubun='표준원가', zcgubunD='입고-생산'
  //   (제조원가 단독 매핑보다 서브타입 판정이 앞선다)
  const r = detectExplicitZcgubunInQuery('제조원가의 표준원가 조회해줘');
  assert(r.explicit === true && r.zcgubun === '표준원가' && r.zcgubunD === '입고-생산',
    `"제조원가의 표준원가" → 표준원가 우선, zcgubun='표준원가', zcgubunD='입고-생산' (요구사항 #6)`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 F: server.mjs GENERIC/SPECIFIC 정규식 반영 확인 ===');
// ═══════════════════════════════════════════════════════════════
{
  // GENERIC_COST_INTENT_RE 에서 "제조원가" 제거되었는지 확인 (2군데 모두)
  //   원래: /(?:^|[^가-힣])(원가|제조원가|자재원가|제품원가)(?![가-힣])/
  //   수정: /(?:^|[^가-힣])(원가|자재원가|제품원가)(?![가-힣])/
  const genericMatches = serverMjs.match(/GENERIC_COST_INTENT_RE\s*=\s*\/[^/]+\//g) || [];
  assert(genericMatches.length >= 2, `GENERIC_COST_INTENT_RE 최소 2군데 (실제 발견: ${genericMatches.length})`);
  for (const m of genericMatches) {
    assert(!m.includes('제조원가'),
      `GENERIC_COST_INTENT_RE 에 "제조원가" 없음 (반드시 제외): ${m.substring(0, 80)}`);
  }

  // SPECIFIC_ZCGUBUN_IN_QUERY_RE 에 "제조원가" 가 추가됐는지 확인
  const specificMatch = serverMjs.match(/SPECIFIC_ZCGUBUN_IN_QUERY_RE\s*=\s*\/([^/]+)\//);
  assert(!!specificMatch, `SPECIFIC_ZCGUBUN_IN_QUERY_RE 정의 존재`);
  if (specificMatch) {
    assert(specificMatch[1].includes('제조') && specificMatch[1].includes('원가'),
      `SPECIFIC_ZCGUBUN_IN_QUERY_RE 에 "제조원가" 포함: ${specificMatch[0]}`);
  }

  // detectManufacturingCostAlias 함수 존재
  assert(serverMjs.includes('function detectManufacturingCostAlias('),
    `detectManufacturingCostAlias 함수 정의 존재`);

  // MANUFACTURING_COST_TERM_MAP 상수 존재
  assert(serverMjs.includes('MANUFACTURING_COST_TERM_MAP'),
    `MANUFACTURING_COST_TERM_MAP 상수 정의 존재`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 G: 사용자 요구사항 Case 1-5 시나리오 완전 재현 ===');
// ═══════════════════════════════════════════════════════════════
{
  // Case 1: "제품별 제조원가 조회해줘" → ZCGUBUN='실제원가', clarification 없음
  const q1 = '제품별 제조원가 조회해줘';
  const r1 = detectExplicitZcgubunInQuery(q1);
  assert(r1.explicit === true && r1.zcgubun === '실제원가' && r1.zcgubunD === null,
    `[Case 1] "${q1}" → ZCGUBUN='실제원가', clarification 없음`);

  // Case 2: "제품별 원가요소 조회해줘(제조원가)" → ZCGUBUN='실제원가', clarification 없음
  //   detectCostElementIntent 로 원가요소 트리거되지만, detectExplicitZcgubunInQuery 로
  //   "제조원가" 명시 확정되므로 clarification 스킵.
  const q2 = '제품별 원가요소 조회해줘(제조원가)';
  const r2 = detectExplicitZcgubunInQuery(q2);
  assert(r2.explicit === true && r2.zcgubun === '실제원가',
    `[Case 2] "${q2}" → ZCGUBUN='실제원가', clarification 없음`);

  // Case 3: "제품별 원가요소 조회해줘" → clarification 필요
  const q3 = '제품별 원가요소 조회해줘';
  const r3 = detectExplicitZcgubunInQuery(q3);
  assert(r3.explicit === false && r3.zcgubun === null,
    `[Case 3] "${q3}" → 원가 종류 불명확, clarification 필요`);

  // Case 4: "매출원가 조회해줘" → ZCGUBUN='매출원가'
  const q4 = '매출원가 조회해줘';
  const r4 = detectExplicitZcgubunInQuery(q4);
  assert(r4.explicit === true && r4.zcgubun === '매출원가',
    `[Case 4] "${q4}" → ZCGUBUN='매출원가'`);

  // Case 5: "제조원가의 표준원가 조회해줘" → ZCGUBUN='표준원가', ZCGUBUN_D='입고-생산'
  const q5 = '제조원가의 표준원가 조회해줘';
  const r5 = detectExplicitZcgubunInQuery(q5);
  assert(r5.explicit === true && r5.zcgubun === '표준원가' && r5.zcgubunD === '입고-생산',
    `[Case 5] "${q5}" → ZCGUBUN='표준원가', ZCGUBUN_D='입고-생산'`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 H: 회귀 안전성 ===');
// ═══════════════════════════════════════════════════════════════
{
  // "원가" 단독은 여전히 GENERIC (요구사항 #5)
  //   detectExplicitZcgubunInQuery 는 실제/매출/표준/제조 만 감지, "원가" 단독은 감지 안 됨
  const r1 = detectExplicitZcgubunInQuery('원가 알려줘');
  assert(r1.explicit === false && r1.zcgubun === null,
    `기존 유지: "원가" 단독 → explicit=false (clarification 정책 유지)`);

  // 실제원가/매출원가 단독 흐름 유지
  const r2 = detectExplicitZcgubunInQuery('제품별 실제원가 원가요소');
  assert(r2.explicit === true && r2.zcgubun === '실제원가',
    `기존 유지: 실제원가 명시 → 자동 확정`);

  const r3 = detectExplicitZcgubunInQuery('제품별 매출원가 원가요소');
  assert(r3.explicit === true && r3.zcgubun === '매출원가',
    `기존 유지: 매출원가 명시 → 자동 확정`);

  // "실제원가의 표준원가" 여전히 동작
  const r4 = detectExplicitZcgubunInQuery('실제원가의 표준원가');
  assert(r4.explicit === true && r4.zcgubun === '표준원가' && r4.zcgubunD === '입고-생산',
    `기존 유지: "실제원가의 표준원가" → zcgubunD='입고-생산'`);

  // "매출원가의 표준원가" 여전히 동작
  const r5 = detectExplicitZcgubunInQuery('매출원가의 표준원가');
  assert(r5.explicit === true && r5.zcgubun === '표준원가' && r5.zcgubunD === '소비-소비',
    `기존 유지: "매출원가의 표준원가" → zcgubunD='소비-소비'`);
}

console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===`);
if (failed > 0) {
  console.log('\n실패 항목:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
