// [PR#462+] 표준원가 서브타입 2차 clarification 회귀 테스트
//
//   대상:
//     - detectStandardCostSubtypeInQuery(query) — "매출원가의 표준원가" 등 감지
//     - detectExplicitZcgubunInQuery(query) — 표준원가 서브타입 확장 (zcgubunD 필드)
//     - applyForcedCostBasisFilter(sql, {value, zcgubunD}) — ZCGUBUN + ZCGUBUN_D 동시 주입
//     - server.mjs 소스에 2차 clarification 게이트 / whitelist / directive 반영 확인
//
//   시나리오 (사용자 요구사항 #9):
//     Case 1: "제품별 원가요소 조회해줘"          → 1차 [실제/매출/표준] 응답
//     Case 2: 1차 [표준원가] 선택 후 재요청          → 2차 [매출의 표준/실제의 표준] 응답
//     Case 3: 2차 [매출원가의 표준원가] 선택         → ZCGUBUN='표준원가' AND ZCGUBUN_D='소비-소비'
//     Case 4: 2차 [실제원가의 표준원가] 선택         → ZCGUBUN='표준원가' AND ZCGUBUN_D='입고-생산'
//     Case 5: "매출원가의 표준원가 알려줘"          → 자동 확정 (모든 clarification 스킵)
//     Case 6: "표준원가 알려줘"                      → 1차 스킵, 2차 clarification 필수

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

const _sanitizeWhereCond = loadFunction('_sanitizeWhereCond');
globalThis._sanitizeWhereCond = _sanitizeWhereCond;
// detectExplicitZcgubunInQuery 는 detectStandardCostSubtypeInQuery + detectManufacturingCostAlias 참조
//   [2026-09-17] "제조원가" alias 추가로 detectManufacturingCostAlias 도 함께 로드 필요
const _mapDecl = serverMjs.match(/const MANUFACTURING_COST_TERM_MAP = \{[\s\S]*?\n\};/);
if (_mapDecl) eval(_mapDecl[0].replace('const MANUFACTURING_COST_TERM_MAP', 'globalThis.MANUFACTURING_COST_TERM_MAP'));
const detectStandardCostSubtypeInQuery = loadFunction('detectStandardCostSubtypeInQuery');
globalThis.detectStandardCostSubtypeInQuery = detectStandardCostSubtypeInQuery;
const detectManufacturingCostAlias = loadFunction('detectManufacturingCostAlias');
globalThis.detectManufacturingCostAlias = detectManufacturingCostAlias;
const detectExplicitZcgubunInQuery = loadFunction('detectExplicitZcgubunInQuery');
const applyForcedCostBasisFilter = loadFunction('applyForcedCostBasisFilter');

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { console.log(`✓ PASS  ${msg}`); passed++; }
  else       { console.log(`❌ FAIL  ${msg}`); failed++; failures.push(msg); }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 A: detectStandardCostSubtypeInQuery — 세부 표현 감지 ===');
// ═══════════════════════════════════════════════════════════════
{
  const cases = [
    // 매칭 기대 — '소비-소비' (매출원가 기준)
    { q: '매출원가의 표준원가 알려줘',   matched: true,  zd: '소비-소비' },
    { q: '매출원가 표준원가 조회',       matched: true,  zd: '소비-소비' },
    { q: '매출 원가의 표준 원가',        matched: true,  zd: '소비-소비' },  // 공백/조사 허용
    // 매칭 기대 — '입고-생산' (실제원가 기준)
    { q: '실제원가의 표준원가 알려줘',   matched: true,  zd: '입고-생산' },
    { q: '실제원가 표준원가',            matched: true,  zd: '입고-생산' },
    { q: '실제 원가의 표준 원가',        matched: true,  zd: '입고-생산' },
    // 역순 (방어적 매칭)
    { q: '표준원가의 매출원가',          matched: true,  zd: '소비-소비' },
    { q: '표준원가의 실제원가',          matched: true,  zd: '입고-생산' },
    // 매칭 안 됨 — 표준원가 단독
    { q: '표준원가 알려줘',              matched: false, zd: null },
    { q: '실제원가 알려줘',              matched: false, zd: null },
    { q: '매출원가 알려줘',              matched: false, zd: null },
    { q: '',                             matched: false, zd: null },
    { q: '원가요소 조회',                matched: false, zd: null },
  ];
  for (const c of cases) {
    const r = detectStandardCostSubtypeInQuery(c.q);
    assert(r.matched === c.matched, `matched=${c.matched} for "${c.q}"`);
    if (c.matched) {
      assert(r.zcgubunD === c.zd, `zcgubunD="${c.zd}" for "${c.q}" (got "${r.zcgubunD}")`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 B: detectExplicitZcgubunInQuery — 표준원가 세부 확장 ===');
// ═══════════════════════════════════════════════════════════════
{
  // 표준원가 단독 → explicit=false (2차 clarification 필요)
  const r1 = detectExplicitZcgubunInQuery('표준원가 알려줘');
  assert(r1.explicit === false, `"표준원가 알려줘" → explicit=false (2차 필요)`);
  assert(r1.zcgubun === '표준원가', `단독 표준원가 감지 (zcgubun='표준원가')`);
  assert(r1.zcgubunD === null, `단독 표준원가는 zcgubunD=null`);

  // 표준원가 + 서브타입 → explicit=true, zcgubunD 함께
  const r2 = detectExplicitZcgubunInQuery('매출원가의 표준원가 알려줘');
  assert(r2.explicit === true, `"매출원가의 표준원가" → explicit=true`);
  assert(r2.zcgubun === '표준원가', `zcgubun='표준원가'`);
  assert(r2.zcgubunD === '소비-소비', `zcgubunD='소비-소비'`);

  const r3 = detectExplicitZcgubunInQuery('실제원가의 표준원가 알려줘');
  assert(r3.explicit === true, `"실제원가의 표준원가" → explicit=true`);
  assert(r3.zcgubunD === '입고-생산', `zcgubunD='입고-생산'`);

  // 실제원가/매출원가 단독 → explicit=true, zcgubunD=null (요구사항 #5)
  const r4 = detectExplicitZcgubunInQuery('실제원가 알려줘');
  assert(r4.explicit === true && r4.zcgubun === '실제원가' && r4.zcgubunD === null,
    `실제원가 단독 → explicit=true, zcgubunD=null`);
  const r5 = detectExplicitZcgubunInQuery('매출원가 알려줘');
  assert(r5.explicit === true && r5.zcgubun === '매출원가' && r5.zcgubunD === null,
    `매출원가 단독 → explicit=true, zcgubunD=null`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 C: applyForcedCostBasisFilter — ZCGUBUN + ZCGUBUN_D 동시 주입 ===');
// ═══════════════════════════════════════════════════════════════
{
  // C1: 표준원가 + 소비-소비 → 두 조건 모두 주입
  const sql1 = 'SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL';
  const out1 = applyForcedCostBasisFilter(sql1, { value: '표준원가', zcgubunD: '소비-소비' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out1), '[표준원가+소비-소비] ZCGUBUN 주입');
  assert(/ZCGUBUN_D\s*=\s*'소비-소비'/.test(out1), '[표준원가+소비-소비] ZCGUBUN_D 주입');
  assert(/GROUP BY MATERIAL/.test(out1), 'GROUP BY 유지');

  // C2: 표준원가 + 입고-생산
  const out2 = applyForcedCostBasisFilter(sql1, { value: '표준원가', zcgubunD: '입고-생산' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out2) && /ZCGUBUN_D\s*=\s*'입고-생산'/.test(out2),
    '[표준원가+입고-생산] 두 조건 모두 주입');

  // C3: 기존 WHERE 에 CALMONTH 있으면 유지 (요구사항 #8)
  const sql3 = "SELECT * FROM sys_aimd_cot015 WHERE CALMONTH = '202608'";
  const out3 = applyForcedCostBasisFilter(sql3, { value: '표준원가', zcgubunD: '소비-소비' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out3), 'CALMONTH 존재 시 ZCGUBUN 병합');
  assert(/ZCGUBUN_D\s*=\s*'소비-소비'/.test(out3), 'CALMONTH 존재 시 ZCGUBUN_D 병합');
  assert(/CALMONTH\s*=\s*'202608'/.test(out3), 'CALMONTH 조건 보존');

  // C4: LLM 이 잘못된 ZCGUBUN + ZCGUBUN_D 넣었어도 사용자 확정값으로 치환
  const sql4 = "SELECT * FROM sys_aimd_cot015 WHERE ZCGUBUN = '실제원가' AND ZCGUBUN_D = '입고-생산' AND CALMONTH = '202608'";
  const out4 = applyForcedCostBasisFilter(sql4, { value: '표준원가', zcgubunD: '소비-소비' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out4), 'LLM 잘못된 ZCGUBUN 치환');
  assert(/ZCGUBUN_D\s*=\s*'소비-소비'/.test(out4), 'LLM 잘못된 ZCGUBUN_D 치환');
  assert(!/'실제원가'/.test(out4), '기존 잘못된 실제원가 리터럴 제거');
  assert(!/'입고-생산'/.test(out4), '기존 잘못된 입고-생산 리터럴 제거');
  assert(/CALMONTH\s*=\s*'202608'/.test(out4), 'CALMONTH 조건 유지 (요구사항 #8)');

  // C5: 서로 다른 표준원가 IN 절도 제거 (요구사항 #7)
  const sql5 = "SELECT * FROM sys_aimd_cot015 WHERE ZCGUBUN = '표준원가' AND ZCGUBUN_D IN ('입고-생산','소비-소비')";
  const out5 = applyForcedCostBasisFilter(sql5, { value: '표준원가', zcgubunD: '입고-생산' });
  assert(/ZCGUBUN_D\s*=\s*'입고-생산'/.test(out5), 'IN 절 제거 후 = 로 재주입');
  assert(!/ZCGUBUN_D\s+IN\s*\(/.test(out5), 'IN 절 완전 제거');

  // C6: zcgubunD 없이 실제원가만 → 기존 동작 (ZCGUBUN 만 주입, ZCGUBUN_D 조건 없음)
  const out6 = applyForcedCostBasisFilter(sql1, { value: '실제원가' });
  assert(/ZCGUBUN\s*=\s*'실제원가'/.test(out6), '실제원가만 → ZCGUBUN 주입');
  assert(!/ZCGUBUN_D\s*=/.test(out6), '실제원가만 → ZCGUBUN_D 미주입');

  // C7: zcgubunD whitelist 위반 값은 무시 (ZCGUBUN 만 주입)
  const out7 = applyForcedCostBasisFilter(sql1, { value: '표준원가', zcgubunD: '해킹시도' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out7), 'whitelist 위반 zcgubunD → ZCGUBUN 만 주입');
  assert(!/ZCGUBUN_D/.test(out7), 'whitelist 위반 zcgubunD → ZCGUBUN_D 미주입');

  // C8: sys_aimd_cot043 은 no-op
  const sql8 = "SELECT * FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '인건비'";
  const out8 = applyForcedCostBasisFilter(sql8, { value: '표준원가', zcgubunD: '소비-소비' });
  assert(out8 === sql8, 'sys_aimd_cot043 → no-op');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 D: 사용자 요구사항 Case 1-6 시나리오 ===');
// ═══════════════════════════════════════════════════════════════
{
  // Case 1: "제품별 원가요소 조회해줘" → 1차 clarification 대상 (표준원가 감지 X)
  const q1 = '제품별 원가요소 조회해줘';
  const e1 = detectExplicitZcgubunInQuery(q1);
  assert(e1.explicit === false && e1.zcgubun === null,
    `[Case 1] "${q1}" → 1차 [실제/매출/표준] 3버튼 대상`);

  // Case 2: 1차 [표준원가] 선택 후 재요청 케이스 — 서버 게이트가 zcgubunD 부재 감지해서 2차 응답
  //   유닛 레벨에서는 서버 로직 문자열 매치로 검증 (그룹 E)

  // Case 3: [매출원가의 표준원가] 선택 시 SQL — value='표준원가', zcgubunD='소비-소비'
  const sql3 = 'SELECT * FROM sys_aimd_cot015';
  const out3 = applyForcedCostBasisFilter(sql3, { value: '표준원가', zcgubunD: '소비-소비' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out3) && /ZCGUBUN_D\s*=\s*'소비-소비'/.test(out3),
    `[Case 3] [매출원가의 표준원가] 선택 → SQL 에 ZCGUBUN='표준원가' AND ZCGUBUN_D='소비-소비'`);

  // Case 4: [실제원가의 표준원가] 선택 시 SQL
  const out4 = applyForcedCostBasisFilter(sql3, { value: '표준원가', zcgubunD: '입고-생산' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out4) && /ZCGUBUN_D\s*=\s*'입고-생산'/.test(out4),
    `[Case 4] [실제원가의 표준원가] 선택 → SQL 에 ZCGUBUN='표준원가' AND ZCGUBUN_D='입고-생산'`);

  // Case 5: "매출원가의 표준원가 알려줘" → 자동 확정 (모든 clarification 스킵)
  const q5 = '매출원가의 표준원가 알려줘';
  const e5 = detectExplicitZcgubunInQuery(q5);
  assert(e5.explicit === true && e5.zcgubun === '표준원가' && e5.zcgubunD === '소비-소비',
    `[Case 5] "${q5}" → 명확화 스킵, 자동 확정 zcgubun='표준원가' zcgubunD='소비-소비'`);

  // Case 5-b: 실제원가의 표준원가 도 동일
  const q5b = '실제원가의 표준원가 알려줘';
  const e5b = detectExplicitZcgubunInQuery(q5b);
  assert(e5b.explicit === true && e5b.zcgubun === '표준원가' && e5b.zcgubunD === '입고-생산',
    `[Case 5-b] "${q5b}" → 자동 확정 zcgubunD='입고-생산'`);

  // Case 6: "표준원가 알려줘" → 2차 clarification 필수 (explicit=false)
  const q6 = '표준원가 알려줘';
  const e6 = detectExplicitZcgubunInQuery(q6);
  assert(e6.explicit === false && e6.zcgubun === '표준원가' && e6.zcgubunD === null,
    `[Case 6] "${q6}" → explicit=false (2차 clarification 필수), zcgubun='표준원가' 감지`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 E: server.mjs 소스 반영 확인 ===');
// ═══════════════════════════════════════════════════════════════
{
  // 2차 clarification 응답 필드
  assert(serverMjs.includes('costbasisStandardSubtypeClarification'),
    'costbasisStandardSubtypeClarification 응답 필드 존재');
  // 재요청 감지 로직
  assert(serverMjs.includes('_needsStandardSubClarify'),
    '_needsStandardSubClarify 재요청 감지 로직 존재');
  // 2차 options (매출원가의 표준원가 / 실제원가의 표준원가)
  assert(serverMjs.includes("label: '매출원가의 표준원가'") && serverMjs.includes("label: '실제원가의 표준원가'"),
    '2차 clarification options 존재 (매출원가의 표준원가 / 실제원가의 표준원가)');
  // emphasize 필드 (프론트가 굵게 표시)
  assert(serverMjs.includes("emphasize: '매출원가'") && serverMjs.includes("emphasize: '실제원가'"),
    'emphasize 필드 존재 (프론트 굵게 표시)');
  // value 매핑: 매출원가의 표준원가 → 소비-소비 / 실제원가의 표준원가 → 입고-생산
  //   options 배열에 두 값이 각각 존재
  assert(/value:\s*'소비-소비'/.test(serverMjs), '소비-소비 zcgubunD 옵션 존재');
  assert(/value:\s*'입고-생산'/.test(serverMjs), '입고-생산 zcgubunD 옵션 존재');
  // whitelist 확장
  assert(serverMjs.includes("rawZd === '소비-소비' || rawZd === '입고-생산'"),
    'zcgubunD whitelist 검증 존재');
  // applyForcedCostBasisFilter 가 ZCGUBUN_D 도 정리
  assert(serverMjs.includes('(?:ZCGUBUN_D|ZCGUBUN)'),
    'applyForcedCostBasisFilter 가 ZCGUBUN_D 도 정리하는 정규식 존재');
  // job.forcedCostBasis 가 zcgubunD 함께 실을 수 있음
  assert(serverMjs.includes('zd ? { value: v, zcgubunD: zd, source:'),
    'job 객체가 zcgubunD 함께 실림');
  // prompt directive 확장
  assert(serverMjs.includes('매출원가의 표준원가') && serverMjs.includes('실제원가의 표준원가'),
    'prompt directive 에 서브타입 라벨 노출');
  assert(serverMjs.includes('표준원가는 ZCGUBUN_D 조건 없이는 의미가 확정되지 않습니다'),
    'aggregate directive 에 ZCGUBUN_D 규칙 존재');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 F: 회귀 안전성 ===');
// ═══════════════════════════════════════════════════════════════
{
  // "제품별 실제원가 원가요소" 는 여전히 실제원가로 자동 확정 (기존 흐름)
  const q = '제품별 실제원가 원가요소 조회해줘';
  const e = detectExplicitZcgubunInQuery(q);
  assert(e.explicit === true && e.zcgubun === '실제원가' && e.zcgubunD === null,
    `기존 케이스 유지: "${q}" → 실제원가 자동 확정, zcgubunD 없음`);

  // "제품별 매출원가 원가요소" 도 동일
  const q2 = '제품별 매출원가 원가요소 조회해줘';
  const e2 = detectExplicitZcgubunInQuery(q2);
  assert(e2.explicit === true && e2.zcgubun === '매출원가' && e2.zcgubunD === null,
    `기존 케이스 유지: "${q2}" → 매출원가 자동 확정`);

  // sys_aimd_cot043 관련 SQL 은 여전히 no-op
  const sql = "SELECT * FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = '인건비'";
  const out = applyForcedCostBasisFilter(sql, { value: '표준원가', zcgubunD: '소비-소비' });
  assert(out === sql, 'sys_aimd_cot043 → no-op (다른 테이블 영향 없음)');

  // bw_profitability_data 도 no-op
  const sql2 = 'SELECT * FROM bw_profitability_data';
  const out2 = applyForcedCostBasisFilter(sql2, { value: '표준원가', zcgubunD: '소비-소비' });
  assert(out2 === sql2, 'bw_profitability_data → no-op (수익성분석 영향 없음)');
}

console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===`);
if (failed > 0) {
  console.log('\n실패 항목:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
