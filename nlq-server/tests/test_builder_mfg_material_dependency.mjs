// ============================================================
// test_builder_mfg_material_dependency.mjs
//
// [목적] 제조원가 비주얼쿼리빌더에서 "개당 단가, 재료비-펄프, 재료비-고지" 등
//        금액/수량 metric 또는 KST 원가요소 컬럼을 더블클릭 할 때
//        자동 추가되는 dependency 리스트에 "자재코드(MATERIAL)" 가 포함되는지,
//        그리고 "자재명(MATERIAL_NM)" 바로 앞에 위치하는지 검증.
//
// [배경]
//   사용자 요청 (2026-11-03):
//     "더블클릭하면 자동으로 조회필드에 '달력연도/월', '플랜트 코드',
//      '자재명(제품명)', '표준원가추정(대구분)', '원가구분(구분)' 이 뜨는데
//      '자재명(제품명)' 앞에 '자재코드' 도 앞으로 자동으로 추가해줘.
//      '개당 단가', '재료비-펄프', '재료비-고지' 등 걸려있는거 다 해당."
//
// [설계]
//   builder.html 의 공통 상수 `_MFG_COST_ELEMENT_DEPS` 를 수정:
//     기존(v4): ['CALMONTH', 'PLANT', 'MATERIAL_NM', 'ZCGUBUN_D', 'ZCGUBUN']
//     신규(v5): ['CALMONTH', 'PLANT', 'MATERIAL', 'MATERIAL_NM', 'ZCGUBUN_D', 'ZCGUBUN']
//   → 이 상수를 참조하는 모든 dependency (UNIT_COST + KST001~KST039 +
//     TOTAL1/TOTAL2 + LBKUM + TOTAL/KST_V/KST_F) 전부 자동 반영 (DRY).
//
// [영역 격리]
//   제조원가 (manufacturing-cost) 영역만 적용. 수익성분석 영역 무영향.
//
// [관련 PR 체인]
//   - PR #542~#549: _MFG_COST_ELEMENT_DEPS 기본 틀 (CALMONTH/PLANT/MATERIAL_NM/ZCGUBUN_D/ZCGUBUN)
//   - PR #550: TOTAL1/TOTAL2 추가 (상수 참조)
//   - PR #553: LBKUM 추가 (상수 참조) + POST_DEPENDENCIES 신설
//   - PR #554: TOTAL/KST_V/KST_F 추가 (상수 참조)
//   - 이번 PR (v5): MATERIAL 을 상수 자체에 추가 → 참조 모든 곳 자동 반영
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const htmlPath = path.resolve(__dirname, '..', 'public', 'builder.html');
const htmlSrc = fs.readFileSync(htmlPath, 'utf-8');

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(cond, label) {
    if (cond) {
        console.log(`PASS: ${label}`);
        passCount++;
    } else {
        console.log(`FAIL: ${label}`);
        failCount++;
        failures.push(label);
    }
}
function assertMatch(src, regex, label) {
    assert(regex.test(src), `${label} \n  regex: ${regex}`);
}
function assertNoMatch(src, regex, label) {
    assert(!regex.test(src), `${label} \n  regex (should NOT match): ${regex}`);
}

// ============================================================
// 1. _MFG_COST_ELEMENT_DEPS 상수 자체에 MATERIAL 포함 (v5)
// ============================================================

// 1-1: 상수가 선언되어 있고 MATERIAL 과 MATERIAL_NM 둘 다 포함
assertMatch(htmlSrc,
    /const\s+_MFG_COST_ELEMENT_DEPS\s*=\s*\[\s*['"]CALMONTH['"]\s*,\s*['"]PLANT['"]\s*,\s*['"]MATERIAL['"]\s*,\s*['"]MATERIAL_NM['"]\s*,\s*['"]ZCGUBUN_D['"]\s*,\s*['"]ZCGUBUN['"]\s*\]/,
    '1-1: _MFG_COST_ELEMENT_DEPS 는 [CALMONTH, PLANT, MATERIAL, MATERIAL_NM, ZCGUBUN_D, ZCGUBUN] (v5 사용자 요구: MATERIAL 추가)');

// 1-2: MATERIAL 이 MATERIAL_NM 바로 앞 (중간에 다른 요소 없음)
//      사용자 요구: "'자재명(제품명)' 앞에 '자재코드' 도 앞으로"
assertMatch(htmlSrc,
    /['"]MATERIAL['"]\s*,\s*['"]MATERIAL_NM['"]/,
    '1-2: MATERIAL 이 MATERIAL_NM 바로 앞에 위치 (v5 요구 순서)');

// 1-3: 상수 선언에 MATERIAL 이 배열 안에 정확히 1번만 등장
//      (중복 삽입 방지 — 혹시 두 번 추가되면 중복 push 리스크)
const depsLineMatch = htmlSrc.match(/const\s+_MFG_COST_ELEMENT_DEPS\s*=\s*\[([^\]]+)\]/);
assert(!!depsLineMatch, '1-3-pre: _MFG_COST_ELEMENT_DEPS 선언문 추출 가능');
if (depsLineMatch) {
    const inside = depsLineMatch[1];
    const matCount = (inside.match(/['"]MATERIAL['"]/g) || []).length;
    const matNmCount = (inside.match(/['"]MATERIAL_NM['"]/g) || []).length;
    assert(matCount === 1,
        `1-3a: 상수 배열 안에 'MATERIAL' 가 정확히 1번만 등장 (실제: ${matCount})`);
    assert(matNmCount === 1,
        `1-3b: 상수 배열 안에 'MATERIAL_NM' 가 정확히 1번만 등장 (실제: ${matNmCount})`);
}

// 1-4: v5 변경 주석 (설계 근거 기록)
assertMatch(htmlSrc,
    /v5\s*변경[\s\S]{0,100}(MATERIAL|\uc790\uc7ac\ucf54\ub4dc)/,
    '1-4: _MFG_COST_ELEMENT_DEPS 상수 위에 v5 변경 주석 (MATERIAL 추가 근거)');

// ============================================================
// 2. 참조 체인 보존 — MATERIAL 상수 변경이 모든 참조에 자동 반영
// ============================================================

// 2-1: UNIT_COST (metric) 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조
//      (상수 선언 뒤 설계 주석 블록이 길어 window 2000 로 확대)
assertMatch(htmlSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES\s*=\s*\{[\s\S]{0,2000}['"]UNIT_COST['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-1: UNIT_COST metric 은 여전히 _MFG_COST_ELEMENT_DEPS 참조 → MATERIAL 자동 반영');

// 2-2: KST001 (재료비-펄프) 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조
assertMatch(htmlSrc,
    /['"]KST001['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-2: KST001 (재료비-펄프) 은 여전히 _MFG_COST_ELEMENT_DEPS 참조 → MATERIAL 자동 반영');

// 2-3: KST002 (재료비-고지) 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조
assertMatch(htmlSrc,
    /['"]KST002['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-3: KST002 (재료비-고지) 은 여전히 _MFG_COST_ELEMENT_DEPS 참조 → MATERIAL 자동 반영');

// 2-4: TOTAL1 (현재월 표준가) 매핑 보존 (PR #550)
assertMatch(htmlSrc,
    /['"]TOTAL1['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-4: TOTAL1 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조 (PR #550 보존)');

// 2-5: TOTAL2 (이전월 표준가) 매핑 보존 (PR #550)
assertMatch(htmlSrc,
    /['"]TOTAL2['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-5: TOTAL2 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조 (PR #550 보존)');

// 2-6: LBKUM (생산수량) 매핑 보존 (PR #553)
assertMatch(htmlSrc,
    /['"]LBKUM['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-6: LBKUM 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조 (PR #553 보존)');

// 2-7: TOTAL (원가 합계금액) 매핑 보존 (PR #554)
assertMatch(htmlSrc,
    /['"]TOTAL['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-7: TOTAL 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조 (PR #554 보존)');

// 2-8: KST_V (변동비) + KST_F (고정비) 매핑 보존 (PR #554)
assertMatch(htmlSrc,
    /['"]KST_V['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-8: KST_V 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조 (PR #554 보존)');
assertMatch(htmlSrc,
    /['"]KST_F['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '2-9: KST_F 매핑이 여전히 _MFG_COST_ELEMENT_DEPS 참조 (PR #554 보존)');

// ============================================================
// 3. 영역 격리 (수익성분석 완전 무영향)
// ============================================================

// 3-1: _MFG_COST_ELEMENT_DEPS 는 MFG 영역 전용 (사용 지점이 _currentBuilderArea() 가드 아래)
//      → htmlSrc 안에 "manufacturing-cost" 가드 뒤에서만 MFG_COLUMN_FIELD_DEPENDENCIES 참조
assertMatch(htmlSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"][\s\S]{0,3000}MFG_COLUMN_FIELD_DEPENDENCIES/,
    '3-1: MFG_COLUMN_FIELD_DEPENDENCIES 사용은 manufacturing-cost 영역 가드 뒤 (수익성분석 무영향)');

// 3-2: 수익성분석 (profit) 쪽 코드에는 MATERIAL dependency 자동 추가 로직 없음
//      → "profitability" 가드 뒤에서 MATERIAL 자동 삽입 코드가 없는지 확인
//      (방어적 체크: 수익성분석 분기에서 selectedFields.push('MATERIAL', ...) 같은 패턴 없음)
assertNoMatch(htmlSrc,
    /profitability[\s\S]{0,2000}selectedFields\.push\s*\(\s*\{\s*column:\s*['"]MATERIAL['"]/,
    '3-2: 수익성분석 영역에서 MATERIAL 자동 push 없음 (영역 격리)');

// ============================================================
// 4. 중복 추가 방지 로직 보존 (사용자가 이미 MATERIAL 을 선택했으면 skip)
// ============================================================

// 4-1: addField 함수 안의 중복 체크 로직 보존
//      selectedFields.find(f => f.column === _depName && !f.aggregate) 패턴
const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '4-0: addField(colName) 함수 블록 추출됨');
if (addFieldMatch) {
    const addFieldSrc = addFieldMatch[0];
    assertMatch(addFieldSrc,
        /selectedFields\.find\s*\(\s*f\s*=>\s*f\.column\s*===\s*_depName\s*&&\s*!f\.aggregate\s*\)/,
        '4-1: dependency 중복 체크 로직 보존 (MATERIAL 도 이미 선택되어 있으면 skip)');
}

// ============================================================
// 5. snackbar 사용자 피드백 메시지 보존 (v3)
// ============================================================

// 5-1: snackbar 메시지에 "달력연도/월·플랜트·원가구분·표준원가추정" 안내 유지
//      (MATERIAL 추가되어도 UX 안내 문구는 유지)
assertMatch(htmlSrc,
    /\ub2ec\ub825\uc5f0\ub3c4\/\uc6d4\u00b7\ud50c\ub79c\ud2b8\u00b7\uc6d0\uac00\uad6c\ubd84\u00b7\ud45c\uc900\uc6d0\uac00\ucd94\uc815/,
    '5-1: snackbar 안내 문구 "달력연도/월·플랜트·원가구분·표준원가추정" 보존');

// ============================================================
// 결과 출력
// ============================================================

console.log('');
console.log('========================================');
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
console.log('========================================');

if (failCount > 0) {
    console.log('');
    console.log('실패한 assertion 목록:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');
    console.log(`==================================================`);
    console.log(`BUILDER MFG MATERIAL DEPENDENCY TEST — PASS: ${passCount}, FAIL: ${failCount}`);
    console.log(`==================================================`);
    process.exit(1);
}

console.log('');
console.log(`==================================================`);
console.log(`BUILDER MFG MATERIAL DEPENDENCY TEST — PASS: ${passCount}, FAIL: ${failCount}`);
console.log(`==================================================`);
