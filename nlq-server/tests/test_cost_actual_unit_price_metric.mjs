/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_cost_actual_unit_price_metric.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상: 054_seed_cost_actual_unit_price_metric.sql (신규 metric 시드) 및
 *       이로 인한 UI/서버 동작 검증.
 *
 * 검증 항목:
 *   [A] SQL 시드 파일 자체의 구조/컨텐츠 검증 (파일 파싱)
 *   [B] UI 예시질문 문구 변경 확인 (index.html)
 *   [C] Metric 산식이 요구사항 그대로인지 (SUM(TOTAL)/NULLIF(SUM(LBKUM),0))
 *   [D] 하드코딩 방지: 특정 자재코드가 파일에 없는지
 *   [E] 3개 도메인 (PS/HL/MGMT) 모두 등록되었는지
 *   [F] 동의어 목록에 사용자 요구 표현 포함
 *   [G] 회귀 시나리오 시뮬레이션 (Case 1~5)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED_SQL = path.resolve(__dirname, '../sql/054_seed_cost_actual_unit_price_metric.sql');
const PROD_SQL = path.resolve(__dirname, '../sql/prod_apply_pr435_add_cost_actual_unit_price_metric.sql');
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

// ══════════════════════════════════════════════════════════════════════════
section('[A] SQL 시드 파일이 존재하고 기본 구조를 갖춤');
// ══════════════════════════════════════════════════════════════════════════
{
  assert(fs.existsSync(SEED_SQL), '054_seed_cost_actual_unit_price_metric.sql 파일 존재');
  assert(fs.existsSync(PROD_SQL), 'prod_apply_pr435_...sql 파일 존재');

  const seedSrc = fs.readFileSync(SEED_SQL, 'utf8');
  assert(seedSrc.includes('INSERT IGNORE INTO metric'), 'metric INSERT 문 존재');
  assert(seedSrc.includes('INSERT IGNORE INTO metric_synonym'), 'metric_synonym INSERT 문 존재');
  assert(seedSrc.includes('COST_ACTUAL_UNIT_PRICE'), 'metric_code=COST_ACTUAL_UNIT_PRICE 등록');
  assert(/멱등성|INSERT IGNORE/.test(seedSrc), '멱등성 (INSERT IGNORE) 명시');
}

// ══════════════════════════════════════════════════════════════════════════
section('[C] Metric 산식이 요구사항 그대로 SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(SEED_SQL, 'utf8');
  // 요구사항: SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)
  const expectedFormula = 'SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)';
  const count = src.split(expectedFormula).length - 1;
  assert(count >= 3, `산식이 정확히 그대로 3회 이상 등장 (도메인 3개): 실제 ${count}회`);

  // aggregation 은 CALC 여야 함 (SUM 이 산식 안에 두 번 있으므로)
  assert(src.includes("'CALC'"), 'aggregation=CALC (column-level 지시)');

  // NULLIF 로 0 나누기 방지
  assert(src.includes('NULLIF(SUM(LBKUM), 0)'), 'NULLIF(SUM(LBKUM), 0) 로 0 나누기 방지');
}

// ══════════════════════════════════════════════════════════════════════════
section('[D] 하드코딩 방지 — 특정 자재코드가 SQL 파일에 없음');
// ══════════════════════════════════════════════════════════════════════════
{
  const seedSrc = fs.readFileSync(SEED_SQL, 'utf8');
  const prodSrc = fs.readFileSync(PROD_SQL, 'utf8');
  const combined = seedSrc + '\n' + prodSrc;

  // 사용자 요구사항 #7: 특정 자재코드 하드코딩 금지
  const bannedCodes = ['F2A11220-05000720B', 'H3S72400-00000000'];
  for (const code of bannedCodes) {
    assert(!combined.includes(code),
      `자재 코드 "${code}" 가 SQL 파일에 하드코딩되지 않음`);
  }

  // ZCGUBUN 값도 산식에는 하드코딩되지 않아야 함 (WHERE 조건은 LLM 이 만듦)
  // 단, 주석/설명에는 등장 가능 → 산식 라인만 검사
  const formulaLines = seedSrc.split('\n').filter(l => l.includes("'SUM(TOTAL)"));
  for (const line of formulaLines) {
    assert(!/실제원가/.test(line),
      `산식 라인에 "실제원가" 리터럴 하드코딩 없음 (line: ${line.slice(0, 60)}...)`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('[E] 3개 도메인 (PS / HL / MGMT) 모두 등록');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(SEED_SQL, 'utf8');
  // 각 도메인이 metric INSERT 에 최소 1회 등장
  for (const dc of ['PS', 'HL', 'MGMT']) {
    const pattern = new RegExp(`'${dc}'\\s*,\\s*'COST_ACTUAL_UNIT_PRICE'`);
    assert(pattern.test(src), `도메인 ${dc} 에 metric 등록됨`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('[F] 동의어 목록에 사용자 자연어 표현 포함');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(SEED_SQL, 'utf8');
  // 사용자가 자연어로 부를 만한 표현들
  const requiredSynonyms = [
    '실제원가 단가',
    '실제원가단가',
    '단위당 실제원가',
    '단위원가',
  ];
  for (const syn of requiredSynonyms) {
    assert(src.includes(`'${syn}'`), `동의어 "${syn}" 등록됨`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('[B] UI 예시질문 문구 변경 확인 (index.html)');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(INDEX_HTML, 'utf8');

  // 신규 문구가 두 번 (unified + cost-product) 등장해야 함
  const newQuestion = "'제품별 실제원가 단가 TOP 5'";
  const newCount = src.split(newQuestion).length - 1;
  assert(newCount >= 2, `신규 예시질문 "${newQuestion}" 이 2회 이상 등장 (실제 ${newCount}회)`);

  // 기존 문구 "제품별 실제원가 TOP 5" (단가 없음) 는 SUGGESTIONS_BY_AREA 안에서
  //   더 이상 나타나지 않아야 함 (별도 예시/주석/설명에는 있을 수 있으므로
  //   SUGGESTIONS_BY_AREA 블록 안쪽만 검사)
  const suggIdx = src.indexOf('const SUGGESTIONS_BY_AREA');
  assert(suggIdx > 0, 'SUGGESTIONS_BY_AREA 블록 존재');
  // 블록 종료 (다음 최상위 상수/함수 선언 전까지) 를 대략적으로 잡음
  const blockEnd = src.indexOf('\nfunction ', suggIdx);
  const block = src.slice(suggIdx, blockEnd > 0 ? blockEnd : suggIdx + 8000);
  const oldQuestion = "'제품별 실제원가 TOP 5'";
  assert(!block.includes(oldQuestion),
    `기존 예시질문 "${oldQuestion}" 은 SUGGESTIONS 블록에서 제거됨`);
}

// ══════════════════════════════════════════════════════════════════════════
section('[G-1] Case 1 시뮬레이션: "제품별 실제원가 단가 TOP 5"');
// ══════════════════════════════════════════════════════════════════════════
{
  // metric 이 매칭되면 LLM 은 그 산식을 그대로 SELECT/ORDER BY 에 사용해야 함.
  // 여기서는 산식이 요구사항 Expected SQL 과 일치하는지 확인.
  const src = fs.readFileSync(SEED_SQL, 'utf8');
  const formulaMatch = src.match(/SUM\(TOTAL\)\s*\/\s*NULLIF\(SUM\(LBKUM\),\s*0\)/);
  assert(formulaMatch !== null, 'Case 1 Expected SQL 의 ORDER BY 식과 동일한 산식이 metric 에 등록됨');
  assert(formulaMatch[0] === 'SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)',
    `산식 문자열이 정확히 "SUM(TOTAL) / NULLIF(SUM(LBKUM), 0)"`);
}

// ══════════════════════════════════════════════════════════════════════════
section('[G-2] Case 2 시뮬레이션: "제품별 실제원가 총액 TOP 5" (단가 metric 미매칭)');
// ══════════════════════════════════════════════════════════════════════════
{
  // "총액" 이 사용자 질의에 들어가면 이 metric 동의어 매칭이 안 되어야 함
  // (동의어 리스트에 "총액" 이 없음)
  const src = fs.readFileSync(SEED_SQL, 'utf8');

  // 동의어 목록 추출 (SELECT '<value>' AS s 형태)
  const synonymMatches = [...src.matchAll(/SELECT\s+'([^']+)'\s+(?:AS\s+s\s+)?(?:UNION\s+ALL|\)|$)/gm)];
  const synonyms = synonymMatches.map(m => m[1]);

  assert(synonyms.length > 0, '동의어 목록 파싱 성공');
  assert(!synonyms.includes('총액'), '"총액" 이 단가 metric 동의어에 포함되지 않음 (총액 질의는 SUM(TOTAL) 로 처리)');
  assert(!synonyms.includes('실제원가 총액'), '"실제원가 총액" 도 단가 metric 동의어에 없음');
  assert(!synonyms.includes('실제원가'), '"실제원가" 단독은 단가 metric 동의어에 없음 (총액/단가 의도 모호)');
}

// ══════════════════════════════════════════════════════════════════════════
section('[G-3] Case 3 시뮬레이션: "H3S72400-00000000 제품 실제원가 알려줘"');
// ══════════════════════════════════════════════════════════════════════════
{
  // 이 케이스는 metric 이름이 아닌 dimension-value 매칭 + measure candidate 경로.
  // 이번 PR 은 metric 등록으로 "단가" 명시 케이스만 해결하고,
  // 이 케이스는 PR #433 (measure candidate 발동 조건 확장) 으로 이미 해결됨.
  // 여기서는 하드코딩 방지만 재확인.
  const seedSrc = fs.readFileSync(SEED_SQL, 'utf8');
  const prodSrc = fs.readFileSync(PROD_SQL, 'utf8');
  assert(!seedSrc.includes('H3S72400-00000000'),
    '자재 코드 H3S72400-00000000 이 seed SQL 에 하드코딩되지 않음');
  assert(!prodSrc.includes('H3S72400-00000000'),
    '자재 코드 H3S72400-00000000 이 prod apply SQL 에 하드코딩되지 않음');
}

// ══════════════════════════════════════════════════════════════════════════
section('[G-4] Case 4 시뮬레이션: 생산수량 0 → NULLIF 안전 처리');
// ══════════════════════════════════════════════════════════════════════════
{
  // NULLIF(SUM(LBKUM), 0) 이 산식에 반드시 있어야 함
  // → SUM(LBKUM)=0 이면 NULL 반환 → 나누기 결과 NULL (에러 아님)
  const src = fs.readFileSync(SEED_SQL, 'utf8');
  assert(/NULLIF\s*\(\s*SUM\s*\(\s*LBKUM\s*\)\s*,\s*0\s*\)/i.test(src),
    'NULLIF(SUM(LBKUM), 0) 로 0 나누기 예외 원천 방지');

  // 실제 SQL 시맨틱 검증 (JS 로 시뮬레이션)
  //   x / NULLIF(y, 0)  === (y===0 ? null : x/y)
  const nullif = (v, cmp) => (v === cmp ? null : v);
  const safeDivide = (total, lbkum) => {
    const denom = nullif(lbkum, 0);
    return denom === null ? null : total / denom;
  };
  assert(safeDivide(1000, 0) === null, 'SUM(LBKUM)=0 → NULL (에러 아님)');
  assert(safeDivide(1280086603, 2487031.560).toFixed(2) === '514.70',
    '요구사항 예시 (TOTAL=1,280,086,603 / LBKUM=2,487,031.560) → 약 514.70원/KG');
  assert(safeDivide(0, 100) === 0, 'SUM(TOTAL)=0 → 0 반환 (LBKUM>0)');
}

// ══════════════════════════════════════════════════════════════════════════
section('[G-5] Case 5 시뮬레이션: 기존 필터 유지 (DIVISION / ZCGUBUN / CALMONTH)');
// ══════════════════════════════════════════════════════════════════════════
{
  // 이번 PR 은 metric 등록만 수행. WHERE 절 필터는 서버측 방어망 3종이 담당:
  //   - applyDomainFilter        → DIVISION 자동 주입
  //   - LLM/서버 → ZCGUBUN='실제원가' 인식 (Ontology synonym)
  //   - ensureCalmonthFilter     → CALMONTH 없으면 latestMonth 주입 (PR #431)
  // 각 방어망은 별도 테스트에서 검증되었으므로 여기서는 metric 등록이 이들에
  // 영향 주지 않는지만 확인.
  const src = fs.readFileSync(SEED_SQL, 'utf8');

  // 산식에 DIVISION/ZCGUBUN/CALMONTH 필터가 하드코딩되지 않음 (필터는 WHERE 절)
  const formulaLines = src.match(/'SUM\(TOTAL\)[^']*'/g) || [];
  for (const line of formulaLines) {
    assert(!/DIVISION|ZCGUBUN|CALMONTH/i.test(line),
      `metric 산식에 WHERE 필터 (DIVISION/ZCGUBUN/CALMONTH) 하드코딩 없음: "${line}"`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('[G-6] Prod apply 파일과 054 파일 산식/동의어 일치');
// ══════════════════════════════════════════════════════════════════════════
{
  const seedSrc = fs.readFileSync(SEED_SQL, 'utf8');
  const prodSrc = fs.readFileSync(PROD_SQL, 'utf8');

  // 실제 SQL 문 (INSERT 이후) 안의 산식만 카운트 (주석/설명 제외)
  //   - seed 파일은 헤더 주석에 산식 설명이 하나 더 있어 총 4회 등장하지만
  //     INSERT 문 안에는 3회 (도메인 3개) 만 있어야 함
  const stripComments = (s) => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const formulaRe = /'SUM\(TOTAL\)\s*\/\s*NULLIF\(SUM\(LBKUM\),\s*0\)'/g;
  const seedSqlOnly = stripComments(seedSrc);
  const prodSqlOnly = stripComments(prodSrc);
  const seedFormulas = [...seedSqlOnly.matchAll(formulaRe)];
  const prodFormulas = [...prodSqlOnly.matchAll(formulaRe)];
  assert(seedFormulas.length === 3 && prodFormulas.length === 3,
    `INSERT 안 산식 등장 횟수 3회 (도메인 3개) — seed:${seedFormulas.length}, prod:${prodFormulas.length}`);

  // 도메인 3개 모두 두 파일에서 동일
  for (const dc of ['PS', 'HL', 'MGMT']) {
    const pat = new RegExp(`'${dc}'\\s*,\\s*'COST_ACTUAL_UNIT_PRICE'`);
    assert(pat.test(seedSrc) && pat.test(prodSrc),
      `도메인 ${dc} 이 seed & prod 양쪽 모두 등록됨`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('결과 요약');
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
if (failCount > 0) process.exit(1);
