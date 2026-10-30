// ============================================================
// test_builder_field_dependency.mjs
// ------------------------------------------------------------
// 사용자 신고:
//   제조원가 VQB 에서 "달력연도/월 + 자재코드 + 자재명 + 개당 단가"
//   만 선택하면 4가지 원가 기준(실제원가/실제원가의 표준원가/매출원가/
//   매출원가의 표준원가) 이 섞여서 한 줄로 집계되는 문제.
//
// 요구사항:
//   필드목록에서 `개당 단가` 더블클릭 → 조회필드 추가 시
//   아래 필드도 자동으로 함께 추가 (중복 체크 포함):
//     - PLANT          (플랜트코드)
//     - ZCGUBUN        (원가구분(구분))
//     - ZCGUBUN_D      (표준원가추정(대구분))
//   자동 추가된 필드는 '개당 단가' 보다 **앞쪽** 에 위치해야 함.
//
// 설계:
//   - 하드코딩 UI 가 아닌 설정 테이블(Dependency map) 패턴
//     상수 MFG_METRIC_FIELD_DEPENDENCIES = { metric_code: [dep...] }
//   - '개당 단가' metric_code = 'COST_ACTUAL_UNIT_PRICE'
//     (서버 sql/054_seed_cost_actual_unit_price_metric.sql 에서 정의)
//   - 영역 가드: _currentBuilderArea() === 'manufacturing-cost'
//   - 수익성분석(profitability) 영역은 완전 무영향
//   - 중복 체크: 이미 selectedFields 에 있으면 skip
//   - 제거 UX (옵션 A, 사용자 승인):
//       사용자가 '개당 단가' 수동 제거해도 자동 추가 필드는 유지
//       (removeField 는 수정하지 않음, 침습 최소화)
//
// 수정 지점:
//   1. builder.html : MFG_METRIC_FIELD_DEPENDENCIES 상수 신설 (라인 ~1812)
//   2. builder.html : addField() 안에 dependency 트리거 분기 추가
//      - metric + manufacturing-cost + dependency 매핑 존재 시 발동
//      - dimension 선삽입 → metric 마지막 push → 자동으로 앞쪽 배치
//   3. removeField() 는 수정하지 않음 (옵션 A: 자동 추가 필드 유지)
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '../public/builder.html');
const SERVER_PATH = resolve(__dirname, '../server.mjs');

const htmlSrc = readFileSync(HTML_PATH, 'utf8');
const serverSrc = readFileSync(SERVER_PATH, 'utf8');

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
// X. 서버 사전 조건 — '개당 단가' metric 이 COST_ACTUAL_UNIT_PRICE 로 정의됨
// ============================================================

// X-1: 서버에서 metric_code = COST_ACTUAL_UNIT_PRICE 로 '개당 단가' 를 노출
assertMatch(serverSrc,
    /COST_ACTUAL_UNIT_PRICE/,
    'X-1: 서버에 COST_ACTUAL_UNIT_PRICE metric 이 정의되어 있음 (사전 조건)');

// X-2: 서버 /api/builder/columns 가 metric_code 를 그대로 노출 (name=METRIC__xxx)
assertMatch(serverSrc,
    /name:\s*`METRIC__\$\{m\.metric_code\}`/,
    'X-2: 서버가 METRIC__<metric_code> 형태로 metric 컬럼 노출 (사전 조건)');

// ============================================================
// 1. 상수 MFG_METRIC_FIELD_DEPENDENCIES 신설 검증
// ============================================================

// 1-1: 상수 이름이 존재해야 함
assertMatch(htmlSrc,
    /const\s+MFG_METRIC_FIELD_DEPENDENCIES\s*=\s*\{/,
    '1-1: const MFG_METRIC_FIELD_DEPENDENCIES = { ... } 상수 선언됨');

// 1-2: COST_ACTUAL_UNIT_PRICE 키가 등록되어 있어야 함
assertMatch(htmlSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES[\s\S]{0,500}['"]COST_ACTUAL_UNIT_PRICE['"]\s*:\s*\[/,
    '1-2: COST_ACTUAL_UNIT_PRICE 키가 dependency 매핑에 등록됨');

// 1-3: PLANT / ZCGUBUN / ZCGUBUN_D 세 컬럼이 매핑되어 있어야 함
//      (사용자 요구: 자동 추가 대상 3개)
assertMatch(htmlSrc,
    /['"]COST_ACTUAL_UNIT_PRICE['"]\s*:\s*\[\s*['"]PLANT['"]\s*,\s*['"]ZCGUBUN['"]\s*,\s*['"]ZCGUBUN_D['"]\s*\]/,
    '1-3: COST_ACTUAL_UNIT_PRICE → [PLANT, ZCGUBUN, ZCGUBUN_D] 순서로 매핑');

// 1-4: 설계 원칙 주석에 "영역 가드" / "하드코딩" / "설정" 중 하나라도 언급
assertMatch(htmlSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES[\s\S]{0,2000}(영역 가드|manufacturing-cost|설정 테이블|하드코딩|Dependency)/,
    '1-4: 상수 근처에 설계 원칙 주석 존재 (영역 가드 / 설정 테이블 패턴 등)');

// ============================================================
// 2. addField() 수정 — dependency 트리거 분기 검증
// ============================================================

// addField 함수 블록만 발췌 (removeField 전까지)
const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '2-0: addField(colName) 함수 블록이 추출됨 (후속 단계 전제조건)');
const addFieldSrc = addFieldMatch ? addFieldMatch[0] : '';

// 2-1: addField 안에서 MFG_METRIC_FIELD_DEPENDENCIES 를 참조
assertMatch(addFieldSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES/,
    '2-1: addField 안에서 MFG_METRIC_FIELD_DEPENDENCIES 상수를 참조');

// 2-2: 영역 가드 — _currentBuilderArea() === 'manufacturing-cost' 체크
assertMatch(addFieldSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"]/,
    '2-2: 영역 가드 — _currentBuilderArea() === "manufacturing-cost" 체크 존재');

// 2-3: col.is_metric + col.metric_code 조건 확인 (metric 전용 분기)
assertMatch(addFieldSrc,
    /col\.is_metric[\s\S]{0,300}col\.metric_code/,
    '2-3: dependency 분기가 col.is_metric + col.metric_code 조건으로 진입');

// 2-4: Array.isArray(MFG_METRIC_FIELD_DEPENDENCIES[col.metric_code]) 체크
assertMatch(addFieldSrc,
    /Array\.isArray\s*\(\s*MFG_METRIC_FIELD_DEPENDENCIES\s*\[\s*col\.metric_code\s*\]\s*\)/,
    '2-4: dependency 매핑 존재 여부를 Array.isArray 로 안전 체크');

// 2-5: 의존 필드 중복 체크 — 이미 selectedFields 에 있으면 skip
//      (dimension 은 aggregate 없이 들어가므로 aggregate 없는 동일 column 기준)
assertMatch(addFieldSrc,
    /selectedFields\.find\s*\(\s*f\s*=>\s*f\.column\s*===\s*_depName\s*&&\s*!f\.aggregate\s*\)/,
    '2-5: 의존 필드 중복 체크 (aggregate 없는 동일 컬럼이면 skip)');

// 2-6: 의존 필드를 selectedFields.push() 로 먼저 추가 (metric 보다 앞)
assertMatch(addFieldSrc,
    /selectedFields\.push\s*\(\s*_depField\s*\)/,
    '2-6: 의존 dimension 필드를 selectedFields.push 로 선삽입');

// 2-7: metric 필드를 마지막에 push → 자동 추가된 dimension 뒤에 위치
//      (즉, 자동 추가 필드가 "앞쪽" 에 오게 됨 — 사용자 요구)
assertMatch(addFieldSrc,
    /selectedFields\.push\s*\(\s*_depField\s*\)[\s\S]{0,500}selectedFields\.push\s*\(\s*newField\s*\)/,
    '2-7: 의존 필드 push 이후에 metric(newField) 을 push → 자동 추가 필드가 앞쪽에 위치');

// 2-8: dependency 분기 완료 후 return — 하단 DATE_FIELDS/일반 분기로 내려가지 않음
//      (중복 push 방지)
assertMatch(addFieldSrc,
    /selectedFields\.push\s*\(\s*newField\s*\)[\s\S]{0,800}return\s*;/,
    '2-8: dependency 분기 끝에서 return 하여 일반 분기 중복 실행 방지');

// 2-9: 사용자 피드백(snackbar) 시도 — 없어도 안전하게 skip
assertMatch(addFieldSrc,
    /typeof\s+showSnackbar\s*===\s*['"]function['"]/,
    '2-9: showSnackbar 유틸이 있으면 사용자 알림 시도 (없으면 조용히 skip)');

// 2-10: 영역 가드가 없거나 metric 이 아니면 기존 분기(DATE_FIELDS/일반) 로 내려가야 함
//       → 기존 DATE_FIELDS 분기 코드가 그대로 보존되어야 함
assertMatch(addFieldSrc,
    /DATE_FIELDS\.includes\s*\(\s*colName\s*\)/,
    '2-10: 기존 DATE_FIELDS 분기 코드가 그대로 보존됨 (회귀 방지)');

assertMatch(addFieldSrc,
    /PERIOD_ORDER\s*=\s*\[\s*['"]CALYEAR['"]\s*,\s*['"]CALMONTH['"]\s*,\s*['"]CALDAY['"]\s*\]/,
    '2-10b: 기존 CALYEAR/CALMONTH/CALDAY 삽입 로직 보존됨 (회귀 방지)');

assertMatch(addFieldSrc,
    /selectedFields\.push\s*\(\s*newField\s*\)[\s\S]{0,2000}renderSelectedFields\s*\(\s*\)/,
    '2-10c: 일반 필드 push 후 renderSelectedFields() 호출 (회귀 방지)');

// ============================================================
// 3. removeField() 는 수정하지 않음 — 옵션 A (자동 추가 필드 유지)
// ============================================================

// removeField 함수 블록 발췌
const removeFieldMatch = htmlSrc.match(/function\s+removeField\s*\(\s*idx\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!removeFieldMatch, '3-0: removeField(idx) 함수 블록이 추출됨');
const removeFieldSrc = removeFieldMatch ? removeFieldMatch[0] : '';

// 3-1: removeField 는 MFG_METRIC_FIELD_DEPENDENCIES 를 참조하지 않아야 함
//      (옵션 A: 사용자가 '개당 단가' 를 수동 제거해도 자동 추가 필드 유지)
assertNoMatch(removeFieldSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES/,
    '3-1: removeField 는 dependency 매핑을 참조하지 않음 (옵션 A: 자동 필드 유지)');

// 3-2: removeField 는 기존처럼 단일 splice 만 수행
assertMatch(removeFieldSrc,
    /selectedFields\.splice\s*\(\s*idx\s*,\s*1\s*\)/,
    '3-2: removeField 는 기존대로 selectedFields.splice(idx, 1) 만 호출');

// ============================================================
// 4. 영역 격리 — 수익성분석(profitability) 완전 무영향 검증
// ============================================================

// 4-1: 영역 가드 외에 MFG_METRIC_FIELD_DEPENDENCIES 를 수익성분석 코드에서
//      참조하는 다른 지점이 없음 (단일 진입점)
const depRefs = (htmlSrc.match(/MFG_METRIC_FIELD_DEPENDENCIES/g) || []).length;
assert(depRefs >= 2 && depRefs <= 5,
    `4-1: MFG_METRIC_FIELD_DEPENDENCIES 참조는 상수 선언 + addField 안 (총 ${depRefs}회, 2~5 범위)`);

// 4-2: 상수가 _currentBuilderArea() 체크 없이는 사용되지 않음
//      (즉, dependency 분기는 반드시 manufacturing-cost 가드 뒤에서만 실행)
assertMatch(htmlSrc,
    /_currentBuilderArea[\s\S]{0,300}===\s*['"]manufacturing-cost['"][\s\S]{0,500}MFG_METRIC_FIELD_DEPENDENCIES/,
    '4-2: dependency 매핑 사용은 반드시 manufacturing-cost 영역 가드 뒤에서만 실행');

// ============================================================
// 5. 사이드바 더블클릭 핸들러 (addFieldByClick) 는 수정하지 않음
// ============================================================

// 5-1: addFieldByClick 는 그대로 addField 를 호출 (단순 래퍼 유지)
assertMatch(htmlSrc,
    /function\s+addFieldByClick\s*\(\s*colName\s*\)\s*\{\s*addField\s*\(\s*colName\s*\)\s*;\s*\}/,
    '5-1: addFieldByClick 는 단순 래퍼 유지 (addField 수정으로 더블클릭도 자동 반영)');

// ============================================================
// 6. 필수 라벨 매핑 사전 조건 — 자동 추가될 ZCGUBUN/ZCGUBUN_D 가
//    제조원가 영역에서 축약 라벨로 노출됨
// ============================================================

assertMatch(htmlSrc,
    /MFG_FIELD_LABEL_SHORT[\s\S]{0,500}['"]ZCGUBUN_D['"]\s*:\s*['"]표준원가추정\(대구분\)['"]/,
    '6-1: ZCGUBUN_D → "표준원가추정(대구분)" 축약 라벨 존재 (사용자 요구 라벨)');

assertMatch(htmlSrc,
    /MFG_FIELD_LABEL_SHORT[\s\S]{0,500}['"]ZCGUBUN['"]\s*:\s*['"]원가구분\(구분\)['"]/,
    '6-2: ZCGUBUN → "원가구분(구분)" 축약 라벨 존재 (사용자 요구 라벨)');

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
