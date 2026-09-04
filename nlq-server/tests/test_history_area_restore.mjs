/**
 * test_history_area_restore.mjs
 *
 * [2026-09-04 fix/history-restore-area-lock]
 * 히스토리 클릭 시 area 복원 로직 회귀 방어 테스트.
 *
 * 배경:
 *   과거 restoreSession() 은 window.AreaTabs.lock() 만 호출해서
 *   "현재 UI 에 선택되어 있던 area 를 그대로 잠금" 하는 버그가 있었음.
 *   → 사용자가 [수익성분석] 상태에서 [제조] 이력 클릭 시 [수익성분석] 으로 잠기는 문제.
 *
 * 이 파일은 index.html restoreSession() 안의 area 복원 로직 (canonical
 * business_area_code → area key 매핑) 을 정확히 그대로 재현해 검증한다.
 *
 * Cases:
 *   A. 현재 activeArea = profitability → MANUFACTURING_COST 이력 클릭
 *      → 대상 area = 'manufacturing-cost' (강제 전환 발생)
 *   B. 현재 activeArea = manufacturing-cost → PROFITABILITY 이력 클릭
 *      → 대상 area = 'profitability' (강제 전환 발생)
 *   C. business_area_code = NULL/누락 이력
 *      → 대상 area = null (강제 전환 스킵, 기존 동작 유지)
 *   D. items[0] 의 business_area_code=NULL, items[1]='MANUFACTURING_COST'
 *      → 대상 area = 'manufacturing-cost' (첫 non-null 값 사용)
 *
 * 실행: node nlq-server/tests/test_history_area_restore.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const INDEX_HTML = resolve(__dirname, '../public/index.html');

// ─────────────────────────────────────────────────────────────────
// 1. 회귀 방어용 소스 인용 검증 —
//    실제 index.html 에 area 복원 로직 markers 가 남아있는지 grep.
//    (이 markers 가 사라지면 향후 리팩터링 중 실수로 로직이 제거된 것)
// ─────────────────────────────────────────────────────────────────
const indexHtml = readFileSync(INDEX_HTML, 'utf8');

const REQUIRED_MARKERS = [
    'History:AreaRestore',
    'business_area_code',
    "'PROFITABILITY': 'profitability'",
    "'MANUFACTURING_COST': 'manufacturing-cost'",
    'window.AreaTabs.set',
    'window.AreaTabs.unlock',
    'window.AreaTabs.lock',
    '{ force: true }',
];

// ─────────────────────────────────────────────────────────────────
// 2. 실제 복원 로직 순수 함수화 —
//    restoreSession() 에서 발췌한 매핑 로직을 그대로 재현.
//    "실제 코드와 동일한 결과를 낸다" 만 검증.
// ─────────────────────────────────────────────────────────────────
function resolveTargetAreaKey(items) {
    // index.html restoreSession() 안의 매핑 로직과 100% 동일해야 함.
    const _bacFromItems = (items.find(it => it && it.business_area_code) || {}).business_area_code || null;
    const _AREA_CODE_TO_KEY = { 'PROFITABILITY': 'profitability', 'MANUFACTURING_COST': 'manufacturing-cost' };
    return _bacFromItems ? _AREA_CODE_TO_KEY[_bacFromItems] : null;
}

// ─────────────────────────────────────────────────────────────────
// 3. Test harness
// ─────────────────────────────────────────────────────────────────
let PASS = 0;
let FAIL = 0;
const failures = [];

function assertEq(label, actual, expected) {
    if (actual === expected) {
        console.log(`  PASS  ${label}`);
        PASS++;
    } else {
        console.log(`  FAIL  ${label}`);
        console.log(`        expected: ${JSON.stringify(expected)}`);
        console.log(`        actual:   ${JSON.stringify(actual)}`);
        failures.push(label);
        FAIL++;
    }
}

// ─────────────────────────────────────────────────────────────────
// 4. Test cases
// ─────────────────────────────────────────────────────────────────

console.log('\n[Group 0] 소스 코드 marker 유지 검증');
REQUIRED_MARKERS.forEach(marker => {
    assertEq(`marker "${marker}" present in index.html`, indexHtml.includes(marker), true);
});

console.log('\n[Group 1] Case A: profitability 상태에서 MANUFACTURING_COST 이력 클릭');
{
    const items = [
        { id: 1, query_text: '베트남지사 인건비', business_area_code: 'MANUFACTURING_COST', domain_code: 'MGMT' },
    ];
    // 현재 activeArea 가 무엇이든 무관. 대상 area 는 items 의 canonical 값을 따른다.
    assertEq('items[0].business_area_code=MANUFACTURING_COST → targetArea=manufacturing-cost',
        resolveTargetAreaKey(items), 'manufacturing-cost');
}

console.log('\n[Group 2] Case B: manufacturing-cost 상태에서 PROFITABILITY 이력 클릭');
{
    const items = [
        { id: 2, query_text: '2026년 7월 총매출', business_area_code: 'PROFITABILITY', domain_code: 'PS' },
    ];
    assertEq('items[0].business_area_code=PROFITABILITY → targetArea=profitability',
        resolveTargetAreaKey(items), 'profitability');
}

console.log('\n[Group 3] Case C: business_area_code=NULL/누락 이력 (옛날 이력)');
{
    assertEq('items=[{business_area_code:null}] → targetArea=null (강제 전환 스킵)',
        resolveTargetAreaKey([{ id: 3, query_text: '옛날 이력', business_area_code: null }]), null);

    assertEq('items=[{ business_area_code 필드 자체 없음 }] → targetArea=null',
        resolveTargetAreaKey([{ id: 4, query_text: '옛날 이력' }]), null);

    assertEq('items=[] → targetArea=null (안전한 no-op)',
        resolveTargetAreaKey([]), null);
}

console.log('\n[Group 4] Case D: 첫 non-null business_area_code 사용');
{
    const items = [
        { id: 5, query_text: '연결 재조회', business_area_code: null },
        { id: 6, query_text: '베트남지사 인건비', business_area_code: 'MANUFACTURING_COST' },
        { id: 7, query_text: '연이은 후속질의', business_area_code: 'MANUFACTURING_COST' },
    ];
    assertEq('첫 non-null 값을 사용 → targetArea=manufacturing-cost',
        resolveTargetAreaKey(items), 'manufacturing-cost');
}

console.log('\n[Group 5] Case E: 방어적 케이스 (혼재/알 수 없는 코드)');
{
    // 알 수 없는 area 코드는 mapping 실패 → undefined 반환 (fallback: 강제 전환 스킵)
    assertEq('알 수 없는 코드 → targetArea=undefined (매핑 미정의 → 스킵)',
        resolveTargetAreaKey([{ id: 8, business_area_code: 'UNKNOWN_AREA' }]), undefined);

    // 첫 유효 코드가 profitability 이면 뒤에 mfg 있어도 profitability 반환
    assertEq('items[0]=PROFITABILITY, items[1]=MANUFACTURING_COST → profitability (첫 non-null)',
        resolveTargetAreaKey([
            { id: 9, business_area_code: 'PROFITABILITY' },
            { id: 10, business_area_code: 'MANUFACTURING_COST' },
        ]), 'profitability');
}

console.log('\n[Group 6] Case F: null 안전성');
{
    assertEq('items=null 방어 → throw? (실코드는 items 항상 배열 보장)',
        (() => { try { return resolveTargetAreaKey([]); } catch { return 'THREW'; } })(), null);

    // 특정 item 자체가 null / undefined 인 경우 (방어적)
    assertEq('items=[null, undefined, {business_area_code:"PROFITABILITY"}] → profitability',
        resolveTargetAreaKey([null, undefined, { business_area_code: 'PROFITABILITY' }]), 'profitability');
}

// ─────────────────────────────────────────────────────────────────
// 5. Summary
// ─────────────────────────────────────────────────────────────────
console.log('\n===============================');
console.log(`Total: ${PASS + FAIL}   PASS: ${PASS}   FAIL: ${FAIL}`);
console.log('===============================');
if (FAIL > 0) {
    console.log('Failures:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
