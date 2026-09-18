// ═══════════════════════════════════════════════════════════════════════
// test_mfg_plant_grouping.mjs
// ─────────────────────────────────────────────────────────────────────────
// [배경] 2026-09-18 사용자 요구:
//   sys_aimd_cot015 (제조원가) 자연어질의에서 제품별 조회 시 반드시
//   MATERIAL + PLANT 를 GROUP BY 기준으로 사용해야 함.
//   동일 MATERIAL 이라도 PLANT 별로 원가가 별도 산정되므로 MATERIAL 만으로
//   합치면 잘못된 합산이 발생.
//
// [테스트 목적]
//   1. 3개 프롬프트 힌트 분기 (SPECIFIC / DELTA / GENERIC) 모두에
//      "MATERIAL + PLANT" 규칙 헤드라인이 존재하는지
//   2. 3개 분기 모두 GROUP BY 문구에 PLANT 가 포함되는지
//   3. 3개 분기 모두 SELECT 에 PLANT 코드 + PLANT_NM 이 추가됐는지
//   4. 회귀 방지: MATERIAL 단독 GROUP BY 지시가 남아있지 않은지
//      (단, DELTA 분기의 HAVING 예시 등 코멘트/설명은 제외)
// ═══════════════════════════════════════════════════════════════════════

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_MJS = path.join(__dirname, '..', 'server.mjs');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); pass++; }
  else      { console.log(`  ❌ ${msg}`); fail++; }
}
function section(title) {
  console.log(`\n──────────────────────────────────────────────────────────`);
  console.log(`  ${title}`);
  console.log(`──────────────────────────────────────────────────────────`);
}

const src = fs.readFileSync(SERVER_MJS, 'utf-8');

// ═══════════════════════════════════════════════════════════════════════
// [A] 3분기 힌트 헤더 확인 — MATERIAL+PLANT 규칙 헤드라인 포함
// ═══════════════════════════════════════════════════════════════════════
section('[A] 3분기 힌트 헤더 — MATERIAL+PLANT 규칙 명시');

// A-1: SPECIFIC 분기 헤더
assert(
  src.includes('제품별 원가 조회 — MATERIAL+PLANT 8컬럼 세트 필수'),
  'A-1: SPECIFIC 분기 헤더에 "MATERIAL+PLANT 8컬럼" 명시'
);
// A-2: DELTA 분기 헤더
assert(
  src.includes('제품별 원가 비교 분석 — MATERIAL+PLANT 8컬럼 세트 필수'),
  'A-2: DELTA 분기 헤더에 "MATERIAL+PLANT 8컬럼" 명시'
);
// A-3: GENERIC 분기 헤더 — 헤더 문구는 유지되지만 집계 단위 규칙 블록 추가됨
assert(
  src.includes('제품별 원가 GENERIC 조회'),
  'A-3: GENERIC 분기 헤더 유지 ("제품별 원가 GENERIC 조회")'
);
// A-4: 3분기 모두 공통 규칙 헤드라인 명시 (사용자 요구 핵심)
const materialPlantHeadlineCount = (src.match(/\*\*MATERIAL \+ PLANT\*\*/g) || []).length;
assert(
  materialPlantHeadlineCount >= 3,
  `A-4: "**MATERIAL + PLANT**" 헤드라인이 3분기 이상 명시됨 (실제: ${materialPlantHeadlineCount}회)`
);

// A-5: 집계 단위 필수 규칙 블록 존재 (SPECIFIC/DELTA/GENERIC 각각)
const grainRuleBlockCount = (src.match(/\[⚠️ 집계 단위 필수 규칙 — sys_aimd_cot015 제품별 조회\]/g) || []).length;
assert(
  grainRuleBlockCount >= 3,
  `A-5: "집계 단위 필수 규칙" 블록이 3분기 이상 명시됨 (실제: ${grainRuleBlockCount}회)`
);

// ═══════════════════════════════════════════════════════════════════════
// [B] SELECT 절 — PLANT / PLANT_NM 컬럼 노출
// ═══════════════════════════════════════════════════════════════════════
section('[B] SELECT 절 — PLANT / PLANT_NM 컬럼 추가');

// SPECIFIC 분기 SELECT
{
  const idxStart = src.indexOf('제품별 원가 조회 — MATERIAL+PLANT 8컬럼 세트 필수');
  const idxEnd = src.indexOf('} else if', idxStart);
  const block = idxStart >= 0 && idxEnd > idxStart ? src.substring(idxStart, idxEnd) : '';
  assert(block.length > 0, 'B-0-S: SPECIFIC 분기 블록 추출 성공');
  assert(/3\. PLANT\s+AS '플랜트'/.test(block), 'B-1-S: SPECIFIC 분기 SELECT 3번에 PLANT AS \'플랜트\'');
  assert(/4\. MAX\(PLANT_NM\)\s+AS '플랜트명'/.test(block), 'B-2-S: SPECIFIC 분기 SELECT 4번에 MAX(PLANT_NM) AS \'플랜트명\'');
}

// DELTA 분기 SELECT
{
  const idxStart = src.indexOf('제품별 원가 비교 분석 — MATERIAL+PLANT 8컬럼 세트 필수');
  const idxEnd = src.indexOf('} else {', idxStart);
  const block = idxStart >= 0 && idxEnd > idxStart ? src.substring(idxStart, idxEnd) : '';
  assert(block.length > 0, 'B-0-D: DELTA 분기 블록 추출 성공');
  assert(/3\. PLANT AS '플랜트'/.test(block), 'B-1-D: DELTA 분기 SELECT 3번에 PLANT AS \'플랜트\'');
  assert(/4\. MAX\(PLANT_NM\) AS '플랜트명'/.test(block), 'B-2-D: DELTA 분기 SELECT 4번에 MAX(PLANT_NM) AS \'플랜트명\'');
}

// GENERIC 분기 SELECT
{
  const idxStart = src.indexOf('제품별 원가 GENERIC 조회');
  const idxEnd = src.indexOf('} else if', idxStart);
  const block = idxStart >= 0 && idxEnd > idxStart ? src.substring(idxStart, idxEnd) : '';
  assert(block.length > 0, 'B-0-G: GENERIC 분기 블록 추출 성공');
  assert(/3\. PLANT\s+AS '플랜트'/.test(block), 'B-1-G: GENERIC 분기 SELECT 3번에 PLANT AS \'플랜트\'');
  assert(/4\. MAX\(PLANT_NM\)\s+AS '플랜트명'/.test(block), 'B-2-G: GENERIC 분기 SELECT 4번에 MAX(PLANT_NM) AS \'플랜트명\'');
}

// ═══════════════════════════════════════════════════════════════════════
// [C] GROUP BY 절 — PLANT 필수 (사용자 요구 핵심)
// ═══════════════════════════════════════════════════════════════════════
section('[C] GROUP BY — PLANT 필수 포함');

// SPECIFIC: GROUP BY MATERIAL, PLANT
assert(
  /GROUP BY MATERIAL, PLANT 필수 \(자재\+공장별 집계\)/.test(src),
  'C-1: SPECIFIC 분기 GROUP BY 지시에 "MATERIAL, PLANT 필수 (자재+공장별 집계)" 명시'
);

// DELTA: GROUP BY MATERIAL, PLANT
assert(
  /GROUP BY MATERIAL, PLANT 필수\. PLANT 를 빠뜨리면/.test(src),
  'C-2: DELTA 분기 GROUP BY 지시에 "MATERIAL, PLANT 필수" + PLANT 누락 경고 명시'
);

// GENERIC: GROUP BY MATERIAL, PLANT, ZCGUBUN_D, ZCGUBUN
assert(
  src.includes('GROUP BY MATERIAL, PLANT, ZCGUBUN_D, ZCGUBUN 필수'),
  'C-3: GENERIC 분기 GROUP BY 지시에 "MATERIAL, PLANT, ZCGUBUN_D, ZCGUBUN 필수" 명시'
);

// C-4: SPECIFIC 분기에 "GROUP BY MATERIAL 필수 (제품별 집계)" 잔재 없음 (회귀 방지)
//   → PLANT 없는 예전 지시가 아직 남아 있으면 실패
assert(
  !src.includes('GROUP BY MATERIAL 필수 (제품별 집계)'),
  'C-4: 회귀 방지 — "GROUP BY MATERIAL 필수 (제품별 집계)" (PLANT 누락 예전 지시) 잔재 없음'
);

// C-5: GENERIC 분기에 예전 "GROUP BY MATERIAL, ZCGUBUN_D, ZCGUBUN 필수" 잔재 없음
assert(
  !src.includes('GROUP BY MATERIAL, ZCGUBUN_D, ZCGUBUN 필수 (원가유형별 집계)'),
  'C-5: 회귀 방지 — GENERIC 분기의 예전 3중 GROUP BY (PLANT 누락) 잔재 없음'
);

// ═══════════════════════════════════════════════════════════════════════
// [D] ORDER BY / HAVING — MATERIAL+PLANT 조합 반영
// ═══════════════════════════════════════════════════════════════════════
section('[D] ORDER BY / HAVING — MATERIAL+PLANT 조합 반영');

// D-1: GENERIC ORDER BY 에 MATERIAL, PLANT, ZCGUBUN_D 순서
assert(
  src.includes("ORDER BY MATERIAL, PLANT, ZCGUBUN_D, CASE WHEN ZCGUBUN = '표준원가' THEN 2 ELSE 1 END"),
  'D-1: GENERIC ORDER BY 에 MATERIAL, PLANT, ZCGUBUN_D 순서 명시'
);

// D-2: DELTA HAVING 설명은 "제품" → "(자재,공장) 조합" 으로 갱신됐는지
assert(
  src.includes('두 기간 모두 생산수량이 0 이 아닌 (자재,공장) 조합만'),
  'D-2: DELTA HAVING 설명이 "(자재,공장) 조합" 단위로 갱신됨'
);

// ═══════════════════════════════════════════════════════════════════════
// [E] 컬럼 수 표기 검증 — 사용자에게 명시적 메시지
// ═══════════════════════════════════════════════════════════════════════
section('[E] 컬럼 수 표기 — 정확한 세트 크기 명시');

// E-1: SPECIFIC 분기 = 8컬럼 (기존 4컬럼 + PLANT + PLANT_NM + 원래 자재명 유지된 상태에서 PLANT 삽입)
assert(
  src.includes('8컬럼 세트 필수 (sys_aimd_cot015)'),
  'E-1: 8컬럼 세트 표기 (SPECIFIC/DELTA)'
);

// E-2: GENERIC 분기 = 10컬럼 (기존 8컬럼 + PLANT + PLANT_NM)
assert(
  src.includes('SELECT 절 구성 — 반드시 이 순서 유지 (10컬럼)'),
  'E-2: GENERIC 10컬럼 표기'
);

// ═══════════════════════════════════════════════════════════════════════
// [F] 개당 단가 alias 규칙 유지 (기존 세션 룰 회귀 방지)
// ═══════════════════════════════════════════════════════════════════════
section('[F] 개당 단가 alias 규칙 유지');

// F-1: SPECIFIC + GENERIC 분기에 '개당 단가(원)' alias 유지 (DELTA 는 별도: '전월/당월 원가 단가')
//   DELTA 분기는 두 기간 비교라 alias 가 '전월 원가 단가' / '당월 원가 단가' / '원가 단가 증가액'.
//   따라서 '개당 단가(원)' 는 SPECIFIC + GENERIC 두 분기에서 2회 등장이 정상.
const unitPriceAliasCount = (src.match(/AS '개당 단가\(원\)'/g) || []).length;
assert(
  unitPriceAliasCount >= 2,
  `F-1: "AS '개당 단가(원)'" alias 가 SPECIFIC+GENERIC 분기 이상 (실제: ${unitPriceAliasCount}회) — 기존 표준 유지`
);
// F-1b: DELTA 분기의 '전월/당월 원가 단가' alias 유지 (계산식 산출 alias)
assert(
  src.includes("AS '전월 원가 단가'") && src.includes("AS '당월 원가 단가'") && src.includes("AS '원가 단가 증가액'"),
  'F-1b: DELTA 분기 alias (전월/당월 원가 단가 + 원가 단가 증가액) 유지'
);

// F-2: ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) 계산식 유지
assert(
  src.includes('ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0)'),
  'F-2: 개당 단가 계산식 (ROUND + NULLIF) 유지'
);

// ─────────────────────────────────────────────────────────────────
// 결과 요약
// ─────────────────────────────────────────────────────────────────
console.log('\n════════════════════════════════════════════════════════════');
console.log(`총 assertions: ${pass + fail}`);
console.log(`  ✅ PASS: ${pass}`);
console.log(`  ❌ FAIL: ${fail}`);
console.log('════════════════════════════════════════════════════════════');
if (fail > 0) process.exit(1);
