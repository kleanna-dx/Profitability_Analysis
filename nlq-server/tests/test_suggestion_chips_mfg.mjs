/**
 * 제조원가 예시질문 (Suggestion Chips) 검증
 * ===================================================================
 * 사용자 요청 (2026-09-18):
 *   [자연어질의 > 제조원가] 예시질문 수정
 *   삭제:
 *     1. "입고-생산 제품별 총원가 TOP 5"
 *     2. "화장지 플랜트 제품별 매출원가 TOP 5"
 *   추가:
 *     "자재별 원가요소 조회해줘"
 *
 * 동작 규칙:
 *   - 질문에 특정 년월이 없으면 기존 제조원가 날짜 기본정책(latestClosedMonth) 적용
 *   - 예시 문구에 "2026년 8월" 같은 년월 하드코딩 금지
 *   - 향후 최신 마감월 변경 시 예시는 그대로 두고 조회월만 자동 변경되어야 함
 *
 * 검증 대상:
 *   1) public/index.html SUGGESTIONS_BY_AREA['manufacturing-cost'] 배열 2개
 *      ('__unified__', 'cost-product')
 *   2) 신규 문구가 server.mjs 의 원가요소 트리거 정규식에 매칭되는지
 *   3) 신규 문구에 년/월 하드코딩 없음
 * ===================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '..', 'public', 'index.html');
const serverPath = path.resolve(__dirname, '..', 'server.mjs');

const html = fs.readFileSync(htmlPath, 'utf8');
const server = fs.readFileSync(serverPath, 'utf8');

// ---- 테스트 프레임워크 ----
let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, name) {
    if (cond) PASS++;
    else { FAIL++; failures.push(name); console.error('FAIL:', name); }
}
function assertMatch(actual, re, name) {
    const ok = re.test(actual);
    if (!ok) {
        FAIL++;
        failures.push(name);
        console.error('FAIL:', name);
        console.error('  regex:  ', re);
        console.error('  actual: ', typeof actual === 'string' ? actual.slice(0, 200) : actual);
    } else PASS++;
}
function assertNotMatch(actual, re, name) {
    const ok = !re.test(actual);
    if (!ok) {
        FAIL++;
        failures.push(name);
        console.error('FAIL:', name);
        console.error('  regex(-):', re);
        console.error('  actual: ', typeof actual === 'string' ? actual.slice(0, 200) : actual);
    } else PASS++;
}

// ---- index.html SUGGESTIONS_BY_AREA 배열 추출 ----
// SUGGESTIONS_BY_AREA = { ... 'manufacturing-cost': { '__unified__': [...], 'cost-product': [...] } ... }
//
// 주의: 주석 안에 대괄호([2026-09-18] 같은)가 있어서 non-greedy 매칭이 조기 종료될 수 있음.
//   → 먼저 소스 전체에서 // 라인주석을 제거한 뒤 배열 body 추출.
function stripLineComments(src) {
    return src
        .split('\n')
        .map(line => {
            // 라인 내에서 // 위치 찾기 (문자열 리터럴 안의 // 는 다르게 처리해야 하지만,
            //  우리 관심 영역인 배열 정의는 각 줄에 '문자열', 만 있음 → // 앞부분 유지로 안전)
            const idx = line.indexOf('//');
            return idx >= 0 ? line.substring(0, idx) : line;
        })
        .join('\n');
}

const htmlNoComments = stripLineComments(html);

function extractSuggestionArray(key) {
    const re = new RegExp(`'${key}'\\s*:\\s*\\[([\\s\\S]*?)\\]`);
    const m = htmlNoComments.match(re);
    if (!m) return null;
    const body = m[1];
    const items = [];
    const literalRe = /'([^']*)'/g;
    let mm;
    while ((mm = literalRe.exec(body)) !== null) {
        items.push(mm[1]);
    }
    return items;
}

const unifiedList = extractSuggestionArray('__unified__');
const costProductList = extractSuggestionArray('cost-product');

// ---- A. 배열 추출 성공 ----
assert(Array.isArray(unifiedList), 'A-1: __unified__ 배열 추출 성공');
assert(Array.isArray(costProductList), 'A-2: cost-product 배열 추출 성공');
assert(unifiedList && unifiedList.length > 0, 'A-3: __unified__ 배열 비어있지 않음');
assert(costProductList && costProductList.length > 0, 'A-4: cost-product 배열 비어있지 않음');

// ---- B. 삭제 대상 2개가 두 배열 모두에서 완전히 제거 ----
const DELETED = [
    '입고-생산 제품별 총원가 TOP 5',
    '화장지 플랜트 제품별 매출원가 TOP 5',
];
for (const q of DELETED) {
    assert(!unifiedList.includes(q), `B-1: __unified__ 에 "${q}" 삭제됨`);
    assert(!costProductList.includes(q), `B-2: cost-product 에 "${q}" 삭제됨`);
}

// ---- C. 신규 문구 "자재별 원가요소 조회해줘" 가 두 배열에 정확히 존재 ----
const NEW_Q = '자재별 원가요소 조회해줘';
assert(unifiedList.includes(NEW_Q), `C-1: __unified__ 에 "${NEW_Q}" 존재`);
assert(costProductList.includes(NEW_Q), `C-2: cost-product 에 "${NEW_Q}" 존재`);

// ---- D. 신규 문구에 년/월 하드코딩 없음 ----
//   금지 패턴: "2020~2030년", "1월"~"12월", "202001"~"203012" 형식, "YYYY-MM"
assertNotMatch(NEW_Q, /20\d{2}\s*년/, 'D-1: 신규 문구에 "YYYY년" 없음');
assertNotMatch(NEW_Q, /\d{1,2}\s*월/, 'D-2: 신규 문구에 "N월" 없음');
assertNotMatch(NEW_Q, /20\d{4}/, 'D-3: 신규 문구에 "YYYYMM" (예: 202608) 없음');
assertNotMatch(NEW_Q, /20\d{2}[-\/]\d{1,2}/, 'D-4: 신규 문구에 "YYYY-MM" / "YYYY/MM" 없음');
assertNotMatch(NEW_Q, /CALMONTH/i, 'D-5: 신규 문구에 "CALMONTH" 리터럴 없음');

// ---- E. 두 배열의 예시 순서 검증 (사용자 스크린샷 순서 유지) ----
//   기존 순서: 제품별 실제원가 단가 TOP 5 → 제품별 표준원가와 실제원가 차이 TOP 5 → 제품별 매출원가 TOP 5
//   → 전월대비 제품별 실제원가 증가액 TOP 10 → 제지 플랜트 제품별 실제원가 순위
//   → [자재별 원가요소 조회해줘]  ← 삭제된 자리에 신규 삽입
//   → 제품별 변동비와 고정비 비교
const EXPECTED_ORDER = [
    '제품별 실제원가 단가 TOP 5',
    '제품별 표준원가와 실제원가 차이 TOP 5',
    '제품별 매출원가 TOP 5',
    '전월대비 제품별 실제원가 증가액 TOP 10',
    '제지 플랜트 제품별 실제원가 순위',
    '자재별 원가요소 조회해줘',
    '제품별 변동비와 고정비 비교',
];
assert(unifiedList.length === EXPECTED_ORDER.length, `E-1: __unified__ 길이 ${unifiedList.length} === ${EXPECTED_ORDER.length}`);
assert(costProductList.length === EXPECTED_ORDER.length, `E-2: cost-product 길이 ${costProductList.length} === ${EXPECTED_ORDER.length}`);
EXPECTED_ORDER.forEach((q, i) => {
    assert(unifiedList[i] === q, `E-3-${i}: __unified__[${i}] === "${q}" (실제: "${unifiedList[i]}")`);
    assert(costProductList[i] === q, `E-4-${i}: cost-product[${i}] === "${q}" (실제: "${costProductList[i]}")`);
});

// ---- F. 신규 문구가 서버의 "원가요소" 트리거 정규식에 매칭되는지 검증 ----
//   server.mjs 의 GENERIC_COST_INTENT_RE, COST_ELEMENT_INTENT_RE 를 실제로 추출해서 테스트
function extractRegex(name) {
    // const NAME = /..../;  또는  const NAME = /..../flags;
    const re = new RegExp(`const\\s+${name}\\s*=\\s*(/[^\\n]+?/[gimsuy]*)\\s*;`);
    const m = server.match(re);
    if (!m) return null;
    // eval 로 정규식 객체 생성
    try { return eval(m[1]); } catch (e) { return null; }
}

const GENERIC_COST_INTENT_RE = extractRegex('GENERIC_COST_INTENT_RE');
const COST_ELEMENT_INTENT_RE = extractRegex('COST_ELEMENT_INTENT_RE');
const COST_ELEMENT_SPECIFIC_TERMS_RE = extractRegex('COST_ELEMENT_SPECIFIC_TERMS_RE');

assert(GENERIC_COST_INTENT_RE instanceof RegExp, 'F-1: GENERIC_COST_INTENT_RE 추출 성공');
assert(COST_ELEMENT_INTENT_RE instanceof RegExp, 'F-2: COST_ELEMENT_INTENT_RE 추출 성공');

// 신규 문구가 두 정규식에 매칭 → "원가요소" 트리거 정상 발동 → KST 20개 컬럼 강제 주입 경로 진입
if (GENERIC_COST_INTENT_RE) {
    assertMatch(NEW_Q, GENERIC_COST_INTENT_RE, 'F-3: 신규 문구 "자재별 원가요소 조회해줘" 가 GENERIC_COST_INTENT_RE 에 매칭 (KST 컬럼 강제 트리거)');
}
if (COST_ELEMENT_INTENT_RE) {
    assertMatch(NEW_Q, COST_ELEMENT_INTENT_RE, 'F-4: 신규 문구가 COST_ELEMENT_INTENT_RE 에 매칭');
}

// ---- G. 신규 문구가 SPECIFIC_TERMS (인건비/재료비/제조경비 등) 에는 매칭되지 않음 ----
//   → SPECIFIC 카테고리가 아니므로 KST 20개 전체 컬럼 반환 경로로 감 (스킵 안됨)
if (COST_ELEMENT_SPECIFIC_TERMS_RE) {
    assertNotMatch(NEW_Q, COST_ELEMENT_SPECIFIC_TERMS_RE, 'G-1: 신규 문구는 SPECIFIC 카테고리 아님 → KST 20개 전체 반환');
}

// ---- H. 삭제된 예시 문구 자체가 index.html 어디에도 없어야 함 (완전 삭제) ----
//   ⚠️ 다만 예외: 코드 주석/문서 안에는 참조로 남을 수 있으므로,
//     '자재별 원가요소' 처럼 실제 문자열 리터럴로만 검사
const bodyOnly = html;
// 삭제된 문구가 리터럴 문자열로 어디에도 정의되어 있지 않음을 검증
//   (주석에는 히스토리로 언급될 수 있으므로 배열에서 삭제되었는지만 위에서 검증했음)
// 여기서는 오직 두 배열 안에 없다는 점만 확인 (B 에서 이미 검증). 재확인 목적.
assert(!unifiedList.includes(DELETED[0]) && !costProductList.includes(DELETED[0]),
    `H-1: "${DELETED[0]}" 배열 완전 삭제 확인`);
assert(!unifiedList.includes(DELETED[1]) && !costProductList.includes(DELETED[1]),
    `H-2: "${DELETED[1]}" 배열 완전 삭제 확인`);

// ---- 리포트 ----
console.log('');
console.log('==================================================');
console.log(`SUGGESTION CHIPS MFG TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    for (const f of failures) console.log('  -', f);
    process.exit(1);
}
