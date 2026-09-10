/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_mfg_preview_gate.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상: nlq-server/public/builder.html 하단의 "제조원가 프리뷰 게이팅" IIFE.
 *
 * 검증 목표:
 *   1) 함수 게이팅: 제조원가 area 에서 executeQuery / addField / addConditionRow 등
 *      래핑된 함수가 원본을 실행하지 않고 모달만 띄운다.
 *   2) 수익성분석 area: 원본 함수가 그대로 실행된다.
 *   3) area 이벤트 (areatabs:ready / areachange) 로 모달이 자동 표시/숨김된다.
 *   4) "수익성분석으로 이동" / "프리뷰만 보기" 버튼 동작.
 *   5) 이중 래핑 방지 (__mfgGated 플래그).
 *
 * 방법:
 *   - builder.html 에서 게이팅 IIFE 를 추출.
 *   - 최소 DOM (jsdom 미사용 — 간단 mock) 을 globalThis 에 세팅.
 *   - IIFE 를 eval 로 실행 후, window[함수명] 호출로 동작 검증.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUILDER_HTML = path.resolve(__dirname, '../public/builder.html');

let passCount = 0;
let failCount = 0;

function assert(cond, msg) {
    if (cond) {
        passCount++;
        console.log('  ✅ ' + msg);
    } else {
        failCount++;
        console.log('  ❌ ' + msg);
    }
}
function section(title) {
    console.log('\n' + '='.repeat(72));
    console.log(title);
    console.log('='.repeat(72));
}

// ── 게이팅 IIFE 소스 추출 ────────────────────────────────────────────────
function extractMfgPreviewIIFE() {
    const html = fs.readFileSync(BUILDER_HTML, 'utf8');
    // 헤더 주석("[2026-09-10] 제조원가 비주얼쿼리빌더 게이팅 스크립트") 이 들어있는
    // <script> 블록만 골라낸다.
    const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        if (m[1].includes('제조원가 비주얼쿼리빌더 게이팅 스크립트')) {
            return m[1];
        }
    }
    throw new Error('mfg preview gating script block not found in builder.html');
}

// ── 최소 DOM/window mock 팩토리 ─────────────────────────────────────────
function buildMockEnv() {
    const listeners = {}; // event -> [handler]
    const modalEl = { style: { display: 'none' } };
    const btnBackToProfit = { id: 'mfgPreviewBackToProfit' };
    const btnClose = { id: 'mfgPreviewCloseBtn' };

    // area-tabs 상태를 조작할 수 있는 mock
    const areaTabs = {
        _current: 'profitability',
        get current() { return this._current; },
        set current(v) { this._current = v; },
        set(newArea) {
            this._current = newArea;
            // 실제 area-tabs.js 도 setArea 후 areachange 이벤트 발행
            dispatchEvent({ type: 'areachange', detail: { area: newArea } });
        },
    };

    function addEventListener(evt, handler /*, opts */) {
        (listeners[evt] = listeners[evt] || []).push(handler);
    }
    function removeEventListener(evt, handler) {
        if (!listeners[evt]) return;
        listeners[evt] = listeners[evt].filter(h => h !== handler);
    }
    function dispatchEvent(evObj) {
        const type = evObj.type;
        (listeners[type] || []).forEach(h => { try { h(evObj); } catch (e) {} });
        return true;
    }

    // 매우 단순한 querySelector/getElementById
    function getElementById(id) {
        if (id === 'mfgPreviewModal') return modalEl;
        return null;
    }

    // element.closest mock — id 로만 매칭
    function makeClosestForId(id) {
        return function closest(sel) {
            if (sel === '#' + id) return { id };
            return null;
        };
    }

    const documentMock = {
        readyState: 'complete',
        body: { dataset: { area: '' } },
        addEventListener,          // for 'click', 'DOMContentLoaded'
        removeEventListener,
        getElementById,
        _fireClick(id) {
            const target = { closest: makeClosestForId(id) };
            (listeners['click'] || []).forEach(h => {
                try { h({ target }); } catch (e) {}
            });
        },
    };

    const windowMock = {
        addEventListener,
        removeEventListener,
        dispatchEvent,
        AreaTabs: areaTabs,
        _listeners: listeners,
    };

    // CustomEvent polyfill (매우 단순)
    function CustomEvent(type, opts) {
        return { type, detail: (opts && opts.detail) || {} };
    }

    return { windowMock, documentMock, areaTabs, modalEl, CustomEvent };
}

// ── IIFE 를 mock 환경에서 실행 ──────────────────────────────────────────
function runGateScript(env, preInstall) {
    const src = extractMfgPreviewIIFE();

    // globalThis 에 window/document/CustomEvent 를 실제 전역으로 매핑
    globalThis.window = env.windowMock;
    globalThis.document = env.documentMock;
    globalThis.CustomEvent = env.CustomEvent;
    // 스크립트 안에서 `window[name]` 접근을 하므로 window 가 곧 함수 저장소.
    // 사전 정의 함수는 windowMock 에 미리 심어둔다.
    if (typeof preInstall === 'function') preInstall(env.windowMock);

    // IIFE 실행. 스크립트 안에서 `document.body?.dataset?.area` 접근 -> mock 에 준비됨.
    // 스크립트 안의 setTimeout(syncModalWithArea, 0) 은 즉시 실행 mock 로 대체.
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
    try {
        // eslint-disable-next-line no-new-func
        new Function(src)();
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 1: 게이팅 IIFE 소스가 builder.html 에서 추출됨');
// ══════════════════════════════════════════════════════════════════════════
{
    const src = extractMfgPreviewIIFE();
    assert(src.length > 500, 'IIFE 소스 길이가 500자 초과');
    assert(/showMfgPreviewModal/.test(src), 'showMfgPreviewModal 함수 정의 포함');
    assert(/hideMfgPreviewModal/.test(src), 'hideMfgPreviewModal 함수 정의 포함');
    assert(/guardFn/.test(src), 'guardFn 래퍼 정의 포함');
    assert(/executeQuery/.test(src) && /executeEditedSql/.test(src)
        && /addField/.test(src) && /addConditionRow/.test(src)
        && /handleFieldDrop/.test(src) && /handleCondDrop/.test(src),
        '6개 액션 함수(executeQuery/executeEditedSql/addField/addConditionRow/handleFieldDrop/handleCondDrop) 모두 게이팅 대상에 포함');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 2: 수익성분석 area — 원본 함수가 정상 실행됨 (기존 기능 무영향)');
// ══════════════════════════════════════════════════════════════════════════
{
    const env = buildMockEnv();
    env.areaTabs._current = 'profitability';
    let executeQueryCalls = 0;
    let addFieldArgs = null;
    runGateScript(env, (w) => {
        w.executeQuery = () => { executeQueryCalls++; return 'executed'; };
        w.addField = (col) => { addFieldArgs = col; return 'added:' + col; };
    });

    const r1 = env.windowMock.executeQuery();
    assert(executeQueryCalls === 1, 'executeQuery 원본이 1회 호출됨');
    assert(r1 === 'executed', 'executeQuery 원본 반환값 보존');

    const r2 = env.windowMock.addField('ZAMT001');
    assert(addFieldArgs === 'ZAMT001', 'addField 인자 전달 정상');
    assert(r2 === 'added:ZAMT001', 'addField 반환값 보존');

    assert(env.modalEl.style.display === 'none',
        '수익성분석 area 진입 시 모달은 표시되지 않음');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 3: 제조원가 area — 원본 함수 실행 차단 + 모달 표시');
// ══════════════════════════════════════════════════════════════════════════
{
    const env = buildMockEnv();
    env.areaTabs._current = 'manufacturing-cost';
    let executeQueryCalls = 0;
    let addFieldCalls = 0;
    let addConditionRowCalls = 0;
    let handleFieldDropCalls = 0;
    let handleCondDropCalls = 0;
    let executeEditedSqlCalls = 0;
    let addFieldByClickCalls = 0;
    runGateScript(env, (w) => {
        w.executeQuery = () => { executeQueryCalls++; };
        w.addField = () => { addFieldCalls++; };
        w.addConditionRow = () => { addConditionRowCalls++; };
        w.handleFieldDrop = () => { handleFieldDropCalls++; };
        w.handleCondDrop = () => { handleCondDropCalls++; };
        w.executeEditedSql = () => { executeEditedSqlCalls++; };
        w.addFieldByClick = () => { addFieldByClickCalls++; };
    });

    // 초기 area 가 이미 mfg 이므로 sync 시점에 모달이 표시되어야 함
    assert(env.modalEl.style.display === 'flex',
        '제조원가 area 로딩 즉시 모달 표시됨');

    // 모달을 사용자가 닫았다고 가정
    env.modalEl.style.display = 'none';

    // 모든 액션 함수 호출 → 원본은 실행되지 않아야 하고, 모달만 다시 뜨는지 확인
    env.windowMock.executeQuery();
    assert(executeQueryCalls === 0, 'executeQuery 원본 차단됨');
    assert(env.modalEl.style.display === 'flex', 'executeQuery 시도 시 모달 재표시');

    env.modalEl.style.display = 'none';
    env.windowMock.addField('X');
    assert(addFieldCalls === 0, 'addField 원본 차단됨');
    assert(env.modalEl.style.display === 'flex', 'addField 시도 시 모달 재표시');

    env.modalEl.style.display = 'none';
    env.windowMock.addFieldByClick('X');
    assert(addFieldByClickCalls === 0, 'addFieldByClick 원본 차단됨');
    assert(env.modalEl.style.display === 'flex', 'addFieldByClick 시도 시 모달 재표시');

    env.modalEl.style.display = 'none';
    env.windowMock.addConditionRow();
    assert(addConditionRowCalls === 0, 'addConditionRow 원본 차단됨');

    env.modalEl.style.display = 'none';
    env.windowMock.handleFieldDrop({ preventDefault:()=>{}, currentTarget:{classList:{remove:()=>{}}} });
    assert(handleFieldDropCalls === 0, 'handleFieldDrop 원본 차단됨');

    env.modalEl.style.display = 'none';
    env.windowMock.handleCondDrop({ preventDefault:()=>{}, currentTarget:{classList:{remove:()=>{}}} });
    assert(handleCondDropCalls === 0, 'handleCondDrop 원본 차단됨');

    env.modalEl.style.display = 'none';
    env.windowMock.executeEditedSql();
    assert(executeEditedSqlCalls === 0, 'executeEditedSql 원본 차단됨');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 4: area 전환 이벤트 — 모달 자동 표시/숨김');
// ══════════════════════════════════════════════════════════════════════════
{
    const env = buildMockEnv();
    env.areaTabs._current = 'profitability';
    runGateScript(env, (w) => {
        w.executeQuery = () => {};
    });

    assert(env.modalEl.style.display === 'none',
        '초기 수익성분석 상태: 모달 숨김');

    // 제조원가로 전환
    env.areaTabs.set('manufacturing-cost');
    assert(env.modalEl.style.display === 'flex',
        'areachange(profitability→manufacturing-cost) 후 모달 자동 표시');

    // 다시 수익성분석으로
    env.areaTabs.set('profitability');
    assert(env.modalEl.style.display === 'none',
        'areachange(manufacturing-cost→profitability) 후 모달 자동 숨김');

    // areatabs:ready 이벤트도 반응해야 함
    env.areaTabs._current = 'manufacturing-cost';
    env.windowMock.dispatchEvent({ type: 'areatabs:ready', detail: { area: 'manufacturing-cost' } });
    assert(env.modalEl.style.display === 'flex',
        'areatabs:ready 이벤트로도 모달 표시됨');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 5: 모달 버튼 — "수익성분석으로 이동" 시 area 전환');
// ══════════════════════════════════════════════════════════════════════════
{
    const env = buildMockEnv();
    env.areaTabs._current = 'manufacturing-cost';
    runGateScript(env, (w) => { w.executeQuery = () => {}; });

    assert(env.modalEl.style.display === 'flex', '초기 제조원가 → 모달 표시');
    assert(env.areaTabs.current === 'manufacturing-cost', '초기 area = manufacturing-cost');

    // "수익성분석으로 이동" 버튼 클릭 시뮬
    env.documentMock._fireClick('mfgPreviewBackToProfit');

    assert(env.areaTabs.current === 'profitability',
        '버튼 클릭 후 area 가 profitability 로 전환됨');
    assert(env.modalEl.style.display === 'none',
        '버튼 클릭 후 모달 숨김됨');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 6: 모달 버튼 — "프리뷰만 보기" 시 모달만 닫힘 (area 유지)');
// ══════════════════════════════════════════════════════════════════════════
{
    const env = buildMockEnv();
    env.areaTabs._current = 'manufacturing-cost';
    runGateScript(env, (w) => { w.executeQuery = () => {}; });

    assert(env.modalEl.style.display === 'flex', '초기 모달 표시');

    env.documentMock._fireClick('mfgPreviewCloseBtn');

    assert(env.modalEl.style.display === 'none',
        '"프리뷰만 보기" 클릭 후 모달 닫힘');
    assert(env.areaTabs.current === 'manufacturing-cost',
        'area 는 manufacturing-cost 그대로 유지됨');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 7: 이중 래핑 방지 (__mfgGated 플래그)');
// ══════════════════════════════════════════════════════════════════════════
{
    const env = buildMockEnv();
    env.areaTabs._current = 'profitability';
    let calls = 0;
    runGateScript(env, (w) => {
        w.executeQuery = () => { calls++; };
    });

    const firstWrapper = env.windowMock.executeQuery;
    assert(firstWrapper.__mfgGated === true, '1차 래핑 후 __mfgGated 플래그 세팅');

    // 만약 (실수로) 다시 IIFE 를 돌려도 재래핑되지 않아야 함.
    // 여기서는 guardFn 을 흉내내어 검증.
    const src = extractMfgPreviewIIFE();
    // installGates 부분만 다시 실행 시뮬레이션: 새로운 IIFE 안에서 처음부터 실행되므로
    // 실제로는 wrapped.__mfgGated 체크가 새 스코프에서 다시 참조되므로
    // 여기서는 windowMock.executeQuery 가 이미 __mfgGated 인 상태에서
    // 다시 IIFE 를 돌려도 새 스코프의 guardFn 이 orig.__mfgGated 를 검사해 skip 해야 함.
    globalThis.window = env.windowMock;
    globalThis.document = env.documentMock;
    globalThis.CustomEvent = env.CustomEvent;
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn) => { try { fn(); } catch (e) {} return 0; };
    try {
        // eslint-disable-next-line no-new-func
        new Function(src)();
    } finally {
        globalThis.setTimeout = originalSetTimeout;
    }

    assert(env.windowMock.executeQuery === firstWrapper,
        '2차 IIFE 실행에도 wrapper 가 동일 참조로 유지됨 (재래핑 방지)');

    // 실제 호출도 여전히 원본을 한 번만 실행 (수익성분석 area 기준)
    env.windowMock.executeQuery();
    assert(calls === 1, '수익성분석 area 에서 원본이 1회만 실행됨');
}

// ══════════════════════════════════════════════════════════════════════════
section('Test 8: 정의되지 않은 함수는 게이팅 skip (에러 없이 진행)');
// ══════════════════════════════════════════════════════════════════════════
{
    const env = buildMockEnv();
    env.areaTabs._current = 'profitability';
    // 함수 하나만 정의하고 나머지는 undefined 상태 → 예외 없이 IIFE 완주해야 함
    let ok = true;
    try {
        runGateScript(env, (w) => {
            w.executeQuery = () => {};
            // addField / addConditionRow / handleFieldDrop / handleCondDrop /
            // executeEditedSql / addFieldByClick 는 정의하지 않음
        });
    } catch (e) {
        ok = false;
    }
    assert(ok, '일부 대상 함수가 없어도 IIFE 는 예외 없이 완료됨');
    assert(typeof env.windowMock.executeQuery === 'function'
        && env.windowMock.executeQuery.__mfgGated === true,
        '정의된 함수 (executeQuery) 만 정상 래핑됨');
    assert(typeof env.windowMock.addField === 'undefined',
        '정의되지 않은 함수 (addField) 는 그대로 undefined 유지');
}

// ══════════════════════════════════════════════════════════════════════════
section('결과 요약');
// ══════════════════════════════════════════════════════════════════════════
console.log(`\n총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
if (failCount > 0) process.exit(1);
