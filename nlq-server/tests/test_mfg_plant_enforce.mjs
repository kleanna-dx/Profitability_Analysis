// ═══════════════════════════════════════════════════════════════════════
// test_mfg_plant_enforce.mjs
// ─────────────────────────────────────────────────────────────────────────
// [배경 2026-09-18]
//   PR #487 로 프롬프트 힌트에 MATERIAL+PLANT 규칙 추가했으나,
//   사용자 케이스 "2026년 7월 FRT-FIR0003A 자재 제품별 원가요소 조회해줘"
//   에서 "원가요소" 어휘가 GENERIC_COST_INTENT_RE 정규식에 안 걸려
//   힌트 미주입 → LLM 이 GROUP BY MATERIAL 만 생성.
//
//   이번 PR 은:
//     (A) 결정적 사후 보정 함수 enforcePlantGroupingForCot015 도입
//     (B) GENERIC_COST_INTENT_RE 에 "원가요소" 어휘 추가
//   → 힌트 트리거와 무관하게 PLANT 규칙 100% 강제.
//
// [테스트 목적]
//   1. enforcePlantGroupingForCot015 정상 동작 검증
//      - 사용자 신고 케이스 재현 → 자동 보정
//      - 회귀 방지: 이미 PLANT 있으면 no-op, sys_aimd_cot015 아니면 no-op 등
//   2. GENERIC_COST_INTENT_RE 확장 검증
//      - "원가요소" 매칭 (신규)
//      - 기존 어휘 (원가/자재원가/제품원가) 회귀 안전
//      - SPECIFIC 어휘 (실제원가/매출원가/표준원가/제조원가) 미매칭 유지
//   3. 훅 부착 확인: analysis route SQL 실행 직전에 호출됨
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

// enforcePlantGroupingForCot015 + 헬퍼 함수 추출 → Function 생성자로 실행 가능하게
const start = serverSrc.indexOf('function enforcePlantGroupingForCot015');
const end = serverSrc.indexOf('function validateCostBasisSqlIntegrity');
if (start < 0 || end < 0 || end <= start) {
  console.error('❌ 함수 소스 추출 실패: enforcePlantGroupingForCot015 함수를 찾을 수 없음');
  process.exit(1);
}
const funcSrc = serverSrc.substring(start, end);
const factory = new Function(funcSrc + '\nreturn { enforcePlantGroupingForCot015 };');
const { enforcePlantGroupingForCot015 } = factory();

// GENERIC_COST_INTENT_RE 도 추출 (정규식 검증용)
const reMatch = serverSrc.match(/const GENERIC_COST_INTENT_RE = (\/[^/]+\/[gimsuy]*);/);
if (!reMatch) {
  console.error('❌ GENERIC_COST_INTENT_RE 정규식 추출 실패');
  process.exit(1);
}
const GENERIC_COST_INTENT_RE = eval(reMatch[1]);

// ═══════════════════════════════════════════════════════════════════════
// [A] enforcePlantGroupingForCot015 — 정상 재작성
// ═══════════════════════════════════════════════════════════════════════
section('[A] enforcePlantGroupingForCot015 — 정상 재작성');

{
  // A-1: 사용자 신고 실제 케이스
  const sql = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', ZCGUBUN AS '원가구분', SUM(TOTAL) AS '원가 총액', ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) AS '개당 단가(원)' FROM sys_aimd_cot015 WHERE CALMONTH = '202607' AND MATERIAL = 'FRT-FIR0003A' AND ZCGUBUN = '매출원가' GROUP BY MATERIAL ORDER BY SUM(TOTAL) DESC`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === true, 'A-1: 사용자 신고 케이스 → applied=true');
  assert(/GROUP\s+BY\s+MATERIAL,\s*PLANT\b/i.test(r.sql), 'A-1: GROUP BY MATERIAL, PLANT 로 재작성');
  assert(/PLANT\s+AS\s+'플랜트'/.test(r.sql), 'A-1: SELECT 에 PLANT AS \'플랜트\' 삽입');
  assert(/MAX\(PLANT_NM\)\s+AS\s+'플랜트명'/.test(r.sql), 'A-1: SELECT 에 MAX(PLANT_NM) AS \'플랜트명\' 삽입');
  // 원본 필터/정렬 유지
  assert(r.sql.includes("MATERIAL = 'FRT-FIR0003A'"), 'A-1: WHERE 필터 유지 (MATERIAL)');
  assert(r.sql.includes("CALMONTH = '202607'"), 'A-1: WHERE 필터 유지 (CALMONTH)');
  assert(r.sql.includes("ZCGUBUN = '매출원가'"), 'A-1: WHERE 필터 유지 (ZCGUBUN)');
  assert(/ORDER\s+BY\s+SUM\(TOTAL\)\s+DESC/i.test(r.sql), 'A-1: ORDER BY 유지');
}

{
  // A-2: 다중 축 GROUP BY (MATERIAL 이 첫번째)
  const sql = `SELECT MATERIAL, ZCGUBUN_D, ZCGUBUN, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL, ZCGUBUN_D, ZCGUBUN`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === true, 'A-2: 다중 축 → applied=true');
  assert(/GROUP\s+BY\s+MATERIAL,\s*PLANT,\s*ZCGUBUN_D,\s*ZCGUBUN/i.test(r.sql), 'A-2: PLANT 가 MATERIAL 바로 뒤 (2번째) 삽입');
}

{
  // A-3: ORDER BY + LIMIT 있는 SQL (사용자가 정렬 명시)
  const sql = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL ORDER BY SUM(TOTAL) DESC LIMIT 10`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === true, 'A-3: ORDER BY+LIMIT 케이스 → applied=true');
  assert(/GROUP\s+BY\s+MATERIAL,\s*PLANT\s+ORDER\s+BY/i.test(r.sql), 'A-3: GROUP BY 뒤 ORDER BY 위치 안정');
  assert(r.sql.includes('LIMIT 10'), 'A-3: LIMIT 절 유지');
}

{
  // A-4: HAVING 있는 SQL (SPECIFIC 힌트 스타일)
  const sql = `SELECT MATERIAL, MAX(MATERIAL_NM), SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL HAVING SUM(LBKUM) <> 0`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === true, 'A-4: HAVING 케이스 → applied=true');
  assert(/GROUP\s+BY\s+MATERIAL,\s*PLANT\s+HAVING/i.test(r.sql), 'A-4: GROUP BY 뒤 HAVING 절 위치 안정');
  assert(r.sql.includes('HAVING SUM(LBKUM) <> 0'), 'A-4: HAVING 조건 유지');
}

// ═══════════════════════════════════════════════════════════════════════
// [B] enforcePlantGroupingForCot015 — no-op 케이스 (회귀 방지)
// ═══════════════════════════════════════════════════════════════════════
section('[B] enforcePlantGroupingForCot015 — no-op 케이스');

{
  // B-1: 이미 PLANT 있음
  const sql = `SELECT MATERIAL, PLANT, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL, PLANT`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === false, 'B-1: 이미 PLANT 포함 → applied=false');
  assert(r.sql === sql, 'B-1: SQL 원본 그대로');
}

{
  // B-2: sys_aimd_cot015 아닌 테이블 (수익성분석)
  const sql = `SELECT MATERIAL FROM bw_profitability_data WHERE ZAMT001>0 GROUP BY MATERIAL`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === false, 'B-2: sys_aimd_cot015 미사용 → applied=false');
  assert(r.sql === sql, 'B-2: 수익성분석 SQL 원본 그대로 (수익성 영향 없음)');
}

{
  // B-3: GROUP BY 없음 (전체 집계)
  const sql = `SELECT SUM(TOTAL) FROM sys_aimd_cot015 WHERE MATERIAL='X'`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === false, 'B-3: GROUP BY 없음 → applied=false (전체 집계)');
  assert(r.sql === sql, 'B-3: 전체 집계 SQL 원본 그대로');
}

{
  // B-4: MATERIAL 없이 다른 축 (예: ZCGUBUN 만)
  const sql = `SELECT ZCGUBUN, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY ZCGUBUN`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === false, 'B-4: GROUP BY 에 MATERIAL 없음 → applied=false');
  assert(r.sql === sql, 'B-4: SQL 원본 그대로 (PLANT 강제 불필요)');
}

{
  // B-5: PLANT_NM 만 있어도 PLANT 취급 (알리아스 리터럴이 아니면)
  const sql = `SELECT MATERIAL, PLANT_NM, SUM(TOTAL) FROM sys_aimd_cot015 GROUP BY MATERIAL, PLANT_NM`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === false, 'B-5: GROUP BY 에 PLANT_NM 포함 (=PLANT 취급) → applied=false');
}

// ═══════════════════════════════════════════════════════════════════════
// [C] enforcePlantGroupingForCot015 — 안전 예외 처리
// ═══════════════════════════════════════════════════════════════════════
section('[C] enforcePlantGroupingForCot015 — 예외/안전 처리');

{
  // C-1: 빈 SQL
  const r = enforcePlantGroupingForCot015('');
  assert(r.applied === false, 'C-1: 빈 SQL → applied=false');
}

{
  // C-2: 잘못된 SQL 형태 (파싱 안 됨)
  const sql = `NOT A VALID SQL`;
  const r = enforcePlantGroupingForCot015(sql);
  assert(r.applied === false, 'C-2: 잘못된 SQL → applied=false');
  assert(r.sql === sql, 'C-2: 원본 유지');
}

// ═══════════════════════════════════════════════════════════════════════
// [D] GENERIC_COST_INTENT_RE 확장 검증
// ═══════════════════════════════════════════════════════════════════════
section('[D] GENERIC_COST_INTENT_RE — "원가요소" 확장');

// D-1: 신규 어휘 매칭
assert(GENERIC_COST_INTENT_RE.test('2026년 7월 FRT-FIR0003A 자재 제품별 원가요소 조회해줘'),
  'D-1: 사용자 실제 신고 케이스 "원가요소" 매칭 (신규)');
assert(GENERIC_COST_INTENT_RE.test('원가요소 알려줘'), 'D-2: "원가요소" 단독 매칭');
assert(GENERIC_COST_INTENT_RE.test('제품별 원가요소 조회'), 'D-3: "제품별 원가요소" 매칭');

// D-2: 기존 어휘 회귀 안전
assert(GENERIC_COST_INTENT_RE.test('F2A11220-05000720B 자재 원가 알려줘'), 'D-4: 기존 "원가" 회귀 안전');
assert(GENERIC_COST_INTENT_RE.test('자재원가 알려줘'), 'D-5: 기존 "자재원가" 회귀 안전');
assert(GENERIC_COST_INTENT_RE.test('제품원가 top 10'), 'D-6: 기존 "제품원가" 회귀 안전');

// D-3: SPECIFIC 어휘 미매칭 유지 (앞에 한글 있으면 GENERIC 아님)
assert(!GENERIC_COST_INTENT_RE.test('실제원가 알려줘'), 'D-7: "실제원가" 는 SPECIFIC → GENERIC 아님');
assert(!GENERIC_COST_INTENT_RE.test('매출원가 조회'), 'D-8: "매출원가" 는 SPECIFIC → GENERIC 아님');
assert(!GENERIC_COST_INTENT_RE.test('표준원가'), 'D-9: "표준원가" 는 SPECIFIC → GENERIC 아님');
assert(!GENERIC_COST_INTENT_RE.test('제조원가'), 'D-10: "제조원가" 는 SPECIFIC → GENERIC 아님');

// D-4: 희귀 케이스 — "원가요소코드"/"원가요소명" 은 뒤에 한글이 붙어서 미매칭
//   (컬럼 자체 언급이므로 원가유형 전체 조회 의도 아님)
assert(!GENERIC_COST_INTENT_RE.test('원가요소코드는?'), 'D-11: "원가요소코드" 미매칭 (컬럼 언급)');
assert(!GENERIC_COST_INTENT_RE.test('원가요소명 리스트'), 'D-12: "원가요소명" 미매칭 (컬럼 언급)');

// ═══════════════════════════════════════════════════════════════════════
// [E] 훅 부착 확인 (analysis route)
// ═══════════════════════════════════════════════════════════════════════
section('[E] 훅 부착 — analysis route SQL 실행 직전');

assert(serverSrc.includes('const _plantEnforce = enforcePlantGroupingForCot015(sql);'),
  'E-1: analysis route 에 enforcePlantGroupingForCot015 호출 부착됨');
assert(serverSrc.includes('[PlantGrouping] sys_aimd_cot015 제품별 조회에 PLANT 강제 주입 완료'),
  'E-2: 성공 시 [PlantGrouping] 로그 태그 출력');
assert(serverSrc.includes("[PlantGrouping] no-op"),
  'E-3: no-op 시 [PlantGrouping] no-op 로그 출력');
assert(serverSrc.includes("[PlantGrouping] 보정 중 예외"),
  'E-4: 예외 시 [PlantGrouping] 예외 로그 + 원본 SQL 유지');

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`총 assertions: ${pass + fail}`);
console.log(`  ✅ PASS: ${pass}`);
console.log(`  ❌ FAIL: ${fail}`);
console.log(`════════════════════════════════════════════════════════════`);
if (fail > 0) process.exit(1);
