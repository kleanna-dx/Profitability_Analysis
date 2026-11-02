// ============================================================
// test_builder_field_group.mjs
// ------------------------------------------------------------
// 사용자 요구:
//   제조원가 VQB 사이드바에서 '플랜트 코드'(PLANT) 와 '플랜트명'(PLANT_NM)
//   을 **하나의 묶음 항목** 으로 표시. 더블클릭하면 두 컬럼이 모두
//   조회필드에 추가되도록.
//
// 사용자 승인 설계 (4가지 결정):
//   Q1. 접근 방식  : 옵션 A (가상 묶음 컬럼 + 설정 테이블 패턴)
//   Q2. 라벨       : (b) "플랜트 (코드/명)"
//   Q3. 개별 항목  : (a) 완전 숨김 (묶음 항목만 노출)
//   Q4. 중복 체크  : (a) 없는 것만 추가 (addField 기존 중복 체크 재사용)
//
// 설계 — Field Group 설정 테이블 패턴:
//   const MFG_FIELD_GROUPS = {
//       '__GROUP__PLANT_PAIR': {
//           label: '플랜트 (코드/명)',
//           category: 'org',
//           type: 'text',
//           members: ['PLANT', 'PLANT_NM'],
//           synonyms: ['플랜트', '공장', ...],
//       },
//   };
//   향후 다른 묶음(자재 코드/명 등)도 이 상수에만 항목 추가하면 됨.
//
// 수정 지점:
//   1. MFG_FIELD_GROUPS 상수 신설 (라인 ~1858)
//   2. _MFG_FIELD_GROUP_MEMBERS 자동 계산 (멤버 숨김 Set)
//   3. loadColumns() : 영역이 manufacturing-cost 일 때 가상 묶음 컬럼
//                      allColumns 에 삽입
//   4. isHiddenInBuilderSidebar() : 묶음 멤버는 제조원가 영역에서 숨김
//                                    (가상 묶음 컬럼 자체는 노출 유지)
//   5. addFieldByClick() : '__GROUP__' 접두사 분기 → 멤버 순차 addField
//
// 영역 격리:
//   수익성분석(profitability) 영역에서는:
//     - loadColumns 가 가상 묶음 컬럼 삽입 안 함 (영역 가드)
//     - isHiddenInBuilderSidebar 는 기존 숨김 정책 그대로 적용
//     - '__GROUP__' name 자체가 존재하지 않으므로 addFieldByClick 분기도 無
//   → 완전 무영향.
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
// 1. MFG_FIELD_GROUPS 상수 신설 검증
// ============================================================

// 1-1: 상수 선언
assertMatch(htmlSrc,
    /const\s+MFG_FIELD_GROUPS\s*=\s*\{/,
    '1-1: const MFG_FIELD_GROUPS = { ... } 상수 선언됨');

// 1-2: '__GROUP__PLANT_PAIR' 키 등록 (가상 묶음 name 접두사 '__GROUP__' 규칙)
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,500}['"]__GROUP__PLANT_PAIR['"]\s*:\s*\{/,
    '1-2: __GROUP__PLANT_PAIR 키가 등록됨 (가상 묶음 접두사 __GROUP__ 규칙)');

// 1-3: 라벨 "플랜트 (코드/명)" (사용자 Q2-b 승인)
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,800}label\s*:\s*['"]플랜트\s*\(코드\/명\)['"]/,
    '1-3: label 이 "플랜트 (코드/명)" 로 지정됨 (사용자 Q2-b 승인)');

// 1-4: category 'org' (사이드바 "조직/사업부" 그룹에 노출)
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,800}category\s*:\s*['"]org['"]/,
    '1-4: category 가 "org" 로 지정됨 (조직/사업부 카테고리)');

// 1-5: members 배열에 PLANT 와 PLANT_NM 포함
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,800}members\s*:\s*\[\s*['"]PLANT['"]\s*,\s*['"]PLANT_NM['"]\s*\]/,
    '1-5: members 가 ["PLANT", "PLANT_NM"] 순서로 등록됨');

// 1-6: synonyms 배열에 '플랜트', '공장' 등 검색 매칭용 동의어 포함
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,1000}synonyms\s*:\s*\[[\s\S]{0,200}['"]플랜트['"]/,
    '1-6: synonyms 에 "플랜트" 포함 (검색 매칭용)');

// ─────────────────────────────────────────────────────────────────
// 1-A. 제품군 묶음 (__GROUP__DIVISION_PAIR) 등록 검증 [2026-10-30 add]
//   운영 라벨 (sql/050_seed_cost_ontology.sql):
//     - DIVISION    = '제품군' (SAP CHAR 2)
//     - DIVISION_NM = '제품군 명 (⚠️ 필터에 사용 금지 — DIVISION 코드 사용)' (SAP CHAR 40)
//   사용자 승인 설계:
//     Q1. 라벨 = (a) '제품군 (코드/명)' (PLANT 묶음과 통일된 패턴)
//     Q2. 범위 = 제품군만 (자재는 이번 턴 제외)
// ─────────────────────────────────────────────────────────────────

// 1-A-1: '__GROUP__DIVISION_PAIR' 키 등록
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,2000}['"]__GROUP__DIVISION_PAIR['"]\s*:\s*\{/,
    '1-A-1: __GROUP__DIVISION_PAIR 키가 MFG_FIELD_GROUPS 에 등록됨');

// 1-A-2: label '제품군 (코드/명)' (사용자 Q1-a 승인, PLANT 묶음과 통일 패턴)
assertMatch(htmlSrc,
    /__GROUP__DIVISION_PAIR[\s\S]{0,500}label\s*:\s*['"]제품군\s*\(코드\/명\)['"]/,
    '1-A-2: label 이 "제품군 (코드/명)" 로 지정됨 (사용자 Q1-a 승인, PLANT 묶음과 통일 패턴)');

// 1-A-3: category 'org' (DIVISION 과 동일 카테고리, server.mjs:16886)
assertMatch(htmlSrc,
    /__GROUP__DIVISION_PAIR[\s\S]{0,500}category\s*:\s*['"]org['"]/,
    '1-A-3: category 가 "org" 로 지정됨 (DIVISION 과 동일 카테고리)');

// 1-A-4: members 배열에 DIVISION 와 DIVISION_NM 순서로
assertMatch(htmlSrc,
    /__GROUP__DIVISION_PAIR[\s\S]{0,500}members\s*:\s*\[\s*['"]DIVISION['"]\s*,\s*['"]DIVISION_NM['"]\s*\]/,
    '1-A-4: members 가 ["DIVISION", "DIVISION_NM"] 순서로 등록됨');

// 1-A-5: synonyms 에 '제품군' 포함 (검색 매칭용)
assertMatch(htmlSrc,
    /__GROUP__DIVISION_PAIR[\s\S]{0,600}synonyms\s*:\s*\[[\s\S]{0,200}['"]제품군['"]/,
    '1-A-5: synonyms 에 "제품군" 포함 (검색 매칭용)');

// 1-7: 설계 원칙 주석 — 설정 테이블 / 영역 가드 / 중복 체크 언급
assertMatch(htmlSrc,
    /MFG_FIELD_GROUPS[\s\S]{0,3000}(설정 테이블|Field Group|manufacturing-cost|\uc911\ubcf5 \uccb4\ud06c)/,
    '1-7: 상수 근처에 설계 원칙 주석 존재 (설정 테이블 / 영역 가드 / 중복 체크)');

// 1-8: _MFG_FIELD_GROUP_MEMBERS Set 자동 계산 (숨김 판정용)
assertMatch(htmlSrc,
    /const\s+_MFG_FIELD_GROUP_MEMBERS\s*=\s*new\s+Set\s*\(\s*\)/,
    '1-8: _MFG_FIELD_GROUP_MEMBERS Set 자동 계산 로직 존재');

assertMatch(htmlSrc,
    /Object\.values\s*\(\s*MFG_FIELD_GROUPS\s*\)\s*\.forEach[\s\S]{0,300}_MFG_FIELD_GROUP_MEMBERS\.add/,
    '1-8b: 묶음 멤버들이 _MFG_FIELD_GROUP_MEMBERS 에 자동 추가됨 (상수 변경만으로 반영)');

// ============================================================
// 2. loadColumns() 가상 묶음 컬럼 삽입 로직 검증
// ============================================================

// loadColumns 함수 블록 발췌
const loadColsMatch = htmlSrc.match(/async\s+function\s+loadColumns\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!loadColsMatch, '2-0: loadColumns() 함수 블록 추출됨');
const loadColsSrc = loadColsMatch ? loadColsMatch[0] : '';

// 2-1: 영역 가드 — areaParam === 'manufacturing-cost' 일 때만 삽입
assertMatch(loadColsSrc,
    /areaParam\s*===\s*['"]manufacturing-cost['"]/,
    '2-1: 영역 가드 — areaParam === "manufacturing-cost" 일 때만 가상 묶음 삽입');

// 2-2: MFG_FIELD_GROUPS 를 Object.entries 로 순회
assertMatch(loadColsSrc,
    /Object\.entries\s*\(\s*MFG_FIELD_GROUPS\s*\)/,
    '2-2: MFG_FIELD_GROUPS 를 Object.entries 로 순회 (상수 추가만으로 자동 반영)');

// 2-3: 멤버 가용성 검사 (서버 응답에 실제 존재하는 멤버만)
assertMatch(loadColsSrc,
    /availableMembers\s*=\s*\(\s*groupDef\.members[\s\S]{0,300}existingColNames\.has/,
    '2-3: 멤버 중 서버 응답에 실제 존재하는 것(availableMembers) 만 유효');

// 2-4: 가용 멤버 0개면 가상 항목도 skip (안전 가드)
assertMatch(loadColsSrc,
    /availableMembers\.length\s*===\s*0[\s\S]{0,100}return/,
    '2-4: 가용 멤버가 하나도 없으면 가상 묶음 삽입 skip (안전 가드)');

// 2-5: 중복 삽입 금지 (loadColumns 재호출 안전)
assertMatch(loadColsSrc,
    /allColumns\.some\s*\(\s*c\s*=>\s*c\.name\s*===\s*groupName\s*\)[\s\S]{0,100}return/,
    '2-5: 이미 같은 묶음 name 이 있으면 중복 삽입 skip (재호출 안전)');

// 2-6: allColumns.push 로 가상 묶음 컬럼 삽입
assertMatch(loadColsSrc,
    /allColumns\.push\s*\(\s*\{[\s\S]{0,500}name\s*:\s*groupName[\s\S]{0,500}is_group\s*:\s*true/,
    '2-6: 가상 묶음 컬럼이 allColumns.push 로 삽입 (is_group:true 플래그 포함)');

// 2-7: group_members 저장 (addFieldByClick 에서 사용)
assertMatch(loadColsSrc,
    /group_members\s*:\s*availableMembers/,
    '2-7: group_members 필드에 가용 멤버 목록 저장 (addFieldByClick 재사용)');

// ============================================================
// 3. isHiddenInBuilderSidebar() — 묶음 멤버 숨김 검증
// ============================================================

// isHiddenInBuilderSidebar 함수 블록 발췌
const hideSidebarMatch = htmlSrc.match(/function\s+isHiddenInBuilderSidebar\s*\(\s*name\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!hideSidebarMatch, '3-0: isHiddenInBuilderSidebar(name) 함수 블록 추출됨');
const hideSidebarSrc = hideSidebarMatch ? hideSidebarMatch[0] : '';

// 3-1: manufacturing-cost 영역에서 _MFG_FIELD_GROUP_MEMBERS 참조
assertMatch(hideSidebarSrc,
    /manufacturing-cost[\s\S]{0,500}_MFG_FIELD_GROUP_MEMBERS\.has/,
    '3-1: manufacturing-cost 영역에서 _MFG_FIELD_GROUP_MEMBERS Set 으로 멤버 숨김 판정');

// 3-2: '__GROUP__' 접두사 가진 가상 묶음 컬럼은 숨기지 않음 (사이드바에 노출돼야 함)
assertMatch(hideSidebarSrc,
    /__GROUP__[\s\S]{0,200}return\s+true/,
    '3-2: 묶음 멤버는 return true (숨김), 가상 묶음 자체(__GROUP__)는 숨기지 않음');

assertMatch(hideSidebarSrc,
    /!u\.startsWith\s*\(\s*['"]__GROUP__['"]\s*\)/,
    '3-2b: 가상 묶음 컬럼(__GROUP__ 접두사)은 숨김 대상에서 제외');

// 3-3: manufacturing-cost 영역 분기 후 기존 수익성분석 숨김 정책은 유지
//      (분기 끝에 return false — 즉 다른 숨김은 적용 안 함)
assertMatch(hideSidebarSrc,
    /manufacturing-cost[\s\S]{0,600}return\s+false\s*;/,
    '3-3: manufacturing-cost 영역에서 묶음 멤버 외에는 숨김 안 함 (기존 정책 유지)');

// 3-4: 수익성분석 영역용 기존 BUILDER_HIDDEN_SIDEBAR_FIELDS 체크 보존 (회귀 방지)
assertMatch(hideSidebarSrc,
    /BUILDER_HIDDEN_SIDEBAR_FIELDS\.has\s*\(\s*u\s*\)/,
    '3-4: 수익성분석용 BUILDER_HIDDEN_SIDEBAR_FIELDS 숨김 정책 보존 (회귀 방지)');

// ============================================================
// 4. addFieldByClick() 묶음 분기 검증
// ============================================================

// addFieldByClick 함수 블록 발췌
const addClickMatch = htmlSrc.match(/function\s+addFieldByClick\s*\(\s*colName\s*\)\s*\{[\s\S]*?\n\}/);
assert(!!addClickMatch, '4-0: addFieldByClick(colName) 함수 블록 추출됨');
const addClickSrc = addClickMatch ? addClickMatch[0] : '';

// 4-1: '__GROUP__' 접두사 분기
assertMatch(addClickSrc,
    /colName\.startsWith\s*\(\s*['"]__GROUP__['"]\s*\)/,
    '4-1: colName 이 "__GROUP__" 로 시작하면 묶음 분기 진입');

// 4-2: col.is_group + col.group_members 조건
assertMatch(addClickSrc,
    /col\.is_group[\s\S]{0,200}Array\.isArray\s*\(\s*col\.group_members\s*\)/,
    '4-2: col.is_group + Array.isArray(col.group_members) 안전 체크');

// 4-3: 각 멤버에 대해 addField() 순차 호출 (중복 체크는 addField 가 수행)
assertMatch(addClickSrc,
    /col\.group_members\.forEach[\s\S]{0,200}addField\s*\(\s*memberName\s*\)/,
    '4-3: group_members.forEach 로 각 멤버에 addField() 호출 (addField 자체 중복 체크 재사용)');

// 4-4: 묶음 분기 완료 후 return (일반 addField 중복 호출 방지)
assertMatch(addClickSrc,
    /col\.group_members\.forEach[\s\S]{0,400}return\s*;/,
    '4-4: 묶음 분기 끝에서 return 하여 일반 addField 중복 호출 방지');

// 4-5: 일반 non-group 더블클릭은 기존 그대로 addField(colName) 호출
assertMatch(addClickSrc,
    /addField\s*\(\s*colName\s*\)\s*;?\s*\}\s*$/,
    '4-5: 일반 non-group 더블클릭은 기존 그대로 addField(colName) 호출 (회귀 방지)');

// ============================================================
// 5. 영역 격리 — 수익성분석(profitability) 완전 무영향 검증
// ============================================================

// 5-1: MFG_FIELD_GROUPS 는 영역 가드 뒤에서만 사용됨
//      (areaParam === 'manufacturing-cost' 분기 안에서만 Object.entries(MFG_FIELD_GROUPS) 호출)
assertMatch(htmlSrc,
    /areaParam\s*===\s*['"]manufacturing-cost['"][\s\S]{0,500}Object\.entries\s*\(\s*MFG_FIELD_GROUPS\s*\)/,
    '5-1: MFG_FIELD_GROUPS 사용은 반드시 manufacturing-cost 영역 가드 뒤에서만');

// 5-2: _MFG_FIELD_GROUP_MEMBERS 숨김도 manufacturing-cost 영역 가드 뒤에서만
assertMatch(hideSidebarSrc,
    /_area\s*===\s*['"]manufacturing-cost['"][\s\S]{0,500}_MFG_FIELD_GROUP_MEMBERS/,
    '5-2: _MFG_FIELD_GROUP_MEMBERS 숨김도 manufacturing-cost 영역 가드 뒤에서만 작동');

// ============================================================
// 6. 회귀 방지 — 기존 로직 보존 검증
// ============================================================

// 6-1: PR #543 의 MFG_METRIC_FIELD_DEPENDENCIES / UNIT_COST 는 그대로 유지
assertMatch(htmlSrc,
    /MFG_METRIC_FIELD_DEPENDENCIES[\s\S]{0,500}['"]UNIT_COST['"]\s*:\s*\[\s*['"]PLANT['"]\s*,\s*['"]ZCGUBUN['"]\s*,\s*['"]ZCGUBUN_D['"]\s*\]/,
    '6-1: PR #543 의 UNIT_COST dependency 매핑 보존 (회귀 방지)');

// 6-2: renderFieldList 는 수정 없음 — 가상 묶음 항목이 non-metric 분기로 자연스럽게 렌더링
assertMatch(htmlSrc,
    /ondblclick\s*=\s*"addFieldByClick\s*\(\s*'\$\{c\.name\}'\s*\)"/,
    '6-2: renderFieldList 는 수정 없이 가상 묶음도 ondblclick="addFieldByClick(c.name)" 로 렌더링');

// 6-3: filterFields 는 수정 없음 — synonyms 가 c.synonyms 로 매칭되어 자동 지원
assertMatch(htmlSrc,
    /c\.synonyms\s*&&\s*Array\.isArray\s*\(\s*c\.synonyms\s*\)[\s\S]{0,200}c\.synonyms\.some\s*\(\s*s\s*=>\s*match\s*\(\s*s\s*\)\s*\)/,
    '6-3: filterFields 가 c.synonyms 로 검색 매칭 (가상 묶음도 synonyms 로 자동 지원)');

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
