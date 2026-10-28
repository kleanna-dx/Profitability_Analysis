// ============================================================
// test_coach_step3_dynamic.mjs
// ------------------------------------------------------------
// 사용자 신고:
//   최초 접속 시 노출되는 사용방법 가이드의 STEP 3 내용이 수익성분석 기준으로
//   고정되어 있음. 제조원가 전용 사용자에게도 '매출/이익' 예시가 노출되는 문제.
//
// 요구사항:
//   - 수익성분석만 권한: 현재처럼 수익성분석 가이드
//   - 제조원가만 권한: 제조원가 가이드 (실제원가/매출원가/표준원가)
//   - 둘 다 권한: 기본 수익성분석 (DEFAULT_AREA)
//   - 수익성분석으로 하드코딩 금지, AreaTabs.snapshot() 활용
//
// 설계:
//   1. getCurrentCoachArea() : AreaTabs.snapshot().area 안전 조회 (fallback='profitability')
//   2. COACH_STEP3_CONTENT   : 영역별 { termPairs, goodExamples, badExamples } 매핑
//   3. buildCoachStep3Html(areaKey) : 영역별 HTML 생성 (알 수 없는 영역 → profitability fallback)
//   4. COACH_STEPS STEP 3 : html → getHtml() 로 전환
//   5. renderCoachStep : step.getHtml?.() ?? step.html (하위 호환)
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '../public/index.html');
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

// ============================================================
// DD. 신규 헬퍼 함수 정의
// ============================================================

// DD-1: getCurrentCoachArea 함수 정의
assertMatch(htmlSrc,
    /function\s+getCurrentCoachArea\s*\(\s*\)/,
    'DD-1: getCurrentCoachArea() 함수 정의');

// DD-2: AreaTabs.snapshot() 을 안전하게 호출 (typeof === 'function' 체크)
{
    const fn = htmlSrc.match(/function\s+getCurrentCoachArea\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /window\.AreaTabs\s*&&\s*typeof\s+window\.AreaTabs\.snapshot\s*===\s*['"]function['"]/.test(fn[0]),
        'DD-2: getCurrentCoachArea 안에서 AreaTabs.snapshot 안전 조회 (typeof 체크)');
}

// DD-3: snap.area 가 valid string 일 때만 반환
{
    const fn = htmlSrc.match(/function\s+getCurrentCoachArea\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /if\s*\(\s*snap\s*&&\s*typeof\s+snap\.area\s*===\s*['"]string['"]\s*&&\s*snap\.area\s*\)/.test(fn[0]),
        'DD-3: snap.area 가 string + truthy 일 때만 반환 (defensive)');
}

// DD-4: 모든 fallback 경로가 'profitability' 반환 (안전)
{
    const fn = htmlSrc.match(/function\s+getCurrentCoachArea\s*\(\s*\)\s*\{[\s\S]*?\n\}/);
    // 마지막 return 이 'profitability' 여야 함
    assert(fn && /return\s+['"]profitability['"]/.test(fn[0]),
        'DD-4: AreaTabs 미로드/에러 시 return profitability (안전 fallback)');
}

// ============================================================
// EE. COACH_STEP3_CONTENT 상수 — 영역별 콘텐츠 정의
// ============================================================

// EE-1: COACH_STEP3_CONTENT 상수 정의
assertMatch(htmlSrc,
    /const\s+COACH_STEP3_CONTENT\s*=\s*\{/,
    'EE-1: COACH_STEP3_CONTENT 상수 정의');

// EE-2: 'profitability' 키 포함 + termPairs 배열
{
    const content = htmlSrc.match(/const\s+COACH_STEP3_CONTENT\s*=\s*\{[\s\S]*?\n\};/);
    assert(content
        && /['"]profitability['"]\s*:\s*\{[\s\S]{0,2000}termPairs:\s*\[/.test(content[0]),
        'EE-2: profitability 영역 — termPairs 배열 정의');
}

// EE-3: 'manufacturing-cost' 키 포함 + termPairs 배열
{
    const content = htmlSrc.match(/const\s+COACH_STEP3_CONTENT\s*=\s*\{[\s\S]*?\n\};/);
    assert(content
        && /['"]manufacturing-cost['"]\s*:\s*\{[\s\S]{0,2000}termPairs:\s*\[/.test(content[0]),
        'EE-3: manufacturing-cost 영역 — termPairs 배열 정의');
}

// ⚠️ 중요: 'manufacturing-cost' 와 'profitability' 키는 htmlSrc 안에
//   SUGGESTIONS_BY_AREA (라인 ~1671) 와 COACH_STEP3_CONTENT (라인 ~8276) 두 곳에 모두 존재.
//   따라서 반드시 COACH_STEP3_CONTENT 블록을 먼저 추출한 뒤 그 안에서 검색해야 함.
//   (안 그러면 SUGGESTIONS_BY_AREA 의 manufacturing-cost 섹션 (termPairs 없음) 에 걸려 FAIL)
const _coachContentBlock = htmlSrc.match(/const\s+COACH_STEP3_CONTENT\s*=\s*\{[\s\S]*?\n\};/);
assert(_coachContentBlock, 'EE-pre: COACH_STEP3_CONTENT 블록 추출 가능 (후속 EE-4~ 테스트 전제)');
const _coachBlockSrc = _coachContentBlock ? _coachContentBlock[0] : '';

// EE-4: 제조원가 termPairs — 사용자 요구 '용어 쌍 1개만' (bad='원가', good='실제원가 · 매출원가 · 표준원가')
{
    // COACH_STEP3_CONTENT 블록 안의 manufacturing-cost 섹션만 안전 추출
    const mfgSection = _coachBlockSrc.match(/['"]manufacturing-cost['"]\s*:\s*\{[\s\S]*?\},/);
    assert(mfgSection
        && /bad:\s*['"]원가['"]\s*,\s*good:\s*['"]실제원가\s*·\s*매출원가\s*·\s*표준원가['"]/.test(mfgSection[0]),
        'EE-4: 제조원가 termPairs — {bad:"원가", good:"실제원가 · 매출원가 · 표준원가"} 포함');
}

// EE-5: 제조원가 termPairs 는 '정확히 1개' (사용자 요구)
{
    const mfgSection = _coachBlockSrc.match(/['"]manufacturing-cost['"]\s*:\s*\{[\s\S]*?termPairs:\s*\[([\s\S]*?)\]/);
    assert(mfgSection, 'EE-5a: manufacturing-cost termPairs 섹션 추출 가능 (COACH_STEP3_CONTENT 내부)');
    if (mfgSection) {
        const termPairsBody = mfgSection[1];
        const badCount = (termPairsBody.match(/\bbad\s*:/g) || []).length;
        assert(badCount === 1,
            `EE-5: 제조원가 termPairs — 정확히 1개 (사용자 요구: 용어 쌍 1개만 노출). 실제: ${badCount}개`);
    }
}

// EE-6: 수익성분석 termPairs 는 기존 2개 유지 (매출/이익)
{
    const prftSection = _coachBlockSrc.match(/['"]profitability['"]\s*:\s*\{[\s\S]*?termPairs:\s*\[([\s\S]*?)\]/);
    assert(prftSection, 'EE-6a: profitability termPairs 섹션 추출 가능 (COACH_STEP3_CONTENT 내부)');
    if (prftSection) {
        const termPairsBody = prftSection[1];
        const badCount = (termPairsBody.match(/\bbad\s*:/g) || []).length;
        assert(badCount === 2,
            `EE-6: 수익성분석 termPairs — 기존 2개 유지 (매출/이익). 실제: ${badCount}개`);
    }
}

// EE-7: 제조원가 goodExamples + badExamples 포함 확인 (COACH_STEP3_CONTENT 내부에서 검색)
//   주의: `{...},` 패턴은 중첩 중괄호를 못 다루므로 (termPairs 안의 {bad:...,good:...}, 에 걸림)
//   badExamples 섹션의 닫는 ]  까지 확실히 매칭하도록 범위 지정.
{
    // 'manufacturing-cost' 부터 ' badExamples: [ ... ],' 가 끝날 때까지 전체 섹션 추출
    const mfgSection = _coachBlockSrc.match(/['"]manufacturing-cost['"]\s*:\s*\{[\s\S]*?badExamples:\s*\[[\s\S]*?\][\s\S]*?\}/);
    assert(mfgSection
        && /goodExamples:\s*\[[\s\S]*?제품별 매출원가 TOP 5[\s\S]*?전월대비 제품별 실제원가 증가액 TOP 10/.test(mfgSection[0])
        && /badExamples:\s*\[[\s\S]*?원가 알려줘[\s\S]*?어떤 제품이 비싸\?/.test(mfgSection[0]),
        'EE-7: 제조원가 goodExamples=["제품별 매출원가 TOP 5", "전월대비..."] + badExamples=["원가 알려줘", "어떤 제품이 비싸?"]');
}

// ============================================================
// FF. buildCoachStep3Html 함수 — 영역별 HTML 생성
// ============================================================

// FF-1: buildCoachStep3Html 함수 정의
assertMatch(htmlSrc,
    /function\s+buildCoachStep3Html\s*\(\s*areaKey\s*\)/,
    'FF-1: buildCoachStep3Html(areaKey) 함수 정의');

// FF-2: 알 수 없는 영역 → profitability fallback
{
    const fn = htmlSrc.match(/function\s+buildCoachStep3Html\s*\(\s*areaKey\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /COACH_STEP3_CONTENT\s*\[\s*areaKey\s*\]\s*\|\|\s*COACH_STEP3_CONTENT\s*\[\s*['"]profitability['"]\s*\]/.test(fn[0]),
        'FF-2: 알 수 없는 areaKey → profitability 폴백 (|| 연산자)');
}

// FF-3: termPairs 를 <li><span class="bad">bad</span>...<span class="good">good</span></li> 로 렌더
{
    const fn = htmlSrc.match(/function\s+buildCoachStep3Html\s*\(\s*areaKey\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /content\.termPairs\.map\s*\(\s*p\s*=>[\s\S]{0,500}class="bad"[\s\S]{0,100}\$\{p\.bad\}[\s\S]{0,200}class="good"[\s\S]{0,100}\$\{p\.good\}/.test(fn[0]),
        'FF-3: termPairs.map 으로 bad/good span 렌더링');
}

// FF-4: goodExamples 를 ✔ + class="good" 으로 렌더
{
    const fn = htmlSrc.match(/function\s+buildCoachStep3Html\s*\(\s*areaKey\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /content\.goodExamples\.map[\s\S]{0,500}class="good"[\s\S]{0,100}✔\s*\$\{q\}/.test(fn[0]),
        'FF-4: goodExamples.map — ✔ 아이콘 + .good 클래스');
}

// FF-5: badExamples 를 ✘ + class="bad" 로 렌더
{
    const fn = htmlSrc.match(/function\s+buildCoachStep3Html\s*\(\s*areaKey\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /content\.badExamples\.map[\s\S]{0,500}class="bad"[\s\S]{0,100}✘\s*\$\{q\}/.test(fn[0]),
        'FF-5: badExamples.map — ✘ 아이콘 + .bad 클래스');
}

// FF-6: HTML 템플릿에 '용어집에 등록된 용어' 안내 포함 (기존 디자인 유지)
{
    const fn = htmlSrc.match(/function\s+buildCoachStep3Html\s*\(\s*areaKey\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /용어집에\s*등록된\s*용어\s*·\s*동의어[\s\S]{0,500}답변\s*품질/.test(fn[0]),
        'FF-6: HTML — "용어집에 등록된 용어 · 동의어" 안내 (기존 디자인 유지)');
}

// FF-7: '좋은 질문' / '불명확한 질문' 섹션 헤더 유지
{
    const fn = htmlSrc.match(/function\s+buildCoachStep3Html\s*\(\s*areaKey\s*\)\s*\{[\s\S]*?\n\}/);
    assert(fn
        && /<b>좋은\s*질문<\/b>/.test(fn[0])
        && /<b>불명확한\s*질문<\/b>/.test(fn[0]),
        'FF-7: HTML — "좋은 질문" / "불명확한 질문" 섹션 헤더 유지');
}

// ============================================================
// GG. COACH_STEPS STEP 3 — html → getHtml 전환
// ============================================================

// GG-1: 3단계 엔트리에 getHtml 콜백 포함 (html 하드코딩 제거)
assertMatch(htmlSrc,
    /title:\s*['"]3단계\s*·\s*정확한\s*용어\s*사용\s*&\s*질문\s*구체화['"][\s\S]{0,2000}getHtml:\s*\(\s*\)\s*=>\s*buildCoachStep3Html\s*\(\s*getCurrentCoachArea\(\s*\)\s*\)/,
    'GG-1: 3단계 엔트리 — getHtml: () => buildCoachStep3Html(getCurrentCoachArea())');

// GG-2: 3단계 엔트리에서 기존 html 상수 완전 제거 (수익성분석 하드코딩 제거)
{
    // 3단계 엔트리 블록 추출
    const stepEntry = htmlSrc.match(/\{\s*[\s\S]{0,1000}title:\s*['"]3단계[\s\S]*?\}\s*,\s*\n\s*\{\s*target:\s*['"]#queryModeBar['"]/);
    assert(stepEntry
        && !/html:\s*`[\s\S]*?매출총이익/.test(stepEntry[0]),
        'GG-2: 3단계 엔트리에서 수익성분석 하드코딩(매출총이익 포함 html) 제거됨');
}

// ============================================================
// HH. renderCoachStep — step.getHtml?.() ?? step.html 패턴
// ============================================================

// HH-1: step.getHtml 체크 + 호출 로직
assertMatch(htmlSrc,
    /\(\s*typeof\s+step\.getHtml\s*===\s*['"]function['"]\s*\)\s*\?\s*step\.getHtml\(\s*\)\s*:\s*step\.html/,
    'HH-1: renderCoachStep — (typeof step.getHtml === "function") ? step.getHtml() : step.html');

// HH-2: 하위 호환 — STEP 1/2/4 는 여전히 html 상수 사용 (수정 안 됨)
{
    const step1 = htmlSrc.match(/title:\s*['"]1단계[\s\S]*?html:\s*`[^`]+`/);
    assert(step1, 'HH-2a: 1단계 — html 상수 유지 (하위 호환)');

    const step2 = htmlSrc.match(/title:\s*['"]2단계[\s\S]*?html:\s*`[^`]+`/);
    assert(step2, 'HH-2b: 2단계 — html 상수 유지 (하위 호환)');

    const step4 = htmlSrc.match(/title:\s*['"]4단계[\s\S]*?html:\s*`[^`]+`/);
    assert(step4, 'HH-2c: 4단계 — html 상수 유지 (하위 호환)');
}

// ============================================================
// II. 통합 — 함수 동작 검증 (실제 실행)
// ============================================================

// II-1: buildCoachStep3Html 함수 + COACH_STEP3_CONTENT 상수를 추출해서 직접 실행
{
    // 두 심볼이 들어있는 블록을 추출해서 eval (안전한 격리 실행)
    const contentDef = htmlSrc.match(/const\s+COACH_STEP3_CONTENT\s*=[\s\S]*?\n\};/);
    const buildFn = htmlSrc.match(/function\s+buildCoachStep3Html\s*\([\s\S]*?\n\}/);
    if (!contentDef || !buildFn) {
        assert(false, 'II-1a: COACH_STEP3_CONTENT 또는 buildCoachStep3Html 추출 실패');
    } else {
        // eval 로 격리 실행 (sandbox 테스트 전용, 프로덕션 코드 아님)
        const sandbox = eval(`(function(){ ${contentDef[0]} ${buildFn[0]} return { COACH_STEP3_CONTENT, buildCoachStep3Html }; })()`);

        // 수익성분석
        const prftHtml = sandbox.buildCoachStep3Html('profitability');
        assert(/매출총이익/.test(prftHtml) && /영업이익/.test(prftHtml),
            'II-1: profitability → 매출총이익 + 영업이익 예시 포함');

        // 제조원가
        const mfgHtml = sandbox.buildCoachStep3Html('manufacturing-cost');
        assert(/제품별 매출원가 TOP 5/.test(mfgHtml) && /실제원가 · 매출원가 · 표준원가/.test(mfgHtml),
            'II-2: manufacturing-cost → 제품별 매출원가 + 실제원가 ·매출원가 ·표준원가 포함');

        // 수익성분석 콘텐츠에 제조원가 예시 없음 (크로스 오염 X)
        assert(!/제품별 매출원가 TOP 5/.test(prftHtml) && !/실제원가 · 매출원가 · 표준원가/.test(prftHtml),
            'II-3: profitability 콘텐츠에 제조원가 예시 없음 (크로스 오염 X)');

        // 제조원가 콘텐츠에 수익성분석 예시 없음 (크로스 오염 X)
        assert(!/매출총이익 증가액/.test(mfgHtml) && !/거래처별 영업이익/.test(mfgHtml),
            'II-4: manufacturing-cost 콘텐츠에 수익성분석 예시 없음 (크로스 오염 X)');

        // 알 수 없는 영역 → profitability fallback
        const unknownHtml = sandbox.buildCoachStep3Html('unknown-area-key');
        assert(unknownHtml === prftHtml,
            'II-5: 알 수 없는 영역 → profitability HTML 로 fallback');

        // null / undefined 입력도 안전
        const nullHtml = sandbox.buildCoachStep3Html(null);
        assert(nullHtml === prftHtml,
            'II-6: null 입력 → profitability fallback');

        // 제조원가 termPairs 가 정확히 1개 (실제 HTML 안에 <li> 개수 세기)
        const mfgTermLiMatches = mfgHtml.match(/<li[^>]*>[^<]*<span class="bad">[^<]+<\/span>\s*보다\s*→/g) || [];
        assert(mfgTermLiMatches.length === 1,
            `II-7: 제조원가 HTML — termPairs <li> 정확히 1개 (사용자 요구). 실제: ${mfgTermLiMatches.length}개`);

        // 수익성분석 termPairs 는 2개 유지
        const prftTermLiMatches = prftHtml.match(/<li[^>]*>[^<]*<span class="bad">[^<]+<\/span>\s*보다\s*→/g) || [];
        assert(prftTermLiMatches.length === 2,
            `II-8: 수익성분석 HTML — termPairs <li> 2개 유지. 실제: ${prftTermLiMatches.length}개`);
    }
}

// ============================================================
// 결과 요약
// ============================================================
console.log('\n=== TEST RESULT ===');
console.log(`PASS: ${PASS}`);
console.log(`FAIL: ${FAIL}`);
if (FAIL > 0) {
    console.log('\nFAILED CASES:');
    failures.forEach(f => console.log('  -', f));
    process.exit(1);
}
console.log('\n✅ 모든 테스트 통과');
process.exit(0);
