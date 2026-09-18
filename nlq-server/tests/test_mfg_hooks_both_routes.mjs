// ═══════════════════════════════════════════════════════════════════════
// test_mfg_hooks_both_routes.mjs
// ─────────────────────────────────────────────────────────────────────────
// [배경 2026-09-18]
//   사용자 신고: develop 배포 후에도 "원가요소 조회해줘" 질의에서 KST001 등이
//   여전히 빠짐. 원인 조사 결과:
//     - aggregate route (L12678+) 에는 훅이 부착됐지만
//     - analysis route (executeAnalysisPlan, L7817+) 에는 훅이 없었음
//     - /api/nlq 는 analysisRequired=true 판정 시 executeAnalysisPlan 로 진입
//     - → analysis 경로에서 사후 재작성이 아예 발동 안 됨
//
//   수정: analysis 경로 (executeAnalysisPlan) 에도 훅 부착
//     - enforcePlantGroupingForCot015 (PLANT 강제)
//     - enforceCostElementColumnsForCot015 (KST 20개 강제)
//
// [테스트 목적]
//   두 라우트 모두에서 훅이 실행되는지 확인 (회귀 방지)
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
// [A] PLANT 강제 훅 — 두 라우트 모두 부착
// ═══════════════════════════════════════════════════════════════════════
section('[A] PLANT 강제 훅 — analysis + aggregate 두 라우트');

const plantMatches = src.match(/enforcePlantGroupingForCot015\((?:baseSql|sql)\)/g) || [];
assert(plantMatches.length >= 2, `A-1: PLANT 훅이 최소 2개 부착됨 (실제: ${plantMatches.length})`);

// analysis 경로 (executeAnalysisPlan 안에 baseSql 사용)
assert(src.includes('const _plantEnforce = enforcePlantGroupingForCot015(baseSql);'),
  'A-2: analysis 경로 (executeAnalysisPlan) 에 PLANT 훅 부착 — baseSql 사용');

// aggregate 경로 (기존 sql 사용)
assert(src.includes('const _plantEnforce = enforcePlantGroupingForCot015(sql);'),
  'A-3: aggregate 경로 (/api/nlq analysisRequired=false) 에 PLANT 훅 부착 — sql 사용');

// 로그 태그 구분 (analysis 는 [PlantGrouping:Analysis])
assert(src.includes('[PlantGrouping:Analysis]'),
  'A-4: analysis 경로 전용 로그 태그 [PlantGrouping:Analysis]');
assert(src.includes('[PlantGrouping] sys_aimd_cot015'),
  'A-5: aggregate 경로 로그 태그 [PlantGrouping] (기존 유지)');

// ═══════════════════════════════════════════════════════════════════════
// [B] KST 20개 강제 훅 — 두 라우트 모두 부착
// ═══════════════════════════════════════════════════════════════════════
section('[B] KST 20개 강제 훅 — analysis + aggregate 두 라우트');

const kstMatches = src.match(/enforceCostElementColumnsForCot015\((?:baseSql|sql), query\)/g) || [];
assert(kstMatches.length >= 2, `B-1: KST 훅이 최소 2개 부착됨 (실제: ${kstMatches.length})`);

// analysis 경로
assert(src.includes('const _kstEnforce = enforceCostElementColumnsForCot015(baseSql, query);'),
  'B-2: analysis 경로 (executeAnalysisPlan) 에 KST 훅 부착 — baseSql 사용');

// aggregate 경로
assert(src.includes('const _kstEnforce = enforceCostElementColumnsForCot015(sql, query);'),
  'B-3: aggregate 경로 (/api/nlq) 에 KST 훅 부착 — sql 사용');

// 로그 태그 구분
assert(src.includes('[CostElementCols:Analysis]'),
  'B-4: analysis 경로 전용 로그 태그 [CostElementCols:Analysis]');
assert(src.includes('[CostElementCols] sys_aimd_cot015'),
  'B-5: aggregate 경로 로그 태그 [CostElementCols] (기존 유지)');

// ═══════════════════════════════════════════════════════════════════════
// [C] 훅 실행 순서: applyForcedCostBasisFilter → PLANT → KST → Metric Determinism
// ═══════════════════════════════════════════════════════════════════════
section('[C] 훅 실행 순서 검증 (analysis 경로)');

// executeAnalysisPlan 안에서 순서: forcedCostBasis → PLANT → KST → Metric
const executeAnalysisPlanBlock = src.substring(
  src.indexOf('async function executeAnalysisPlan'),
  src.indexOf('async function executeAnalysisPlan') + 20000
);

const idxForcedCostBasis = executeAnalysisPlanBlock.indexOf('applyForcedCostBasisFilter(baseSql');
const idxPlantEnforce = executeAnalysisPlanBlock.indexOf('enforcePlantGroupingForCot015(baseSql)');
const idxKstEnforce = executeAnalysisPlanBlock.indexOf('enforceCostElementColumnsForCot015(baseSql, query)');
const idxMetric = executeAnalysisPlanBlock.indexOf('validateAndFixMetricFormulas(baseSql');

assert(idxForcedCostBasis > 0, 'C-1: executeAnalysisPlan 에 applyForcedCostBasisFilter 존재');
assert(idxPlantEnforce > idxForcedCostBasis, 'C-2: PLANT 훅이 applyForcedCostBasisFilter 뒤에 있음');
assert(idxKstEnforce > idxPlantEnforce, 'C-3: KST 훅이 PLANT 훅 뒤에 있음');
assert(idxMetric > idxKstEnforce, 'C-4: Metric Determinism 이 KST 훅 뒤에 있음');

// ═══════════════════════════════════════════════════════════════════════
// [D] executeAnalysisPlan 진입 시 사용자 신고 케이스 시뮬레이션
//    (직접 함수 호출은 어려우니 상수/로직 부분만 검증)
// ═══════════════════════════════════════════════════════════════════════
section('[D] 사용자 신고 케이스 시뮬레이션 — analysis 경로');

// 함수 소스 추출해서 실제 재작성 로직만 검증
const startEnforce = src.indexOf('function enforcePlantGroupingForCot015');
const endEnforce = src.indexOf('function validateCostBasisSqlIntegrity');
const funcSrc = src.substring(startEnforce, endEnforce);
const factory = new Function(funcSrc + '\nreturn { enforceCostElementColumnsForCot015 };');
const { enforceCostElementColumnsForCot015 } = factory();

// D-1: 사용자 신고 케이스 재현
//   analysis 경로가 만들 법한 SQL (buildAggregationSqlFromPlan 스타일)
const analysisModeSql = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', PLANT AS '플랜트', MAX(PLANT_NM) AS '플랜트명', SUM(TOTAL) AS '원가 합계금액(원)' FROM sys_aimd_cot015 WHERE CALMONTH='202607' GROUP BY MATERIAL, PLANT`;
const query = '2026년 7월 FRT-FIR0003A 자재 제품별 원가요소 조회해줘';
const r = enforceCostElementColumnsForCot015(analysisModeSql, query);

assert(r.applied === true, 'D-1: analysis 경로 SQL 도 KST 20개 재작성 발동');
const kstInSql = (r.sql.match(/\bKST\d{3}\b/g) || []);
assert(kstInSql.length === 20, `D-2: 결과 SQL 에 KST 20개 (실제: ${kstInSql.length})`);
assert(r.sql.includes('SUM(KST001)'), 'D-3: 사용자 신고했던 KST001 포함 확인');
assert(r.sql.includes("'재료비-펄프 합계(원)'"), 'D-4: KST001 라벨 "재료비-펄프 합계(원)" 정확');

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`총 assertions: ${pass + fail}`);
console.log(`  ✅ PASS: ${pass}`);
console.log(`  ❌ FAIL: ${fail}`);
console.log(`════════════════════════════════════════════════════════════`);
if (fail > 0) process.exit(1);
