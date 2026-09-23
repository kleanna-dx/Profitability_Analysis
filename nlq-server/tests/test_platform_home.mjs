/**
 * 통합 플랫폼 HOME 도입 검증
 * ===================================================================
 * 사용자 요청 (2026-09-21):
 *   [통합 플랫폼 홈 화면 신규 구성]
 *   - 최초 진입 화면을 자연어질의 대신 [통합 플랫폼 HOME] 으로 변경
 *   - 좌측 메뉴 대분류: 수익성분석 / 경영시뮬레이션
 *   - 수익성분석 드롭다운: 자연어 질의 / 비주얼 쿼리 빌더 / 학습관리 /
 *                          권한 관리 / 배치관리 / 인터페이스 관리 (권한 반영)
 *   - "통합 플랫폼" 로고 클릭 → HOME 이동
 *
 * 검증 대상:
 *   A. platform.html 파일 존재 및 필수 요소
 *   B. platform-sidebar.js 함수 로직 (그룹핑, active 판정)
 *   C. server.mjs 라우팅 (GET / → platform.html, GET /nlq → index.html)
 *   D. DEFAULT_MENUS_ALL 에 interface 추가되고 nlq URL 이 /nlq
 *   E. 각 페이지 (index/builder/learning/permission/batch/interface/report/upload)
 *      가 platform-sidebar.js 로드 + '통합 플랫폼' 로고 링크 보유
 *   F. 인증 미들웨어에서 /nlq, /interface.html 가 menuPages 에 포함
 *   G. isMenuAllowed 가 /, /index.html → /nlq 로 정규화
 * ===================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const serverPath = path.resolve(__dirname, '..', 'server.mjs');
const sidebarJsPath = path.resolve(publicDir, 'platform-sidebar.js');

const server = fs.readFileSync(serverPath, 'utf8');

// ---- 테스트 프레임워크 ----
let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, name) {
    if (cond) PASS++;
    else { FAIL++; failures.push(name); console.error('FAIL:', name); }
}
function assertMatch(str, re, name) {
    const ok = re.test(str);
    if (!ok) {
        FAIL++;
        failures.push(name);
        console.error('FAIL:', name);
        console.error('  regex:  ', re);
        console.error('  actual: ', typeof str === 'string' ? str.slice(0, 200) : str);
    } else PASS++;
}

// ============================================================
// A. platform.html 파일 존재 및 필수 요소
// ============================================================
const platformHtmlPath = path.resolve(publicDir, 'platform.html');
assert(fs.existsSync(platformHtmlPath), 'A-1: platform.html 파일 존재');

const platformHtml = fs.existsSync(platformHtmlPath) ? fs.readFileSync(platformHtmlPath, 'utf8') : '';

assertMatch(platformHtml, /<title>[^<]*통합 플랫폼[^<]*<\/title>/, 'A-2: <title> 에 "통합 플랫폼" 포함');
assertMatch(platformHtml, /수익성분석 AI/, 'A-3: 카드에 "수익성분석 AI" 문구 포함');
assertMatch(platformHtml, /경영시뮬레이션/, 'A-4: 카드에 "경영시뮬레이션" 문구 포함');
assertMatch(platformHtml, /준비중/, 'A-5: 경영시뮬레이션 준비중 표시');
assertMatch(platformHtml, /자연어 질의/, 'A-6: 수익성분석 AI 카드에 "자연어 질의" 태그');
assertMatch(platformHtml, /비주얼 쿼리 빌더/, 'A-7: "비주얼 쿼리 빌더" 태그');
assertMatch(platformHtml, /학습 관리/, 'A-8: "학습 관리" 태그');

// 사용자 요구: 'PPT 장표 생성' 태그 삭제됨
assert(!/PPT 장표 생성/.test(platformHtml), 'A-9: 수익성분석 AI 카드에서 "PPT 장표 생성" 태그 삭제됨');

// [2026-09-23 사용자 요청] 카드 설명 문구에서 "AI가" 제거
//   원문 "AI가 내부 수익성 데이터를 분석하여..." → "내부 수익성 데이터를 분석하여..."
assert(!/AI가\s*내부\s*수익성/.test(platformHtml), 'A-9b: 카드 설명 문구에서 "AI가 내부 수익성" 표현 제거됨');
assertMatch(platformHtml, /월 마감 완료 후 사용자가 자연어로 질문하면,[\s\S]*?내부 수익성 데이터를 분석하여/, 'A-9c: 카드 설명 새 문구 ("내부 수익성 데이터를 분석하여") 확인');

// disabled 시작 버튼
assertMatch(platformHtml, /card-cta disabled/, 'A-10: 경영시뮬레이션 시작 버튼 비활성화');
// 로그인 확인 로직
assertMatch(platformHtml, /\/api\/me/, 'A-11: platform.html 이 /api/me 를 호출');
// 로고가 홈으로 링크
assertMatch(platformHtml, /<a\s+href="\/"[^>]*(?:title|class)[^>]*>[\s\S]*?통합 플랫폼/, 'A-12: 사이드바 로고 링크가 / 로 이동');
// platform-sidebar.js 로드
assertMatch(platformHtml, /<script[^>]*src="\/platform-sidebar\.js"/, 'A-13: platform-sidebar.js 로드');

// ============================================================
// B. platform-sidebar.js 함수 로직 (그룹핑, active 판정)
// ============================================================
assert(fs.existsSync(sidebarJsPath), 'B-1: platform-sidebar.js 파일 존재');

// eval 로 함수 로직만 뽑아서 실행 (IIFE, global 은 fake 객체)
const sidebarSrc = fs.readFileSync(sidebarJsPath, 'utf8');
const fakeGlobal = {};
// document/localStorage 는 injectCssOnce 에서 사용되므로 fake stub 제공
const fakeDocument = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
};
const fakeLocalStorage = { getItem: () => null, setItem: () => {} };
try {
    // IIFE 는 (function(global){...})(...) 형태. 마지막 인자를 fakeGlobal 로 강제.
    const modifiedSrc = sidebarSrc.replace(
        /\}\)\(typeof window[^)]+\);/,
        '})(fakeGlobal);'
    );
    new Function('fakeGlobal', 'document', 'localStorage', modifiedSrc)(fakeGlobal, fakeDocument, fakeLocalStorage);
} catch (e) {
    console.error('platform-sidebar.js eval 실패:', e.message);
}
const PS = fakeGlobal.PlatformSidebar;
assert(PS && typeof PS.groupMenus === 'function', 'B-2: PlatformSidebar.groupMenus 함수 export');
assert(PS && typeof PS.isActive === 'function', 'B-3: PlatformSidebar.isActive 함수 export');
assert(PS && Array.isArray(PS.GROUPS), 'B-4: PlatformSidebar.GROUPS 배열 export');

// B-5~B-9: GROUPS 정의 검증
// [2026-09-23-2] 재구성: 3개 그룹 (수익성분석 / 경영시뮬레이션 / 시스템관리)
//   - 경영시뮬레이션: disabled 제거 + simulation-test 하위 추가
//   - 시스템관리: 신규, permission 을 여기로 이관
if (PS && PS.GROUPS) {
    assert(PS.GROUPS.length === 3, 'B-5: 대분류 그룹 정확히 3개 (수익성분석/경영시뮬레이션/시스템관리)');
    assert(PS.GROUPS[0].key === 'profitability', 'B-6: 첫 번째 그룹 key = profitability');
    assert(PS.GROUPS[0].name === '수익성분석', 'B-7: 첫 번째 그룹 이름 = 수익성분석');
    assert(PS.GROUPS[1].key === 'simulation', 'B-8: 두 번째 그룹 key = simulation');
    assert(PS.GROUPS[1].name === '경영시뮬레이션', 'B-9: 두 번째 그룹 이름 = 경영시뮬레이션');
    assert(PS.GROUPS[1].disabled !== true, 'B-10: 경영시뮬레이션 disabled 해제 (테스트 메뉴 추가되어 정상 drop-down)');
    assert(PS.GROUPS[2] && PS.GROUPS[2].key === 'sysadmin', 'B-10b: 세 번째 그룹 key = sysadmin (신규)');
    assert(PS.GROUPS[2] && PS.GROUPS[2].name === '시스템관리', 'B-10c: 세 번째 그룹 이름 = 시스템관리');
    // 수익성분석 그룹에는 permission 을 제외한 나머지 5개 메뉴 코드 포함
    const profitCodes = PS.GROUPS[0].codes;
    for (const code of ['nlq','builder','learning','batch','interface']) {
        assert(profitCodes.includes(code), `B-11-${code}: 수익성분석 그룹에 ${code} 포함`);
    }
    // permission 은 이제 수익성분석에 없어야 함
    assert(!profitCodes.includes('permission'), 'B-11-permission-removed: 수익성분석 그룹에서 permission 제거');
}

// B-12: groupMenus 로직 검증 (2026-09-23 권한 필터링 규칙)
//   - profitability 는 codes 중 하나라도 있으면 표시, 하위 메뉴가 0개면 그룹 자체 숨김
//   - simulation 은 requiredCodes 인 'simulation' 이 있어야만 표시
if (PS && PS.groupMenus) {
    const M_NLQ      = { menu_code:'nlq',      menu_name:'자연어 질의',   menu_url:'/nlq',            icon_class:'fas fa-comments',   sort_order:1 };
    const M_BUILDER  = { menu_code:'builder',  menu_name:'비주얼',        menu_url:'/builder.html',   icon_class:'fas fa-th-large',   sort_order:2 };
    const M_INTERFACE= { menu_code:'interface',menu_name:'인터페이스',    menu_url:'/interface.html', icon_class:'fas fa-plug',       sort_order:7 };
    const M_SIM      = { menu_code:'simulation',menu_name:'경영시뮬레이션',menu_url:'#simulation',    icon_class:'fas fa-flask',      sort_order:100 };

    // 시나리오 A: nlq + builder + interface (수익성분석만) → profitability 그룹만 표시
    const groupedA = PS.groupMenus([M_NLQ, M_BUILDER, M_INTERFACE]);
    assert(groupedA.length === 1, 'B-12: 수익성분석만 있으면 1개 그룹 (경영시뮬 숨김)');
    assert(groupedA[0].group.key === 'profitability', 'B-13: 첫 그룹 = profitability');
    assert(groupedA[0].items.length === 3, 'B-14: 수익성분석 3개 하위 메뉴');

    // 시나리오 B: simulation 만 → simulation 그룹만 표시 (profitability 는 하위 0개라 숨김)
    const groupedB = PS.groupMenus([M_SIM]);
    assert(groupedB.length === 1, 'B-15: 경영시뮬만 있으면 1개 그룹 (수익성분석 숨김)');
    assert(groupedB[0].group.key === 'simulation', 'B-15b: 유일한 그룹 = simulation');

    // 시나리오 C: 둘 다 → 2개 그룹 모두 표시
    const groupedC = PS.groupMenus([M_NLQ, M_SIM]);
    assert(groupedC.length === 2, 'B-15c: 둘 다 있으면 2개 그룹 모두 표시');
    assert(groupedC[0].group.key === 'profitability' && groupedC[1].group.key === 'simulation', 'B-15d: 순서 profitability → simulation');

    // 시나리오 D: 완전 무권한 → 그룹 0개
    const groupedD = PS.groupMenus([]);
    assert(groupedD.length === 0, 'B-15e: 무권한 → 0개 그룹 (홈은 render()가 별도 처리)');

    // 시나리오 E: nlq, builder 만 → profitability 만, 하위 2개
    const restricted = PS.groupMenus([M_NLQ, M_BUILDER]);
    assert(restricted.length === 1 && restricted[0].items.length === 2, 'B-16: 권한 제한 시 그 메뉴만 그룹에 포함');

    // 시나리오 F: 알려지지 않은 코드는 어느 그룹에도 매핑 안 됨 → 그룹 0개
    const unknown = PS.groupMenus([{ menu_code:'unknown', menu_name:'X', menu_url:'/x', icon_class:'', sort_order:99 }]);
    assert(unknown.length === 0, 'B-17: 알려지지 않은 menu_code 는 어느 그룹도 매칭 못 함 → 0개 그룹');
}

// B-18: isActive 로직
if (PS && PS.isActive) {
    assert(PS.isActive('/builder.html', '/builder.html') === true, 'B-18: 정확 일치');
    assert(PS.isActive('/nlq', '/nlq') === true, 'B-19: /nlq === /nlq');
    assert(PS.isActive('/nlq', '/index.html') === true, 'B-20: /index.html 은 /nlq 로 취급');
    assert(PS.isActive('/report', '/report/generate') === true, 'B-21: /report SPA fallback');
    assert(PS.isActive('/builder.html', '/other') === false, 'B-22: 다른 경로 → false');
    assert(PS.isActive('/nlq', '/builder.html') === false, 'B-23: 다른 경로 → false');
}

// ============================================================
// C. server.mjs 라우팅
// ============================================================
// C-1: GET / 라우트가 platform.html 서빙
assertMatch(server, /app\.get\('\/',\s*\(req,\s*res\)\s*=>\s*\{[\s\S]*?platform\.html[\s\S]*?\}\)/, 'C-1: GET / → platform.html 서빙');
// C-2: GET /nlq 라우트가 index.html 서빙
assertMatch(server, /app\.get\('\/nlq',\s*\(req,\s*res\)\s*=>\s*\{[\s\S]*?index\.html[\s\S]*?\}\)/, 'C-2: GET /nlq → index.html 서빙');
// C-3: express.static 은 두 라우트 뒤에 있어야 함 (/ 요청이 static 으로 넘어가면 index.html 이 되어버림)
const staticIdx = server.indexOf('app.use(express.static(');
const rootRouteIdx = server.search(/app\.get\('\/',\s*\(req,\s*res\)/);
const nlqRouteIdx = server.search(/app\.get\('\/nlq',\s*\(req,\s*res\)/);
assert(staticIdx > 0 && rootRouteIdx > 0 && rootRouteIdx < staticIdx, 'C-3: GET / 라우트가 express.static 이전에 정의됨');
assert(staticIdx > 0 && nlqRouteIdx > 0 && nlqRouteIdx < staticIdx, 'C-4: GET /nlq 라우트가 express.static 이전에 정의됨');

// ============================================================
// D. DEFAULT_MENUS_ALL
// ============================================================
// D-1: nlq 의 menu_url 이 /nlq
assertMatch(server, /menu_code:'nlq',[^}]*menu_url:'\/nlq'/, 'D-1: DEFAULT_MENUS_ALL 의 nlq URL = /nlq');
// D-2: interface 메뉴 포함
assertMatch(server, /menu_code:'interface',[^}]*menu_name:'인터페이스 관리'/, 'D-2: DEFAULT_MENUS_ALL 에 interface 메뉴 포함');
// D-3: 시드 데이터 INSERT 에도 nlq → /nlq, interface 포함
assertMatch(server, /INSERT INTO menus[\s\S]*?'nlq',[^\n]*'\/nlq'/, 'D-3: 시드 INSERT 에서 nlq URL = /nlq');
assertMatch(server, /INSERT INTO menus[\s\S]*?'interface',[^\n]*'\/interface\.html'/, 'D-4: 시드 INSERT 에서 interface 포함');
// D-5: 기존 DB 마이그레이션 코드 존재 (nlq URL / → /nlq)
assertMatch(server, /UPDATE menus SET menu_url = '\/nlq' WHERE id = \?/, 'D-5: 기존 DB nlq URL 마이그레이션 SQL 존재');
// D-6: interface 마이그레이션 (기존 배포된 DB 에도 자동 추가)
assertMatch(server, /INSERT INTO menus[\s\S]*?'interface', '인터페이스 관리', '\/interface\.html'/, 'D-6: interface 마이그레이션 INSERT 존재');

// ============================================================
// E. 각 페이지가 platform-sidebar.js 로드 + '통합 플랫폼' 로고 링크
// ============================================================
const PAGES = ['index.html', 'builder.html', 'learning.html', 'permission.html', 'batch.html', 'interface.html', 'report.html', 'upload.html'];
for (const p of PAGES) {
    const fp = path.resolve(publicDir, p);
    if (!fs.existsSync(fp)) { failures.push(`E-${p}: 파일 없음`); FAIL++; continue; }
    const html = fs.readFileSync(fp, 'utf8');
    // E-a: platform-sidebar.js 로드
    assertMatch(html, /<script[^>]*src="\/platform-sidebar\.js"/, `E-${p}-1: platform-sidebar.js 로드`);
    // E-b: 사이드바 로고가 / 로 링크 (통합 플랫폼)
    assertMatch(html, /<a\s+href="\/"\s+class="platform-brand-link"[\s\S]*?통합 플랫폼[\s\S]*?<\/a>/, `E-${p}-2: 사이드바 로고 링크 → /`);
    // E-c: 기존 sidebarMenu.innerHTML = me.menus.map(...) 렌더 로직이 PlatformSidebar.render 호출로 대체됨
    //   (있어도 되지만, PlatformSidebar.render 호출이 반드시 존재해야 함)
    assertMatch(html, /PlatformSidebar\.render\(/, `E-${p}-3: PlatformSidebar.render 호출 존재`);
}

// ============================================================
// F. 인증 미들웨어 menuPages 배열
// ============================================================
// F-1: menuPages 에 /nlq 포함
assertMatch(server, /const menuPages = \[[^\]]*'\/nlq'[^\]]*\]/, 'F-1: menuPages 에 /nlq 포함');
// F-2: menuPages 에 /interface.html 포함
assertMatch(server, /const menuPages = \[[^\]]*'\/interface\.html'[^\]]*\]/, 'F-2: menuPages 에 /interface.html 포함');
// F-3: /index.html 접근 시 /nlq 로 정규화
assertMatch(server, /req\.path === '\/index\.html'\s*\)\s*\?\s*'\/nlq'\s*:\s*req\.path/, 'F-3: /index.html → /nlq 로 정규화');

// ============================================================
// G. isMenuAllowed 정규화
// ============================================================
assertMatch(server, /urlPath === '\/index\.html' \|\| urlPath === '\/'\s*\)\s*normalizedPath = '\/nlq'/, 'G-1: isMenuAllowed 가 / 및 /index.html → /nlq 정규화');

// ============================================================
// H. [홈] 버튼 (2026-09-23 사용자 요청 1차)
//   - 사이드바 최상단, 대분류 위에 독립 [홈] 버튼 표시
//   - href="/" 로 통합 플랫폼 HOME 이동
//   - 현재 페이지가 / 이면 active 스타일
// ============================================================
const sidebarSrcForHome = fs.readFileSync(sidebarJsPath, 'utf8');
assertMatch(sidebarSrcForHome, /<a href="\/" class="home-link category-item\$\{homeActive\}"/, 'H-1: 홈 링크 HTML (home-link + category-item 공통 클래스)');
assertMatch(sidebarSrcForHome, /class="fas fa-home cat-icon"/, 'H-2: 홈 아이콘 (fa-home, cat-icon 공통 클래스)');
assertMatch(sidebarSrcForHome, /<span class="cat-label">홈<\/span>/, 'H-3: 홈 텍스트 (cat-label 공통 클래스)');
assertMatch(sidebarSrcForHome, /isActive\('\/', activeUrl\)/, 'H-4: 홈 active 판정 (activeUrl === "/")');
assertMatch(sidebarSrcForHome, /container\.innerHTML\s*=\s*homeHtml\s*\+\s*groupsHtml/, 'H-5: innerHTML 에 homeHtml 이 groups 앞에 삽입됨');

// H-6~H-10: 실제 렌더링 결과 검증
if (PS && PS.render) {
    const capture = { innerHTML: '' };
    const originalGet = fakeDocument.getElementById;
    fakeDocument.getElementById = (id) => id === 'sidebarMenu'
        ? { set innerHTML(v){ capture.innerHTML = v; }, get innerHTML(){ return capture.innerHTML; } }
        : null;
    try {
        // H-6: HOME 페이지 (activeUrl='/') → home-link 에 active 클래스
        capture.innerHTML = '';
        PS.render([], { activeUrl: '/' });
        assertMatch(capture.innerHTML, /class="home-link category-item active"/, 'H-6: HOME 페이지에서 home-link 에 active');
        assertMatch(capture.innerHTML, /<a href="\/"/, 'H-7: 홈 링크 href="/"');
        assertMatch(capture.innerHTML, /<span class="cat-label">홈<\/span>/, 'H-8: 홈 텍스트 렌더링');
        // H-9: 다른 페이지 → home-link 비-active
        capture.innerHTML = '';
        PS.render([], { activeUrl: '/nlq' });
        assert(/class="home-link category-item"/.test(capture.innerHTML) && !/class="home-link category-item active"/.test(capture.innerHTML),
            'H-9: /nlq 페이지에서 home-link 는 active 아님');
        // H-10: 홈 링크가 대분류 앞에 위치 (실제 대분류 그룹이 렌더링되어야 하므로 nlq 메뉴 포함)
        capture.innerHTML = '';
        PS.render([{ menu_code:'nlq', menu_name:'X', menu_url:'/nlq', icon_class:'', sort_order:1 }],
                  { activeUrl: '/builder.html' });
        const homeIdx = capture.innerHTML.indexOf('home-link');
        const groupIdx = capture.innerHTML.indexOf('menu-group');
        assert(homeIdx > -1 && groupIdx > -1 && homeIdx < groupIdx, 'H-10: 홈 링크가 대분류 이전에 위치');
    } finally {
        fakeDocument.getElementById = originalGet;
    }
}

// ============================================================
// I. 3개 대분류 UI 통일 (2026-09-23 사용자 요청 2차)
//   - 홈 / 수익성분석 / 경영시뮬레이션이 동일한 카드 스타일(.category-item)
//   - 동일한 높이/여백/아이콘/글자 크기, 둥근 박스
//   - 선택된 대분류 active 표시 명확
//   - 수익성분석: chevron 유지, 하위 계층 명확
//   - 경영시뮬레이션: 준비중 뱃지 유지, 대분류 디자인 동일
// ============================================================
// sidebarSrc 는 파일 상단(B 섹션)에서 이미 로드됨. 재사용.

// I-1: .category-item 공통 CSS 클래스 정의
assertMatch(sidebarSrc, /#sidebarMenu\s+\.category-item\s*\{[\s\S]*?border-radius:10px/, 'I-1: .category-item 공통 CSS 정의 (border-radius 10px)');
// I-2: 공통 min-height 및 padding
assertMatch(sidebarSrc, /#sidebarMenu\s+\.category-item\s*\{[\s\S]*?min-height:46px/, 'I-2: 공통 min-height 46px (높이 통일)');
assertMatch(sidebarSrc, /#sidebarMenu\s+\.category-item\s*\{[\s\S]*?padding:12px 16px/, 'I-3: 공통 padding 12px 16px');
// I-4: 공통 font-size 14px + font-weight 700 (사용자 요구: 조금 더 크게 + font-weight 높게)
assertMatch(sidebarSrc, /#sidebarMenu\s+\.category-item\s*\{[\s\S]*?font-size:14px[\s\S]*?font-weight:700/, 'I-4: 공통 font 14px/700');
// I-5: 공통 아이콘 크기 (.cat-icon 15px)
assertMatch(sidebarSrc, /#sidebarMenu\s+\.category-item\s*>\s*\.cat-icon\s*\{[\s\S]*?font-size:15px/, 'I-5: 공통 아이콘 15px');
// I-6: active 상태 정의 (배경 강화 + 테두리)
assertMatch(sidebarSrc, /#sidebarMenu\s+\.category-item\.active\s*\{[\s\S]*?border-color:rgba\(165,180,252/, 'I-6: active 상태 border-color 강화');

// I-7: 하위 메뉴는 대분류보다 작음 (13.5px < 14px)
//   [2026-09-23 사용자 요청] 하위 메뉴 글씨 1포인트 증가 (12.5px → 13.5px).
//   대분류(14px) 와의 계층 여전히 유지되면서 가독성 향상.
assertMatch(sidebarSrc, /#sidebarMenu\s+\.menu-item\s*\{[\s\S]*?font-size:13\.5px/, 'I-7: 하위 메뉴 font 13.5px (대분류 14px 보다 작음)');
// I-8: 하위 메뉴 들여쓰기 (margin-left 34px 이상)
assertMatch(sidebarSrc, /#sidebarMenu\s+\.menu-item\s*\{[\s\S]*?margin:2px 22px 2px 34px/, 'I-8: 하위 메뉴 좌측 들여쓰기 (margin-left 34px)');

// I-9: 준비중 뱃지 스타일
assertMatch(sidebarSrc, /#sidebarMenu\s+\.category-item\s*>\s*\.ready-badge\s*\{/, 'I-9: 준비중 뱃지 스타일 정의');
// I-10: 준비중 그룹은 hover transform 억제
assertMatch(sidebarSrc, /\.menu-group\.disabled\s*>\s*\.category-item:hover\s*\{[\s\S]*?transform:none/, 'I-10: 준비중 그룹 hover 시 transform 없음');

// I-11: 렌더링 결과 — 3개 카테고리가 모두 .category-item 클래스 보유
if (PS && PS.render) {
    const capture = { innerHTML: '' };
    const originalGet = fakeDocument.getElementById;
    fakeDocument.getElementById = (id) => id === 'sidebarMenu'
        ? { set innerHTML(v){ capture.innerHTML = v; }, get innerHTML(){ return capture.innerHTML; } }
        : null;
    try {
        // [2026-09-23] simulation 대분류가 렌더링되려면 me.menus 에 simulation 권한이 있어야 함.
        //   → I-13/I-15 검증을 위해 sample 에 simulation 메뉴 포함.
        const sampleAll = [
            { menu_code:'nlq',        menu_name:'자연어 질의',   menu_url:'/nlq',        icon_class:'fas fa-comments', sort_order:1 },
            { menu_code:'simulation', menu_name:'경영시뮬레이션',menu_url:'#simulation', icon_class:'fas fa-flask',    sort_order:100 },
        ];
        capture.innerHTML = '';
        PS.render(sampleAll, { activeUrl: '/' });
        // I-11: 홈이 .category-item 클래스
        assertMatch(capture.innerHTML, /class="home-link category-item active"[^>]*>[\s\S]*?<span class="cat-label">홈</, 'I-11: 홈 대분류 카드 클래스 통일');
        // I-12: 수익성분석이 .category-item 클래스
        assertMatch(capture.innerHTML, /class="menu-group-header category-item"[^>]*>[\s\S]*?<span class="cat-label">수익성분석</, 'I-12: 수익성분석 대분류 카드 클래스 통일');
        // [2026-09-23-2] 재구성: 경영시뮬레이션에도 하위(simulation-test)가 있어 정상 chevron
        // I-13: 경영시뮬레이션이 .category-item 클래스 (chevron 포함, 준비중 뱃지 아님)
        assertMatch(capture.innerHTML, /class="menu-group-header category-item"[^>]*>[\s\S]*?<span class="cat-label">경영시뮬레이션/, 'I-13: 경영시뮬레이션 대분류 카드 클래스 통일');
        // I-14: 수익성분석에 chevron 유지 (fas fa-chevron-down)
        assertMatch(capture.innerHTML, /<span class="cat-label">수익성분석[\s\S]*?fa-chevron-down/, 'I-14: 수익성분석 chevron 유지');
        // I-15: 경영시뮬레이션도 chevron 정상 표시 (하위 [테스트 메뉴] 가 있으므로)
        const simCard = capture.innerHTML.match(/<span class="cat-label">경영시뮬레이션[\s\S]*?<\/div>/);
        assert(simCard && /fa-chevron-down/.test(simCard[0]), 'I-15: 경영시뮬레이션 카드에 chevron 표시 (drop-down 가능)');

        // I-16: 홈 페이지에서는 홈만 active, 수익성분석은 비-active
        assert(
            /home-link category-item active/.test(capture.innerHTML) &&
            !/menu-group-header category-item active/.test(capture.innerHTML),
            'I-16: HOME 페이지에서 홈만 active, 수익성분석 비-active'
        );

        // I-17: /nlq 페이지에서는 수익성분석이 active
        capture.innerHTML = '';
        PS.render(sampleAll, { activeUrl: '/nlq' });
        assertMatch(capture.innerHTML, /menu-group-header category-item active/, 'I-17: /nlq 페이지에서 수익성분석 대분류가 active');
        assert(!/home-link category-item active/.test(capture.innerHTML), 'I-18: /nlq 페이지에서 홈은 비-active');

        // I-19: 하위 메뉴에 .menu-item 클래스 유지 (계층 구조 유지)
        assertMatch(capture.innerHTML, /<a[^>]*class="menu-item active"[^>]*data-menu-code="nlq"/, 'I-19: 하위 메뉴 .menu-item.active 유지');
    } finally {
        fakeDocument.getElementById = originalGet;
    }
}

// ============================================================
// J. 마지막 대분류(경영시뮬레이션) 아래 여백 제거 (2026-09-23 사용자 요청)
//   - #sidebarMenu 컨테이너 padding-bottom 을 20px → 4px 로 축소
//   - 마지막 그룹(:last-child)의 .category-item 하단 마진 및
//     .menu-group-body 하단 padding 제거
// ============================================================
// J-1: #sidebarMenu 하단 padding 이 4px 이하 (기존 20px 이 아니어야 함)
assertMatch(sidebarSrc, /#sidebarMenu\s*\{\s*padding:8px 0 4px\s*;\s*\}/, 'J-1: #sidebarMenu padding 이 8px 0 4px 로 축소됨 (기존 20px 제거)');
// J-2: 기존 padding:8px 0 20px 이 남아있지 않음
assert(!/#sidebarMenu\s*\{\s*padding:8px 0 20px/.test(sidebarSrc), 'J-2: 기존 padding:8px 0 20px 완전 제거');
// J-3: 마지막 그룹의 category-item 하단 margin 제거
assertMatch(sidebarSrc, /#sidebarMenu\s*>\s*\.menu-group:last-child\s*>\s*\.category-item\s*\{\s*margin-bottom:0\s*;?\s*\}/, 'J-3: 마지막 대분류 카드 margin-bottom:0');
// J-4: 마지막 그룹 body 하단 padding 제거
assertMatch(sidebarSrc, /#sidebarMenu\s*>\s*\.menu-group:last-child\s*>\s*\.menu-group-body\s*\{\s*padding-bottom:0\s*;?\s*\}/, 'J-4: 마지막 대분류 body padding-bottom:0');

// ============================================================
// K. [비주얼 쿼리 빌더] DB 연결 UI 위치 이동 (2026-09-23 사용자 요청)
//   - 사이드바 "시스템 정보 / DB 연결됨" 영역 삭제
//   - 상단 우측에 자연어질의(index.html) 와 동일한 .status-pill 배지 노출
//   - 컴포넌트/디자인/아이콘/색상/id 완전 재사용
//   - 실제 /api/status 호출로 상태 반영 (기존 하드코딩 초록 대체)
// ============================================================
const builderHtmlPath = path.resolve(publicDir, 'builder.html');
const builderHtml = fs.readFileSync(builderHtmlPath, 'utf8');

// K-1: 사이드바 시스템 정보 영역 완전 삭제 (DOM 노드 기준)
//   주석 안 언급은 허용, 실제 사용 태그 <p>시스템 정보</p>, <span id="sideDbDot">, <span>DB 연결됨</span> 없음
assert(!/<p[^>]*>시스템 정보<\/p>/.test(builderHtml), 'K-1: <p>시스템 정보</p> 태그 삭제됨');
assert(!/id="sideDbDot"/.test(builderHtml), 'K-2: id="sideDbDot" 요소 삭제됨');
assert(!/<span[^>]*>DB 연결됨<\/span>/.test(builderHtml), 'K-3: <span>DB 연결됨</span> 태그 삭제됨');

// K-4: 상단 .status-pill CSS 정의 (index.html 과 동일 스타일)
assertMatch(builderHtml, /\.status-pill\{[\s\S]*?display:flex[\s\S]*?border-radius:20px/, 'K-4: .status-pill CSS 정의 (index.html 과 동일)');
assertMatch(builderHtml, /\.status-pill\s+\.dot\.green\{background:#22c55e/, 'K-5: .status-pill .dot.green (동일 색상)');

// K-6: 상단바에 topDbDot / topDbLabel 배지 DOM 추가 (index.html 과 동일 id)
assertMatch(builderHtml, /<div class="status-pill">[\s\S]*?<span id="topDbDot" class="dot"><\/span>[\s\S]*?<span id="topDbLabel">DB<\/span>[\s\S]*?<\/div>/, 'K-6: 상단바 DB 배지 (topDbDot/topDbLabel, index.html 과 동일 마크업)');

// K-7: /api/status 호출로 상태 갱신 로직 (index.html 과 동일)
assertMatch(builderHtml, /function initDbStatusPill\s*\(\s*\)\s*\{[\s\S]*?fetch\(['"]\/api\/status['"]\)/, 'K-7: initDbStatusPill 함수 정의 (/api/status 호출)');
assertMatch(builderHtml, /getElementById\(['"]topDbDot['"]\)[\s\S]*?classList\.add\(['"]green['"]\)/, 'K-8: 성공 시 topDbDot 에 green 클래스');
assertMatch(builderHtml, /getElementById\(['"]topDbLabel['"]\)[\s\S]*?['"]DB 연결['"]/, 'K-9: 성공 시 topDbLabel = "DB 연결"');
assertMatch(builderHtml, /getElementById\(['"]topDbLabel['"]\)[\s\S]*?['"]DB 오류['"]/, 'K-10: 실패 시 topDbLabel = "DB 오류"');

// K-11: DOMContentLoaded 시 initDbStatusPill 호출
assertMatch(builderHtml, /DOMContentLoaded[\s\S]*?initDbStatusPill\s*\(\s*\)/, 'K-11: DOMContentLoaded 시 initDbStatusPill 호출');

// ============================================================
// L. 통합 플랫폼 대분류 권한 (경영시뮬레이션) 도입 (2026-09-23 사용자 요청)
//   - menus 테이블에 'simulation' 메뉴 추가 (menu_url='#simulation', dummy 앵커)
//   - admin 역할에 자동 매핑
//   - 사용자에게 'simulation' 메뉴 권한이 있어야만 사이드바 대분류 노출
//   - 권한관리 UI 에서 [통합 플랫폼 대분류 메뉴] 섹션에 별도 표시
// ============================================================
// L-1: DEFAULT_MENUS_ALL 에 simulation 메뉴 포함
assertMatch(server, /menu_code:'simulation',[\s\S]*?menu_name:'경영시뮬레이션',[\s\S]*?menu_url:'#simulation',[\s\S]*?icon_class:'fas fa-flask'/, 'L-1: DEFAULT_MENUS_ALL 에 simulation 메뉴 (menu_url=#simulation, fa-flask)');
// L-2: 시드 데이터 INSERT 에도 simulation 포함
assertMatch(server, /INSERT INTO menus[\s\S]*?'simulation',\s*'경영시뮬레이션',\s*'#simulation',\s*'fas fa-flask'/, 'L-2: 시드 INSERT 에 simulation 포함');
// L-3: 기존 배포 DB 마이그레이션 (simulation 없으면 자동 추가)
assertMatch(server, /SELECT id FROM menus WHERE menu_code = 'simulation'/, 'L-3: 기존 DB 에 simulation 존재 확인 마이그레이션');
assertMatch(server, /INSERT INTO menus[\s\S]*?VALUES\s*\('simulation',\s*'경영시뮬레이션',\s*'#simulation',\s*'fas fa-flask',\s*100\)/, 'L-4: 마이그레이션 INSERT 구문');
// L-5: admin 에 simulation 자동 매핑 마이그레이션
assertMatch(server, /INSERT IGNORE INTO role_menus[\s\S]*?WHERE r\.role_code = 'admin' AND m\.menu_code = 'simulation'/, 'L-5: admin 역할에 simulation 자동 매핑');

// L-6~L-9: platform-sidebar.js GROUPS 정의
if (PS && PS.GROUPS) {
    const simGroup = PS.GROUPS.find(g => g.key === 'simulation');
    assert(simGroup && Array.isArray(simGroup.requiredCodes) && simGroup.requiredCodes.includes('simulation'),
        'L-6: simulation 그룹의 requiredCodes 에 "simulation" 명시');
    const profitGroup = PS.GROUPS.find(g => g.key === 'profitability');
    assert(profitGroup && profitGroup.requiredCodes == null,
        'L-7: profitability 그룹의 requiredCodes 는 null (하위 메뉴 존재 여부로 판정)');
}

// L-8~L-15: 사용자 시나리오 검증 (사용자 요구사항 3번 그대로)
if (PS && PS.render) {
    const M_NLQ = { menu_code:'nlq',        menu_name:'자연어 질의',   menu_url:'/nlq',        icon_class:'fas fa-comments', sort_order:1 };
    const M_SIM = { menu_code:'simulation', menu_name:'경영시뮬레이션',menu_url:'#simulation', icon_class:'fas fa-flask',    sort_order:100 };

    const capture = { innerHTML: '' };
    const originalGet = fakeDocument.getElementById;
    fakeDocument.getElementById = (id) => id === 'sidebarMenu'
        ? { set innerHTML(v){ capture.innerHTML = v; }, get innerHTML(){ return capture.innerHTML; } }
        : null;
    try {
        // 시나리오 1: "수익성분석 권한만 있음" → 홈 + 수익성분석, 경영시뮬 숨김
        capture.innerHTML = '';
        PS.render([M_NLQ], { activeUrl: '/nlq' });
        assertMatch(capture.innerHTML, /home-link/, 'L-8: 수익성분석만 → 홈 표시');
        assertMatch(capture.innerHTML, /data-group-key="profitability"/, 'L-9: 수익성분석만 → 수익성분석 그룹 표시');
        assert(!/data-group-key="simulation"/.test(capture.innerHTML), 'L-10: 수익성분석만 → 경영시뮬 숨김');

        // 시나리오 2: "경영시뮬레이션 권한만 있음" → 홈 + 경영시뮬, 수익성분석 숨김
        capture.innerHTML = '';
        PS.render([M_SIM], { activeUrl: '/' });
        assertMatch(capture.innerHTML, /home-link/, 'L-11: 경영시뮬만 → 홈 표시');
        assertMatch(capture.innerHTML, /data-group-key="simulation"/, 'L-12: 경영시뮬만 → 경영시뮬 그룹 표시');
        assert(!/data-group-key="profitability"/.test(capture.innerHTML), 'L-13: 경영시뮬만 → 수익성분석 숨김');

        // 시나리오 3: "두 권한 모두 있음" → 홈 + 수익성분석 + 경영시뮬
        capture.innerHTML = '';
        PS.render([M_NLQ, M_SIM], { activeUrl: '/nlq' });
        assertMatch(capture.innerHTML, /home-link/, 'L-14: 둘 다 → 홈 표시');
        assertMatch(capture.innerHTML, /data-group-key="profitability"/, 'L-14b: 둘 다 → 수익성분석 표시');
        assertMatch(capture.innerHTML, /data-group-key="simulation"/, 'L-14c: 둘 다 → 경영시뮬 표시');

        // 시나리오 4: 완전 무권한 → 홈만 표시, 두 대분류 모두 숨김
        capture.innerHTML = '';
        PS.render([], { activeUrl: '/' });
        assertMatch(capture.innerHTML, /home-link/, 'L-15: 무권한 → 홈만 표시 (항상 노출)');
        assert(!/data-group-key="profitability"/.test(capture.innerHTML) && !/data-group-key="simulation"/.test(capture.innerHTML),
            'L-16: 무권한 → 두 대분류 모두 숨김');
    } finally {
        fakeDocument.getElementById = originalGet;
    }
}

// L-17~L-20: 권한관리 UI (permission.html) — 대분류 계층 가시화
const permHtmlPath = path.resolve(publicDir, 'permission.html');
const permHtml = fs.readFileSync(permHtmlPath, 'utf8');
// [2026-09-23-2] PLATFORM_CATEGORY_CODES 에 sysadmin 추가됨
assertMatch(permHtml, /PLATFORM_CATEGORY_CODES\s*=\s*new\s+Set\(\s*\[[^\]]*['"]simulation['"][^\]]*\]\s*\)/, 'L-17: 권한관리 UI 에 PLATFORM_CATEGORY_CODES 정의 (simulation 포함)');
assertMatch(permHtml, /PLATFORM_CATEGORY_CODES\s*=\s*new\s+Set\(\s*\[[^\]]*['"]sysadmin['"][^\]]*\]\s*\)/, 'L-17b: PLATFORM_CATEGORY_CODES 에 sysadmin 포함');
assertMatch(permHtml, /통합 플랫폼 대분류 메뉴/, 'L-18: 권한관리 UI 에 "통합 플랫폼 대분류 메뉴" 섹션 타이틀');
assertMatch(permHtml, /수익성분석\/제조원가는[\s\S]*?수익성분석 서비스 내부의 업무영역 권한/, 'L-19: 업무영역 권한과 대분류 권한 분리 안내 문구');
assertMatch(permHtml, /수익성분석 하위 메뉴/, 'L-20: 권한관리 UI 에 "수익성분석 하위 메뉴" 섹션 타이틀');

// ============================================================
// M 섹션 (2026-09-23-2): 사이드바 재구성
//   - 권한 관리: 수익성분석 그룹 → 시스템관리 그룹 이동
//   - 경영시뮬레이션 하위: 테스트 메뉴 (simulation-test) 추가
//   - 시스템관리 (sysadmin) 대분류 신규
// ============================================================
// M-1~M-4: server.mjs — 신규 메뉴 코드
assertMatch(server, /menu_code:'simulation-test',[\s\S]*?menu_name:'테스트 메뉴',[\s\S]*?menu_url:'\/simulation-test\.html',[\s\S]*?icon_class:'fas fa-vial'/, 'M-1: DEFAULT_MENUS_ALL 에 simulation-test 메뉴');
assertMatch(server, /menu_code:'sysadmin',[\s\S]*?menu_name:'시스템관리',[\s\S]*?menu_url:'#sysadmin',[\s\S]*?icon_class:'fas fa-cogs'/, 'M-2: DEFAULT_MENUS_ALL 에 sysadmin 메뉴');
assertMatch(server, /INSERT INTO menus[\s\S]*?'simulation-test',\s*'테스트 메뉴',\s*'\/simulation-test\.html',\s*'fas fa-vial'/, 'M-3: 시드 INSERT 에 simulation-test');
assertMatch(server, /INSERT INTO menus[\s\S]*?'sysadmin',\s*'시스템관리',\s*'#sysadmin',\s*'fas fa-cogs'/, 'M-4: 시드 INSERT 에 sysadmin');
// M-5~M-6: 마이그레이션 블록
assertMatch(server, /SELECT id FROM menus WHERE menu_code = 'simulation-test'/, 'M-5: simulation-test 마이그레이션 SELECT');
assertMatch(server, /SELECT id FROM menus WHERE menu_code = 'sysadmin'/, 'M-6: sysadmin 마이그레이션 SELECT');
assertMatch(server, /INSERT IGNORE INTO role_menus[\s\S]*?WHERE r\.role_code = 'admin' AND m\.menu_code = 'simulation-test'/, 'M-7: admin 에 simulation-test 자동 매핑');
assertMatch(server, /INSERT IGNORE INTO role_menus[\s\S]*?WHERE r\.role_code = 'admin' AND m\.menu_code = 'sysadmin'/, 'M-8: admin 에 sysadmin 자동 매핑');

// M-9~M-13: platform-sidebar.js GROUPS 재구성
if (PS && PS.GROUPS) {
    const profitGroup = PS.GROUPS.find(g => g.key === 'profitability');
    assert(profitGroup && !profitGroup.codes.includes('permission'),
        'M-9: profitability 그룹 codes 에서 permission 제거');
    assert(profitGroup && profitGroup.codes.includes('nlq') && profitGroup.codes.includes('builder') && profitGroup.codes.includes('learning'),
        'M-10: profitability 그룹 codes 에 nlq/builder/learning 유지');
    const simGroup = PS.GROUPS.find(g => g.key === 'simulation');
    assert(simGroup && simGroup.codes.includes('simulation-test'),
        'M-11: simulation 그룹 codes 에 simulation-test 추가');
    const saGroup = PS.GROUPS.find(g => g.key === 'sysadmin');
    assert(saGroup && Array.isArray(saGroup.requiredCodes) && saGroup.requiredCodes.includes('sysadmin'),
        'M-12: sysadmin 그룹 신규 + requiredCodes 에 sysadmin');
    assert(saGroup && saGroup.codes.includes('permission'),
        'M-13: sysadmin 그룹 codes 에 permission 이관');
}

// M-14~M-20: 사용자 시나리오 (재구성 후)
if (PS && PS.render) {
    const M_NLQ    = { menu_code:'nlq',             menu_name:'자연어 질의',   menu_url:'/nlq',                  icon_class:'fas fa-comments',   sort_order:1 };
    const M_PERM   = { menu_code:'permission',      menu_name:'권한 관리',      menu_url:'/permission.html',      icon_class:'fas fa-shield-alt', sort_order:5 };
    const M_SIM    = { menu_code:'simulation',      menu_name:'경영시뮬레이션', menu_url:'#simulation',           icon_class:'fas fa-flask',      sort_order:100 };
    const M_STEST  = { menu_code:'simulation-test', menu_name:'테스트 메뉴',    menu_url:'/simulation-test.html', icon_class:'fas fa-vial',       sort_order:101 };
    const M_SADM   = { menu_code:'sysadmin',        menu_name:'시스템관리',     menu_url:'#sysadmin',             icon_class:'fas fa-cogs',       sort_order:200 };

    const capture = { innerHTML: '' };
    const originalGet = fakeDocument.getElementById;
    fakeDocument.getElementById = (id) => id === 'sidebarMenu'
        ? { set innerHTML(v){ capture.innerHTML = v; }, get innerHTML(){ return capture.innerHTML; } }
        : null;
    try {
        // groupMenus 결과로 각 그룹별 items 를 정확히 검증 (렌더 문자열보다 안정적)
        const groupedAdmin = PS.groupMenus([M_NLQ, M_PERM, M_SIM, M_STEST, M_SADM]);
        const gaProfit = groupedAdmin.find(g => g.group.key === 'profitability');
        const gaSim    = groupedAdmin.find(g => g.group.key === 'simulation');
        const gaSys    = groupedAdmin.find(g => g.group.key === 'sysadmin');
        // 렌더 결과에서 세 그룹 모두 노출 확인
        capture.innerHTML = '';
        PS.render([M_NLQ, M_PERM, M_SIM, M_STEST, M_SADM], { activeUrl: '/permission.html' });
        assertMatch(capture.innerHTML, /data-group-key="profitability"/, 'M-14: admin → profitability 그룹 노출');
        assertMatch(capture.innerHTML, /data-group-key="simulation"/, 'M-15: admin → simulation 그룹 노출');
        assertMatch(capture.innerHTML, /data-group-key="sysadmin"/, 'M-16: admin → sysadmin 그룹 노출');
        // 그룹별 items 검증 — 각 하위 메뉴가 올바른 그룹에 속하는지
        assert(gaSys && gaSys.items.some(m => m.menu_code === 'permission'),
            'M-17: 권한 관리(permission) 가 시스템관리 그룹 items 에 배치');
        assert(gaProfit && !gaProfit.items.some(m => m.menu_code === 'permission'),
            'M-18: 권한 관리가 수익성분석 그룹 items 에 더 이상 없음');
        assert(gaSim && gaSim.items.some(m => m.menu_code === 'simulation-test'),
            'M-19: 경영시뮬레이션 그룹 items 에 simulation-test 하위 메뉴');
        // 실제 링크가 렌더 결과에 존재하는지도 확인 (사용자 관점)
        assertMatch(capture.innerHTML, /href="\/permission\.html"/, 'M-19b: 렌더 결과에 /permission.html 링크 존재');
        assertMatch(capture.innerHTML, /href="\/simulation-test\.html"/, 'M-19c: 렌더 결과에 /simulation-test.html 링크 존재');

        // 시나리오: 수익성분석만 (permission 없음) → sysadmin/simulation 숨김
        capture.innerHTML = '';
        PS.render([M_NLQ], { activeUrl: '/nlq' });
        assert(!/data-group-key="sysadmin"/.test(capture.innerHTML) && !/data-group-key="simulation"/.test(capture.innerHTML),
            'M-20: 수익성분석 하위만 있음 → sysadmin/simulation 대분류 숨김');

        // 시나리오: sysadmin 대분류만 부여 (permission 하위도 있음) → sysadmin 만 표시
        capture.innerHTML = '';
        PS.render([M_SADM, M_PERM], { activeUrl: '/permission.html' });
        assertMatch(capture.innerHTML, /data-group-key="sysadmin"/, 'M-21: sysadmin 대분류 + permission → sysadmin 그룹 표시');
        assert(!/data-group-key="profitability"/.test(capture.innerHTML),
            'M-22: sysadmin 만 있음 → profitability 숨김 (permission 은 이제 sysadmin 소속)');

        // 시나리오: simulation 대분류만 (simulation-test 없음) → 그룹 헤더만 표시, 하위는 "접근 가능한 메뉴가 없습니다"
        capture.innerHTML = '';
        PS.render([M_SIM], { activeUrl: '/' });
        assertMatch(capture.innerHTML, /data-group-key="simulation"/, 'M-23: simulation 대분류만 → 그룹 표시');
        assertMatch(capture.innerHTML, /접근 가능한 메뉴가 없습니다/, 'M-24: 하위 없으면 "접근 가능한 메뉴가 없습니다" 안내');
    } finally {
        fakeDocument.getElementById = originalGet;
    }
}

// M-25~M-28: permission.html — 그룹별 섹션 렌더
assertMatch(permHtml, /GROUP_SUB_CODES\s*=\s*\{/, 'M-25: permission.html 에 GROUP_SUB_CODES 정의');
assertMatch(permHtml, /경영시뮬레이션 하위 메뉴/, 'M-26: permission.html 에 "경영시뮬레이션 하위 메뉴" 섹션');
assertMatch(permHtml, /시스템관리 하위 메뉴/, 'M-27: permission.html 에 "시스템관리 하위 메뉴" 섹션');
assertMatch(permHtml, /permission['"]?\s*\]\s*\)/, 'M-28: GROUP_SUB_CODES.sysadmin 에 permission 포함');

// M-29: simulation-test.html 페이지 파일 존재
const stestPath = path.resolve(publicDir, 'simulation-test.html');
assert(fs.existsSync(stestPath), 'M-29: simulation-test.html 파일 존재');
if (fs.existsSync(stestPath)) {
    const stestHtml = fs.readFileSync(stestPath, 'utf8');
    assertMatch(stestHtml, /platform-sidebar\.js/, 'M-30: simulation-test.html 이 platform-sidebar.js 로드');
    assertMatch(stestHtml, /PlatformSidebar\.render/, 'M-31: simulation-test.html 이 PlatformSidebar.render 호출');
    assertMatch(stestHtml, /activeUrl:\s*['"]\/simulation-test\.html['"]/, 'M-32: activeUrl = /simulation-test.html');
    assertMatch(stestHtml, /menu_code === ['"]simulation-test['"]/, 'M-33: simulation-test 메뉴 권한 체크');
}

// ============================================================
// 리포트
// ============================================================
console.log('');
console.log('==================================================');
console.log(`PLATFORM HOME TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    for (const f of failures) console.log('  -', f);
    process.exit(1);
}
