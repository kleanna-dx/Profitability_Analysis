// ═══════════════════════════════════════════════════════════════════════
// test_hooks_outside_forcedcomp.mjs
// ─────────────────────────────────────────────────────────────────────────
// [배경 2026-09-18]
//   사용자 신고: 배포된 develop 에서도 "원가요소 조회해줘" (매출원가 명확화)
//   케이스에서 KST001/027/029/033/037/039 6개가 빠진 15개만 노출.
//
//   근본 원인:
//     aggregate route (/api/nlq) 의 PLANT/KST/CostBasis 훅 3종이
//     `if (areaCtx.forcedCostComp)` 조건 블록 안에 실수로 삽입되어 있었음.
//     사용자 케이스는 forcedCostComp 가 아니라 forcedCostBasis (ZCGUBUN 명확화)
//     → if 조건 false → 훅 자체가 실행 안 됨 → LLM 이 뽑은 15개 그대로 통과.
//
//   수정: 훅 3종을 forcedCostComp if 블록 밖으로 이동. 항상 실행되도록.
//
// [테스트 목적]
//   1. 훅 3종이 forcedCostComp 조건 블록 안에 없음을 보장 (회귀 방지)
//   2. 훅 3종이 aggregate route (/api/nlq) 안에 존재
//   3. 순서 유지: PLANT → KST → CostBasisIntegrity
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

// aggregate route 내부 블록 추출
//   /api/nlq route 시작 (L11349) 부터 SQL Validator 지점 앞까지
const nlqRouteStart = src.indexOf("app.post('/api/nlq'");
const sqlValidatorStart = src.indexOf("[2026-08-21] SQL Validator 개선", nlqRouteStart);
const aggregateBlock = src.substring(nlqRouteStart, sqlValidatorStart);

// ═══════════════════════════════════════════════════════════════════════
// [A] forcedCostComp if 블록 위치 확인 (그 안에 훅이 없어야 함)
// ═══════════════════════════════════════════════════════════════════════
section('[A] forcedCostComp if 블록 내부에 훅 없음 (회귀 방지)');

// forcedCostComp if 블록 추출: `if (areaCtx.forcedCostComp)` ~ 짝 맞는 닫는 `}`
const forcedCompStart = aggregateBlock.indexOf('if (areaCtx.forcedCostComp)');
assert(forcedCompStart > 0, 'A-0: forcedCostComp if 블록 존재');

// 해당 블록의 끝 찾기 (중괄호 depth)
let depth = 0, forcedCompEnd = forcedCompStart;
for (let i = forcedCompStart; i < aggregateBlock.length; i++) {
  const ch = aggregateBlock[i];
  if (ch === '{') depth++;
  else if (ch === '}') {
    depth--;
    if (depth === 0) { forcedCompEnd = i; break; }
  }
}
const forcedCompBlock = aggregateBlock.substring(forcedCompStart, forcedCompEnd + 1);

// A-1: forcedCostComp 블록 안에 enforcePlantGroupingForCot015 없음
assert(!forcedCompBlock.includes('enforcePlantGroupingForCot015'),
  'A-1: forcedCostComp 블록 안에 enforcePlantGroupingForCot015 호출 없음');

// A-2: forcedCostComp 블록 안에 enforceCostElementColumnsForCot015 없음
assert(!forcedCompBlock.includes('enforceCostElementColumnsForCot015'),
  'A-2: forcedCostComp 블록 안에 enforceCostElementColumnsForCot015 호출 없음');

// A-3: forcedCostComp 블록 안에 validateCostBasisSqlIntegrity 없음
assert(!forcedCompBlock.includes('validateCostBasisSqlIntegrity'),
  'A-3: forcedCostComp 블록 안에 validateCostBasisSqlIntegrity 호출 없음');

// ═══════════════════════════════════════════════════════════════════════
// [B] 훅 3종이 aggregate route 안 (forcedCostComp 블록 밖) 에 존재
// ═══════════════════════════════════════════════════════════════════════
section('[B] 훅 3종이 aggregate route 에 존재 (forcedCostComp 밖)');

// aggregate 블록 = forcedCostComp 밖 = 블록 종료 이후의 나머지
const afterForcedComp = aggregateBlock.substring(forcedCompEnd + 1);

assert(afterForcedComp.includes('enforcePlantGroupingForCot015(sql)'),
  'B-1: PLANT 훅이 forcedCostComp 블록 밖에 존재');
assert(afterForcedComp.includes('enforceCostElementColumnsForCot015(sql, query)'),
  'B-2: KST 훅이 forcedCostComp 블록 밖에 존재');
assert(afterForcedComp.includes('validateCostBasisSqlIntegrity({'),
  'B-3: CostBasisIntegrity 훅이 forcedCostComp 블록 밖에 존재');

// ═══════════════════════════════════════════════════════════════════════
// [C] 훅 실행 순서: PLANT → KST → CostBasisIntegrity
// ═══════════════════════════════════════════════════════════════════════
section('[C] 훅 실행 순서 유지 (PLANT → KST → CostBasisIntegrity)');

const idxPlant = afterForcedComp.indexOf('enforcePlantGroupingForCot015(sql)');
const idxKst = afterForcedComp.indexOf('enforceCostElementColumnsForCot015(sql, query)');
const idxCB = afterForcedComp.indexOf('validateCostBasisSqlIntegrity({');

assert(idxPlant > 0 && idxKst > idxPlant, 'C-1: PLANT 훅이 KST 훅보다 앞');
assert(idxKst > 0 && idxCB > idxKst, 'C-2: KST 훅이 CostBasisIntegrity 훅보다 앞');

// ═══════════════════════════════════════════════════════════════════════
// [D] 사용자 신고 케이스 재현 - 함수는 정상 (재확인)
// ═══════════════════════════════════════════════════════════════════════
section('[D] 사용자 신고 케이스 재현 — LLM 이 15개 뽑았을 때 20개로 확장');

const start = src.indexOf('function enforcePlantGroupingForCot015');
const end = src.indexOf('function validateCostBasisSqlIntegrity');
const funcSrc = src.substring(start, end);
const factory = new Function(funcSrc + '\nreturn { enforceCostElementColumnsForCot015 };');
const { enforceCostElementColumnsForCot015 } = factory();

// 사용자님이 실제로 본 문제 쿼리 (KST 15개만 있음)
const problemSql = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', PLANT AS '플랜트', MAX(PLANT_NM) AS '플랜트명', ROUND(SUM(TOTAL)/NULLIF(SUM(LBKUM),0),0) AS '개당 단가(원)', SUM(TOTAL) AS '원가 총액(원)', SUM(LBKUM) AS '생산수량', MAX(BASE_UOM) AS '단위', SUM(KST002) AS '재료비-고지 합계(원)', SUM(KST004) AS '재료비-패드 합계(원)', SUM(KST006) AS '부재료비-약품 합계(원)', SUM(KST008) AS '부재료비-포장재 합계(원)', SUM(KST010) AS '재료비-기타 합계(원)', SUM(KST012) AS '인건비 합계(원)', SUM(KST014) AS '도급비 합계(원)', SUM(KST015) AS '에너지비 합계(원)', SUM(KST017) AS '감가상각비 합계(원)', SUM(KST019) AS '수선/소모품비 합계(원)', SUM(KST021) AS '기타경비 합계(원)', SUM(KST025) AS '외주가공비 합계(원)', SUM(KST031) AS '전력비 합계(원)', SUM(KST035) AS '지급수수료 합계(원)' FROM sys_aimd_cot015 WHERE CALMONTH='202607' AND MATERIAL='FRT-FIR0003A' AND ZCGUBUN='매출원가' GROUP BY MATERIAL, PLANT`;
const r = enforceCostElementColumnsForCot015(problemSql, '2026년 7월 FRT-FIR0003A 자재 제품별 원가요소 조회해줘');

assert(r.applied === true, 'D-1: 사용자 문제 SQL 재작성 발동');
const finalKstCount = (r.sql.match(/\bKST\d{3}\b/g) || []).length;
assert(finalKstCount === 20, `D-2: 최종 KST 컬럼 수 20 (실제: ${finalKstCount})`);

// 사용자님이 빠졌다고 지적한 6개 KST 모두 포함됐는지
const missingBefore = ['KST001', 'KST027', 'KST029', 'KST033', 'KST037', 'KST039'];
for (const kst of missingBefore) {
  assert(r.sql.includes(`SUM(${kst})`), `D-3: 사용자 지적한 ${kst} 이제 포함됨`);
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
