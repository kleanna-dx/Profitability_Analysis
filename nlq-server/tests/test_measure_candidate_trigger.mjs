/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_measure_candidate_trigger.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상: nlq-server/server.mjs 안의 "Numeric Measure Candidate 자동 노출"
 *       발동 조건 확장 (사용자 신고 2026-09-10).
 *
 * 배경 (사용자 신고):
 *   "제품별 실제원가 TOP 5"           → 정상 SQL 생성 (rankIntent=true 라서)
 *   "F2A11220-05000720B 자재 실제원가 알려줘" → "알 수 없는 용어" refuse
 *
 * 근본 원인:
 *   - 두 질의 모두 "실제원가" 는 ZCGUBUN 컬럼 동의어로 매칭됨
 *   - 그러나 후자는 rankIntent=false 라서 Numeric Measure Candidate 프롬프트
 *     섹션이 발동하지 않음
 *   - LLM 은 프롬프트 규칙 18 예외 조건 (b) "정렬용 Measure 자동 후보 섹션
 *     존재" 를 못 만족해서 refuse
 *
 * 수정:
 *   Numeric Measure Candidate 발동 조건을 [A OR B] 로 확장:
 *     [A] 기존 조건: 정렬 의도 감지 (rankIntent)
 *     [B] 신규 조건: dimension-value 매칭 감지 (columnMatches 안에 varchar 계열
 *         컬럼이 있어서 값 필터로 해석될 여지가 큰 경우)
 *   공통: Metric 매칭 0건 + tableWhitelist 지정됨
 *
 * 테스트 검증:
 *   - RANK_INTENT_PATTERNS 감지 정확도
 *   - STRING_DIMENSION_TYPE_RE 로 dimension 판별 정확도
 *   - 조합 조건 [A] / [B] / [A∩B] / [~A∩~B] 모든 매트릭스 검증
 *   - 사용자 재현 두 질의 시나리오 (Case A/B)
 *   - 하드코딩 방지 검증 (특정 컬럼명 사용 안 함)
 *   - 회귀 안전성: 기존 rankIntent 경로 케이스가 여전히 발동
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
  if (cond) {
    passCount++;
    console.log('  ✅ ' + msg);
  } else {
    failCount++;
    console.log('  ❌ ' + msg);
  }
}
function section(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

// ── server.mjs 에서 조건 로직 재현 ──────────────────────────────────
// 실제 함수는 async DB 조회를 포함하지만, 발동 조건 계산 자체는 순수
// 로직이므로 여기서 동등한 함수를 재현하여 단위 테스트.
//
// 아래 재현 함수는 server.mjs 의 다음 원본과 로직상 동일해야 함:
//   const RANK_INTENT_PATTERNS = [...]         (server.mjs L3337)
//   function detectRankIntent(query)           (server.mjs L3347)
//   const STRING_DIMENSION_TYPE_RE = /^(varchar|char|text|enum|nchar|nvarchar)/i;
//   const dimensionValueMatches = columnMatches.filter(...)
//   const hasDimensionValueMatch = dimensionValueMatches.length > 0;
//   const needMeasureCandidate = (rankIntent || hasDimensionValueMatch);
//   if (needMeasureCandidate && metricMatches.length === 0 && hasScope) { ... }

// server.mjs 의 실제 RANK_INTENT_PATTERNS 를 그대로 가져와 검증
function loadRankIntentPatternsFromSource() {
  const src = fs.readFileSync(SERVER_MJS, 'utf8');
  const marker = 'const RANK_INTENT_PATTERNS = [';
  const idx = src.indexOf(marker);
  if (idx < 0) throw new Error('RANK_INTENT_PATTERNS not found in server.mjs');
  // 배열 끝 ] 까지
  let i = idx + marker.length;
  let depth = 1;
  while (i < src.length && depth > 0) {
    if (src[i] === '[') depth++;
    else if (src[i] === ']') depth--;
    if (depth === 0) break;
    i++;
  }
  const arrayBody = src.slice(idx + marker.length, i);
  // eslint-disable-next-line no-new-func
  return new Function(`return [${arrayBody}];`)();
}

const RANK_INTENT_PATTERNS = loadRankIntentPatternsFromSource();
function detectRankIntent(query) {
  const q = String(query || '');
  return RANK_INTENT_PATTERNS.some(p => p.test(q));
}

const STRING_DIMENSION_TYPE_RE = /^(varchar|char|text|enum|nchar|nvarchar)/i;

// 트리거 판정 로직 (server.mjs 의 것과 로직상 동등)
function computeTrigger(query, columnMatches, metricMatches, tableWhitelist) {
  const rankIntent = detectRankIntent(query);
  const hasScope = Array.isArray(tableWhitelist) && tableWhitelist.length > 0;
  const dimensionValueMatches = (columnMatches || []).filter(m =>
    STRING_DIMENSION_TYPE_RE.test(String(m.data_type || ''))
  );
  const hasDimensionValueMatch = dimensionValueMatches.length > 0;
  const needMeasureCandidate = (rankIntent || hasDimensionValueMatch);
  const wouldTrigger = needMeasureCandidate && (metricMatches || []).length === 0 && hasScope;
  return {
    rankIntent,
    hasScope,
    dimensionValueMatches,
    hasDimensionValueMatch,
    needMeasureCandidate,
    wouldTrigger,
  };
}

// 헬퍼: dimension match 팩토리 (실제원가 → ZCGUBUN 형태)
function mkColMatch({ column_name, data_type, matchedKeyword }) {
  return {
    column_name,
    data_type,
    matchedKeyword,
    synonym: matchedKeyword,
    description: '',
    source: 'ontology',
  };
}

// 공통 fixtures
const SCOPE = ['sys_aimd_cot015'];
const ZCGUBUN_MATCH = mkColMatch({
  column_name: 'ZCGUBUN', data_type: 'varchar(20)', matchedKeyword: '실제원가'
});
const AMOUNT_MATCH = mkColMatch({
  column_name: 'TOTAL', data_type: 'decimal(18,2)', matchedKeyword: '금액'
});

// ══════════════════════════════════════════════════════════════════════════
section('Test 1: 사용자 신고 재현 — Case A (TOP 있음) vs Case B (TOP 없음)');
// ══════════════════════════════════════════════════════════════════════════
{
  // Case A: "제품별 실제원가 TOP 5" → 기존에도 정상 동작
  const caseA = computeTrigger(
    '제품별 실제원가 TOP 5',
    [ZCGUBUN_MATCH],   // "실제원가" 는 ZCGUBUN (varchar) 매칭
    [],                 // Metric 매칭 없음
    SCOPE
  );
  assert(caseA.rankIntent === true, 'Case A: TOP 5 → rankIntent=true');
  assert(caseA.hasDimensionValueMatch === true, 'Case A: ZCGUBUN(varchar) → hasDimensionValueMatch=true');
  assert(caseA.wouldTrigger === true, 'Case A: measure candidate 발동 (기존 정상 동작 유지)');

  // Case B: "F2A11220-05000720B 자재 실제원가 알려줘" → 이번 수정 대상
  const caseB = computeTrigger(
    'F2A11220-05000720B 자재 실제원가 알려줘',
    [ZCGUBUN_MATCH],
    [],
    SCOPE
  );
  assert(caseB.rankIntent === false, 'Case B: 정렬 의도 없음 → rankIntent=false');
  assert(caseB.hasDimensionValueMatch === true, 'Case B: ZCGUBUN(varchar) → hasDimensionValueMatch=true');
  assert(caseB.wouldTrigger === true,
    'Case B: measure candidate 발동 (수정 전에는 false 였음 — 이번 수정으로 true)');

  // 두 경로가 동일한 트리거 상태에 도달하는지 확인 (핵심 대칭성)
  assert(caseA.wouldTrigger === caseB.wouldTrigger,
    '★ 사용자 신고 대응: 두 경로 모두 measure candidate 트리거됨 (대칭성 확보)');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 2: 발동 조건 매트릭스 — A/B/공통 조건 모든 조합');
// ══════════════════════════════════════════════════════════════════════════
{
  // 매트릭스: [rankIntent, hasDimMatch, hasMetric, hasScope] → wouldTrigger
  const cases = [
    // [query, columnMatches, metricMatches, tableWhitelist, expectedTrigger, label]
    ['TOP 5',              [ZCGUBUN_MATCH], [], SCOPE, true,  'A+B+공통 → 발동'],
    ['TOP 5',              [],              [], SCOPE, true,  'A만 (기존 rankIntent 경로) → 발동'],
    ['실제원가 알려줘',    [ZCGUBUN_MATCH], [], SCOPE, true,  'B만 (신규 dim 경로) → 발동'],
    ['실제원가 알려줘',    [],              [], SCOPE, false, '~A∩~B → 미발동'],
    ['TOP 5',              [ZCGUBUN_MATCH], [{ column_name:'SUM(X)' }], SCOPE, false, 'A+B 있어도 Metric 있으면 미발동'],
    ['실제원가 알려줘',    [ZCGUBUN_MATCH], [], [],    false, 'scope 없으면 미발동'],
    ['TOP 5',              [ZCGUBUN_MATCH], [], null,  false, 'scope=null → 미발동'],
  ];
  for (const [q, cm, mm, wl, expected, label] of cases) {
    const r = computeTrigger(q, cm, mm, wl);
    assert(r.wouldTrigger === expected, `${label}: wouldTrigger=${expected}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 3: dimension 판별 정확도 — 문자열 계열은 dimension, 숫자 계열은 measure');
// ══════════════════════════════════════════════════════════════════════════
{
  const cases = [
    // [data_type, expectedIsDimension]
    ['varchar(20)',   true,  'varchar → dimension'],
    ['VARCHAR(40)',   true,  '대문자 VARCHAR → dimension'],
    ['char(10)',      true,  'char → dimension'],
    ['text',          true,  'text → dimension'],
    ['enum',          true,  'enum → dimension'],
    ['nvarchar(50)',  true,  'nvarchar → dimension'],
    ['int(11)',       false, 'int → dimension 아님 (measure 대상)'],
    ['bigint',        false, 'bigint → dimension 아님'],
    ['decimal(18,2)', false, 'decimal → dimension 아님'],
    ['numeric',       false, 'numeric → dimension 아님'],
    ['double',        false, 'double → dimension 아님'],
    ['float',         false, 'float → dimension 아님'],
    ['',              false, '빈 문자열 → dimension 아님'],
    [null,            false, 'null → dimension 아님'],
    [undefined,       false, 'undefined → dimension 아님'],
  ];
  for (const [dt, expected, label] of cases) {
    const got = STRING_DIMENSION_TYPE_RE.test(String(dt || ''));
    assert(got === expected, label);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 4: 회귀 안전성 — 기존 rankIntent 경로가 그대로 발동');
// ══════════════════════════════════════════════════════════════════════════
{
  // 기존에 정상 동작하던 rankIntent 케이스들이 여전히 발동하는지 검증
  const queries = [
    '제품별 실제원가 TOP 5',
    '부서별 원가 상위 10',
    '자재별 하위 5',
    '가장 높은 매출 제품',
    '가장 많은 원가 부서',
    '제일 낮은 이익 제품',
    // 참고: '랭킹 조회' 는 기존 RANK_INTENT_PATTERNS 특성상 매칭 안 됨
    //   (/\b랭킹|순위|등수/ 에서 \b 는 한글 앞에서 word boundary 인식 안 함,
    //    또한 | 가 우선이라 실제로는 [/\b랭킹/, /순위/, /등수/] 로 갈라짐).
    //   이 특성은 본 PR 스코프 밖의 기존 이슈이므로 테스트에서 제외.
    '순위 확인',
  ];
  for (const q of queries) {
    const r = computeTrigger(q, [], [], SCOPE);
    assert(r.wouldTrigger === true, `기존 정상: "${q}" → measure candidate 발동`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 5: 사용자 요구 Case 1~4 대응');
// ══════════════════════════════════════════════════════════════════════════
{
  // Case 1: "제품별 실제원가 TOP 5" - 기존 정상 동작 유지
  const c1 = computeTrigger('제품별 실제원가 TOP 5', [ZCGUBUN_MATCH], [], SCOPE);
  assert(c1.wouldTrigger === true, 'Case 1: 기존 정상 동작 유지');

  // Case 2: "F2A11220-05000720B 자재 실제원가 알려줘"
  const c2 = computeTrigger('F2A11220-05000720B 자재 실제원가 알려줘', [ZCGUBUN_MATCH], [], SCOPE);
  assert(c2.wouldTrigger === true, 'Case 2: MATERIAL 코드 포함 실제원가 조회 → 발동');

  // Case 3: 다른 MATERIAL 코드 + 실제원가 (하드코딩 아닌지 검증)
  const c3a = computeTrigger('ABC-123 자재 실제원가', [ZCGUBUN_MATCH], [], SCOPE);
  const c3b = computeTrigger('XYZ-999-EEE 실제원가 조회', [ZCGUBUN_MATCH], [], SCOPE);
  assert(c3a.wouldTrigger === true, 'Case 3-a: ABC-123 자재 실제원가 → 발동');
  assert(c3b.wouldTrigger === true, 'Case 3-b: XYZ-999-EEE 실제원가 조회 → 발동');

  // Case 4: "F2A11220-05000720B 자재 표준원가 알려줘"
  //   표준원가도 ZCGUBUN 컬럼의 값 (사용자 스크린샷 확인)
  const c4 = computeTrigger('F2A11220-05000720B 자재 표준원가 알려줘',
    [mkColMatch({ column_name: 'ZCGUBUN', data_type: 'varchar(20)', matchedKeyword: '표준원가' })],
    [], SCOPE);
  assert(c4.wouldTrigger === true, 'Case 4: 표준원가도 동일 게이트 통과');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 6: 하드코딩 방지 — 특정 컬럼명 없이도 발동');
// ══════════════════════════════════════════════════════════════════════════
{
  // 어떤 varchar 계열 컬럼이든 dimension 매칭이면 발동해야 함 (ZCGUBUN 하드코딩 없음)
  const otherDim = mkColMatch({ column_name: 'ZWERKS', data_type: 'varchar(4)', matchedKeyword: '공장' });
  const r = computeTrigger('공장별 원가 조회', [otherDim], [], SCOPE);
  assert(r.hasDimensionValueMatch === true, '다른 varchar 컬럼도 dimension 으로 인식');
  assert(r.wouldTrigger === true, 'ZCGUBUN 이 아닌 컬럼(ZWERKS) 매칭이어도 발동');

  // 다중 dimension 매칭
  const multi = computeTrigger('공장별 실제원가 조회', [ZCGUBUN_MATCH, otherDim], [], SCOPE);
  assert(multi.hasDimensionValueMatch === true, '복수 dimension 매칭도 dimension 있음으로 인식');
  assert(multi.dimensionValueMatches.length === 2, '2개 dimension 모두 필터링에 포함');
  assert(multi.wouldTrigger === true, '복수 dimension 매칭 → 발동');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 7: 부정 오탐 방지 — 숫자 컬럼만 있으면 dimension 매칭으로 오인 X');
// ══════════════════════════════════════════════════════════════════════════
{
  // 숫자 컬럼만 매칭된 경우는 measure 자체이지 dimension 이 아님
  // → hasDimensionValueMatch=false, rankIntent 없으면 발동 안 함
  const r = computeTrigger('실제원가 알려줘', [AMOUNT_MATCH], [], SCOPE);
  assert(r.hasDimensionValueMatch === false, '숫자 컬럼(decimal)은 dimension 아님');
  assert(r.wouldTrigger === false, '숫자 컬럼 매칭만 있으면 발동 안 함 (이미 measure)');

  // 숫자 + varchar 혼합 매칭 → varchar 하나라도 있으면 dimension 매칭 감지
  const mixed = computeTrigger('실제원가 알려줘', [ZCGUBUN_MATCH, AMOUNT_MATCH], [], SCOPE);
  assert(mixed.hasDimensionValueMatch === true, '혼합 시 varchar 하나라도 있으면 dimension');
  assert(mixed.dimensionValueMatches.length === 1, 'dimension 매칭 개수: varchar 만 카운트');
  assert(mixed.wouldTrigger === true, '혼합 매칭도 발동');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 8: Metric 매칭이 있으면 절대 발동 안 함 (backward compat)');
// ══════════════════════════════════════════════════════════════════════════
{
  // 학습관리에 Metric 이 정식 등록된 경우 - 그 산식이 우선이므로 candidate 프롬프트 미노출
  const metric = { source: 'metric', metric_code: 'M001', column_name: 'SUM(X)', synonym: '실제원가' };

  // A: TOP + dim + Metric → 미발동
  const a = computeTrigger('실제원가 TOP 5', [ZCGUBUN_MATCH], [metric], SCOPE);
  assert(a.wouldTrigger === false, 'Metric 있으면 rank+dim 있어도 미발동');

  // B: dim + Metric → 미발동
  const b = computeTrigger('실제원가 알려줘', [ZCGUBUN_MATCH], [metric], SCOPE);
  assert(b.wouldTrigger === false, 'Metric 있으면 dim 있어도 미발동');

  // C: rank + Metric → 미발동
  const c = computeTrigger('TOP 5', [], [metric], SCOPE);
  assert(c.wouldTrigger === false, 'Metric 있으면 rank 있어도 미발동');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 9: server.mjs 소스에 새 로직이 실제로 반영되어 있는지 스팟 체크');
// ══════════════════════════════════════════════════════════════════════════
{
  const src = fs.readFileSync(SERVER_MJS, 'utf8');
  assert(src.includes('STRING_DIMENSION_TYPE_RE'),
    'server.mjs 에 STRING_DIMENSION_TYPE_RE 상수 정의됨');
  assert(src.includes('const hasDimensionValueMatch = dimensionValueMatches.length > 0'),
    'server.mjs 에 hasDimensionValueMatch 판정 로직 있음');
  assert(src.includes('const needMeasureCandidate = (rankIntent || hasDimensionValueMatch)'),
    'server.mjs 에 needMeasureCandidate 통합 조건 있음');
  assert(src.includes('needMeasureCandidate && metricMatches.length === 0 && hasScope'),
    'server.mjs 에 발동 조건이 needMeasureCandidate 로 확장됨');
  assert(src.includes('차원값 매칭 감지'),
    'server.mjs 에 차원값 매칭 감지 trigger reason 로그 있음');
  // 하드코딩 방지: TOTAL 같은 컬럼명이 발동 조건 로직에 등장하지 않음
  const triggerBlock = src.slice(
    src.indexOf('const rankIntent = detectRankIntent(query);'),
    src.indexOf('} else {\n        console.log(`[NumericCandidate] 발동 조건 충족')
  );
  assert(!/\bTOTAL\b/.test(triggerBlock), '발동 조건 블록에 TOTAL 하드코딩 없음');
  assert(!/\bZAMT/.test(triggerBlock), '발동 조건 블록에 ZAMT 하드코딩 없음');
  assert(!/\bMATERIAL\b/.test(triggerBlock), '발동 조건 블록에 MATERIAL 하드코딩 없음');
  assert(!/\bZCGUBUN\b(?!['" ]?\s*=)/.test(triggerBlock.replace(/차원값 매칭[^`]*`/, '')),
    '발동 조건 판정 코드에 ZCGUBUN 하드코딩 없음 (주석/로그의 예시 표현은 허용)');
}

// ══════════════════════════════════════════════════════════════════════════
section('결과 요약');
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
if (failCount > 0) process.exit(1);
