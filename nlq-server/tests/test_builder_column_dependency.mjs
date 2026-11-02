// ============================================================
// test_builder_column_dependency.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #546):
//   제조원가 VQB 에서 20개 원가요소 컬럼(KST001~KST039)을 사이드바에서
//   더블클릭하면, 집계 왜곡 방지를 위해 아래 4개 dimension 을 자동으로
//   함께 조회필드에 추가.
//
//   자동 추가 필드 (사용자 승인 순서):
//     1. CALMONTH   (달력연도/월)   ← DATE_FIELDS 특수 삽입 → selectedFields 맨 앞
//     2. PLANT      (플랜트 코드)
//     3. ZCGUBUN_D  (표준원가추정(대구분))
//     4. ZCGUBUN    (원가구분(구분))
//     5. [선택한 KST 컬럼]
//
//   사용자 승인 Q (3가지):
//     Q1. 공통 dependency 통일 ✅ (['CALMONTH','PLANT','ZCGUBUN_D','ZCGUBUN'])
//     Q2. KST039 (생산량 입고용) 도 포함 ✅ (총 21개 = UNIT_COST + 20개)
//     Q3. UNIT_COST (개당 단가) 도 동일 dependency 로 변경 ✅
//
// 20개 KST 컬럼 매핑 (sql/043_create_sys_aimd_cot015.sql + sql/050 운영 ontology):
//   KST001 재료비-펄프      KST002 재료비-고지      KST004 재료비-패드
//   KST006 부재료비-약품    KST008 부재료비-포장재  KST010 재료비-기타
//   KST012 인건비           KST014 도급비           KST015 에너지비
//   KST017 감가상각비       KST019 수선/소모품비    KST021 기타경비
//   KST025 외주가공비       KST027 인건비-경비      KST029 인건비-기타
//   KST031 전력비           KST033 세금과공과       KST035 지급수수료
//   KST037 기타경비-폐기물  KST039 생산량 (입고용)
//
// 설계 (설정 테이블 패턴, PR #542/#544 와 통일):
//   const _MFG_COST_ELEMENT_DEPS = ['CALMONTH','PLANT','ZCGUBUN_D','ZCGUBUN'];
//   const MFG_METRIC_FIELD_DEPENDENCIES = { 'UNIT_COST': _MFG_COST_ELEMENT_DEPS };
//   const MFG_COLUMN_FIELD_DEPENDENCIES = {
//     'KST001': _MFG_COST_ELEMENT_DEPS,
//     'KST002': _MFG_COST_ELEMENT_DEPS,
//     ... (20개)
//   };
//
// 영역 격리:
//   - addField 분기에서 _currentBuilderArea() === 'manufacturing-cost' 가드
//   - 수익성분석(profitability) 영역은 DIVISION/MATERIAL 외에 KST 컬럼 자체가
//     없고, 영역 가드로 분기 미발동 → 완전 무영향
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '../public/builder.html');
const htmlSrc = readFileSync(HTML_PATH, 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, msg) {
    if (cond) { PASS++; }
    else { FAIL++; failures.push(msg); console.log('FAIL:', msg); }
}
function assertMatch(src, re, msg) {
    const ok = re.test(src);
    if (ok) { PASS++; }
    else { FAIL++; failures.push(`${msg}\n  regex: ${re}`); console.log('FAIL:', msg, '\n  regex:', re); }
}
function assertNoMatch(src, re, msg) {
    const ok = !re.test(src);
    if (ok) { PASS++; }
    else { FAIL++; failures.push(`${msg}\n  regex: ${re}`); console.log('FAIL:', msg, '\n  regex:', re); }
}

// ============================================================
// 1. _MFG_COST_ELEMENT_DEPS 공통 상수 (DRY)
// ============================================================

// 1-1: _MFG_COST_ELEMENT_DEPS 공통 상수 선언
assertMatch(htmlSrc,
    /const\s+_MFG_COST_ELEMENT_DEPS\s*=\s*\[/,
    '1-1: _MFG_COST_ELEMENT_DEPS 공통 상수 선언됨');

// 1-2 [v4]: 사용자 요구 순서 [CALMONTH, PLANT, MATERIAL_NM, ZCGUBUN_D, ZCGUBUN]
//           v4 변경: MATERIAL_NM(자재명) 추가 — 자재별 집계 왜곡 방지
assertMatch(htmlSrc,
    /_MFG_COST_ELEMENT_DEPS\s*=\s*\[\s*['"]CALMONTH['"]\s*,\s*['"]PLANT['"]\s*,\s*['"]MATERIAL_NM['"]\s*,\s*['"]ZCGUBUN_D['"]\s*,\s*['"]ZCGUBUN['"]\s*\]/,
    '1-2 [v4]: _MFG_COST_ELEMENT_DEPS = [CALMONTH, PLANT, MATERIAL_NM, ZCGUBUN_D, ZCGUBUN] (v4 사용자 승인 순서)');

// 1-3: 공통 상수에 설계 메모 주석 포함
assertMatch(htmlSrc,
    /_MFG_COST_ELEMENT_DEPS[\s\S]{0,2000}(CALMONTH|DATE_FIELDS|\ub9e8 \uc55e|DRY|\uacf5\ud1b5)/,
    '1-3: _MFG_COST_ELEMENT_DEPS 근처에 설계 메모 주석 (CALMONTH 특수 / DRY / 공통)');

// ============================================================
// 2. MFG_COLUMN_FIELD_DEPENDENCIES 상수 신설
// ============================================================

// 2-1: 상수 선언
assertMatch(htmlSrc,
    /const\s+MFG_COLUMN_FIELD_DEPENDENCIES\s*=\s*\{/,
    '2-1: const MFG_COLUMN_FIELD_DEPENDENCIES = { ... } 상수 선언됨');

// 2-2: 20개 KST 컬럼 전부 등록 — 모두 _MFG_COST_ELEMENT_DEPS 참조
const KST_COLS = [
    'KST001', 'KST002', 'KST004', 'KST006', 'KST008',
    'KST010', 'KST012', 'KST014', 'KST015', 'KST017',
    'KST019', 'KST021', 'KST025', 'KST027', 'KST029',
    'KST031', 'KST033', 'KST035', 'KST037', 'KST039',
];
assert(KST_COLS.length === 20, `2-2a: 테스트에서 확인할 KST 컬럼이 20개 (실제: ${KST_COLS.length})`);

KST_COLS.forEach((kst, i) => {
    // 각 KST 컬럼이 MFG_COLUMN_FIELD_DEPENDENCIES 에 _MFG_COST_ELEMENT_DEPS 로 매핑돼 있는지
    assertMatch(htmlSrc,
        new RegExp(`MFG_COLUMN_FIELD_DEPENDENCIES[\\s\\S]{0,3000}['"]${kst}['"]\\s*:\\s*_MFG_COST_ELEMENT_DEPS`),
        `2-2-${String(i + 1).padStart(2, '0')}: ${kst} 매핑됨 → _MFG_COST_ELEMENT_DEPS 공통 상수 참조`);
});

// 2-3: 상수 근처에 설계 원칙 주석 (설정 테이블 / sql/043 / sys_aimd_cot015)
assertMatch(htmlSrc,
    /MFG_COLUMN_FIELD_DEPENDENCIES[\s\S]{0,3000}(sys_aimd_cot015|sql\/043|\uc124\uc815 \ud14c\uc774\ube14|KST001~KST039|DRY)/,
    '2-3: MFG_COLUMN_FIELD_DEPENDENCIES 근처에 설계 메모 주석 (설정 테이블 / sys_aimd_cot015 / KST 범위)');

// ============================================================
// 3. addField() 확장 — non-metric 컬럼도 dependency 처리
// ============================================================

// addField 함수 블록 추출 (metric/column 통합 분기 포함)
const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '3-0: addField(colName) 함수 블록 추출됨');
const addFieldSrc = addFieldMatch ? addFieldMatch[0] : '';

// 3-1: addField 안에서 MFG_COLUMN_FIELD_DEPENDENCIES 를 참조
assertMatch(addFieldSrc,
    /MFG_COLUMN_FIELD_DEPENDENCIES/,
    '3-1: addField 안에서 MFG_COLUMN_FIELD_DEPENDENCIES 참조 (non-metric 컬럼 분기)');

// 3-2: non-metric 조건 (!col.is_metric) 체크 — metric 분기와 상호배타
assertMatch(addFieldSrc,
    /!col\.is_metric[\s\S]{0,500}MFG_COLUMN_FIELD_DEPENDENCIES\s*\[\s*colName\s*\]/,
    '3-2: !col.is_metric 조건 하에서 MFG_COLUMN_FIELD_DEPENDENCIES[colName] 조회 (metric 과 상호배타)');

// 3-3: Array.isArray 로 안전 체크 (매핑 없는 컬럼은 skip)
assertMatch(addFieldSrc,
    /Array\.isArray\s*\(\s*MFG_COLUMN_FIELD_DEPENDENCIES\s*\[\s*colName\s*\]\s*\)/,
    '3-3: Array.isArray(MFG_COLUMN_FIELD_DEPENDENCIES[colName]) 안전 체크 (매핑 없으면 skip)');

// 3-4: 영역 가드 (_isMfgArea) 안에서만 column dependency 조회
//      metric 분기와 동일하게 'manufacturing-cost' 전용
assertMatch(addFieldSrc,
    /_isMfgArea[\s\S]{0,500}MFG_COLUMN_FIELD_DEPENDENCIES/,
    '3-4: 영역 가드(_isMfgArea) 안에서만 MFG_COLUMN_FIELD_DEPENDENCIES 조회');

// 3-5: CALMONTH 등 DATE_FIELDS 는 addField 재귀 호출로 특수 삽입 로직 활용
//      → selectedFields 맨 앞에 배치됨
assertMatch(addFieldSrc,
    /DATE_FIELDS\.includes\s*\(\s*_depName\s*\)[\s\S]{0,300}addField\s*\(\s*_depName\s*\)/,
    '3-5: DATE_FIELDS 멤버(CALMONTH)는 addField(_depName) 재귀 호출로 맨 앞 삽입 로직 활용');

// 3-6: 통합 lookup 패턴 — _depColNames 변수 사용 (metric/column 공통)
assertMatch(addFieldSrc,
    /let\s+_depColNames\s*=\s*null/,
    '3-6: _depColNames 통합 변수 선언 (metric/column 분기 모두 사용)');

// 3-7: 분기 끝에 return 하여 DATE_FIELDS/일반 분기 중복 실행 방지
assertMatch(addFieldSrc,
    /_depColNames[\s\S]{0,3000}selectedFields\.push\s*\(\s*newField\s*\)[\s\S]{0,800}return\s*;/,
    '3-7: dependency 분기 끝에 return → 하단 DATE_FIELDS/일반 분기 중복 실행 방지');

// ============================================================
// 4. UNIT_COST 와 KST 컬럼은 동일 공통 상수 공유 (일관성)
// ============================================================

// 4-1: MFG_METRIC_FIELD_DEPENDENCIES 의 UNIT_COST 도 _MFG_COST_ELEMENT_DEPS 사용
assertMatch(htmlSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES[\s\S]{0,2000}['"]UNIT_COST['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    '4-1: UNIT_COST 도 _MFG_COST_ELEMENT_DEPS 공유 → KST 컬럼들과 동일 dependency');

// 4-2: 과거 PR #542 의 하드코딩 순서 [PLANT, ZCGUBUN, ZCGUBUN_D] 는 제거됨
assertNoMatch(htmlSrc,
    /['"]UNIT_COST['"]\s*:\s*\[\s*['"]PLANT['"]\s*,\s*['"]ZCGUBUN['"]\s*,\s*['"]ZCGUBUN_D['"]\s*\]/,
    '4-2: 과거 UNIT_COST 하드코딩 순서 [PLANT, ZCGUBUN, ZCGUBUN_D] 가 코드에서 제거됨');

// ============================================================
// 5. 영역 격리 — 수익성분석 완전 무영향
// ============================================================

// 5-1: MFG_COLUMN_FIELD_DEPENDENCIES 사용은 반드시 manufacturing-cost 영역 가드 뒤에서
assertMatch(htmlSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"][\s\S]{0,3000}MFG_COLUMN_FIELD_DEPENDENCIES/,
    '5-1: MFG_COLUMN_FIELD_DEPENDENCIES 사용은 반드시 manufacturing-cost 영역 가드 뒤');

// ============================================================
// 6. 회귀 방지 — PR #542/#543/#544/#545 보존
// ============================================================

// 6-1: PR #543 UNIT_COST key 보존
assertMatch(htmlSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES[\s\S]{0,2000}['"]UNIT_COST['"]/,
    '6-1: PR #543 UNIT_COST metric_code 보존');

// 6-2: PR #544 __GROUP__PLANT_PAIR 보존
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,2000}['"]__GROUP__PLANT_PAIR['"]/,
    '6-2: PR #544 __GROUP__PLANT_PAIR 묶음 보존');

// 6-3: PR #545 __GROUP__DIVISION_PAIR 보존
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,2000}['"]__GROUP__DIVISION_PAIR['"]/,
    '6-3: PR #545 __GROUP__DIVISION_PAIR 묶음 보존');

// 6-4: PR #542 addFieldByClick __GROUP__ 분기 보존
assertMatch(htmlSrc,
    /function\s+addFieldByClick[\s\S]{0,2000}['"]__GROUP__['"]/,
    '6-4: PR #544 addFieldByClick __GROUP__ 분기 보존');

// 6-5: 기존 DATE_FIELDS 특수 삽입 로직 (CALYEAR/CALMONTH/CALDAY) 보존
assertMatch(htmlSrc,
    /PERIOD_ORDER\s*=\s*\[\s*['"]CALYEAR['"]\s*,\s*['"]CALMONTH['"]\s*,\s*['"]CALDAY['"]\s*\]/,
    '6-5: 기존 DATE_FIELDS PERIOD_ORDER 로직 보존 (회귀 방지)');

// 6-6: removeField 는 수정 없음 (옵션 A — 자동 추가 필드 유지)
const removeFieldMatch = htmlSrc.match(/function\s+removeField\s*\(\s*idx\s*\)\s*\{[\s\S]*?\n\}/);
const removeFieldSrc = removeFieldMatch ? removeFieldMatch[0] : '';
assertNoMatch(removeFieldSrc,
    /MFG_(METRIC|COLUMN)_FIELD_DEPENDENCIES/,
    '6-6: removeField 는 dependency 매핑 미참조 (옵션 A 유지)');

// ============================================================
// 결과 출력
// ============================================================
console.log('\n========================================');
console.log(`PASS: ${PASS}`);
console.log(`FAIL: ${FAIL}`);
console.log('========================================');
if (FAIL > 0) {
    console.log('\n실패한 assertion 목록:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    process.exit(1);
}
process.exit(0);
