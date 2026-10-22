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

assertMatch(serverSrc,
    /let\s+appliedCostBasisMeta\s*=\s*null\s*;\s*\n\s*if\s*\(\s*selectedTable\s*===\s*['"]sys_aimd_cot015['"]\s*\)/,
    'C-1: aggregate route — sys_aimd_cot015 조건 분기');

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

// J-4 ~ J-5: onCostBasisDropdownChange 함수 본문 전체를 추출해 하위 검증
{
    const m = htmlSrc.match(/async\s+function\s+onCostBasisDropdownChange\s*\(\s*selectEl\s*\)\s*\{([\s\S]*?)\n\s{0,4}\}\n/);
    const body = m ? m[1] : '';
    assert(/await\s+sendQuery\s*\(\s*originalQuery\s*,\s*\{\s*costBasisDropdownResend:\s*true\s*\}\s*\)/.test(body),
        'J-4: 드롭다운 변경 후 sendQuery(originalQuery, { costBasisDropdownResend: true }) 재호출');
    assert(/selectEl\.disabled\s*=\s*true/.test(body),
        'J-5: 재질의 중 사용자 재조작 방지 (selectEl.disabled = true)');
}

assertMatch(htmlSrc,
    /onCostBasisDropdownChange[\s\S]{0,2500}sib\.classList\.contains\s*\(\s*['"]msg-user-row['"]\s*\)/,
    'J-6: 원래 질의 텍스트 역탐색 — .msg-user-row 클래스 사용');

assertMatch(htmlSrc,
    /onCostBasisDropdownChange[\s\S]{0,2500}sib\.dataset\.queryText/,
    'J-7: dataset.queryText 로 원래 질의 추출 (buildUserMessageRow 와 일치)');

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
assertMatch(serverSrc,
    /if\s*\(\s*selectedTable\s*===\s*['"]sys_aimd_cot015['"]\s*\)\s*\{[\s\S]{0,1500}appliedCostBasisMeta\s*=\s*buildAppliedCostBasisResponse/,
    'N-2: aggregate route — appliedCostBasis 는 sys_aimd_cot015 조건 분기 안에서만 생성');

// N-3: deyang 모듈 (module-rolling-planning-simulation) 미건드림
assertNoMatch(serverSrc,
    /module-rolling-planning-simulation[\s\S]{0,500}sessionCostBasis/,
    'N-3: deyang 모듈 영역에 sessionCostBasis 변경 없음');

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
