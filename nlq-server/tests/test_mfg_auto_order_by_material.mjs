// ============================================================
// test_mfg_auto_order_by_material.mjs
// ------------------------------------------------------------
// 사용자 요구 (2026-11-03, PR #552 확장 v2):
//   비주얼쿼리빌더 피벗 SQL 생성 시 "제조원가" 영역에서만,
//   SELECT 조회필드에 MATERIAL 또는 MATERIAL_NM 중 "하나라도" 포함되어 있으면
//   ORDER BY 에서 PLANT 보다 먼저 MATERIAL 기준으로 정렬:
//
//     ORDER BY
//       MATERIAL,                 ← NEW (v2)
//       PLANT,
//       CASE WHEN ZCGUBUN_D = '입고-생산' THEN 1 WHEN ZCGUBUN_D = '소비-소비' THEN 2 ELSE 99 END,
//       CASE WHEN ZCGUBUN_D = '입고-생산' AND ZCGUBUN = '실제원가' THEN 1 ... END
//
//   중요 (사용자 명시):
//     - 자재명(MATERIAL_NM) 만 조회필드에 있어도 정렬 기준은 MATERIAL (유일키)
//     - 집계 쿼리면 MATERIAL 이 GROUP BY 에도 포함 (PR #210 자동 보정 담당)
//     - 기존 PLANT → 입고-생산/소비-소비 → 실제/표준/매출원가 규칙 유지
//     - 최종 순서: MATERIAL → PLANT → ZCGUBUN_D → ZCGUBUN
//
//   사용자 승인:
//     Q1 = A : MATERIAL 이 SELECT/GROUP BY 에 없는 경우 MATERIAL 자동 추가
//              (builder.html 쪽에서 _MFG_COST_ELEMENT_DEPS 에 MATERIAL 포함되어
//               더블클릭 시 자동 삽입되므로, 실질적으로 edge case 소멸)
//     Q2 = 유지 : PLANT + ZCGUBUN_D + ZCGUBUN 3개 조건은 그대로 (분리하지 않음)
//     Q3 = 단일 PR : server.mjs + builder.html 통합 PR
//
// 설계 (설정 테이블 패턴, PR #552 와 동일):
//   const _MFG_AUTO_ORDER_RULES = {
//     required_columns: ['PLANT', 'ZCGUBUN_D', 'ZCGUBUN'],
//     material_trigger_columns: ['MATERIAL', 'MATERIAL_NM'],      ← NEW
//     order_by_sql_base: 'PLANT, CASE WHEN ... END, CASE WHEN ... END',   ← rename
//     order_by_sql_with_material: 'MATERIAL, PLANT, CASE WHEN ... END, ...',  ← NEW
//   }
//
// 영역 격리:
//   - 제조원가 (manufacturing-cost) 영역만 적용 (isMfgArea 가드 유지)
//   - 수익성분석 영역 완전 무영향
//   - 사용자 정렬 지정 시 자동 skip (기존 동작 유지)
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../server.mjs');
const serverSrc = readFileSync(SERVER_PATH, 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, msg) {
    if (cond) {
        PASS++;
        console.log(`PASS: ${msg}`);
    } else {
        FAIL++;
        failures.push(msg);
        console.log(`FAIL: ${msg}`);
    }
}
function assertMatch(src, regex, label) {
    assert(regex.test(src), `${label} \n  regex: ${regex}`);
}
function assertNoMatch(src, regex, label) {
    assert(!regex.test(src), `${label} \n  regex (should NOT match): ${regex}`);
}

// ============================================================
// 1. _MFG_AUTO_ORDER_RULES 설정 테이블 확장 (v2)
// ============================================================

// 1-1: material_trigger_columns 신규 속성 (OR 매칭용 — MATERIAL 또는 MATERIAL_NM)
assertMatch(serverSrc,
    /_MFG_AUTO_ORDER_RULES\s*=\s*\{[\s\S]{0,500}material_trigger_columns\s*:\s*\[\s*['"]MATERIAL['"]\s*,\s*['"]MATERIAL_NM['"]\s*\]/,
    '1-1: material_trigger_columns 신규 속성 선언 (MATERIAL + MATERIAL_NM 둘 다 트리거)');

// 1-2: order_by_sql_base 로 rename (기존 order_by_sql → base 접미사)
assertMatch(serverSrc,
    /order_by_sql_base\s*:\s*[`'"]PLANT,/,
    '1-2: order_by_sql_base 신규 명 (기존 order_by_sql 가 base 로 rename)');

// 1-3: order_by_sql_with_material 신규 상수 (MATERIAL prefix 가 붙은 SQL)
assertMatch(serverSrc,
    /order_by_sql_with_material\s*:\s*[`'"]MATERIAL,\s*PLANT,/,
    '1-3: order_by_sql_with_material 신규 상수 — MATERIAL 이 PLANT 앞 (v2 사용자 요구)');

// 1-4: order_by_sql_with_material 안에도 기존 CASE 규칙 유지 (ZCGUBUN_D, ZCGUBUN)
assertMatch(serverSrc,
    /order_by_sql_with_material[\s\S]{0,2000}CASE[\s\S]{0,200}ZCGUBUN_D\s*=\s*['"]입고-생산['"][\s\S]{0,100}THEN\s*1/,
    '1-4: order_by_sql_with_material 안에 기존 ZCGUBUN_D CASE 규칙 유지 (입고-생산 → 1)');

assertMatch(serverSrc,
    /order_by_sql_with_material[\s\S]{0,2000}CASE[\s\S]{0,500}ZCGUBUN\s*=\s*['"]실제원가['"][\s\S]{0,50}THEN\s*1/,
    '1-5: order_by_sql_with_material 안에 기존 ZCGUBUN CASE 규칙 유지 (실제원가 → 1)');

// 1-6: required_columns 는 그대로 유지 (Q2 유지 — 분리 안 함)
assertMatch(serverSrc,
    /required_columns\s*:\s*\[\s*['"]PLANT['"]\s*,\s*['"]ZCGUBUN_D['"]\s*,\s*['"]ZCGUBUN['"]\s*\]/,
    '1-6: required_columns 는 그대로 [PLANT, ZCGUBUN_D, ZCGUBUN] (Q2 유지)');

// 1-7: 두 order_by_sql_* 상수 모두 선언됨 (base + with_material 2개)
//      선언문만 매칭 (주석 안의 설명 텍스트 제외) — 백틱 시작 + 실제 SQL 패턴 로 정확 매칭
const baseDecl = serverSrc.match(/order_by_sql_base\s*:\s*`/g) || [];
const withMatDecl = serverSrc.match(/order_by_sql_with_material\s*:\s*`/g) || [];
assert(baseDecl.length === 1,
    `1-7a: order_by_sql_base 선언문이 정확히 1번만 등장 (주석 제외, 실제: ${baseDecl.length})`);
assert(withMatDecl.length === 1,
    `1-7b: order_by_sql_with_material 선언문이 정확히 1번만 등장 (주석 제외, 실제: ${withMatDecl.length})`);

// ============================================================
// 2. _mfgAutoOrderBySql 헬퍼 함수 분기 로직 (v2)
// ============================================================

// _mfgAutoOrderBySql 함수 블록 추출 (화살표 함수 const 선언 패턴)
const helperMatch = serverSrc.match(/_mfgAutoOrderBySql\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\};/);
assert(!!helperMatch, '2-0: _mfgAutoOrderBySql 헬퍼 함수 블록 추출됨');
const helperSrc = helperMatch ? helperMatch[0] : '';

// 2-1: 영역 가드 — isMfgArea 가 아니면 null (기존 유지)
assertMatch(helperSrc,
    /if\s*\(\s*!isMfgArea\s*\)\s*return\s+null/,
    '2-1: isMfgArea 영역 가드 유지 (수익성분석 완전 무영향)');

// 2-2: 사용자 order_by 지정 시 skip (기존 유지)
assertMatch(helperSrc,
    /userOrderStr[\s\S]{0,100}return\s+null/,
    '2-2: 사용자가 order_by 지정하면 null 반환 (사용자 정렬 우선, Q2(a))');

// 2-3: required_columns 엄격 매칭 (기존 유지)
assertMatch(helperSrc,
    /allPresent\s*=\s*_MFG_AUTO_ORDER_RULES\.required_columns\.every/,
    '2-3: required_columns 엄격 매칭 (every) 유지');

// 2-4: v2 분기 — material_trigger_columns.some() 체크
assertMatch(helperSrc,
    /hasMaterialTrigger\s*=\s*_MFG_AUTO_ORDER_RULES\.material_trigger_columns\.some/,
    '2-4: v2 분기 — material_trigger_columns.some() 으로 MATERIAL/MATERIAL_NM 중 하나라도 있는지 체크');

// 2-5: hasMaterialTrigger 가 true 이면 order_by_sql_with_material 반환
assertMatch(helperSrc,
    /if\s*\(\s*hasMaterialTrigger\s*\)\s*\{[\s\S]{0,200}return\s+_MFG_AUTO_ORDER_RULES\.order_by_sql_with_material/,
    '2-5: hasMaterialTrigger === true 분기 → order_by_sql_with_material 반환');

// 2-6: 그 외는 기존 order_by_sql_base 반환
assertMatch(helperSrc,
    /return\s+_MFG_AUTO_ORDER_RULES\.order_by_sql_base/,
    '2-6: 그 외 (MATERIAL/MATERIAL_NM 없음) → order_by_sql_base 반환 (기존 동작 유지)');

// 2-7: selectedCols 를 Set 으로 만들어 .has() 로 체크 (대소문자 처리 포함)
assertMatch(helperSrc,
    /selectedCols\s*=\s*new\s+Set\s*\([\s\S]{0,300}toUpperCase/,
    '2-7: selectedCols Set 조립 + toUpperCase 로 대소문자 중립 매칭');

// ============================================================
// 3. 3개 ORDER BY 조립 지점 (기존 PR #552) 모두 _mfgAutoOrderBySql 사용
// ============================================================

// 3-1: compare 모드 (라인 ~17975)
assertMatch(serverSrc,
    /const\s+_autoOrderCompare\s*=\s*_mfgAutoOrderBySql/,
    '3-1: compare 모드에서 _mfgAutoOrderBySql 호출 (기존 PR #552 유지)');

// 3-2: 메인 경로 (라인 ~18138)
assertMatch(serverSrc,
    /const\s+_autoOrderMain\s*=\s*_mfgAutoOrderBySql/,
    '3-2: 메인 경로에서 _mfgAutoOrderBySql 호출 (기존 PR #552 유지)');

// 3-3: 월별 비교 분기 (라인 ~18394)
assertMatch(serverSrc,
    /const\s+_autoOrderCompareMonth\s*=\s*_mfgAutoOrderBySql/,
    '3-3: 월별 비교 분기에서 _mfgAutoOrderBySql 호출 (기존 PR #552 유지)');

// ============================================================
// 4. SQL 패턴 — order_by_sql_with_material 가 최종 ORDER BY 모양 보존
// ============================================================

// 4-1: 최종 순서 MATERIAL, PLANT, (ZCGUBUN_D CASE), (ZCGUBUN CASE)
assertMatch(serverSrc,
    /order_by_sql_with_material\s*:\s*[`'"]MATERIAL,\s*PLANT,\s*[`'"][\s\S]{0,100}CASE[\s\S]{0,500}ZCGUBUN_D[\s\S]{0,500}END[\s\S]{0,100}CASE[\s\S]{0,2000}ZCGUBUN[\s\S]{0,2000}END/,
    '4-1: order_by_sql_with_material SQL 모양 — MATERIAL, PLANT, CASE(ZCGUBUN_D), CASE(ZCGUBUN) 순서');

// 4-2: MATERIAL 은 ORDER BY 맨 앞 (PLANT 보다 먼저)
//      → regex 로 "MATERIAL" 뒤에 "PLANT" 가 나오는지 확인 (반대 순서면 fail)
assertMatch(serverSrc,
    /order_by_sql_with_material\s*:\s*[`'"]MATERIAL\s*,\s*PLANT/,
    '4-2: order_by_sql_with_material 안에서 MATERIAL 이 PLANT 바로 앞 (사용자 요구 핵심)');

// 4-3: PLANT 가 MATERIAL 앞에 오는 역순 실수 없음 (방어)
assertNoMatch(serverSrc,
    /order_by_sql_with_material\s*:\s*[`'"]PLANT\s*,\s*MATERIAL/,
    '4-3: order_by_sql_with_material 안에서 PLANT 가 MATERIAL 앞에 오는 역순 없음 (방어)');

// 4-4: MATERIAL_NM 은 ORDER BY 에 쓰이지 않음 — 유일키 MATERIAL 만 정렬 기준
//      사용자 명시: "자재명이 조회필드에 있더라도 MATERIAL_NM 이 아니라 MATERIAL 을 정렬 기준으로"
assertNoMatch(serverSrc,
    /order_by_sql_with_material\s*:\s*[`'"][^`'"]*MATERIAL_NM/,
    '4-4: order_by_sql_with_material 안에 MATERIAL_NM 미사용 (정렬키는 유일키 MATERIAL)');

// ============================================================
// 5. 영역 격리 — 수익성분석 완전 무영향
// ============================================================

// 5-1: _MFG_AUTO_ORDER_RULES 와 _mfgAutoOrderBySql 는 각각 1곳에 선언 (전역 상수가 아닌 route 내부)
const rulesDeclCount = (serverSrc.match(/const\s+_MFG_AUTO_ORDER_RULES\s*=/g) || []).length;
assert(rulesDeclCount === 1,
    `5-1: _MFG_AUTO_ORDER_RULES 선언이 정확히 1번만 등장 (실제: ${rulesDeclCount})`);

const helperDeclCount = (serverSrc.match(/const\s+_mfgAutoOrderBySql\s*=/g) || []).length;
assert(helperDeclCount === 1,
    `5-2: _mfgAutoOrderBySql 선언이 정확히 1번만 등장 (실제: ${helperDeclCount})`);

// 5-3: 수익성분석 영역 isMfgArea=false 시 null 반환 (helper 안 첫 가드)
//      → 이미 2-1 에서 검증했으나, 영역 가드가 'manufacturing-cost' 와 isMfgArea 로 묶여 있는지 재확인
assertMatch(serverSrc,
    /isMfgArea\s*=\s*\(\s*areaKey\s*===\s*['"]manufacturing-cost['"]\s*\)/,
    '5-3: isMfgArea = (areaKey === "manufacturing-cost") 플래그 유지 (영역 격리 baseline)');

// ============================================================
// 6. 회귀 방지 — 기존 PR #552 base 로직 보존
// ============================================================

// 6-1: order_by_sql_base 안에도 PLANT 로 시작하는 기존 모양 유지
assertMatch(serverSrc,
    /order_by_sql_base\s*:\s*[`'"]PLANT,\s*[`'"][\s\S]{0,100}CASE[\s\S]{0,500}ZCGUBUN_D[\s\S]{0,500}END[\s\S]{0,100}CASE/,
    '6-1: order_by_sql_base 안에도 기존 ORDER BY 모양 유지 (PLANT 로 시작, 2개 CASE)');

// 6-2: ZCGUBUN_D 가 '입고-생산' 일 때 THEN 1 (base 쪽)
assertMatch(serverSrc,
    /order_by_sql_base[\s\S]{0,2000}ZCGUBUN_D\s*=\s*['"]입고-생산['"][\s\S]{0,100}THEN\s*1/,
    '6-2: order_by_sql_base 쪽 입고-생산 → THEN 1 보존');

// 6-3: ZCGUBUN = '매출원가' 일 때 THEN 1 (소비-소비, base 쪽)
assertMatch(serverSrc,
    /order_by_sql_base[\s\S]{0,2000}ZCGUBUN\s*=\s*['"]매출원가['"][\s\S]{0,100}THEN\s*1/,
    '6-3: order_by_sql_base 쪽 매출원가 → THEN 1 보존 (소비-소비 분기)');

// 6-4: 사용자 정렬 지정 시 skip 패턴 유지 (helper 안)
assertMatch(helperSrc,
    /userOrderBy\s*\|\|\s*['"]['"]/,
    '6-4: 사용자 정렬 유연 처리 (userOrderBy || "") 패턴 유지');

// ============================================================
// 7. 설계 주석 — v2 변경 근거 기록
// ============================================================

// 7-1: v2 확장 설명 주석 (사용자 요청 2026-11-03 근거)
assertMatch(serverSrc,
    /v2\s*확장[\s\S]{0,300}(MATERIAL|자재)/,
    '7-1: v2 확장 설명 주석 (MATERIAL 추가 근거 2026-11-03)');

// 7-2: material_trigger_columns 의미 주석 (OR 매칭)
assertMatch(serverSrc,
    /material_trigger_columns[\s\S]{0,200}(OR|\ub458 \uc911|\ud558\ub098\ub77c\ub3c4)/,
    '7-2: material_trigger_columns 의미 주석 (OR 매칭, 둘 중 하나라도)');

// ============================================================
// 결과 출력
// ============================================================

console.log('');
console.log('==================================================');
console.log(`MFG AUTO ORDER BY MATERIAL TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');

if (FAIL > 0) {
    console.log('');
    console.log('실패 케이스:');
    failures.forEach((f, i) => console.log(`  - ${f}`));
    process.exit(1);
}
