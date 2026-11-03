// ============================================================
// test_builder_lbkum_dependency.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #553, 2026-11-02):
//   LBKUM (생산수량/매출수량) 더블클릭 시:
//     1) SUM 뱃지 제거 + 드롭박스 숨김 (PR #549 와 동일)
//     2) 아래 순서로 조회필드 자동 셋팅:
//        CALMONTH → PLANT → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN
//        → [LBKUM 자기 자신] → BASE_UOM(기본 단위)
//
// 사용자 승인 조합:
//   Q1(a): 신규 전용 상수 패턴 (MFG_COLUMN_FIELD_POST_DEPENDENCIES 신설)
//   Q2(a): LBKUM 도 SUM 고정 + 뱃지 제거 (_MFG_FIXED_AGG_COLUMNS 추가)
//   Q3(a): BASE_UOM 자체는 평범한 dim (POST_DEPENDENCIES 에 BASE_UOM 키 없음)
//   Q4: 기본단위 사이드바 노출 상태 그대로 유지 (별도 숨김/노출 변경 없음)
//   Q5(a): 제조원가 영역만 (수익성분석 무영향)
//
// 설계 (설정 테이블 패턴, PR #542/#544/#546/#549/#550/#551/#552 와 통일):
//   앞쪽 dependency: MFG_COLUMN_FIELD_DEPENDENCIES['LBKUM'] = _MFG_COST_ELEMENT_DEPS
//                   → CALMONTH, PLANT, MATERIAL_NM, ZCGUBUN_D, ZCGUBUN
//                   → addField 가 self push 전에 하나씩 push
//   뒤쪽 dependency: MFG_COLUMN_FIELD_POST_DEPENDENCIES['LBKUM'] = ['BASE_UOM']
//                   → addField 가 self push 후에 post dependency 처리
//
// 영역 격리:
//   - 제조원가 (manufacturing-cost) 영역만 적용
//   - 수익성분석 (profitability) 영역: 공통 상수 미참조 + 영역 가드 → 완전 무영향
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
// 1. MFG_COLUMN_FIELD_DEPENDENCIES 에 LBKUM 추가 (앞쪽 dependency)
// ============================================================

// 1-1: 'LBKUM': _MFG_COST_ELEMENT_DEPS 매핑 존재
assertMatch(htmlSrc,
    /MFG_COLUMN_FIELD_DEPENDENCIES[\s\S]{0,3500}['"]LBKUM['"]\s*:\s*_MFG_COST_ELEMENT_DEPS/,
    "1-1: MFG_COLUMN_FIELD_DEPENDENCIES['LBKUM'] = _MFG_COST_ELEMENT_DEPS 매핑됨");

// 1-2: LBKUM 매핑 주석 (생산수량/매출수량)
assertMatch(htmlSrc,
    /['"]LBKUM['"]\s*:\s*_MFG_COST_ELEMENT_DEPS\s*,?\s*\/\/[^\n]*(\uc0dd\uc0b0\uc218\ub7c9|\ub9e4\ucd9c\uc218\ub7c9|DECIMAL)/,
    '1-2: LBKUM 매핑에 "생산수량/매출수량 (DECIMAL)" 주석 (DB 스키마 명시)');

// ============================================================
// 2. MFG_COLUMN_FIELD_POST_DEPENDENCIES 신설 (뒤쪽 dependency)
// ============================================================

// 2-1: 상수 선언 존재
assertMatch(htmlSrc,
    /const\s+MFG_COLUMN_FIELD_POST_DEPENDENCIES\s*=\s*\{/,
    '2-1: const MFG_COLUMN_FIELD_POST_DEPENDENCIES = { ... } 상수 선언됨 (PR #553)');

// 2-2: LBKUM: ['BASE_UOM'] 매핑
assertMatch(htmlSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES\s*=\s*\{[\s\S]{0,500}['"]LBKUM['"]\s*:\s*\[\s*['"]BASE_UOM['"]\s*\]/,
    "2-2: MFG_COLUMN_FIELD_POST_DEPENDENCIES['LBKUM'] = ['BASE_UOM'] 매핑 (LBKUM 뒤에 BASE_UOM 자동 추가)");

// 2-3: BASE_UOM 자체는 POST_DEPENDENCIES 키 아님 (Q3(a) 승인 — 평범한 dim)
assertNoMatch(htmlSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES\s*=\s*\{[\s\S]{0,500}['"]BASE_UOM['"]\s*:/,
    '2-3: BASE_UOM 은 POST_DEPENDENCIES 키 아님 (Q3(a) 승인 — 평범한 dim 으로 동작)');

// 2-4: 상수 선언 위쪽 주석에 설계 메모 (PR #553 / 설정 테이블 / 영역 가드)
const _declIdx = htmlSrc.indexOf('const MFG_COLUMN_FIELD_POST_DEPENDENCIES');
const _declPrelude = _declIdx >= 0 ? htmlSrc.substring(Math.max(0, _declIdx - 3000), _declIdx) : '';
assertMatch(_declPrelude,
    /PR #553|POST dependency|\uc124\uc815 \ud14c\uc774\ube14|manufacturing-cost|\uc601\uc5ed \uac00\ub4dc/,
    '2-4: MFG_COLUMN_FIELD_POST_DEPENDENCIES 선언 위쪽 주석에 설계 메모 (PR #553 / POST dependency / 영역 가드)');

// ============================================================
// 3. _MFG_FIXED_AGG_COLUMNS 에 LBKUM 추가 (SUM 고정 + 뱃지 제거)
// ============================================================

// 3-1: Set 안에 'LBKUM' 포함 (문자열 리터럴)
assertMatch(htmlSrc,
    /_MFG_FIXED_AGG_COLUMNS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]LBKUM['"]/,
    "3-1: _MFG_FIXED_AGG_COLUMNS Set 에 'LBKUM' 추가 (SUM 고정 + 뱃지 제거)");

// 3-2: LBKUM 추가 주석 (PR #553 / Q2(a) / 생산수량)
assertMatch(htmlSrc,
    /['"]LBKUM['"]\s*,?\s*\/\/[^\n]*(\uc0dd\uc0b0\uc218\ub7c9|\ub9e4\ucd9c\uc218\ub7c9)/,
    '3-2: _MFG_FIXED_AGG_COLUMNS 안 LBKUM 에 "생산수량/매출수량" 주석');

// 3-3: _MFG_FIXED_AGG_COLUMNS 안 LBKUM 추가 지점 근처에 PR #553 / Q2(a) 참조
const _aggIdx = htmlSrc.indexOf('_MFG_FIXED_AGG_COLUMNS');
const _aggSrc = _aggIdx >= 0 ? htmlSrc.substring(_aggIdx, _aggIdx + 1500) : '';
assertMatch(_aggSrc,
    /PR #553|Q2\(a\)/,
    '3-3: _MFG_FIXED_AGG_COLUMNS 안 LBKUM 추가 지점에 PR #553 / Q2(a) 설계 메모');

// ============================================================
// 4. addField() 함수 안의 POST dependency 처리 로직
// ============================================================

// addField 함수 블록 추출
const addFieldMatch = htmlSrc.match(/function\s+addField\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addFieldMatch, '4-0: addField(colName) 함수 블록 추출됨');
const addFieldSrc = addFieldMatch ? addFieldMatch[0] : '';

// 4-1: addField 안에서 MFG_COLUMN_FIELD_POST_DEPENDENCIES 참조
assertMatch(addFieldSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES/,
    '4-1: addField 안에서 MFG_COLUMN_FIELD_POST_DEPENDENCIES 참조');

// 4-2: Array.isArray(MFG_COLUMN_FIELD_POST_DEPENDENCIES[colName]) 안전 체크
assertMatch(addFieldSrc,
    /Array\.isArray\s*\(\s*MFG_COLUMN_FIELD_POST_DEPENDENCIES\s*\[\s*colName\s*\]\s*\)/,
    '4-2: Array.isArray(MFG_COLUMN_FIELD_POST_DEPENDENCIES[colName]) 안전 체크 (매핑 없으면 skip)');

// 4-3: for-of 루프로 _postName 순회
assertMatch(addFieldSrc,
    /for\s*\(\s*const\s+_postName\s+of\s+MFG_COLUMN_FIELD_POST_DEPENDENCIES\s*\[\s*colName\s*\]\s*\)/,
    '4-3: for (const _postName of MFG_COLUMN_FIELD_POST_DEPENDENCIES[colName]) 순회');

// 4-4: 중복 체크 (앞쪽 dependency 와 동일 패턴)
assertMatch(addFieldSrc,
    /selectedFields\.find\s*\(\s*f\s*=>\s*f\.column\s*===\s*_postName\s*&&\s*!f\.aggregate\s*\)/,
    '4-4: 중복 체크 패턴 (selectedFields.find column === _postName && !aggregate)');

// 4-5: 메타 조회 — allColumns 에서 c.name === _postName
assertMatch(addFieldSrc,
    /allColumns\.find\s*\(\s*c\s*=>\s*c\.name\s*===\s*_postName\s*\)/,
    '4-5: 메타 조회 — allColumns.find(c => c.name === _postName)');

// 4-6: 메타 없으면 조용히 skip (사이드바에 없는 컬럼은 자동 추가 안 함)
assertMatch(addFieldSrc,
    /if\s*\(\s*!_postCol\s*\)\s*continue/,
    '4-6: 메타 없으면 조용히 skip (if (!_postCol) continue)');

// 4-7: self push 바로 뒤에 POST 처리 (self 가 먼저 push 되어야 LBKUM "뒤에" BASE_UOM 이 옴)
//      → selectedFields.push(newField) 와 POST 처리 블록이 가까이 (순서) 있어야 함
const selfPushIdx = addFieldSrc.indexOf('selectedFields.push(newField)');
const postBlockIdx = addFieldSrc.indexOf('MFG_COLUMN_FIELD_POST_DEPENDENCIES');
assert(selfPushIdx >= 0 && postBlockIdx >= 0 && postBlockIdx > selfPushIdx,
    `4-7: POST dependency 처리(idx=${postBlockIdx}) 가 selectedFields.push(newField)(idx=${selfPushIdx}) 뒤에 위치 (LBKUM 뒤에 BASE_UOM)`);

// 4-8: _autoAddedCount 증가 (snackbar 메시지에서 자동 추가 개수 반영)
assertMatch(addFieldSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES[\s\S]{0,1000}_autoAddedCount\+\+/,
    '4-8: POST dependency 처리 후 _autoAddedCount++ (snackbar 메시지에 반영)');

// ============================================================
// 5. 영역 격리 — 수익성분석 영역 완전 무영향 재검증
// ============================================================

// 5-1: MFG_COLUMN_FIELD_POST_DEPENDENCIES 사용은 반드시 _isMfgArea 가드 뒤에서
//      → addField 안의 _isMfgArea 체크 블록 안에서만 참조됨
const _isMfgCheckIdx = addFieldSrc.indexOf('_currentBuilderArea');
assert(_isMfgCheckIdx >= 0,
    '5-1a: addField 안에 _currentBuilderArea() 영역 가드 존재');

// POST 처리가 _isMfgArea 체크 "뒤" 에 오는지 확인 (호출 순서)
const _postRefIdx = addFieldSrc.indexOf('MFG_COLUMN_FIELD_POST_DEPENDENCIES');
assert(_isMfgCheckIdx < _postRefIdx,
    `5-1b: _isMfgArea 가드(idx=${_isMfgCheckIdx}) 가 POST_DEPENDENCIES 참조(idx=${_postRefIdx}) 보다 앞 — 영역 가드 안에서만 처리`);

// 5-2: MFG_COLUMN_FIELD_POST_DEPENDENCIES 가 _depColNames 분기 내부에만 위치
//      (= 이 분기는 _isMfgArea 가 true 일 때만 _depColNames 가 non-null → POST 처리도 자동으로 영역 격리)
// _depColNames 분기 추출: if (_depColNames) { ... }
const depBlockMatch = addFieldSrc.match(/if\s*\(\s*_depColNames\s*\)\s*\{[\s\S]*?\n\s{4}\}/);
assert(!!depBlockMatch, '5-2a: if (_depColNames) { ... } 블록 추출됨');
const depBlockSrc = depBlockMatch ? depBlockMatch[0] : '';
assertMatch(depBlockSrc,
    /MFG_COLUMN_FIELD_POST_DEPENDENCIES/,
    '5-2b: POST dependency 처리가 if (_depColNames) { ... } 분기 내부에 위치 (영역 격리 자동 보장)');

// ============================================================
// 6. 사용자 요구 순서 재검증 (문서화 성격)
// ============================================================

// 6-1: _MFG_COST_ELEMENT_DEPS 공통 상수의 순서 재확인 (사용자 명시)
//      CALMONTH → PLANT → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN
assertMatch(htmlSrc,
    /_MFG_COST_ELEMENT_DEPS\s*=\s*\[\s*['"]CALMONTH['"]\s*,\s*['"]PLANT['"]\s*,\s*['"]MATERIAL['"]\s*,\s*['"]MATERIAL_NM['"]\s*,\s*['"]ZCGUBUN_D['"]\s*,\s*['"]ZCGUBUN['"]\s*\]/,
    '6-1 [v5]: _MFG_COST_ELEMENT_DEPS = [CALMONTH, PLANT, MATERIAL, MATERIAL_NM, ZCGUBUN_D, ZCGUBUN] 순서 보존 (v5: MATERIAL 추가, MATERIAL_NM 앞)');

// 6-2: 최종 동작 순서 요약 — 주석에 사용자 명시 순서 기록
assertMatch(htmlSrc,
    /CALMONTH\s*(→|->|-->)\s*PLANT\s*(→|->|-->)\s*MATERIAL_NM\s*(→|->|-->)\s*ZCGUBUN_D\s*(→|->|-->)\s*ZCGUBUN\s*(→|->|-->)\s*\[?LBKUM[\s\S]{0,100}BASE_UOM/,
    '6-2: 주석에 사용자 명시 최종 순서 기록 (CALMONTH → PLANT → MATERIAL_NM → ZCGUBUN_D → ZCGUBUN → [LBKUM] → BASE_UOM)');

// ============================================================
// 결과 출력
// ============================================================
console.log('');
console.log('==================================================');
console.log(`BUILDER LBKUM DEPENDENCY TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
