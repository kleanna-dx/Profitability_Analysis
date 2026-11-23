// ============================================================
// test_nm_like_rule.mjs
//
// [목적] BASE_SYSTEM_PROMPT 의 "명칭(_NM) 컬럼 조건 생성 규칙" 블록
//        존재 및 핵심 요건 검증.
//
// [배경] 2026-11-23 사용자 요구 (명시):
//   - "_NM 으로 끝나는 명칭 컬럼은 기본적으로 = 가 아니라 LIKE '%검색어%' 를 사용한다"
//   - "사용자 질의 자연어로 입력된 값은 DB 실제 명칭과 완전히 동일하지 않을 수 있으므로
//      부분 일치를 우선한다"
//   - "코드/ID 컬럼만 기본적으로 = 를 사용한다"
//   - "_NM 컬럼에 = 조건을 임의로 생성하지 않는다"
//
//   예시:
//     사용자 질의: "깨끗한나라 제품 중 매출이 가장 높은 SKU 10개를 알려줘."
//     DB 실제 값: "반제품(깨끗한나라)", "상품(깨끗한나라)", "제품(깨끗한나라)"
//     올바른 SQL: MATL_TYPE_NM LIKE '%제품%'
//     잘못된 SQL: MATL_TYPE_NM = '제품'
//
// [수정 지점]
//   BASE_SYSTEM_PROMPT (nlq-server/server.mjs L2456~) 내
//   기존 "자재명/고객명 공백 무시 검색 규칙" 블록을 확장:
//     - 모든 _NM 컬럼 기본 LIKE 규칙을 상위에 선언
//     - 기존 MATERIAL_NM / CUSTOMER_NM REPLACE+LIKE 규칙은 특수 하위 규칙으로 유지
//
// [적용 범위]
//   BASE_SYSTEM_PROMPT 는 buildRAGSystemPrompt / analysis plan phase /
//   aggregate 경로 모두에서 import 되므로, 블록 1개 수정으로 전 경로에 자동 반영.
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, '..', 'server.mjs');
const serverSrc = fs.readFileSync(serverPath, 'utf-8');

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
    assert(regex.test(src), `${label}\n  regex: ${regex}`);
}
function assertNoMatch(src, regex, label) {
    assert(!regex.test(src), `${label}\n  regex (should NOT match): ${regex}`);
}

// ============================================================
// 1. "명칭(_NM) 컬럼 조건 생성 규칙" 블록 존재
// ============================================================

// 1-1: 신규 블록 헤더 (Name Column Rule)
assertMatch(serverSrc,
    /\[★★★★★\s*명칭\(_NM\)\s*컬럼\s*조건\s*생성\s*규칙\s*\(Name\s*Column\s*Rule\)\s*—\s*최상위\s*우선순위\s*★★★★★\]/,
    '1-1: 신규 블록 헤더 "[★★★★★ 명칭(_NM) 컬럼 조건 생성 규칙 (Name Column Rule) — 최상위 우선순위 ★★★★★]" 존재');

// 1-2: 핵심 원칙 선언 — _NM 은 기본 LIKE '%검색어%'
assertMatch(serverSrc,
    /_NM[\s"']*으로\s*끝나는\s*명칭\s*컬럼은\s*기본적으로[\s\S]{0,100}LIKE\s*'%검색어%'/,
    '1-2: 핵심 선언 "_NM 으로 끝나는 명칭 컬럼은 기본적으로 ... LIKE \'%검색어%\' 를 사용"');

// 1-3: 부분 일치 우선 이유 명시
assertMatch(serverSrc,
    /DB\s*실제\s*명칭과\s*완전히\s*동일하지\s*않을\s*수\s*있으므로[\s\S]{0,100}부분\s*일치/,
    '1-3: "DB 실제 명칭과 완전히 동일하지 않을 수 있으므로 부분 일치" 이유 명시');

// 1-4: 코드/ID 컬럼은 = 사용 원칙
assertMatch(serverSrc,
    /코드\/ID\s*컬럼[\s\S]{0,200}기본\s*['"=]+/,
    '1-4: "코드/ID 컬럼은 기본 = 사용" 원칙 명시');

// 1-5: "_NM 컬럼에 '=' 조건을 임의로 생성하지 마세요"
assertMatch(serverSrc,
    /_NM\s*컬럼에\s*['"]=['"]\s*조건을\s*임의로\s*생성하지\s*마세요/,
    '1-5: "_NM 컬럼에 \'=\' 조건을 임의로 생성하지 마세요" 명시');

// ============================================================
// 2. 대상 _NM 컬럼 열거 및 예시
// ============================================================

// 2-1: 적용 대상 _NM 컬럼 열거 (수익성분석 bw_profitability_data 전수)
const requiredNmColumns = [
    'PLANT_NM', 'MATL_TYPE_NM', 'SALES_OFF_NM', 'PROFIT_CTR_NM',
    'PRODH1_NM', 'PRODH2_NM', 'PRODH3_NM', 'PRODH4_NM',
    'BIC_ZJPCODE_NM', 'BIC_ZBRAND_NM', 'BIC_ZSBRAND_NM',
    'BILL_TYPE_NM', 'INCOTERMS_NM',
    'CUST_GROUP_NM', 'CUST_GRP1_NM', 'ZZKVGR7_NM',
    'COUNTRY_NM', 'BIC_ZKUNN2_NM',
    'MATL_GROUP_NM', 'CO_AREA_NM', 'DISTR_CHAN_NM',
];
// 블록 내부에 해당 컬럼이 열거되어 있는지 확인
const blockStart = serverSrc.indexOf('[★★★★★ 명칭(_NM) 컬럼 조건 생성 규칙');
const blockEnd = serverSrc.indexOf('[★★★ 최우선 규칙 — 컬럼명 사용', blockStart);
const blockText = (blockStart >= 0 && blockEnd > blockStart) ? serverSrc.slice(blockStart, blockEnd) : '';
assert(blockText.length > 500, '2-0: "명칭(_NM) 컬럼 조건 규칙" 블록 본문 추출 가능 (500자 이상)');

for (const col of requiredNmColumns) {
    assert(blockText.includes(col),
        `2-1: 대상 _NM 컬럼 "${col}" 가 규칙 블록 내 열거 목록에 포함`);
}

// 2-2: 코드/ID 컬럼 (대비 명시)
const requiredCodeColumns = [
    'DIVISION', 'PLANT', 'MATERIAL', 'MATL_TYPE',
    'PROFIT_CTR', 'SALES_OFF', 'CUSTOMER',
];
for (const col of requiredCodeColumns) {
    // 코드 컬럼 목록 — 블록 내 "코드/ID 컬럼" 섹션에 포함되어야 함
    // (단, MATERIAL 은 MATERIAL_NM 과 구분해야 하므로 \b 경계 확인)
    const codeRegex = new RegExp(`\\b${col}\\b(?!_NM|_NAME)`, 'g');
    assert(codeRegex.test(blockText),
        `2-2: 코드/ID 컬럼 "${col}" 가 규칙 블록 내 열거 목록에 포함`);
}

// 2-3: 사용자 신고 예시 (깨끗한나라 제품) 포함
assertMatch(blockText,
    /MATL_TYPE_NM\s*LIKE\s*'%제품%'/,
    '2-3: 사용자 신고 예시 "MATL_TYPE_NM LIKE \'%제품%\'" 정답 패턴 포함');

assertMatch(blockText,
    /반제품\(깨끗한나라\)[\s\S]{0,100}상품\(깨끗한나라\)[\s\S]{0,100}제품\(깨끗한나라\)/,
    '2-4: DB 실제값 예시 "반제품(깨끗한나라) / 상품(깨끗한나라) / 제품(깨끗한나라)" 포함');

// 2-5: 잘못된 패턴 예시 (= '제품') 포함
assertMatch(blockText,
    /MATL_TYPE_NM\s*=\s*'제품'/,
    '2-5: 잘못된 패턴 예시 "MATL_TYPE_NM = \'제품\'" 금지 사례 포함');

// ============================================================
// 3. 정답/금지 패턴 예시
// ============================================================

// 3-1: 정답 패턴 - PLANT_NM LIKE
assertMatch(blockText,
    /WHERE\s+PLANT_NM\s+LIKE\s+'%[^']+%'/,
    '3-1: 정답 패턴 - PLANT_NM LIKE \'%값%\' 예시 포함');

// 3-2: 정답 패턴 - SALES_OFF_NM LIKE
assertMatch(blockText,
    /WHERE\s+SALES_OFF_NM\s+LIKE\s+'%[^']+%'/,
    '3-2: 정답 패턴 - SALES_OFF_NM LIKE \'%값%\' 예시 포함');

// 3-3: 정답 패턴 - PROFIT_CTR_NM LIKE
assertMatch(blockText,
    /WHERE\s+PROFIT_CTR_NM\s+LIKE\s+'%[^']+%'/,
    '3-3: 정답 패턴 - PROFIT_CTR_NM LIKE \'%값%\' 예시 포함');

// 3-4: 금지 패턴 - _NM = '값'
assertMatch(blockText,
    /WHERE\s+PLANT_NM\s*=\s*'[^']+'/,
    '3-4: 금지 패턴 - PLANT_NM = \'값\' 예시 (절대 금지로 명시)');

// 3-5: 금지 패턴 섹션 헤더
assertMatch(blockText,
    /절대\s*금지\s*패턴[\s\S]{0,100}_NM\s*컬럼에\s*['"=]+/,
    '3-5: "절대 금지 패턴 (_NM 컬럼에 = 를 임의 생성)" 섹션 명시');

// ============================================================
// 4. 기존 MATERIAL_NM / CUSTOMER_NM 특수 규칙 유지
// ============================================================

// 4-1: 특수 하위 규칙 헤더 존재
assertMatch(serverSrc,
    /\[자재명\/고객명\s*공백\s*무시\s*검색\s*규칙\s*—\s*특수\s*하위\s*규칙\s*\(기존\s*유지\)\]/,
    '4-1: 특수 하위 규칙 블록 헤더 유지 ("기존 유지" 표기 포함)');

// 4-2: MATERIAL_NM REPLACE+LIKE 패턴 유지
assertMatch(serverSrc,
    /REPLACE\(MATERIAL_NM,\s*'\s*',\s*''\)\s*LIKE\s*'%[^']+%'/,
    '4-2: MATERIAL_NM 특수 규칙 - REPLACE(MATERIAL_NM, \' \', \'\') LIKE \'%값%\' 유지');

// 4-3: CUSTOMER_NM REPLACE+LIKE 패턴 유지
assertMatch(serverSrc,
    /REPLACE\(CUSTOMER_NM,\s*'\s*',\s*''\)\s*LIKE\s*'%[^']+%'/,
    '4-3: CUSTOMER_NM 특수 규칙 - REPLACE(CUSTOMER_NM, \' \', \'\') LIKE \'%값%\' 유지');

// 4-4: 기존 예시 "순수소프티100매" / "메디프렌즈" 유지 (regression 방지)
assertMatch(serverSrc,
    /순수소프티100매/,
    '4-4: 기존 예시 "순수소프티100매" 유지 (기존 테스트 regression 방지)');
assertMatch(serverSrc,
    /메디프렌즈/,
    '4-5: 기존 예시 "메디프렌즈" 유지 (기존 테스트 regression 방지)');

// ============================================================
// 5. 공통 적용 범위 섹션 — 통합 적용 범위 재정의
// ============================================================

// 5-1: 공통 적용 범위 섹션 존재
assertMatch(serverSrc,
    /\[공통\s*적용\s*범위\]/,
    '5-1: "[공통 적용 범위]" 섹션 존재');

// 5-2: 모든 _NM 기본 LIKE
assertMatch(serverSrc,
    /모든\s*_NM\s*컬럼[\s\S]{0,100}기본\s*LIKE\s*'%값%'/,
    '5-2: "모든 _NM 컬럼: 기본 LIKE \'%값%\' 사용" 명시');

// 5-3: MATERIAL_NM/CUSTOMER_NM 은 추가로 REPLACE
assertMatch(serverSrc,
    /MATERIAL_NM,\s*CUSTOMER_NM[\s\S]{0,100}추가로\s*REPLACE/,
    '5-3: "MATERIAL_NM, CUSTOMER_NM: 추가로 REPLACE(...) LIKE" 명시');

// 5-4: 코드/ID 컬럼 기본 = 사용
assertMatch(serverSrc,
    /코드\/ID\s*컬럼[\s\S]{0,50}기본\s*=\s*사용/,
    '5-4: "코드/ID 컬럼: 기본 = 사용" 명시');

// 5-5: SELECT/GROUP BY/ORDER BY 는 원본 컬럼
assertMatch(serverSrc,
    /SELECT\s*\/\s*GROUP\s*BY\s*\/\s*ORDER\s*BY[\s\S]{0,100}원본\s*컬럼/,
    '5-5: "SELECT / GROUP BY / ORDER BY: 원본 컬럼 그대로 사용" 명시');

// 5-6: 사용자 명시 완전일치 예외 조항
assertMatch(serverSrc,
    /사용자가[\s\S]{0,100}명시적으로\s*완전일치[\s\S]{0,100}_NM/,
    '5-6: "사용자가 명시적으로 완전일치 요구한 경우에만 _NM 에 = 사용 가능" 예외 명시');

// ============================================================
// 6. BASE_SYSTEM_PROMPT 내부 통합 확인 (regression — 블록이 프롬프트에 포함되어야 함)
// ============================================================

// 6-1: BASE_SYSTEM_PROMPT 선언 존재 (수정 전후 동일)
assertMatch(serverSrc,
    /const\s+BASE_SYSTEM_PROMPT\s*=\s*`당신은\s*수익성\s*분석\s*데이터베이스\s*전문가/,
    '6-1: BASE_SYSTEM_PROMPT 선언 유지 (당신은 수익성 분석 데이터베이스 전문가)');

// 6-2: BASE_SYSTEM_PROMPT 범위 내에 새 규칙 블록이 포함되어야 함
//   (BASE_SYSTEM_PROMPT 선언부터 다음 `const 선언까지의 범위 안에 "명칭(_NM) 컬럼" 블록이 있어야 함)
const baseStart = serverSrc.indexOf('const BASE_SYSTEM_PROMPT = `');
assert(baseStart >= 0, '6-2a: BASE_SYSTEM_PROMPT 시작 위치 식별 가능');

// 템플릿 리터럴 종료 찾기 (`;)
const baseEnd = serverSrc.indexOf('`;', baseStart);
assert(baseEnd > baseStart, '6-2b: BASE_SYSTEM_PROMPT 종료 (`;) 위치 식별 가능');

const baseBlock = serverSrc.slice(baseStart, baseEnd);
assert(baseBlock.includes('명칭(_NM) 컬럼 조건 생성 규칙'),
    '6-2c: BASE_SYSTEM_PROMPT 내부에 "명칭(_NM) 컬럼 조건 생성 규칙" 블록 포함');

// 6-3: 블록 순서 — 명칭 규칙은 "컬럼명 사용" 최우선 규칙 바로 앞에 위치해야 함
const namePos = baseBlock.indexOf('[★★★★★ 명칭(_NM) 컬럼 조건 생성 규칙');
const colRulePos = baseBlock.indexOf('[★★★ 최우선 규칙 — 컬럼명 사용');
assert(namePos >= 0 && colRulePos > namePos,
    '6-3: "명칭(_NM) 규칙" 블록이 "컬럼명 사용 최우선 규칙" 블록보다 앞에 위치');

// 6-4: 사업부 필터 규칙은 그대로 유지 (regression)
assertMatch(baseBlock,
    /\[★★★★★\s*사업부\s*필터\s*절대\s*규칙\s*\(Division\s*Filter\s*Rule\)/,
    '6-4: 기존 "사업부 필터 절대 규칙" 블록 유지');

// 6-5: DIVISION_NM LIKE 금지 규칙은 유지 (사업부 규칙이 명칭 규칙보다 우선)
//   (DIVISION_NM 은 특수 케이스로 LIKE 사용도 금지 — 반드시 DIVISION 코드 사용)
assertMatch(baseBlock,
    /DIVISION_NM\s*LIKE\s*'%HL%'/,
    '6-5: DIVISION_NM LIKE 금지 예시 유지 (사업부 규칙 우선 — _NM LIKE 규칙 예외)');

// ============================================================
// 7. 설계 주석 / 추적성
// ============================================================

// 7-1: 사용자 요구 근거 — 기본 LIKE 원칙
assertMatch(blockText,
    /사용자\s*요구[\s\S]{0,300}반드시\s*준수/,
    '7-1: 블록 내 "사용자 요구 — 반드시 준수" 주석 (추적성)');

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
    console.log('==================================================');
    console.log(`NLQ _NM LIKE RULE TEST — PASS: ${passCount}, FAIL: ${failCount}`);
    console.log('==================================================');
    process.exit(1);
}

console.log('');
console.log('==================================================');
console.log(`NLQ _NM LIKE RULE TEST — PASS: ${passCount}, FAIL: ${failCount}`);
console.log('==================================================');
