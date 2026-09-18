// ═══════════════════════════════════════════════════════════════════════
// test_kst_column_order.mjs
// ─────────────────────────────────────────────────────────────────────────
// [배경 2026-09-18 revB]
//   사용자 신고: 20개 KST 컬럼은 다 나오는데 순서가 뒤죽박죽.
//   기대: KST001, KST002, KST004, ..., KST039 순서 고정.
//
//   원인: 기존 append 방식은 LLM 이 뽑은 KST 는 원 위치 유지, 없는 것만 뒤에 추가.
//   해결: append → 치환 방식으로 변경. KST 참조 항목은 모두 제거하고
//         20개를 사용자 지정 순서로 재삽입.
//
// [테스트 목적]
//   1. KST 순서가 항상 사용자 지정 순서와 일치
//   2. non-KST 컬럼 (기존 8컬럼) 은 원 순서 유지
//   3. LLM 이 임시 alias 로 뽑아도 표준 라벨로 교체
//   4. 이미 정확하면 no-op
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

// 함수 로드
const startFn = src.indexOf('function enforcePlantGroupingForCot015');
const endFn = src.indexOf('function validateCostBasisSqlIntegrity');
const funcSrc = src.substring(startFn, endFn);
const factory = new Function(funcSrc + '\nreturn { enforceCostElementColumnsForCot015 };');
const { enforceCostElementColumnsForCot015 } = factory();

const EXPECTED_ORDER = [
  'KST001','KST002','KST004','KST006','KST008','KST010','KST012','KST014','KST015','KST017',
  'KST019','KST021','KST025','KST027','KST029','KST031','KST033','KST035','KST037','KST039'
];

function extractKstOrder(sql) {
  return [...sql.matchAll(/SUM\((KST\d{3})\)/g)].map(m => m[1]);
}

// ═══════════════════════════════════════════════════════════════════════
// [A] 사용자 신고 케이스 (뒤죽박죽 순서 → 정렬)
// ═══════════════════════════════════════════════════════════════════════
section('[A] 사용자 신고 케이스: 순서 뒤죽박죽 → 사용자 지정 순서로 정렬');

{
  // LLM 이 15개 먼저 뽑고 서버가 6개 append (기존 방식) - 뒤죽박죽
  const messyOrderSql = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', PLANT AS '플랜트', MAX(PLANT_NM) AS '플랜트명', ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) AS '개당 단가(원)', SUM(TOTAL) AS '원가 총액(원)', SUM(LBKUM) AS '생산수량', MAX(BASE_UOM) AS '단위', SUM(KST002) AS '재료비-고지 합계(원)', SUM(KST004) AS '재료비-패드 합계(원)', SUM(KST006) AS '부재료비-약품 합계(원)', SUM(KST008) AS '부재료비-포장재 합계(원)', SUM(KST010) AS '재료비-기타 합계(원)', SUM(KST012) AS '인건비 합계(원)', SUM(KST014) AS '도급비 합계(원)', SUM(KST015) AS '에너지비 합계(원)', SUM(KST017) AS '감가상각비 합계(원)', SUM(KST019) AS '수선/소모품비 합계(원)', SUM(KST021) AS '기타경비 합계(원)', SUM(KST025) AS '외주가공비 합계(원)', SUM(KST031) AS '전력비 합계(원)', SUM(KST035) AS '지급수수료 합계(원)', SUM(KST001) AS '재료비-펄프 합계(원)', SUM(KST027) AS '인건비-경비 합계(원)', SUM(KST029) AS '인건비-기타 합계(원)', SUM(KST033) AS '세금과공과 합계(원)', SUM(KST037) AS '기타경비-폐기물 합계(원)', SUM(KST039) AS '생산량-입고용 합계(원)' FROM sys_aimd_cot015 WHERE CALMONTH='202607' GROUP BY MATERIAL, PLANT`;
  const r = enforceCostElementColumnsForCot015(messyOrderSql, '원가요소 조회해줘');
  assert(r.applied === true, 'A-1: 뒤죽박죽 순서 → 재정렬 발동');

  const order = extractKstOrder(r.sql);
  assert(order.length === 20, `A-2: KST 개수 정확히 20 (실제: ${order.length})`);
  assert(JSON.stringify(order) === JSON.stringify(EXPECTED_ORDER),
    `A-3: KST 순서 정확 (KST001, 002, 004, ..., 039)`);

  // 첫 KST 는 반드시 KST001 (사용자님 첫 지시 순서)
  assert(order[0] === 'KST001', 'A-4: 첫 KST 는 KST001');
  assert(order[order.length - 1] === 'KST039', 'A-5: 마지막 KST 는 KST039');
}

// ═══════════════════════════════════════════════════════════════════════
// [B] non-KST 컬럼 (기존 8컬럼) 은 원 순서 유지
// ═══════════════════════════════════════════════════════════════════════
section('[B] non-KST 컬럼 원 순서 유지');

{
  const sql = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', PLANT AS '플랜트', MAX(PLANT_NM) AS '플랜트명', ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) AS '개당 단가(원)', SUM(TOTAL) AS '원가 총액(원)', SUM(LBKUM) AS '생산수량', MAX(BASE_UOM) AS '단위' FROM sys_aimd_cot015 GROUP BY MATERIAL, PLANT`;
  const r = enforceCostElementColumnsForCot015(sql, '원가요소 조회');
  assert(r.applied === true, 'B-0: KST 0개 → 20개 삽입 발동');

  // 8컬럼 유지 (SELECT 절 앞부분에)
  const selectPart = r.sql.substring(r.sql.indexOf('SELECT'), r.sql.indexOf('FROM'));
  const idxMaterial = selectPart.indexOf("MATERIAL AS '자재코드'");
  const idxUnit = selectPart.indexOf("MAX(BASE_UOM) AS '단위'");
  const idxFirstKst = selectPart.indexOf('SUM(KST001)');

  assert(idxMaterial >= 0 && idxMaterial < idxFirstKst, 'B-1: 자재코드 → KST 앞');
  assert(idxUnit >= 0 && idxUnit < idxFirstKst, 'B-2: 단위(BASE_UOM) → KST 앞');
  assert(idxMaterial < idxUnit, 'B-3: 자재코드 → 단위 순서 유지');
}

// ═══════════════════════════════════════════════════════════════════════
// [C] 이미 정확한 순서 → no-op (재쓰기 안 함)
// ═══════════════════════════════════════════════════════════════════════
section('[C] 이미 정확한 순서 → no-op');

{
  const perfect = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', ` +
    EXPECTED_ORDER.map((k, i) => {
      const labels = ['재료비-펄프 합계(원)','재료비-고지 합계(원)','재료비-패드 합계(원)','부재료비-약품 합계(원)','부재료비-포장재 합계(원)','재료비-기타 합계(원)','인건비 합계(원)','도급비 합계(원)','에너지비 합계(원)','감가상각비 합계(원)','수선/소모품비 합계(원)','기타경비 합계(원)','외주가공비 합계(원)','인건비-경비 합계(원)','인건비-기타 합계(원)','전력비 합계(원)','세금과공과 합계(원)','지급수수료 합계(원)','기타경비-폐기물 합계(원)','생산량-입고용 합계(원)'];
      return `SUM(${k}) AS '${labels[i]}'`;
    }).join(', ') +
    ` FROM sys_aimd_cot015 GROUP BY MATERIAL`;
  const r = enforceCostElementColumnsForCot015(perfect, '원가요소 조회');
  assert(r.applied === false, 'C-1: 이미 정확한 순서/라벨 → applied=false (no-op)');
  assert(r.sql === perfect, 'C-2: SQL 원본 유지 (재작성 안 함)');
}

// ═══════════════════════════════════════════════════════════════════════
// [D] LLM 임시 alias → 표준 라벨로 강제 교체
// ═══════════════════════════════════════════════════════════════════════
section('[D] LLM 임시 alias 표준화');

{
  const badAlias = `SELECT MATERIAL, SUM(KST012) AS 'LABOR_TEMP', SUM(KST014) AS 'OUTSRC_XYZ' FROM sys_aimd_cot015 GROUP BY MATERIAL`;
  const r = enforceCostElementColumnsForCot015(badAlias, '원가요소 조회');
  assert(r.applied === true, 'D-1: 임시 alias → 재작성 발동');
  assert(r.sql.includes("SUM(KST012) AS '인건비 합계(원)'"), 'D-2: KST012 표준 라벨 "인건비 합계(원)"');
  assert(r.sql.includes("SUM(KST014) AS '도급비 합계(원)'"), 'D-3: KST014 표준 라벨 "도급비 합계(원)"');
  assert(!r.sql.includes('LABOR_TEMP'), 'D-4: 임시 alias LABOR_TEMP 제거');
  assert(!r.sql.includes('OUTSRC_XYZ'), 'D-5: 임시 alias OUTSRC_XYZ 제거');

  // KST 개수는 20개 (기존 2개 + 신규 18개)
  const order = extractKstOrder(r.sql);
  assert(order.length === 20, `D-6: 최종 KST 20개 (실제: ${order.length})`);
  assert(JSON.stringify(order) === JSON.stringify(EXPECTED_ORDER), 'D-7: 순서 사용자 지정 그대로');
}

// ═══════════════════════════════════════════════════════════════════════
// [E] 회귀 안전 (미발동 케이스)
// ═══════════════════════════════════════════════════════════════════════
section('[E] 회귀 안전');

{
  // sys_aimd_cot015 아님
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL FROM bw_profitability_data GROUP BY MATERIAL`,
    '원가요소 조회'
  );
  assert(r.applied === false, 'E-1: 수익성분석 테이블 → no-op');
}
{
  // "원가요소" 어휘 없음
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL`,
    '실제원가 알려줘'
  );
  assert(r.applied === false, 'E-2: 원가요소 어휘 없음 → no-op');
}
{
  // 특정 카테고리 지목
  const r = enforceCostElementColumnsForCot015(
    `SELECT MATERIAL, SUM(KST012) FROM sys_aimd_cot015 GROUP BY MATERIAL`,
    '원가요소 중 인건비만'
  );
  assert(r.applied === false, 'E-3: 특정 카테고리(인건비) 지목 → no-op');
}

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`총 assertions: ${pass + fail}`);
console.log(`  ✅ PASS: ${pass}`);
console.log(`  ❌ FAIL: ${fail}`);
console.log(`════════════════════════════════════════════════════════════`);
if (fail > 0) process.exit(1);
