// [PR#460] 제조원가 ZCGUBUN(원가기준) 명확화 게이트 회귀 테스트
//
//   대상:
//     - detectCostElementIntent(query) — "원가요소" 트리거 감지
//     - detectExplicitZcgubunInQuery(query) — 사용자 명시 여부 판정
//     - applyForcedCostBasisFilter(sql, {value}) — SQL 에 ZCGUBUN 결정적 주입
//     - server.mjs 소스에 clarification 게이트 / job field / prompt directive 반영 확인
//
//   시나리오 (사용자 요구사항 #9):
//     Case 1: "제품별 원가요소 조회해줘"          → clarification 응답
//     Case 2: "제품별 실제원가 원가요소 조회해줘"  → clarification 스킵, ZCGUBUN='실제원가'
//     Case 3: "제품별 매출원가 원가요소 조회해줘"  → clarification 스킵, ZCGUBUN='매출원가'
//     Case 4: "제품별 표준원가 원가요소 조회해줘"  → clarification 스킵, ZCGUBUN='표준원가'
//     Case 5: 사용자가 [실제원가] 선택 후 재요청 → 실제원가만 조회 (합산 안됨)
//
//   중요: 이 테스트는 LLM/DB 호출 없이 순수 로직 단위 검증.

import { readFileSync } from 'node:fs';

const serverMjs = readFileSync('/home/user/webapp/nlq-server/server.mjs', 'utf8');

// ─────────────────────────────────────────────────────────────────
// 1. 함수 격리 로드 (server.mjs 에서 함수 본문 추출 후 eval)
// ─────────────────────────────────────────────────────────────────
function loadFunction(name) {
  const startMarker = `function ${name}(`;
  const startIdx = serverMjs.indexOf(startMarker);
  if (startIdx === -1) throw new Error(`${name} 함수 시작점 없음`);
  // 함수 선언의 '{' 위치 찾기 (첫 번째 opening brace)
  let openIdx = serverMjs.indexOf('{', startIdx);
  if (openIdx === -1) throw new Error(`${name} 함수 body 시작 { 없음`);
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

// applyForcedCostBasisFilter 는 _sanitizeWhereCond 를 참조하므로 먼저 로드
const _sanitizeWhereCond = loadFunction('_sanitizeWhereCond');
globalThis._sanitizeWhereCond = _sanitizeWhereCond;
const detectCostElementIntent = loadFunction('detectCostElementIntent');
// detectExplicitZcgubunInQuery 는 detectStandardCostSubtypeInQuery 를 참조하므로 후자 먼저 로드
const detectStandardCostSubtypeInQuery = loadFunction('detectStandardCostSubtypeInQuery');
globalThis.detectStandardCostSubtypeInQuery = detectStandardCostSubtypeInQuery;
const detectExplicitZcgubunInQuery = loadFunction('detectExplicitZcgubunInQuery');
const applyForcedCostBasisFilter = loadFunction('applyForcedCostBasisFilter');

// ─────────────────────────────────────────────────────────────────
// 2. 헬퍼
// ─────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) { console.log(`✓ PASS  ${msg}`); passed++; }
  else       { console.log(`❌ FAIL  ${msg}`); failed++; failures.push(msg); }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 A: detectCostElementIntent — "원가요소" 트리거 감지 ===');
// ═══════════════════════════════════════════════════════════════
{
  const cases = [
    { q: '제품별 원가요소 조회해줘',           expect: true,  kw: '원가요소' },
    { q: '원가요소 알려줘',                    expect: true,  kw: '원가요소' },
    { q: '2026년 8월 원가 요소',                expect: true,  kw: '원가요소' },  // 공백 있어도 매칭
    { q: '원가유형 조회',                      expect: true,  kw: '원가유형' },
    { q: '원가항목 조회',                      expect: true,  kw: '원가항목' },
    // 매칭되지 말아야 함
    { q: '원가 알려줘',                        expect: false, kw: '' },
    { q: '제조원가 조회',                      expect: false, kw: '' },
    { q: '인건비 알려줘',                      expect: false, kw: '' },
    { q: '2026년 8월 매출',                    expect: false, kw: '' },
    { q: '',                                   expect: false, kw: '' },
  ];
  for (const c of cases) {
    const r = detectCostElementIntent(c.q);
    assert(r.matched === c.expect, `matched="${c.expect}" for "${c.q}"`);
    if (c.expect) {
      assert(r.matchedKeyword === c.kw, `matchedKeyword="${c.kw}" for "${c.q}" (got "${r.matchedKeyword}")`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 B: detectExplicitZcgubunInQuery — 사용자 명시 여부 판정 ===');
// ═══════════════════════════════════════════════════════════════
{
  // [2026-09-16 스펙 확장] 표준원가 단독은 이제 explicit=false (2차 clarification 필요)
  //   요구사항 #6/#7: "표준원가 알려줘" → 반드시 서브타입 확정
  //   표준원가 + 서브타입 명시 ("매출원가의 표준원가") 는 별도 스위트 (standard_subtype) 에서 검증
  const cases = [
    // 실제/매출원가는 단독으로도 explicit=true (기존 유지)
    { q: '제품별 실제원가 원가요소 조회해줘',   explicit: true,  z: '실제원가' },
    { q: '제품별 매출원가 원가요소 조회해줘',   explicit: true,  z: '매출원가' },
    { q: '실제 원가 원가요소',                  explicit: true,  z: '실제원가' },  // 공백 허용
    { q: '매출 원가 요소',                      explicit: true,  z: '매출원가' },
    // 표준원가 단독 → explicit=false (2차 clarification 필요, zcgubun 은 감지됨)
    { q: '제품별 표준원가 원가요소 조회해줘',   explicit: false, z: '표준원가' },
    { q: '표준 원가 알려줘',                    explicit: false, z: '표준원가' },
    // 아무 것도 명시 안 됨
    { q: '제품별 원가요소 조회해줘',            explicit: false, z: null },
    { q: '원가 알려줘',                         explicit: false, z: null },
    { q: '',                                    explicit: false, z: null },
  ];
  for (const c of cases) {
    const r = detectExplicitZcgubunInQuery(c.q);
    assert(r.explicit === c.explicit, `explicit=${c.explicit} for "${c.q}"`);
    // 표준원가 단독은 explicit=false 지만 zcgubun 은 '표준원가' 로 반환 (게이트에서 2차 처리 위해)
    if (c.z !== null) {
      assert(r.zcgubun === c.z, `zcgubun="${c.z}" for "${c.q}" (got "${r.zcgubun}")`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 C: applyForcedCostBasisFilter — SQL 결정적 주입 ===');
// ═══════════════════════════════════════════════════════════════
{
  // C1: WHERE 절 없음 → FROM 뒤에 WHERE 신설
  const sql1 = 'SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL';
  const out1 = applyForcedCostBasisFilter(sql1, { value: '실제원가' });
  assert(/WHERE\s+ZCGUBUN\s*=\s*'실제원가'/.test(out1), 'WHERE 없음 → FROM 뒤에 WHERE ZCGUBUN 신설');
  assert(/GROUP BY MATERIAL/.test(out1), 'GROUP BY 절 유지');

  // C2: 기존 WHERE 있음 → AND (ZCGUBUN=...) 로 병합
  const sql2 = "SELECT * FROM sys_aimd_cot015 WHERE CALMONTH = '202608'";
  const out2 = applyForcedCostBasisFilter(sql2, { value: '매출원가' });
  assert(/ZCGUBUN\s*=\s*'매출원가'/.test(out2), 'WHERE 있음 → ZCGUBUN 조건 병합');
  assert(/CALMONTH\s*=\s*'202608'/.test(out2), '기존 CALMONTH 조건 유지 (기존 필터 보존)');

  // C3: LLM 이 임의로 다른 ZCGUBUN 넣었어도 사용자 확정값으로 치환
  const sql3 = "SELECT * FROM sys_aimd_cot015 WHERE ZCGUBUN = '표준원가' AND CALMONTH = '202608'";
  const out3 = applyForcedCostBasisFilter(sql3, { value: '실제원가' });
  assert(/ZCGUBUN\s*=\s*'실제원가'/.test(out3), 'LLM 의 잘못된 ZCGUBUN 값 → 사용자 확정값으로 치환');
  assert(!/ZCGUBUN\s*=\s*'표준원가'/.test(out3), '기존 잘못된 ZCGUBUN 값 제거');
  assert(/CALMONTH\s*=\s*'202608'/.test(out3), '기존 CALMONTH 조건 유지');

  // C4: LLM 이 IN 절로 여러 값 넣었어도 정리 후 확정값 하나만 남김 (요구사항 #4)
  const sql4 = "SELECT * FROM sys_aimd_cot015 WHERE ZCGUBUN IN ('실제원가','매출원가','표준원가')";
  const out4 = applyForcedCostBasisFilter(sql4, { value: '매출원가' });
  assert(/ZCGUBUN\s*=\s*'매출원가'/.test(out4), 'IN 절 제거 후 사용자 확정값 = 로 재주입');
  assert(!/IN\s*\(/.test(out4), '기존 IN 절 완전 제거 (서로 다른 원가기준 합산 금지)');

  // C5: LLM 이 LIKE 로 넣은 케이스
  const sql5 = "SELECT * FROM sys_aimd_cot015 WHERE ZCGUBUN LIKE '%원가%'";
  const out5 = applyForcedCostBasisFilter(sql5, { value: '표준원가' });
  assert(/ZCGUBUN\s*=\s*'표준원가'/.test(out5), 'LIKE 절 제거 후 = 로 재주입');
  assert(!/LIKE/i.test(out5), 'LIKE 절 완전 제거');

  // C6: sys_aimd_cot015 아닌 테이블은 no-op
  const sql6 = 'SELECT * FROM sys_aimd_cot043 WHERE ZCOSTCOMP_NM = \'인건비\'';
  const out6 = applyForcedCostBasisFilter(sql6, { value: '실제원가' });
  assert(out6 === sql6, 'sys_aimd_cot043 → no-op (다른 테이블에 영향 없음)');

  const sql7 = 'SELECT * FROM bw_profitability_data';
  const out7 = applyForcedCostBasisFilter(sql7, { value: '실제원가' });
  assert(out7 === sql7, 'bw_profitability_data → no-op (수익성분석 영향 없음)');

  // C7: forcedCostBasis 가 null 이면 no-op
  const out8 = applyForcedCostBasisFilter(sql1, null);
  assert(out8 === sql1, 'forcedCostBasis=null → no-op');
  const out9 = applyForcedCostBasisFilter(sql1, { value: '' });
  assert(out9 === sql1, 'forcedCostBasis.value 빈 문자열 → no-op');

  // C8: 백틱 감싼 컬럼명도 매치
  const sql10 = "SELECT * FROM sys_aimd_cot015 WHERE `ZCGUBUN` = '표준원가'";
  const out10 = applyForcedCostBasisFilter(sql10, { value: '실제원가' });
  assert(/ZCGUBUN\s*=\s*'실제원가'/.test(out10), '백틱 감싼 ZCGUBUN 도 정확히 치환');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 D: 사용자 요구사항 Case 1-5 시나리오 완전 재현 ===');
// ═══════════════════════════════════════════════════════════════
{
  // Case 1: "제품별 원가요소 조회해줘" → clarification 표시
  const q1 = '제품별 원가요소 조회해줘';
  const e1 = detectCostElementIntent(q1);
  const x1 = detectExplicitZcgubunInQuery(q1);
  assert(e1.matched === true && x1.explicit === false, `[Case 1] "${q1}" → clarification 대상`);

  // Case 2: "제품별 실제원가 원가요소 조회해줘" → clarification 스킵, ZCGUBUN='실제원가'
  const q2 = '제품별 실제원가 원가요소 조회해줘';
  const e2 = detectCostElementIntent(q2);
  const x2 = detectExplicitZcgubunInQuery(q2);
  assert(e2.matched === true && x2.explicit === true && x2.zcgubun === '실제원가',
    `[Case 2] "${q2}" → clarification 스킵, ZCGUBUN='실제원가'`);

  // Case 3: "제품별 매출원가 원가요소 조회해줘" → ZCGUBUN='매출원가'
  const q3 = '제품별 매출원가 원가요소 조회해줘';
  const e3 = detectCostElementIntent(q3);
  const x3 = detectExplicitZcgubunInQuery(q3);
  assert(e3.matched === true && x3.explicit === true && x3.zcgubun === '매출원가',
    `[Case 3] "${q3}" → ZCGUBUN='매출원가'`);

  // Case 4: "제품별 표준원가 원가요소 조회해줘" → zcgubun='표준원가' 감지되지만
  //   서브타입 없어서 explicit=false → 2차 clarification 필요.
  //   [2026-09-16] 스펙 확장: 표준원가 단독은 반드시 2차 확정 (요구사항 #6/#7).
  //   기존 자동 확정 케이스는 test_costbasis_standard_subtype.mjs 에서 별도 검증.
  const q4 = '제품별 표준원가 원가요소 조회해줘';
  const e4 = detectCostElementIntent(q4);
  const x4 = detectExplicitZcgubunInQuery(q4);
  assert(e4.matched === true && x4.zcgubun === '표준원가' && x4.explicit === false,
    `[Case 4] "${q4}" → 표준원가 감지되지만 서브타입 없어서 2차 clarification 필요 (explicit=false)`);

  // Case 5: 실제원가 선택 후 재요청 → 실제원가만 조회, 표준원가와 합산 안됨
  //   LLM 이 잘못해서 표준원가/실제원가 두 값을 IN 절에 넣어도 서버가 실제원가만 남김
  const llmSql = "SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 WHERE CALMONTH='202608' AND ZCGUBUN IN ('실제원가','표준원가') GROUP BY MATERIAL";
  const finalSql = applyForcedCostBasisFilter(llmSql, { value: '실제원가' });
  assert(/ZCGUBUN\s*=\s*'실제원가'/.test(finalSql),
    `[Case 5] 재요청 SQL 에 ZCGUBUN='실제원가' 확정 필터 존재`);
  assert(!/'표준원가'/.test(finalSql),
    `[Case 5] 표준원가 리터럴 완전 제거 (서로 다른 원가기준 합산 금지)`);
  assert(/CALMONTH\s*=\s*'202608'/.test(finalSql),
    `[Case 5] 기존 CALMONTH 조건 유지 (요구사항 #6)`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 E: server.mjs 소스 반영 확인 (문자열 스팟 체크) ===');
// ═══════════════════════════════════════════════════════════════
{
  // clarification 게이트 존재
  assert(serverMjs.includes('costbasisClarification'),
    'server.mjs 에 costbasisClarification 응답 필드 존재');
  assert(serverMjs.includes('CostBasisClarify'),
    'server.mjs 에 CostBasisClarify 로그 태그 존재');
  assert(serverMjs.includes("selectedTable === 'sys_aimd_cot015' && !alreadyClarifiedCostBasis"),
    'server.mjs 에 cot015 전용 clarification 게이트 조건 존재');

  // 3버튼 옵션 (실제원가/매출원가/표준원가)
  const zcgubunButtons = serverMjs.match(/value:\s*'실제원가'.*?value:\s*'매출원가'.*?value:\s*'표준원가'/s);
  assert(!!zcgubunButtons,
    'server.mjs clarification options 에 실제원가/매출원가/표준원가 3버튼 존재');

  // __ALL__ 옵션 없음 (요구사항 #4)
  const clarifyBlockStart = serverMjs.indexOf('costbasisClarification: {');
  const clarifyBlockEnd = serverMjs.indexOf('return res.json', clarifyBlockStart);
  const clarifyBlock = serverMjs.slice(clarifyBlockStart, clarifyBlockEnd);
  assert(!/__ALL__/.test(clarifyBlock),
    'costbasisClarification 응답에 __ALL__ 옵션 없음 (요구사항 #4)');

  // job 에 forcedCostBasis 필드
  assert(serverMjs.includes('forcedCostBasis: confirmedForcedCostBasis'),
    'job 객체에 forcedCostBasis 필드 존재');

  // whitelist 검증
  assert(serverMjs.includes("v === '실제원가' || v === '매출원가' || v === '표준원가'"),
    'server.mjs 에 ZCGUBUN whitelist 검증 존재');

  // areaCtx 병합 (스펙 확장 후: value 또는 value+zcgubunD 로 병합)
  assert(serverMjs.includes('areaCtx.forcedCostBasis ='),
    'server.mjs 에 areaCtx.forcedCostBasis 병합 로직 존재');

  // SQL 실행 직전 필터 주입
  assert(serverMjs.includes('applyForcedCostBasisFilter(baseSql, areaCtx.forcedCostBasis)'),
    'server.mjs 에 baseSql 에 applyForcedCostBasisFilter 호출 존재');
  assert(serverMjs.includes('applyForcedCostBasisFilter(priorSql, areaCtx.forcedCostBasis)'),
    'server.mjs 에 priorSql 에도 applyForcedCostBasisFilter 호출 존재 (delta 대칭)');

  // prompt directive 존재 (analysis + aggregate)
  assert(serverMjs.includes('costBasisDirective') && serverMjs.includes('원가기준(ZCGUBUN)'),
    'server.mjs 에 costBasisDirective (analysis 라우트 프롬프트) 존재');
  assert(serverMjs.includes('CostBasisDirective:Aggregate'),
    'server.mjs 에 CostBasisDirective:Aggregate (aggregate 라우트 프롬프트) 존재');

  // self-fetch body 에 forwarding
  assert(serverMjs.includes('forcedCostBasis: job.forcedCostBasis'),
    'server.mjs 에 async → sync self-fetch body 에 forcedCostBasis 전달 존재');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 F: 기존 기능 회귀 안전성 ===');
// ═══════════════════════════════════════════════════════════════
{
  // "인건비 알려줘" 는 원가요소 트리거가 아니므로 clarification 미발동 (aggregate grain directive 만 발동)
  const q = '인건비 알려줘';
  assert(detectCostElementIntent(q).matched === false,
    `"${q}" → 원가요소 트리거 아님 (기존 인건비 조회 흐름 유지)`);

  // "원가 알려줘" 는 기존 GENERIC branch (L4815) 가 담당 → 새 트리거 미발동
  const q2 = '원가 알려줘';
  assert(detectCostElementIntent(q2).matched === false,
    `"${q2}" → 새 트리거 미발동 (기존 GENERIC branch 담당)`);

  // "제품별 원가 알려줘" 도 새 트리거 미발동
  const q3 = '제품별 원가 알려줘';
  assert(detectCostElementIntent(q3).matched === false,
    `"${q3}" → 새 트리거 미발동`);

  // "제품별 실제원가" 만 있으면 원가요소 트리거 없어서 clarification 미발동 (기존 SPECIFIC branch 담당)
  const q4 = '제품별 실제원가 조회';
  const e4 = detectCostElementIntent(q4);
  assert(e4.matched === false,
    `"${q4}" → 원가요소 트리거 아님 (기존 SPECIFIC branch 담당)`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n=== 그룹 G: 하드코딩 방지 (일반화된 로직) ===');
// ═══════════════════════════════════════════════════════════════
{
  // detectCostElementIntent 는 어떤 특정 원가항목 이름도 하드코딩하지 않음
  const src = serverMjs;
  const funcStart = src.indexOf('function detectCostElementIntent');
  const funcEnd   = src.indexOf('\n}\n', funcStart) + 3;
  const funcBody = src.slice(funcStart, funcEnd);
  // 특정 원가 어휘 (인건비/전력비/도급비 등) 를 하드코딩하지 않았는지 확인
  const hardcodedTerms = ['인건비', '전력비', '도급비', '재료비', '노무비', '경비'];
  for (const t of hardcodedTerms) {
    assert(!funcBody.includes(t),
      `detectCostElementIntent 는 "${t}" 하드코딩 없음`);
  }
  // 트리거는 오직 "원가요소/원가유형/원가항목" 3종
  assert(funcBody.includes('원가\\s*요소') && funcBody.includes('원가\\s*유형') && funcBody.includes('원가\\s*항목'),
    'detectCostElementIntent 트리거는 원가요소/원가유형/원가항목 3종');
}

console.log(`\n=== 결과: ${passed} PASS / ${failed} FAIL ===`);
if (failed > 0) {
  console.log('\n실패 항목:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
