// ============================================================
// test_builder_dedup_strict.mjs
//
// [목적] addField() 함수의 중복 체크가 column 이름만으로 판정되는지
//        (aggregate 값과 무관하게) 검증. LBKUM(생산수량) / UNIT_COST(개당단가)
//        같은 "aggregate 가 truthy 로 설정되는 필드" 가 더블클릭 중복
//        추가되지 않도록 보장.
//
// [배경] 2026-11-03 사용자 지적:
//   "LBKUM(생산수량) / 개당단가 이 두 개만 더블클릭하면 계속 중복 추가됨.
//    이 두 개만 중복 추가되지 않게 해줘."
//
//   원인 분석:
//     기존 addField 중복 체크: `f.column === colName && !f.aggregate`
//     → aggregate 가 falsy (빈 문자열) 일 때만 중복 판정
//     → LBKUM (category='quantity' → aggregate='SUM')  : `!aggregate` 가 false → 중복 안 됨 ❌
//     → UNIT_COST (is_metric → aggregate='METRIC')     : `!aggregate` 가 false → 중복 안 됨 ❌
//     → 그 외 (dim/KST/TOTAL 등 aggregate='') 는 정상 중복 체크 ✅
//
//   수정:
//     중복 체크 조건을 `f.column === colName` 만으로 단순화.
//     → aggregate 값 무관하게 같은 column 은 1번만 추가 허용
//     → LBKUM, UNIT_COST 포함 모든 필드가 더블클릭 중복 추가 안 됨
//
// [영역 격리]
//   addField 함수는 공통 로직. 수익성분석도 동일한 중복 체크 적용되는데,
//   수익성분석 쪽은 원래 모든 컬럼 aggregate='' 로 들어가서 기존 체크로도
//   정상 작동했음. 이번 수정은 더 엄격해지는 방향 (더 많이 skip) 이므로
//   수익성분석에도 안전 (regression 없음).
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
// 1. addField 함수 추출
// ============================================================

const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '1-0: addField(colName) 함수 블록 추출됨');
const addFieldSrc = addFieldMatch ? addFieldMatch[0] : '';

// ============================================================
// 2. 중복 체크 조건이 column 이름만으로 판정 (aggregate 무관)
// ============================================================

// 2-1: addField 맨 위에 중복 체크 조건이 column 이름만 비교
//      패턴: selectedFields.find(f => f.column === colName) 뒤에 바로 return
assertMatch(addFieldSrc,
    /selectedFields\.find\s*\(\s*f\s*=>\s*f\.column\s*===\s*colName\s*\)\s*\)\s*return\s*;/,
    '2-1: addField 중복 체크는 column 이름만 비교 (aggregate 조건 없음) → LBKUM/UNIT_COST 포함 전 필드 중복 금지');

// 2-2: 기존 `!f.aggregate` 조건이 중복 체크에서 제거됨 (regression 방지)
//      addField 함수의 "맨 위 중복 체크" 지점에서는 이 패턴이 없어야 함
//      (단, dependency 자동 추가 블록의 _depName 중복 체크는 유지 — 그건 별도)
const topGuardMatch = addFieldSrc.match(/function\s+addField\s*\(\s*colName\s*\)[\s\S]{0,2000}?return\s*;/);
assert(!!topGuardMatch, '2-2-pre: addField 함수 맨 위 중복 체크 블록 추출 (처음 return 까지)');
if (topGuardMatch) {
    const topGuardSrc = topGuardMatch[0];
    assertNoMatch(topGuardSrc,
        /f\.column\s*===\s*colName\s*&&\s*!f\.aggregate/,
        '2-2: addField 맨 위 중복 체크에 `&& !f.aggregate` 조건 없음 (regression 방지)');
}

// 2-3: 수정 근거 설명 주석 포함 (사용자 지적 2026-11-03 기록)
assertMatch(addFieldSrc,
    /2026-11-03\s*수정[\s\S]{0,500}(LBKUM|UNIT_COST|\uac1c\ub2f9\ub2e8\uac00)/,
    '2-3: 2026-11-03 사용자 지적 수정 근거 주석 (LBKUM/UNIT_COST/개당단가 언급)');

// ============================================================
// 3. dependency 자동 추가 블록의 내부 중복 체크는 유지 (regression 방지)
// ============================================================

// 3-1: 의존 필드 (_depName) 중복 체크는 기존 패턴 유지 — dependency 자동 추가는
//      "이미 있는 dimension 은 skip, 없는 것만 추가" UX 그대로
assertMatch(addFieldSrc,
    /selectedFields\.find\s*\(\s*f\s*=>\s*f\.column\s*===\s*_depName\s*&&\s*!f\.aggregate\s*\)/,
    '3-1: dependency 자동 추가 내부 중복 체크 (_depName && !aggregate) 유지 — dim 전용');

// 3-2: POST dependency (_postName) 중복 체크도 유지 (PR #553)
assertMatch(addFieldSrc,
    /selectedFields\.find\s*\(\s*f\s*=>\s*f\.column\s*===\s*_postName\s*&&\s*!f\.aggregate\s*\)/,
    '3-2: POST dependency 자동 추가 내부 중복 체크 (_postName && !aggregate) 유지 (PR #553)');

// ============================================================
// 4. 기존 기능 보존 (dependency / POST / snackbar 등)
// ============================================================

// 4-1: metric 분기 보존 (col.is_metric)
assertMatch(addFieldSrc,
    /if\s*\(\s*col\.is_metric\s*\)/,
    '4-1: metric 분기 (col.is_metric) 보존');

// 4-2: 영역 가드 보존
assertMatch(addFieldSrc,
    /_currentBuilderArea\s*\(\s*\)\s*===\s*['"]manufacturing-cost['"]/,
    '4-2: 영역 가드 (_currentBuilderArea() === "manufacturing-cost") 보존');

// 4-3: _depColNames 통합 변수 보존
assertMatch(addFieldSrc,
    /let\s+_depColNames\s*=\s*null/,
    '4-3: _depColNames 통합 변수 보존');

// 4-4: POST_DEPENDENCIES 처리 블록 보존 (PR #553)
assertMatch(addFieldSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES/,
    '4-4: MFG_COLUMN_FIELD_POST_DEPENDENCIES 처리 블록 보존 (PR #553)');

// 4-5: snackbar 피드백 로직 보존
assertMatch(addFieldSrc,
    /typeof\s+showSnackbar\s*===\s*['"]function['"]/,
    '4-5: showSnackbar 피드백 로직 보존');

// ============================================================
// 5. 영역 격리 (수익성분석 완전 무영향)
// ============================================================

// 5-1: 중복 체크는 공통 (manufacturing-cost 가드 밖) — 수익성분석도 동일 적용
//      수익성분석 쪽은 원래 aggregate='' 로 들어가서 기존 체크로도 정상 중복 체크됨.
//      이번 수정은 더 엄격해지는 방향 (더 많이 skip) 이라 수익성분석에도 안전.
//      → 중복 체크 지점이 영역 가드 "앞"에 있는지 확인
const guardMatch = addFieldSrc.match(/_currentBuilderArea/);
const dedupMatch = addFieldSrc.match(/selectedFields\.find\s*\(\s*f\s*=>\s*f\.column\s*===\s*colName\s*\)\s*\)\s*return/);
if (guardMatch && dedupMatch) {
    const guardIdx = addFieldSrc.indexOf(guardMatch[0]);
    const dedupIdx = addFieldSrc.indexOf(dedupMatch[0]);
    assert(dedupIdx < guardIdx,
        '5-1: 중복 체크는 영역 가드 앞 (공통 로직) — 수익성분석도 더 엄격해지는 방향으로 영향 없음');
}

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
    console.log(`BUILDER DEDUP STRICT TEST — PASS: ${passCount}, FAIL: ${failCount}`);
    console.log(`==================================================`);
    process.exit(1);
}

console.log('');
console.log(`==================================================`);
console.log(`BUILDER DEDUP STRICT TEST — PASS: ${passCount}, FAIL: ${failCount}`);
console.log(`==================================================`);
