// ═══════════════════════════════════════════════════════════════════════
// test_mfg_cost_element_columns.mjs
// ─────────────────────────────────────────────────────────────────────────
// [배경 2026-09-18]
//   사용자 요구: "원가요소 조회해줘" 유형의 질의는 원가 세부 항목 20개
//   (KST001~KST039) 를 반드시 SELECT 에 함께 포함.
//   프롬프트 힌트만으로는 LLM 이 임의로 일부만 뽑을 수 있으므로
//   결정적 사후 재작성 함수로 강제.
//
// [테스트 목적]
//   1. 상수 정의: 20개 KST 컬럼 + 라벨 (ontology 시드 기준)
//   2. 트리거 감지: "원가요소" 어휘 O + 특정 카테고리 지목 X 시에만 발동
//   3. 재작성 정확성: 20개 컬럼이 SUM(...) AS '<라벨> 합계(원)' 형태로 append
//   4. 중복 방지: 이미 있는 KST 는 건너뛰고 나머지만 추가
//   5. 회귀 안전: 수익성분석 / 특정 지목 / "원가요소코드" 등 미발동
//   6. 훅 부착: analysis route SQL 실행 직전 호출됨
// ═══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_MJS = path.join(__dirname, '..', 'server.mjs');
const serverSrc = fs.readFileSync(SERVER_MJS, 'utf-8');

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

// 함수 소스 추출
const start = serverSrc.indexOf('function enforcePlantGroupingForCot015');
const end = serverSrc.indexOf('function validateCostBasisSqlIntegrity');
if (start < 0 || end <= start) {
  console.error('❌ 함수 소스 추출 실패');
  process.exit(1);
}
const funcSrc = serverSrc.substring(start, end);
const factory = new Function(funcSrc + '\nreturn { enforceCostElementColumnsForCot015, COT015_COST_ELEMENT_KST_COLUMNS, COST_ELEMENT_INTENT_RE, COST_ELEMENT_SPECIFIC_TERMS_RE };');
const { enforceCostElementColumnsForCot015, COT015_COST_ELEMENT_KST_COLUMNS, COST_ELEMENT_INTENT_RE, COST_ELEMENT_SPECIFIC_TERMS_RE } = factory();

// ═══════════════════════════════════════════════════════════════════════
// [A] 상수 정의 검증 (사용자 요구 20개 정확히 매칭)
// ═══════════════════════════════════════════════════════════════════════
section('[A] 20개 KST 컬럼 상수 정의');

const expectedKst = [
  'KST001','KST002','KST004','KST006','KST008','KST010','KST012','KST014','KST015','KST017',
  'KST019','KST021','KST025','KST027','KST029','KST031','KST033','KST035','KST037','KST039'
];

assert(COT015_COST_ELEMENT_KST_COLUMNS.length === 20, `A-1: 총 20개 컬럼 (실제: ${COT015_COST_ELEMENT_KST_COLUMNS.length})`);
const actualCodes = COT015_COST_ELEMENT_KST_COLUMNS.map(x => x.col);
assert(JSON.stringify(actualCodes) === JSON.stringify(expectedKst),
  `A-2: 사용자 요구 20개 KST 코드 정확히 매칭 및 순서 유지`);

// 각 컬럼의 라벨 형식: "<라벨> 합계(원)" 통일
const badLabels = COT015_COST_ELEMENT_KST_COLUMNS.filter(x => !/합계\(원\)$/.test(x.label));
assert(badLabels.length === 0, `A-3: 모든 라벨이 "... 합계(원)" 형식으로 통일 (위반: ${badLabels.length})`);

// 주요 라벨 spot check
const labelMap = new Map(COT015_COST_ELEMENT_KST_COLUMNS.map(x => [x.col, x.label]));
assert(labelMap.get('KST001') === '재료비-펄프 합계(원)', 'A-4: KST001 = "재료비-펄프 합계(원)"');
assert(labelMap.get('KST012') === '인건비 합계(원)', 'A-5: KST012 = "인건비 합계(원)"');
assert(labelMap.get('KST017') === '감가상각비 합계(원)', 'A-6: KST017 = "감가상각비 합계(원)"');
assert(labelMap.get('KST033') === '세금과공과 합계(원)', 'A-7: KST033 = "세금과공과 합계(원)"');
assert(labelMap.get('KST039') === '생산량-입고용 합계(원)', 'A-8: KST039 = "생산량-입고용 합계(원)"');

// ═══════════════════════════════════════════════════════════════════════
// [B] 트리거 정규식 검증
// ═══════════════════════════════════════════════════════════════════════
section('[B] 트리거 정규식 — "원가요소" 감지');

// 매칭 케이스
assert(COST_ELEMENT_INTENT_RE.test('제품별 원가요소 조회해줘'), 'B-1: "원가요소" 매칭');
assert(COST_ELEMENT_INTENT_RE.test('원가요소 알려줘'), 'B-2: "원가요소" 단독 매칭');
assert(COST_ELEMENT_INTENT_RE.test('2026년 7월 FRT-FIR0003A 자재 제품별 원가요소 조회해줘'), 'B-3: 사용자 신고 케이스 매칭');

// 미매칭 케이스 (뒤에 한글이 붙으면 컬럼 언급이므로 제외)
assert(!COST_ELEMENT_INTENT_RE.test('원가요소코드 리스트'), 'B-4: "원가요소코드" 미매칭 (컬럼 언급 배제)');
assert(!COST_ELEMENT_INTENT_RE.test('원가요소명 조회'), 'B-5: "원가요소명" 미매칭 (컬럼 언급 배제)');

// 특정 카테고리 정규식
assert(COST_ELEMENT_SPECIFIC_TERMS_RE.test('인건비 조회'), 'B-6: "인건비" 감지');
assert(COST_ELEMENT_SPECIFIC_TERMS_RE.test('재료비 총액'), 'B-7: "재료비" 감지');
assert(COST_ELEMENT_SPECIFIC_TERMS_RE.test('전력비'), 'B-8: "전력비" 감지');
assert(!COST_ELEMENT_SPECIFIC_TERMS_RE.test('원가요소 조회해줘'), 'B-9: 순수 "원가요소" 는 특정 카테고리 아님');

// ═══════════════════════════════════════════════════════════════════════
// [C] enforceCostElementColumnsForCot015 — 정상 재작성
// ═══════════════════════════════════════════════════════════════════════
section('[C] 정상 재작성 케이스');

{
  // C-1: 사용자 신고 케이스 (기존 8컬럼 + KST 20개 추가)
  const sql = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', PLANT AS '플랜트', MAX(PLANT_NM) AS '플랜트명', ZCGUBUN_D AS '원가 대구분', ZCGUBUN AS '원가구분', ROUND(SUM(TOTAL)/NULLIF(SUM(LBKUM),0),0) AS '개당 단가(원)', SUM(TOTAL) AS '원가 총액(원)', SUM(LBKUM) AS '생산수량', MAX(BASE_UOM) AS '단위' FROM sys_aimd_cot015 WHERE CALMONTH='202607' AND MATERIAL='FRT-FIR0003A' AND ZCGUBUN='매출원가' GROUP BY MATERIAL, PLANT, ZCGUBUN_D, ZCGUBUN ORDER BY MATERIAL, PLANT`;
  const query = '2026년 7월 FRT-FIR0003A 자재 제품별 원가요소 조회해줘';
  const r = enforceCostElementColumnsForCot015(sql, query);
  assert(r.applied === true, 'C-1: 사용자 신고 케이스 → applied=true');
  // 20개 KST 모두 삽입 확인
  const kstInSql = (r.sql.match(/SUM\(KST\d{3}\)/gi) || []).map(s => s.toUpperCase());
  assert(kstInSql.length === 20, `C-1: SELECT 에 KST 20개 (실제: ${kstInSql.length})`);
  for (const kst of expectedKst) {
    assert(r.sql.includes(`SUM(${kst})`), `C-1: SUM(${kst}) 포함`);
  }
  // 라벨 spot check
  assert(r.sql.includes("'재료비-펄프 합계(원)'"), 'C-1: 재료비-펄프 라벨');
  assert(r.sql.includes("'인건비 합계(원)'"), 'C-1: 인건비 라벨');
  assert(r.sql.includes("'생산량-입고용 합계(원)'"), 'C-1: 생산량-입고용 라벨');
  // 기존 8컬럼 유지
  assert(r.sql.includes("MATERIAL AS '자재코드'"), 'C-1: 자재코드 유지');
  assert(r.sql.includes("'개당 단가(원)'"), 'C-1: 개당 단가 유지 (사용자 요구: 기존 규칙 살림)');
  assert(r.sql.includes("SUM(TOTAL) AS '원가 총액(원)'"), 'C-1: 원가 총액 유지');
  assert(r.sql.includes("SUM(LBKUM) AS '생산수량'"), 'C-1: 생산수량 유지');
  assert(r.sql.includes("MAX(BASE_UOM) AS '단위'"), 'C-1: 단위 유지');
  // WHERE / GROUP BY / ORDER BY 미변경
  assert(r.sql.includes("WHERE CALMONTH='202607'"), 'C-1: WHERE 절 유지');
  assert(r.sql.includes("GROUP BY MATERIAL, PLANT, ZCGUBUN_D, ZCGUBUN"), 'C-1: GROUP BY 유지');
  assert(r.sql.includes("ORDER BY MATERIAL, PLANT"), 'C-1: ORDER BY 유지');
}

{
  // C-2: 이미 일부 KST 포함 → 나머지만 추가 (중복 방지)
  const sql = `SELECT MATERIAL, SUM(KST012) AS '인건비', SUM(KST014) AS '도급비', SUM(KST031) AS '전력비' FROM sys_aimd_cot015 GROUP BY MATERIAL`;
  const r = enforceCostElementColumnsForCot015(sql, '원가요소 조회');
  assert(r.applied === true, 'C-2: 일부 KST 이미 있음 → applied=true');
  const kstInSql = new Set((r.sql.match(/SUM\(KST\d{3}\)/gi) || []).map(s => s.toUpperCase()));
  assert(kstInSql.size === 20, `C-2: 최종 SELECT KST 개수 20 (중복 제거, 실제: ${kstInSql.size})`);
  // [2026-09-18 revB] 재정렬 방식으로 변경 → 로그 문구도 변경
  //   기존: "17개 컬럼 append" → 신규: "기존 3개 재배치 + 신규 17개 삽입"
  assert(/기존 3개 재배치 \+ 신규 17개 삽입/.test(r.changes.join(' ')),
    'C-2: 기존 3개 재배치 + 신규 17개 삽입 로그 (재정렬 방식)');
}

// ═══════════════════════════════════════════════════════════════════════
// [D] no-op 케이스 (회귀 방지)
// ═══════════════════════════════════════════════════════════════════════
section('[D] no-op 케이스');

{
  // D-1: "원가요소" 어휘 없음
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL`,
    '실제원가 알려줘'
  );
  assert(r.applied === false, 'D-1: "원가요소" 어휘 없음 → no-op');
}

{
  // D-2: sys_aimd_cot015 아닌 테이블 (수익성분석)
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL, SUM(ZAMT001) FROM bw_profitability_data GROUP BY MATERIAL`,
    '원가요소 알려줘'
  );
  assert(r.applied === false, 'D-2: sys_aimd_cot015 미사용 → no-op (수익성분석 영향 없음)');
}

{
  // D-3: 특정 카테고리 지목 (인건비)
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL, SUM(KST012) FROM sys_aimd_cot015 GROUP BY MATERIAL`,
    '원가요소 중 인건비만 알려줘'
  );
  assert(r.applied === false, 'D-3: "원가요소" + "인건비" 동시 → 특정 지목 우선, no-op');
  assert(/특정 원가요소 카테고리 지목 감지/.test(r.changes.join(' ')), 'D-3: 로그에 사유 명시');
}

{
  // D-4: 이미 20개 KST 모두 있고 순서/라벨까지 완벽 → no-op
  //   [2026-09-18 revB] 재정렬 방식으로 변경 → alias/순서까지 일치해야 no-op
  //     alias 없이 SUM(KSTxxx) 만 있으면 표준 라벨 붙이려고 재작성 발동
  const labelMap = {
    KST001: '재료비-펄프 합계(원)', KST002: '재료비-고지 합계(원)', KST004: '재료비-패드 합계(원)',
    KST006: '부재료비-약품 합계(원)', KST008: '부재료비-포장재 합계(원)', KST010: '재료비-기타 합계(원)',
    KST012: '인건비 합계(원)', KST014: '도급비 합계(원)', KST015: '에너지비 합계(원)',
    KST017: '감가상각비 합계(원)', KST019: '수선/소모품비 합계(원)', KST021: '기타경비 합계(원)',
    KST025: '외주가공비 합계(원)', KST027: '인건비-경비 합계(원)', KST029: '인건비-기타 합계(원)',
    KST031: '전력비 합계(원)', KST033: '세금과공과 합계(원)', KST035: '지급수수료 합계(원)',
    KST037: '기타경비-폐기물 합계(원)', KST039: '생산량-입고용 합계(원)',
  };
  const perfectSelect = expectedKst.map(k => `SUM(${k}) AS '${labelMap[k]}'`).join(', ');
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL, ${perfectSelect} FROM sys_aimd_cot015 GROUP BY MATERIAL`,
    '원가요소 조회'
  );
  assert(r.applied === false, 'D-4: 이미 20개 KST 모두 정확한 순서/라벨 → no-op');
}

{
  // D-5: 원가요소코드 (컬럼 언급) → 미발동
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL, COSTELMNT FROM sys_aimd_cot015 GROUP BY MATERIAL, COSTELMNT`,
    '원가요소코드 리스트'
  );
  assert(r.applied === false, 'D-5: "원가요소코드" (컬럼 언급) → no-op');
}

// ═══════════════════════════════════════════════════════════════════════
// [E] 훅 부착 확인 (analysis route)
// ═══════════════════════════════════════════════════════════════════════
section('[E] 훅 부착 — analysis route');

assert(serverSrc.includes('const _kstEnforce = enforceCostElementColumnsForCot015(sql, query);'),
  'E-1: analysis route 에 enforceCostElementColumnsForCot015 호출 부착됨');
assert(serverSrc.includes('[CostElementCols] sys_aimd_cot015 "원가요소" 조회에 KST 20개 컬럼 강제 주입 완료'),
  'E-2: 성공 시 [CostElementCols] 로그 태그');
assert(serverSrc.includes('[CostElementCols] no-op'),
  'E-3: no-op 시 [CostElementCols] no-op 로그');
assert(serverSrc.includes('[CostElementCols] 보정 중 예외'),
  'E-4: 예외 시 [CostElementCols] 예외 로그 + 원본 SQL 유지');

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`총 assertions: ${pass + fail}`);
console.log(`  ✅ PASS: ${pass}`);
console.log(`  ❌ FAIL: ${fail}`);
console.log(`════════════════════════════════════════════════════════════`);
if (fail > 0) process.exit(1);
