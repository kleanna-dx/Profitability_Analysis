/**
 * test_mfg_session_cost_basis.mjs
 *
 * [2026-10-16] 제조원가(sys_aimd_cot015) 자연어 질의 — 원가 기준(ZCGUBUN) 세션 상태 관리
 *                regression 방지 테스트.
 *
 * 배경:
 *   사용자 신고 — 제조원가 영역에서 "매출원가로 보여줘" 라고 한 뒤 "인건비 TOP5" 라고
 *   물으면 다시 실제원가(기본값)로 돌아가거나, ZCGUBUN 조건이 아예 안 걸려 서로 다른
 *   원가 기준의 금액이 섞여 SUM 되는 문제.
 *
 *   기존 명확화 UI 는 "원가요소/원가유형/원가항목" 같은 키워드가 있을 때만 트리거되어
 *   "인건비 TOP5" 같은 자유 질의는 ZCGUBUN 필터가 안 들어감.
 *
 * 수정 (방법 2: 서버 WHERE 템플릿 치환 — LLM 호출 없음):
 *   서버 (nlq-server/server.mjs):
 *     - 상수 COST_BASIS_OPTIONS (4개 원가 기준) + DEFAULT_COST_BASIS 정의
 *     - normalizeSessionCostBasis(raw) — whitelist 검증 함수
 *     - buildAppliedCostBasisResponse(costBasis) — showDropdown 결정 + 응답 조립
 *     - aggregate / analysis route 양쪽에 appliedCostBasis 응답 메타 추가
 *     - forcedCostBasis 결정 블록에 sessionCostBasis 3순위 폴백 추가
 *       (1순위: confirmedForcedCostBasis / 2순위: body.forcedCostBasis / 3순위: body.sessionCostBasis)
 *     - saveHistory() 에서 chart_config._sessionCostBasis 저장 로직 추가 (스키마 변경 없음)
 *
 *   프론트 (nlq-server/public/index.html):
 *     - let currentCostBasis — 메모리 변수 (currentDomain 과 동일 패턴, 세션 상태)
 *     - resetCurrentCostBasis() — 새 채팅/페이지 초기 로드 시 기본값 리셋
 *     - syncCostBasisFromResponse(appliedCostBasis) — 서버 응답 반영
 *     - sendQuery payload 에 매번 sessionCostBasis 자동 포함 (currentDomain 과 동일 패턴)
 *     - buildAnalysisDetailTable 에 appliedCostBasis 파라미터 추가 → 결과표 toolbar 에 뱃지/드롭다운
 *     - onCostBasisDropdownChange(selectEl) — 드롭다운 변경 시 즉시 재질의 (LLM 호출 없음)
 *     - restoreSession 에 _sessionCostBasis 복원 로직 (items 최신 row 1개)
 *     - startNewChat 에 resetCurrentCostBasis() 호출
 *     - resendQueryWithForcedCostBasis 에서 명확화 UI 선택 시 currentCostBasis 동기화
 *
 * 범위:
 *   - sys_aimd_cot015 (제조원가) 전용 — 수익성분석(bw_profitability_data)/cot043 영향 없음
 *   - aggregate(현황집계) + analysis(분석질문) 모드 모두 적용
 *   - 상태 저장: 메모리 변수(let) + DB 백업 (chart_config._sessionCostBasis, 스키마 변경 없음)
 *   - VQB 미건드림 (별개 route)
 *   - deyang 영역 미건드림
 *
 * 실행: node nlq-server/tests/test_mfg_session_cost_basis.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVER_MJS = resolve(__dirname, '../server.mjs');
const INDEX_HTML = resolve(__dirname, '../public/index.html');

const serverSrc = readFileSync(SERVER_MJS, 'utf8');
const htmlSrc = readFileSync(INDEX_HTML, 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, name) {
    if (cond) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name); }
}
function assertMatch(src, re, name) {
    const ok = re.test(src);
    if (ok) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name, '\n  regex:', re); }
}
function assertNoMatch(src, re, name) {
    const ok = !re.test(src);
    if (ok) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name, '\n  regex (should NOT match):', re); }
}

// ============================================================
// A. SERVER — 상수/함수 정의
// ============================================================

// A-1 ~ A-5: COST_BASIS_OPTIONS 상수 (4개 원가 기준)
assertMatch(serverSrc,
    /const\s+COST_BASIS_OPTIONS\s*=\s*\[/,
    'A-1: COST_BASIS_OPTIONS 상수 정의');

assertMatch(serverSrc,
    /COST_BASIS_OPTIONS\s*=\s*\[[\s\S]{0,800}value:\s*['"]실제원가['"][\s\S]{0,100}zcgubunD:\s*null/,
    'A-2: 실제원가 (zcgubunD=null) 포함');

assertMatch(serverSrc,
    /COST_BASIS_OPTIONS\s*=\s*\[[\s\S]{0,800}value:\s*['"]매출원가['"][\s\S]{0,100}zcgubunD:\s*null/,
    'A-3: 매출원가 (zcgubunD=null) 포함');

assertMatch(serverSrc,
    /COST_BASIS_OPTIONS\s*=\s*\[[\s\S]{0,800}value:\s*['"]표준원가['"][\s\S]{0,100}zcgubunD:\s*['"]입고-생산['"]/,
    'A-4: 실제원가의 표준원가 (zcgubunD=입고-생산) 포함');

assertMatch(serverSrc,
    /COST_BASIS_OPTIONS\s*=\s*\[[\s\S]{0,800}value:\s*['"]표준원가['"][\s\S]{0,100}zcgubunD:\s*['"]소비-소비['"]/,
    'A-5: 매출원가의 표준원가 (zcgubunD=소비-소비) 포함');

// A-6: DEFAULT_COST_BASIS = 실제원가
assertMatch(serverSrc,
    /const\s+DEFAULT_COST_BASIS\s*=\s*\{[\s\S]{0,200}value:\s*['"]실제원가['"][\s\S]{0,100}source:\s*['"]default_fallback['"]/,
    'A-6: DEFAULT_COST_BASIS = 실제원가 / default_fallback');

// A-7 ~ A-10: normalizeSessionCostBasis(raw) 함수
assertMatch(serverSrc,
    /function\s+normalizeSessionCostBasis\s*\(\s*raw\s*\)/,
    'A-7: normalizeSessionCostBasis(raw) 함수 정의');

assertMatch(serverSrc,
    /normalizeSessionCostBasis[\s\S]{0,500}COST_BASIS_OPTIONS\.find\s*\(/,
    'A-8: whitelist 검증 (COST_BASIS_OPTIONS.find 사용)');

assertMatch(serverSrc,
    /normalizeSessionCostBasis[\s\S]{0,800}allowedSources[\s\S]{0,300}['"]default_fallback['"][\s\S]{0,100}['"]dropdown_change['"]/,
    'A-9: source whitelist 포함 (default_fallback, dropdown_change)');

assertMatch(serverSrc,
    /normalizeSessionCostBasis[\s\S]{0,800}['"]clarification_ui['"][\s\S]{0,100}['"]clarification_ui_subtype['"][\s\S]{0,100}['"]explicit_in_query['"]/,
    'A-10: source whitelist 포함 (clarification_ui, clarification_ui_subtype, explicit_in_query)');

// A-11 ~ A-14: buildAppliedCostBasisResponse 함수
assertMatch(serverSrc,
    /function\s+buildAppliedCostBasisResponse\s*\(\s*costBasis\s*\)/,
    'A-11: buildAppliedCostBasisResponse(costBasis) 함수 정의');

assertMatch(serverSrc,
    /buildAppliedCostBasisResponse[\s\S]{0,800}showDropdown\s*=\s*\(\s*costBasis\.source\s*===\s*['"]default_fallback['"]\s*\|\|\s*costBasis\.source\s*===\s*['"]dropdown_change['"]\s*\)/,
    'A-12: showDropdown=true 조건 (default_fallback OR dropdown_change)');

// A-13: 응답 포맷 — buildAppliedCostBasisResponse 함수 본문에 6개 필드가 모두 등장
{
    const m = serverSrc.match(/function\s+buildAppliedCostBasisResponse\s*\(\s*costBasis\s*\)\s*\{([\s\S]*?)\n\}/);
    const body = m ? m[1] : '';
    const fields = ['value:', 'zcgubunD:', 'label', 'source', 'showDropdown', 'options:'];
    const missing = fields.filter(f => !body.includes(f));
    assert(missing.length === 0,
        `A-13: 함수 본문에 6개 필드 모두 등장 — 누락=${JSON.stringify(missing)}`);
}

assertMatch(serverSrc,
    /buildAppliedCostBasisResponse[\s\S]{0,800}options:\s*COST_BASIS_OPTIONS\.map/,
    'A-14: options 에 COST_BASIS_OPTIONS 전체 리스트 포함 (드롭다운 재조립용)');

// ============================================================
// B. SERVER — forcedCostBasis 결정 블록에 sessionCostBasis 3순위 폴백
// ============================================================

assertMatch(serverSrc,
    /forcedCostBasis:\s*confirmedForcedCostBasis\s*\|\|\s*\(\(\)\s*=>\s*\{[\s\S]{0,2000}sessionCostBasis/,
    'B-1: forcedCostBasis 결정 블록에 sessionCostBasis 참조 포함');

assertMatch(serverSrc,
    /forcedCostBasis:[\s\S]{0,2000}normalizeSessionCostBasis\(\s*req\.body\?\.sessionCostBasis\s*\)/,
    'B-2: req.body.sessionCostBasis → normalizeSessionCostBasis 로 검증');

// B-3: 1순위 → 2순위 → 3순위 순서 보장
// confirmedForcedCostBasis 가 가장 먼저 체크되고, 그다음 body.forcedCostBasis, 마지막으로 sessionCostBasis
{
    const m = serverSrc.match(/forcedCostBasis:\s*confirmedForcedCostBasis\s*\|\|\s*\(\(\)\s*=>\s*\{([\s\S]{0,2500}?)\}\s*\)\s*\(\s*\)\s*,/);
    assert(!!m, 'B-3a: forcedCostBasis IIFE 블록 추출 성공');
    if (m) {
        const body = m[1];
        const idxForced = body.indexOf('req.body?.forcedCostBasis');
        const idxSession = body.indexOf('normalizeSessionCostBasis');
        assert(idxForced >= 0 && idxSession >= 0 && idxForced < idxSession,
            'B-3b: body.forcedCostBasis(2순위) 가 sessionCostBasis(3순위) 보다 먼저 평가됨');
    } else {
        FAIL++; failures.push('B-3b: IIFE 블록 미발견으로 순서 검증 불가');
    }
}

// B-4: 둘 다 없을 때 null 반환 → 강제 필터 미주입
assertMatch(serverSrc,
    /forcedCostBasis:[\s\S]{0,2000}if\s*\(\s*sessionCb\s*\)\s*return\s+sessionCb\s*;?\s*return\s+null/,
    'B-4: sessionCostBasis 도 없으면 null 반환 (기존 흐름 유지)');

// ============================================================
// C. SERVER — aggregate route 응답에 appliedCostBasis 메타 추가
// ============================================================

// [2026-10-22 FIX] 'selectedTable' 지역변수가 route scope 에 없어 500 에러를 유발.
//   올바른 참조는 areaCtx.table — 파일 전반 일관성 유지.
assertMatch(serverSrc,
    /let\s+appliedCostBasisMeta\s*=\s*null\s*;\s*\n\s*if\s*\(\s*areaCtx\s*&&\s*areaCtx\.table\s*===\s*['"]sys_aimd_cot015['"]\s*\)/,
    'C-1: aggregate route — areaCtx.table === "sys_aimd_cot015" 조건 분기 (selectedTable ReferenceError 수정)');

assertMatch(serverSrc,
    /appliedCostBasisMeta\s*=\s*buildAppliedCostBasisResponse\s*\(\s*_effectiveCostBasis\s*\)/,
    'C-2: aggregate route — buildAppliedCostBasisResponse 호출');

assertMatch(serverSrc,
    /appliedCostBasisMeta[\s\S]{0,1500}value:\s*['"]실제원가['"][\s\S]{0,100}source:\s*['"]default_fallback['"]/,
    'C-3: aggregate route — forcedCostBasis 미설정 시 "실제원가/default_fallback" 폴백');

assertMatch(serverSrc,
    /const\s+result\s*=\s*\{[\s\S]{0,3000}appliedCostBasis:\s*appliedCostBasisMeta\s*,/,
    'C-4: aggregate route — result 응답 객체에 appliedCostBasis 포함');

assertMatch(serverSrc,
    /saveHistory\s*\([\s\S]{0,500}sessionCostBasis:\s*appliedCostBasisMeta\s*\}\s*\)/,
    'C-5: aggregate route — saveHistory 호출에 sessionCostBasis 전달');

// ============================================================
// D. SERVER — analysis route 응답에 appliedCostBasis 메타 추가
// ============================================================

assertMatch(serverSrc,
    /let\s+appliedCostBasisAnalysis\s*=\s*null/,
    'D-1: analysis route — appliedCostBasisAnalysis 변수 선언');

assertMatch(serverSrc,
    /appliedCostBasisAnalysis\s*=\s*buildAppliedCostBasisResponse\s*\(\s*_effCb\s*\)/,
    'D-2: analysis route — buildAppliedCostBasisResponse 호출');

assertMatch(serverSrc,
    /appliedCostBasis:\s*appliedCostBasisAnalysis/,
    'D-3: analysis route — 응답 객체에 appliedCostBasis 포함');

assertMatch(serverSrc,
    /sessionCostBasis:\s*appliedCostBasisAnalysis\s*\}/,
    'D-4: analysis route — saveHistory 호출에 sessionCostBasis 전달');

// ============================================================
// E. SERVER — saveHistory 에서 chart_config._sessionCostBasis 저장
// ============================================================

assertMatch(serverSrc,
    /if\s*\(\s*options\s*&&\s*options\.sessionCostBasis\s*&&\s*typeof\s+options\.sessionCostBasis\.value\s*===\s*['"]string['"]\s*\)/,
    'E-1: saveHistory — options.sessionCostBasis 가 유효할 때만 저장');

assertMatch(serverSrc,
    /_sessionCostBasis:\s*\{[\s\S]{0,300}value:[\s\S]{0,100}zcgubunD:[\s\S]{0,100}source:/,
    'E-2: _sessionCostBasis 저장 포맷 — value/zcgubunD/source (label/options 미저장)');

// E-3: _sessionCostBasis 가 _clarificationSelections 와 공존 (언더스코어 메타 규약)
assertMatch(serverSrc,
    /_cfgToPersist\s*=\s*\{\s*\.\.\.\s*\(_cfgToPersist\s*\|\|\s*\{\}\s*\)\s*,\s*\n\s*_sessionCostBasis:/,
    'E-3: 저장 시 기존 _cfgToPersist 유지 + _sessionCostBasis 병합 (spread)');

// E-4: 스키마 변경 없음 — chart_config 는 기존 JSON 컬럼 그대로 사용
assertNoMatch(serverSrc,
    /ALTER\s+TABLE\s+nl_query_history[\s\S]{0,200}_sessionCostBasis/i,
    'E-4: nl_query_history 테이블 ALTER 가 없음 (chart_config JSON 재활용)');

// ============================================================
// F. FRONTEND — currentCostBasis 메모리 변수 + 헬퍼
// ============================================================

assertMatch(htmlSrc,
    /let\s+currentCostBasis\s*=\s*\{\s*value:\s*['"]실제원가['"][\s\S]{0,150}source:\s*['"]default_fallback['"]/,
    'F-1: let currentCostBasis — 기본값 = 실제원가 / default_fallback');

assertMatch(htmlSrc,
    /function\s+resetCurrentCostBasis\s*\(\s*\)[\s\S]{0,300}currentCostBasis\s*=\s*\{\s*value:\s*['"]실제원가['"]/,
    'F-2: resetCurrentCostBasis() — 기본값으로 리셋');

assertMatch(htmlSrc,
    /function\s+syncCostBasisFromResponse\s*\(\s*appliedCostBasis\s*\)/,
    'F-3: syncCostBasisFromResponse(appliedCostBasis) 함수 정의');

assertMatch(htmlSrc,
    /syncCostBasisFromResponse[\s\S]{0,600}currentCostBasis\s*=\s*\{\s*\n?\s*value:\s*appliedCostBasis\.value/,
    'F-4: syncCostBasisFromResponse — currentCostBasis 를 응답값으로 덮어씀');

// ============================================================
// G. FRONTEND — sendQuery payload 에 sessionCostBasis 포함
// ============================================================

assertMatch(htmlSrc,
    /asyncPayload\.sessionCostBasis\s*=\s*\{\s*\n?\s*value:\s*currentCostBasis\.value/,
    'G-1: asyncPayload.sessionCostBasis = { value, zcgubunD, source } 전송');

// ============================================================
// H. FRONTEND — 응답 수신 시 syncCostBasisFromResponse 호출
// ============================================================

assertMatch(htmlSrc,
    /if\s*\(\s*data\.appliedCostBasis\s*\)\s*syncCostBasisFromResponse\s*\(\s*data\.appliedCostBasis\s*\)/,
    'H-1: 응답 분기에서 syncCostBasisFromResponse(data.appliedCostBasis) 호출');

// H-2: aggregate + analysis 두 경로 모두 호출 (적어도 2번 등장)
{
    const matches = htmlSrc.match(/syncCostBasisFromResponse\s*\(\s*data\.appliedCostBasis\s*\)/g) || [];
    assert(matches.length >= 2, `H-2: syncCostBasisFromResponse(data.appliedCostBasis) 호출이 2회 이상 (aggregate+analysis) — 실제=${matches.length}`);
}

// ============================================================
// I. FRONTEND — buildAnalysisDetailTable 뱃지/드롭다운
// ============================================================

assertMatch(htmlSrc,
    /function\s+buildAnalysisDetailTable\s*\([\s\S]{0,500}appliedCostBasis\s*\)/,
    'I-1: buildAnalysisDetailTable 함수 시그니처에 appliedCostBasis 파라미터 추가');

assertMatch(htmlSrc,
    /let\s+costBasisBadgeHtml\s*=\s*['"]['"]\s*;\s*\n?\s*let\s+costBasisDropdownHtml\s*=\s*['"]['"]\s*;/,
    'I-2: costBasisBadgeHtml / costBasisDropdownHtml 변수 초기화');

assertMatch(htmlSrc,
    /sourceLabelMap\s*=\s*\{[\s\S]{0,500}['"]default_fallback['"]\s*:\s*['"]기본값['"][\s\S]{0,200}['"]dropdown_change['"]\s*:\s*['"]사용자 변경['"]/,
    'I-3: source → 뱃지 라벨 매핑 (기본값/사용자 변경)');

assertMatch(htmlSrc,
    /sourceLabelMap[\s\S]{0,500}['"]clarification_ui['"]\s*:\s*['"]사용자 선택['"][\s\S]{0,200}['"]explicit_in_query['"]\s*:\s*['"]질문에서 명시['"]/,
    'I-4: source → 뱃지 라벨 매핑 (사용자 선택/질문에서 명시)');

assertMatch(htmlSrc,
    /if\s*\(\s*appliedCostBasis\.showDropdown\s*&&\s*Array\.isArray\s*\(\s*appliedCostBasis\.options\s*\)\s*\)/,
    'I-5: showDropdown=true + options 배열일 때만 드롭다운 렌더');

assertMatch(htmlSrc,
    /onchange="onCostBasisDropdownChange\(this\)"/,
    'I-6: <select onchange="onCostBasisDropdownChange(this)"> 바인딩');

// I-7: option value 포맷 "<value>|<zcgubunD>"
assertMatch(htmlSrc,
    /optKey\s*=\s*`\$\{opt\.value\}\|\$\{opt\.zcgubunD\s*\|\|\s*['"]['"]\}`/,
    'I-7: option value 포맷 "<value>|<zcgubunD>" 사용');

// [2026-10-22 신규] I-8 / I-9 — buildAnalysisDetailTable 호출부 모두 appliedCostBasis 전달
//   사용자 신고: aggregate 결과표에 뱃지/드롭다운이 보이지 않음.
//   원인: aggregate 호출부(appendBotMessage, 라인 ~3829)가 10번째 인자를 안 넘겨 undefined 로 호출됨.
//         analysis 호출부(appendAnalysisOnlyMessage)만 appliedCostBasis 가 전달되고 있었음.
//   재발 방지: 두 호출부 모두 10번째 인자로 appliedCostBasis 를 전달해야 함.

// I-8: aggregate 호출부 (appendBotMessage) — data.appliedCostBasis 전달
assertMatch(htmlSrc,
    /buildAnalysisDetailTable\s*\(\s*detailTableId[\s\S]{0,500}data\.appliedCostBasis/,
    'I-8: aggregate 호출부(appendBotMessage) 가 data.appliedCostBasis 를 10번째 인자로 전달 (뱃지/드롭다운 렌더용)');

// I-9: analysis 호출부 (appendAnalysisOnlyMessage) — dataOrText.appliedCostBasis 전달
assertMatch(htmlSrc,
    /buildAnalysisDetailTable\s*\(\s*tableId[\s\S]{0,500}dataOrText\.appliedCostBasis/,
    'I-9: analysis 호출부(appendAnalysisOnlyMessage) 가 dataOrText.appliedCostBasis 를 10번째 인자로 전달');

// I-10: buildAnalysisDetailTable 호출 중 "9-인자 (appliedCostBasis 누락)" 가 없는지 재확인
//   모든 호출의 인자 개수가 10개여야 함 (showWidenButton + appliedCostBasis 둘 다 명시)
{
    const callRe = /buildAnalysisDetailTable\s*\(([^)]*)\)/g;
    const argCounts = [];
    let m;
    while ((m = callRe.exec(htmlSrc)) !== null) {
        argCounts.push(m[1].split(',').map(s => s.trim()).filter(Boolean).length);
    }
    const bad = argCounts.filter(n => n < 10);
    assert(bad.length === 0,
        `I-10: 모든 buildAnalysisDetailTable 호출이 10-인자여야 함 — 9개 이하 호출=${bad.length}, 전체=${JSON.stringify(argCounts)}`);
}

// ============================================================
// J. FRONTEND — onCostBasisDropdownChange 핸들러
// ============================================================

assertMatch(htmlSrc,
    /async\s+function\s+onCostBasisDropdownChange\s*\(\s*selectEl\s*\)/,
    'J-1: async function onCostBasisDropdownChange(selectEl) 정의');

assertMatch(htmlSrc,
    /onCostBasisDropdownChange[\s\S]{0,1500}sepIdx\s*=\s*raw\.indexOf\s*\(\s*['"]\|['"]\s*\)/,
    'J-2: select.value 파싱 — "|" 로 value/zcgubunD 분리');

assertMatch(htmlSrc,
    /onCostBasisDropdownChange[\s\S]{0,1500}currentCostBasis\s*=\s*\{[\s\S]{0,300}source:\s*['"]dropdown_change['"]/,
    'J-3: 드롭다운 변경 → currentCostBasis.source="dropdown_change" 로 즉시 업데이트');

// [2026-10-22 B-3 전환] J-4 ~ J-7 전면 교체.
//   방식 A (sendQuery 재호출) → 방식 B-3 (in-place 재조회) 전환으로
//   아래 검증 포인트가 완전히 바뀜:
//     - 더 이상 sendQuery 재호출 안 함 (J-4 반전)
//     - 더 이상 "원 질의 텍스트" 역탐색 안 함 (J-6/J-7 삭제)
//     - 대신 /api/nlq/rewrite-cost-basis 호출 (B-3 신규)
//     - 표/차트 in-place 갱신 (B-3 신규)
//     - selectEl.disabled 중복 방지 (유지 — J-5)
{
    const m = htmlSrc.match(/async\s+function\s+onCostBasisDropdownChange\s*\(\s*selectEl\s*\)\s*\{([\s\S]*?)\n\s{0,4}\}\n/);
    const body = m ? m[1] : '';

    // J-4 (반전): sendQuery 재호출 금지 (방식 A 패턴 완전 제거 확인)
    assert(!/await\s+sendQuery\s*\(\s*originalQuery/.test(body),
        'J-4: sendQuery(originalQuery, ...) 재호출 완전 제거 (방식 A → B-3 전환 완료)');

    // J-5 (유지): 중복 변경 방지
    assert(/selectEl\.disabled\s*=\s*true/.test(body),
        'J-5: 중복 변경 방지 (selectEl.disabled = true)');

    // J-6 신규: /api/nlq/rewrite-cost-basis 호출
    assert(/fetch\s*\(\s*['"]\/api\/nlq\/rewrite-cost-basis['"]/.test(body),
        'J-6: fetch(/api/nlq/rewrite-cost-basis) 호출 (B-3 in-place 재조회)');

    // J-7 신규: 응답으로 analysisTableState.rows 교체 + renderAnalysisTable 재호출
    assert(/st\.rows\s*=\s*data\.data/.test(body) && /renderAnalysisTable\s*\(\s*tableId\s*\)/.test(body),
        'J-7: 응답으로 analysisTableState[tableId].rows 교체 + renderAnalysisTable(tableId) 재호출');

    // J-8 신규: 차트도 함께 갱신 (사용자 요구사항 — 표 바뀌면 차트도 바뀌어야)
    assert(/renderMsgChart\s*\(/.test(body) && /_nlqChartData\.data\s*=\s*data\.data/.test(body),
        'J-8: 차트 canvas._nlqChartData.data 교체 + renderMsgChart 재호출 (표+차트 동시 갱신)');

    // J-9 신규: 뱃지/드롭다운 재조립
    assert(/refreshCostBasisBadgeAndDropdown\s*\(/.test(body),
        'J-9: refreshCostBasisBadgeAndDropdown 호출 (뱃지/드롭다운 selected 교체)');

    // J-10 신규: 답변 흐리게 효과
    assert(/applyCostBasisDimEffect\s*\(/.test(body),
        'J-10: applyCostBasisDimEffect 호출 (답변 영역 흐리게 + 안내 문구)');

    // J-11 신규: history row UPDATE (채팅 재진입 복원용)
    assert(/\/api\/history\/session\/[\s\S]{0,80}\/cost-basis/.test(body),
        'J-11: PATCH /api/history/session/:id/cost-basis fire-and-forget 호출');

    // J-12 신규 (2026-10-22 B-3 fix): SQL 탭의 SQL pre 를 새 SQL (data.newSql) 로 교체
    //   사용자 신고: 표/차트는 바뀌는데 SQL 탭의 쿼리가 그대로 남아있어 혼란.
    assert(
        /_sqlPre/.test(body) && /data\.newSql/.test(body) && /formatAndHighlightSql/.test(body),
        'J-12: SQL 탭 pre (_sqlPre) 를 data.newSql + formatAndHighlightSql 로 교체'
    );

    // J-13 신규 (2026-10-22 B-3 fix): SQL 편집기 textarea 도 함께 교체
    assert(
        /_editorTa/.test(body) && /formatSqlText/.test(body),
        'J-13: SQL 편집기 textarea (_editorTa) 도 data.newSql 로 교체 (편집 혼란 방지)'
    );
}

// ============================================================
// [2026-10-22] S. SERVER — _sanitizeWhereCond 중첩 외곽 괄호 벗기기
// ------------------------------------------------------------
// 사용자 신고: 드롭다운에서 원가 기준을 반복 변경하면 SQL WHERE 절에
//   AND (((((((CALMONTH = '202608'))))))) 처럼 괄호가 누적됨.
// 원인: applyForcedCostBasisFilter 가 매 호출마다 cond 를 `(cond)` 로 감싸서
//   반환 → 그 결과가 다음 호출의 입력이 되어 또 괄호 1겹 추가 → 반복.
// 수정: _sanitizeWhereCond 에 중첩 외곽 괄호 벗기기 로직 추가.
//   핵심 조건: "전체를 감싸는 1개의 괄호쌍" 일 때만 벗김. (A) AND (B) 는 X.
// ============================================================

// S-1: 중첩 외곽 괄호 벗기기 for 루프 (최대 20회)
assertMatch(serverSrc,
    /function\s+_sanitizeWhereCond[\s\S]{0,2000}중첩 외곽 괄호[\s\S]{0,500}for\s*\(\s*let\s+i\s*=\s*0\s*;\s*i\s*<\s*20\s*;/,
    'S-1: _sanitizeWhereCond 에 중첩 외곽 괄호 벗기기 for 루프 (최대 20회)');

// S-2: outerIsSinglePair 체크 — (A) AND (B) 같은 다중 괄호쌍은 안 벗김
assertMatch(serverSrc,
    /function\s+_sanitizeWhereCond[\s\S]{0,2500}outerIsSinglePair\s*=\s*true[\s\S]{0,500}depth\s*===\s*0\s*&&\s*j\s*<\s*s\.length\s*-\s*1/,
    'S-2: outerIsSinglePair depth tracking (여러 괄호쌍 보호)');

// S-3: 문자열(') 안의 괄호 무시 — "'2026(08)'" 같은 문자열 보호
assertMatch(serverSrc,
    /function\s+_sanitizeWhereCond[\s\S]{0,2500}inString\s*=\s*false[\s\S]{0,500}inString\s*=\s*!inString/,
    'S-3: 문자열 리터럴 안의 괄호 무시 (SQL 문자열 보호)');

// S-4: 바깥 괄호쌍 벗기기 — s.slice(1, -1)
assertMatch(serverSrc,
    /function\s+_sanitizeWhereCond[\s\S]{0,2500}s\s*=\s*s\.slice\s*\(\s*1\s*,\s*-1\s*\)\.trim\s*\(\s*\)/,
    'S-4: 바깥 괄호쌍 벗기기 — s.slice(1, -1).trim()');

// ============================================================
// [2026-10-22 BUGFIX] T. 명시 감지 승격 — session 값보다 우선
// ------------------------------------------------------------
// 사용자 신고: "제품별 매출원가 TOP 5" 질의 시 상단 설명은 매출원가 지만
//   SQL/뱃지는 실제원가 (이전 드롭다운 세션 값) 로 조회됨.
// 원인: shouldGate 블록이 "원가요소" 키워드가 있을 때만 confirmedForcedCostBasis
//   를 세팅. "매출원가" 명시만 있는 질의는 confirmedForcedCostBasis=null →
//   3순위 sessionCostBasis(실제원가) 가 승리 → 사용자 의도와 어긋남.
// 수정: shouldGate 와 별개로 explicit 감지된 ZCGUBUN 은 항상 1순위로 승격.
// ============================================================

// T-1: shouldGate 블록 위에 명시 감지 승격 로직 존재
assertMatch(serverSrc,
    /\[CostBasisExplicit\][\s\S]{0,500}명시 감지[\s\S]{0,200}session 보다 우선/,
    'T-1: [CostBasisExplicit] 명시 감지 로그 (session 보다 우선 승격)');

// T-2: 승격 조건 — explicit=true + zcgubun 있음 + (표준원가 서브타입 없는 케이스는 제외)
assertMatch(serverSrc,
    /!confirmedForcedCostBasis[\s\S]{0,300}explicitZcgubun\.explicit[\s\S]{0,300}explicitZcgubun\.zcgubun[\s\S]{0,500}!\s*\(\s*explicitZcgubun\.zcgubun\s*===\s*['"]표준원가['"]\s*&&\s*!explicitZcgubun\.zcgubunD\s*\)/,
    'T-2: 승격 조건 — explicit=true AND zcgubun 있음 AND NOT (표준원가 only without zcgubunD)');

// T-3: 서브타입 포함 (표준원가 + zcgubunD) 승격 로직
assertMatch(serverSrc,
    /\[CostBasisExplicit\][\s\S]{0,500}explicitZcgubun\.zcgubun\s*===\s*['"]표준원가['"][\s\S]{0,300}explicitZcgubun\.zcgubunD[\s\S]{0,200}source:\s*['"]explicit_in_query['"]/,
    'T-3: 표준원가 + 서브타입 명시 → 승격 (source=explicit_in_query)');

// T-4: 실제원가/매출원가 명시 → 승격 (source=explicit_in_query)
assertMatch(serverSrc,
    /\[CostBasisExplicit\][\s\S]{0,1000}else\s*\{[\s\S]{0,500}value:\s*explicitZcgubun\.zcgubun[\s\S]{0,300}source:\s*['"]explicit_in_query['"]/,
    'T-4: 실제원가/매출원가 명시 → 승격 (source=explicit_in_query)');

// ============================================================
// K. FRONTEND — restoreSession 복원 로직
// ============================================================

assertMatch(htmlSrc,
    /\[CostBasis:Restore\][\s\S]{0,500}세션 원가 기준 복원/,
    'K-1: restoreSession — 복원 로그 메시지 포함');

assertMatch(htmlSrc,
    /for\s*\(\s*let\s+i\s*=\s*items\.length\s*-\s*1\s*;\s*i\s*>=\s*0\s*;\s*i--\s*\)/,
    'K-2: restoreSession — items 역탐색 (최신 → 과거) 루프');

assertMatch(htmlSrc,
    /_cfg\._sessionCostBasis[\s\S]{0,300}typeof\s+_cfg\._sessionCostBasis\.value\s*===\s*['"]string['"]/,
    'K-3: restoreSession — chart_config._sessionCostBasis.value 유효성 체크');

assertMatch(htmlSrc,
    /if\s*\(\s*_restoredCb\s*\)\s*\{[\s\S]{0,500}currentCostBasis\s*=\s*\{[\s\S]{0,300}value:\s*_restoredCb\.value/,
    'K-4: restoreSession — 복원 성공 시 currentCostBasis 세팅');

assertMatch(htmlSrc,
    /복원 대상 없음[\s\S]{0,300}resetCurrentCostBasis\s*\(\s*\)/,
    'K-5: restoreSession — _sessionCostBasis 없으면 기본값 리셋 (이전 세션 잔여값 방지)');

// ============================================================
// L. FRONTEND — startNewChat 리셋
// ============================================================

assertMatch(htmlSrc,
    /function\s+startNewChat\s*\(\s*\)\s*\{[\s\S]{0,500}resetCurrentCostBasis\s*\(\s*\)/,
    'L-1: startNewChat — resetCurrentCostBasis() 호출 포함');

// ============================================================
// M. FRONTEND — 명확화 UI 선택 시 currentCostBasis 동기화
// ============================================================

assertMatch(htmlSrc,
    /resendQueryWithForcedCostBasis[\s\S]{0,2000}currentCostBasis\s*=\s*\{[\s\S]{0,300}source:\s*['"]clarification_ui['"]/,
    'M-1: resendQueryWithForcedCostBasis 안에서 currentCostBasis.source="clarification_ui" 로 동기화');

// ============================================================
// N. 범위 검증 — 수익성/VQB/deyang 영향 없음
// ============================================================

// N-1: VQB (builder) route 는 sessionCostBasis 안 참조
{
    // builder_query_history 는 cost basis 와 무관 — grep 으로 확인
    const vqbCostBasisMatches = serverSrc.match(/builder_query_history[\s\S]{0,500}sessionCostBasis/g) || [];
    assert(vqbCostBasisMatches.length === 0,
        `N-1: VQB (builder_query_history) 는 sessionCostBasis 미참조 — 실제=${vqbCostBasisMatches.length}`);
}

// N-2: appliedCostBasis 는 sys_aimd_cot015 조건 안에서만 생성 (aggregate route)
// [2026-10-22 FIX] selectedTable → areaCtx.table 패턴 반영
assertMatch(serverSrc,
    /if\s*\(\s*areaCtx\s*&&\s*areaCtx\.table\s*===\s*['"]sys_aimd_cot015['"]\s*\)\s*\{[\s\S]{0,1500}appliedCostBasisMeta\s*=\s*buildAppliedCostBasisResponse/,
    'N-2: aggregate route — appliedCostBasis 는 areaCtx.table === sys_aimd_cot015 조건 분기 안에서만 생성');

// N-3: deyang 모듈 (module-rolling-planning-simulation) 미건드림
assertNoMatch(serverSrc,
    /module-rolling-planning-simulation[\s\S]{0,500}sessionCostBasis/,
    'N-3: deyang 모듈 영역에 sessionCostBasis 변경 없음');

// ============================================================
// [2026-10-22 신규] N-4 / N-5 / N-6 — ReferenceError 재발 방지
// ------------------------------------------------------------
// 사용자 신고: "2026년 8월 인건비가 가장 많이 들어간 품목 TOP 5" 질의 시
//   - ReferenceError: selectedTable is not defined (server.mjs:13438)
//   - ReferenceError: tableWhitelist is not defined (CostBasisIntegrity)
// 원인: aggregate/analysis route 메인 핸들러 scope 에는 'selectedTable'
//       지역변수가 없음. 일부 함수 내부 파라미터로만 존재. 따라서
//       route 레벨 if 조건에서는 반드시 areaCtx.table 을 써야 함.
//       tableWhitelist 도 동일 — areaCtx.tableWhitelist 가 올바른 참조.
// 방지: route scope 에서 'if (selectedTable ===' 패턴을 금지한다.
//       또한 CostBasisIntegrity 호출의 tableWhitelist 는 areaCtx 를 거쳐야 함.
// ============================================================

// N-4: appliedCostBasis 생성 블록 근처에서 'selectedTable' 직접 참조 금지
//   (사용자 신고 ReferenceError 재발 방지 — 해당 scope 에는 const selectedTable 선언 없음)
//   참고: 라인 ~14069 에 const selectedTable = areaCtx.table 선언이 있는 다른 scope 에서는
//   selectedTable 사용이 정상이므로, 전역 금지가 아니라 appliedCostBasis 블록 주변만 체크.
{
    // appliedCostBasisMeta 블록 전후 300줄 범위에서 selectedTable 참조 금지
    const metaBlockIdx = serverSrc.indexOf('let appliedCostBasisMeta');
    const analysisBlockIdx = serverSrc.indexOf('let appliedCostBasisAnalysis');
    const checkRegions = [];
    if (metaBlockIdx >= 0) {
        // 블록 시작부터 200자 범위 (조건 분기 라인까지만)
        checkRegions.push(serverSrc.slice(metaBlockIdx, metaBlockIdx + 200));
    }
    if (analysisBlockIdx >= 0) {
        checkRegions.push(serverSrc.slice(analysisBlockIdx, analysisBlockIdx + 200));
    }
    const badRegions = checkRegions.filter(r => /if\s*\(\s*selectedTable\s*===/.test(r));
    assert(badRegions.length === 0,
        `N-4: appliedCostBasis 생성 블록은 selectedTable 를 참조하면 안 됨 (ReferenceError 재발 방지) — 위반=${badRegions.length}`);
}

// N-5: CostBasisIntegrity 호출은 반드시 areaCtx.tableWhitelist 를 거쳐야 함
assertMatch(serverSrc,
    /validateCostBasisSqlIntegrity\s*\(\s*\{[\s\S]{0,300}tableWhitelist:\s*\(areaCtx\s*&&\s*areaCtx\.tableWhitelist\)/,
    'N-5: validateCostBasisSqlIntegrity 호출은 areaCtx.tableWhitelist 를 전달해야 함 (tableWhitelist is not defined 재발 방지)');

// N-6: aggregate + analysis 두 route 모두 areaCtx.table === sys_aimd_cot015 패턴 사용
{
    const matches = serverSrc.match(/areaCtx\s*&&\s*areaCtx\.table\s*===\s*['"]sys_aimd_cot015['"]/g) || [];
    assert(matches.length >= 2,
        `N-6: areaCtx.table === "sys_aimd_cot015" 조건 분기가 aggregate+analysis 2곳 이상 — 실제=${matches.length}`);
}

// ============================================================
// O. CODE_HEALTH — 중복 선언/문법 안전성
// ============================================================

// O-1: COST_BASIS_OPTIONS 가 1회만 선언
{
    const matches = serverSrc.match(/const\s+COST_BASIS_OPTIONS\s*=/g) || [];
    assert(matches.length === 1,
        `O-1: COST_BASIS_OPTIONS 상수 1회만 선언 — 실제=${matches.length}`);
}

// O-2: normalizeSessionCostBasis 함수가 1회만 정의
{
    const matches = serverSrc.match(/function\s+normalizeSessionCostBasis\s*\(/g) || [];
    assert(matches.length === 1,
        `O-2: normalizeSessionCostBasis 함수 1회만 정의 — 실제=${matches.length}`);
}

// O-3: buildAppliedCostBasisResponse 함수가 1회만 정의
{
    const matches = serverSrc.match(/function\s+buildAppliedCostBasisResponse\s*\(/g) || [];
    assert(matches.length === 1,
        `O-3: buildAppliedCostBasisResponse 함수 1회만 정의 — 실제=${matches.length}`);
}

// O-4: currentCostBasis 변수가 1회만 선언 (프론트)
{
    const matches = htmlSrc.match(/let\s+currentCostBasis\s*=/g) || [];
    assert(matches.length === 1,
        `O-4: currentCostBasis 변수 1회만 선언 — 실제=${matches.length}`);
}

// O-5: onCostBasisDropdownChange 함수가 1회만 정의
{
    const matches = htmlSrc.match(/async\s+function\s+onCostBasisDropdownChange\s*\(/g) || [];
    assert(matches.length === 1,
        `O-5: onCostBasisDropdownChange 함수 1회만 정의 — 실제=${matches.length}`);
}

// ============================================================
// [2026-10-22 B-3] 신규 섹션 P — in-place 갱신 전환 검증
// ------------------------------------------------------------
// 방식 A (sendQuery 재호출) → 방식 B-3 (SQL WHERE 치환 + 표/차트만 교체)
// 전환으로 생긴 신규 서버 엔드포인트 2개 + 프론트 헬퍼 3개 + state 확장 검증.
// ============================================================

// ─── P. SERVER — 신규 엔드포인트 2개
// P-1: POST /api/nlq/rewrite-cost-basis 엔드포인트 정의
assertMatch(serverSrc,
    /app\.post\s*\(\s*['"]\/api\/nlq\/rewrite-cost-basis['"]/,
    'P-1: POST /api/nlq/rewrite-cost-basis 엔드포인트 정의');

// P-2: 신규 엔드포인트가 applyForcedCostBasisFilter 재사용 (LLM 호출 없음)
assertMatch(serverSrc,
    /\/api\/nlq\/rewrite-cost-basis[\s\S]{0,3000}applyForcedCostBasisFilter/,
    'P-2: rewrite 엔드포인트가 applyForcedCostBasisFilter 재사용 (LLM 호출 없음)');

// P-3: 신규 엔드포인트가 normalizeSessionCostBasis 로 whitelist 검증
assertMatch(serverSrc,
    /\/api\/nlq\/rewrite-cost-basis[\s\S]{0,3000}normalizeSessionCostBasis/,
    'P-3: rewrite 엔드포인트가 normalizeSessionCostBasis 로 whitelist 검증');

// P-4: 신규 엔드포인트가 isReadOnlyQuery 로 SELECT-only 방어
assertMatch(serverSrc,
    /\/api\/nlq\/rewrite-cost-basis[\s\S]{0,3000}isReadOnlyQuery/,
    'P-4: rewrite 엔드포인트가 isReadOnlyQuery 로 SELECT-only 방어');

// P-5: 신규 엔드포인트가 sys_aimd_cot015 전용 체크
assertMatch(serverSrc,
    /\/api\/nlq\/rewrite-cost-basis[\s\S]{0,3000}sys_aimd_cot015[\s\S]{0,500}전용/,
    'P-5: rewrite 엔드포인트는 sys_aimd_cot015 전용 (수익성/cot043 거부)');

// P-6: 응답에 newSql + appliedCostBasis 포함 (프론트 재사용용)
assertMatch(serverSrc,
    /\/api\/nlq\/rewrite-cost-basis[\s\S]{0,3000}newSql[\s\S]{0,500}appliedCostBasis/,
    'P-6: rewrite 응답에 newSql + appliedCostBasis 포함');

// P-7: PATCH /api/history/session/:sessionKey/cost-basis 엔드포인트 정의
assertMatch(serverSrc,
    /app\.patch\s*\(\s*['"]\/api\/history\/session\/:sessionKey\/cost-basis['"]/,
    'P-7: PATCH /api/history/session/:sessionKey/cost-basis 엔드포인트 정의');

// P-8: PATCH 엔드포인트가 chart_config._sessionCostBasis UPDATE (스키마 변경 없음)
assertMatch(serverSrc,
    /\/api\/history\/session\/:sessionKey\/cost-basis[\s\S]{0,2000}_sessionCostBasis/,
    'P-8: PATCH 엔드포인트가 chart_config._sessionCostBasis 업데이트');

// P-9: PATCH 엔드포인트가 UPDATE nl_query_history 로 저장 (ALTER 없음)
assertMatch(serverSrc,
    /\/api\/history\/session\/:sessionKey\/cost-basis[\s\S]{0,2000}UPDATE nl_query_history/,
    'P-9: PATCH 엔드포인트가 UPDATE nl_query_history 로 저장 (스키마 변경 없음)');

// ─── Q. FRONTEND — 헬퍼 함수 3개 + state 확장
// Q-1: initAnalysisDetailTable 시그니처 확장 (sql, initialAppliedCostBasis, chartCanvasId)
assertMatch(htmlSrc,
    /function\s+initAnalysisDetailTable\s*\(\s*tableId\s*,\s*rows\s*,\s*columnOrder\s*,\s*columnLabels\s*,\s*fromHistory\s*,\s*widenable\s*,\s*sql\s*,\s*initialAppliedCostBasis\s*,\s*chartCanvasId\s*\)/,
    'Q-1: initAnalysisDetailTable 시그니처에 sql/initialAppliedCostBasis/chartCanvasId 파라미터 추가');

// Q-2: analysisTableState 에 sql 저장
assertMatch(htmlSrc,
    /analysisTableState\[tableId\]\s*=\s*\{[\s\S]{0,800}sql:\s*\(/,
    'Q-2: analysisTableState 에 sql 저장 (드롭다운 재조회용)');

// Q-3: analysisTableState 에 initialAppliedCostBasis 저장 (원래값 복귀 판정용)
assertMatch(htmlSrc,
    /analysisTableState\[tableId\]\s*=\s*\{[\s\S]{0,800}initialAppliedCostBasis:/,
    'Q-3: analysisTableState 에 initialAppliedCostBasis 저장');

// Q-4: analysisTableState 에 chartCanvasId 저장 (차트 재렌더용)
assertMatch(htmlSrc,
    /analysisTableState\[tableId\]\s*=\s*\{[\s\S]{0,800}chartCanvasId:/,
    'Q-4: analysisTableState 에 chartCanvasId 저장 (차트 재렌더용)');

// Q-5: 신규 헬퍼 isSameCostBasis 정의
assertMatch(htmlSrc,
    /function\s+isSameCostBasis\s*\(\s*a\s*,\s*b\s*\)/,
    'Q-5: isSameCostBasis(a, b) 헬퍼 정의 (원래값 복귀 판정)');

// Q-6: 신규 헬퍼 refreshCostBasisBadgeAndDropdown 정의
assertMatch(htmlSrc,
    /function\s+refreshCostBasisBadgeAndDropdown\s*\(\s*wrap\s*,\s*appliedCostBasis\s*\)/,
    'Q-6: refreshCostBasisBadgeAndDropdown(wrap, appliedCostBasis) 헬퍼 정의');

// Q-7: 신규 헬퍼 applyCostBasisDimEffect 정의
assertMatch(htmlSrc,
    /function\s+applyCostBasisDimEffect\s*\(\s*msgBot\s*,\s*\{\s*changed\s*,\s*newLabel\s*\}\s*\)/,
    'Q-7: applyCostBasisDimEffect(msgBot, {changed, newLabel}) 헬퍼 정의');

// Q-8: 답변 흐리게 처리에 opacity 사용 (0.65 또는 유사)
assertMatch(htmlSrc,
    /applyCostBasisDimEffect[\s\S]{0,1500}header\.style\.opacity/,
    'Q-8: applyCostBasisDimEffect 가 header.style.opacity 로 답변 흐리게 처리');

// Q-9: 안내 문구에 "표/차트/SQL" 명시 (사용자에게 뭐가 바뀌었는지 전달)
//   [2026-10-22 B-3 fix] SQL 탭도 함께 갱신되므로 안내 문구에 SQL 포함.
assertMatch(htmlSrc,
    /cb-dim-notice[\s\S]{0,2000}표\/차트\/SQL은 재조회/,
    'Q-9: 안내 문구에 "표/차트/SQL은 재조회" 명시 (사용자에게 범위 명확화)');

// Q-9b (반전, 2026-10-22): SQL 탭 상단 설명 블록이 아예 제거되었으므로
//   sqlExplanationBlock 흐리게 처리 로직도 제거됨을 검증.
//   (사용자 요구: 거의 안 보는 공간이라 아예 제거)
assertNoMatch(htmlSrc,
    /sqlExplanationBlock\.style\.opacity/,
    'Q-9b: sqlExplanationBlock 흐리게 처리 로직 제거 (SQL 탭 설명 블록 자체 제거됨)');

// Q-9c 신규: SQL 탭 안의 LLM 설명 블록 자체가 render 코드에서 제거됨
//   data.explanation 을 보라색 info 박스로 렌더하던 블록이 삭제되고 주석만 남음.
{
    // "data.explanation ? `<div ... border-left:3px solid #6366f1 ..." 패턴이 더 이상 없어야 함
    const hasExplanationBlock = /data\.explanation\s*\?\s*`<div[^`]{0,500}border-left:3px solid #6366f1/.test(htmlSrc);
    assert(!hasExplanationBlock,
        'Q-9c: SQL 탭 상단 LLM 설명 블록 render 코드 제거됨 (사용자 요구: 아예 제거)');
}

// Q-10: 헬퍼 함수들이 각각 1회만 정의 (중복 방지)
{
    const a = (htmlSrc.match(/function\s+isSameCostBasis\s*\(/g) || []).length;
    const b = (htmlSrc.match(/function\s+refreshCostBasisBadgeAndDropdown\s*\(/g) || []).length;
    const c = (htmlSrc.match(/function\s+applyCostBasisDimEffect\s*\(/g) || []).length;
    assert(a === 1 && b === 1 && c === 1,
        `Q-10: 신규 헬퍼 3개 각각 1회만 정의 — isSameCostBasis=${a}, refreshCostBasisBadgeAndDropdown=${b}, applyCostBasisDimEffect=${c}`);
}

// ─── R. FRONTEND — initAnalysisDetailTable 호출부가 신규 인자 전달
// R-1: aggregate 호출부 (라인 ~3946, _aggDetailInitCtx) 가 sql + chartCanvasId 포함
assertMatch(htmlSrc,
    /_aggDetailInitCtx\s*=\s*\{[\s\S]{0,500}sql:\s*data\.sql[\s\S]{0,500}chartCanvasId:\s*chartId/,
    'R-1: aggregate 호출부가 _aggDetailInitCtx 에 sql + chartCanvasId 저장');

// R-2: aggregate 호출부가 initAnalysisDetailTable 에 9개 인자 모두 전달
assertMatch(htmlSrc,
    /initAnalysisDetailTable\s*\(\s*\n?\s*detailTableId[\s\S]{0,500}_aggDetailInitCtx\.sql[\s\S]{0,300}_aggDetailInitCtx\.initialAppliedCostBasis[\s\S]{0,300}_aggDetailInitCtx\.chartCanvasId/,
    'R-2: aggregate 호출부가 initAnalysisDetailTable 에 7~9번째 인자 모두 전달');

// R-3: analysis 호출부도 sql + appliedCostBasis 전달 (chartCanvasId 는 null)
assertMatch(htmlSrc,
    /if\s*\(hasTable\)\s*\{[\s\S]{0,1500}initAnalysisDetailTable\s*\([\s\S]{0,500}_sqlForRequery[\s\S]{0,200}_initCbForRequery/,
    'R-3: analysis 호출부도 initAnalysisDetailTable 에 sql + initialAppliedCostBasis 전달');

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
