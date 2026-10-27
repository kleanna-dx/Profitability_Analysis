// ============================================================
// test_glossary_area_filter.mjs
// ------------------------------------------------------------
// 사용자 신고:
//   용어집이 수익성분석 필드만 보여주고 있음. 상단에서 '제조원가' 를
//   선택해도 용어집은 여전히 수익성분석 테이블(bw_profitability_data)
//   컬럼만 노출됨.
//
// 요구사항:
//   - 수익성분석 선택 → 수익성분석 관련 테이블(bw_profitability_data) 컬럼만
//   - 제조원가 선택 → 제조원가 관련 테이블(sys_aimd_cot015) 컬럼만
//   - 영역 전환 시 (용어집 열려있으면) 자동 재조회
//
// 서버 상태:
//   /api/builder/columns 는 이미 ?area= 파라미터를 지원 (server.mjs:16820,
//   2026-09-17 추가). table_name IN (허용 테이블) 로 격리까지 완료됨.
//   → 서버 수정 0줄. 프론트에서 파라미터 전달만 하면 됨.
//
// 수정 지점:
//   1. loadGlossary() : fetch URL 에 ?area=... 추가 (AreaTabs.snapshot 활용)
//   2. 컨텍스트 배지  : "수익성분석/제조원가" 영역 라벨 함께 표시
//   3. areachange     : 용어집이 열려있으면 자동 재조회 (switchDomain 패턴과 동일)
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '../public/index.html');
const SERVER_PATH = resolve(__dirname, '../server.mjs');

const htmlSrc = readFileSync(HTML_PATH, 'utf8');
const serverSrc = readFileSync(SERVER_PATH, 'utf8');

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
// X. 서버 사전 조건 — /api/builder/columns 가 이미 ?area= 지원
// ============================================================

// X-1: 서버 /api/builder/columns 가 req.query.area 를 수신
assertMatch(serverSrc,
    /app\.get\s*\(\s*['"]\/api\/builder\/columns['"][\s\S]{0,2000}req\.query\.area/,
    'X-1: 서버 /api/builder/columns 가 req.query.area 수신 (사전 조건, 이미 지원됨)');

// X-2: 서버가 area → tableWhitelist 로 격리 (table_name IN (?))
assertMatch(serverSrc,
    /\/api\/builder\/columns[\s\S]{0,3000}tableWhitelist[\s\S]{0,500}table_name\s+IN/i,
    'X-2: 서버가 tableWhitelist 로 ontology_column 필터 (영역별 격리)');

// ============================================================
// Y. 프론트 — loadGlossary() 수정
// ============================================================

// Y-1: loadGlossary 안에서 AreaTabs.snapshot() 호출
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn && /window\.AreaTabs\s*&&\s*typeof\s+window\.AreaTabs\.snapshot\s*===\s*['"]function['"]/.test(fn[0]),
        'Y-1: loadGlossary 안에서 AreaTabs.snapshot() 안전 조회 (타입 체크 포함)');
}

// Y-2: _area 변수 fallback 'profitability' (AreaTabs 로드 실패 시 하위 호환)
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn && /let\s+_area\s*=\s*['"]profitability['"]/.test(fn[0]),
        'Y-2: _area 기본값 = profitability (AreaTabs 미로드 시 하위 호환)');
}

// Y-3: _snap.area 가 string + truthy 일 때만 _area 갱신
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn && /if\s*\(\s*_snap\s*&&\s*typeof\s+_snap\.area\s*===\s*['"]string['"]\s*&&\s*_snap\.area\s*\)/.test(fn[0]),
        'Y-3: _snap.area 가 valid string 일 때만 _area 갱신 (defensive)');
}

// Y-4: fetch URL 에 area 쿼리 파라미터 전달
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn && /fetch\s*\(\s*`\/api\/builder\/columns\?area=\$\{encodeURIComponent\(_area\)\}[^`]*_t=\$\{Date\.now\(\)\}`/.test(fn[0]),
        'Y-4: fetch URL — /api/builder/columns?area=${_area}&_t=... (encodeURIComponent 사용)');
}

// Y-5: 기존 ?_t=Date.now() 만 보내던 호출 완전 제거 (?area= 파라미터로 교체됨)
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn && !/fetch\s*\(\s*['"]\/api\/builder\/columns\?_t=/.test(fn[0]),
        'Y-5: 구 fetch URL (area 파라미터 없는 호출) 완전 제거됨');
}

// ============================================================
// Z. 프론트 — 컨텍스트 배지에 영역 라벨 표시
// ============================================================

// Z-1: _areaLabel 변수 선언 + 기본값 '수익성분석'
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn && /let\s+_areaLabel\s*=\s*['"]수익성분석['"]/.test(fn[0]),
        'Z-1: _areaLabel 기본값 = 수익성분석');
}

// Z-2: _snap.areaLabel 우선 사용, 없으면 manufacturing-cost 체크로 폴백
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn
        && /typeof\s+_snap\.areaLabel\s*===\s*['"]string['"]/.test(fn[0])
        && /_area\s*===\s*['"]manufacturing-cost['"]\s*\)\s*\?\s*['"]제조원가['"]\s*:\s*['"]수익성분석['"]/.test(fn[0]),
        'Z-2: _areaLabel = _snap.areaLabel 우선, 없으면 _area 보고 매핑 (제조원가/수익성분석)');
}

// Z-3: 컨텍스트 배지 포맷 — "도메인 (코드) · 영역 기준 · 활성 필드"
{
    const fn = htmlSrc.match(/async\s+function\s+loadGlossary\s*\([\s\S]*?\n\}/);
    assert(fn && /ctx\.textContent\s*=\s*`\$\{dLabel\}\s*\(\$\{_curDisp\}\)\s*·\s*\$\{_areaLabel\}\s*기준\s*·\s*활성\s*필드`/.test(fn[0]),
        'Z-3: ctx.textContent 포맷 — "도메인 (코드) · {영역} 기준 · 활성 필드"');
}

// ============================================================
// AA. 프론트 — areachange 이벤트 리스너에 용어집 재조회 추가
// ============================================================

// AA-1: areachange 리스너 안에서 glossaryOpen 체크 후 loadGlossary() 호출
assertMatch(htmlSrc,
    /addEventListener\s*\(\s*['"]areachange['"][\s\S]{0,800}if\s*\(\s*typeof\s+glossaryOpen\s*!==\s*['"]undefined['"]\s*&&\s*glossaryOpen\s*&&\s*typeof\s+loadGlossary\s*===\s*['"]function['"]\s*\)\s*loadGlossary\(\)/,
    'AA-1: areachange 리스너 — glossaryOpen && loadGlossary 존재 시 재조회 (defensive)');

// AA-2: try/catch 로 감싸서 다른 리스너 처리 안 깨뜨리게
{
    // areachange 리스너 블록 추출
    const block = htmlSrc.match(/addEventListener\s*\(\s*['"]areachange['"][\s\S]*?\}\)/);
    assert(block && (block[0].match(/try\s*\{/g) || []).length >= 4,
        'AA-2: areachange 리스너 — 각 try/catch 블록 4개 이상 (refreshSubAreaBar / renderSuggestionChips / toggleAreaSpecificText / loadGlossary)');
}

// AA-3: switchDomain 패턴(라인 2344) 의 glossaryOpen 체크와 동일한 가드 사용
//       (코드 중복이 아니라 동일 패턴 유지 — 일관성 확보)
assertMatch(htmlSrc,
    /if\s*\(\s*glossaryOpen\s*\)\s*loadGlossary\s*\(\s*\)/,
    'AA-3: switchDomain 쪽 기존 패턴 (if (glossaryOpen) loadGlossary()) 유지');

// ============================================================
// BB. 통합 검증
// ============================================================

// BB-1: 상단 네비게이션 '용어집' 버튼은 그대로 (PR #536 유지)
assertMatch(htmlSrc,
    /<span>용어집<\/span>[\s\S]{0,200}glossary-arrow/,
    'BB-1: 상단 네비 "용어집" 버튼 (PR #536 라벨) 유지');

// BB-2: AreaTabs.snapshot() 반환 포맷에 area / areaLabel 포함 (주석/사용 흔적 확인)
assertMatch(htmlSrc,
    /AreaTabs\.snapshot\(\)[\s\S]{0,500}\{\s*area[\s\S]{0,200}areaLabel/,
    'BB-2: AreaTabs.snapshot() 반환 포맷 { area, areaLabel, ... } 주석 유지');

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
