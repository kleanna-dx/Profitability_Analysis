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

// B-12~B-17: groupMenus 로직 검증
// [2026-09-23-3] 대분류 별도 권한 폐지 (사용자 요청):
//   - 오직 하위 메뉴 코드로 판정. 대분류 코드(simulation/sysadmin) 는 GROUPS 에 존재하지 않아야 함.
//   - 하위 메뉴 1개 이상 → 그룹 표시. 0개 → 그룹 숨김.
if (PS && PS.groupMenus) {
    const M_NLQ      = { menu_code:'nlq',             menu_name:'자연어 질의', menu_url:'/nlq',                  icon_class:'fas fa-comments', sort_order:1 };
    const M_BUILDER  = { menu_code:'builder',         menu_name:'비주얼',      menu_url:'/builder.html',         icon_class:'fas fa-th-large', sort_order:2 };
    const M_INTERFACE= { menu_code:'interface',       menu_name:'인터페이스',  menu_url:'/interface.html',       icon_class:'fas fa-plug',     sort_order:7 };
    const M_STEST    = { menu_code:'simulation-test', menu_name:'테스트',      menu_url:'/simulation-test.html', icon_class:'fas fa-vial',     sort_order:101 };
    const M_PERM     = { menu_code:'permission',      menu_name:'권한 관리',   menu_url:'/permission.html',      icon_class:'fas fa-shield-alt', sort_order:5 };
    // [2026-09-23-3] simulation / sysadmin dummy 코드는 이제 GROUPS 에 매칭 안 됨 → 무시됨
    const M_LEGACY_SIM  = { menu_code:'simulation', menu_name:'X', menu_url:'#simulation', icon_class:'fas fa-flask', sort_order:100 };
    const M_LEGACY_SADM = { menu_code:'sysadmin',   menu_name:'X', menu_url:'#sysadmin',   icon_class:'fas fa-cogs',  sort_order:200 };

    // 시나리오 A: 수익성분석 하위 3개 → profitability 그룹만 표시
    const groupedA = PS.groupMenus([M_NLQ, M_BUILDER, M_INTERFACE]);
    assert(groupedA.length === 1, 'B-12: 수익성분석 하위 3개 → profitability 그룹만');
    assert(groupedA[0].group.key === 'profitability', 'B-13: 첫 그룹 = profitability');
    assert(groupedA[0].items.length === 3, 'B-14: 수익성분석 3개 하위 메뉴');

    // 시나리오 B: simulation-test 하위 1개만 → simulation 그룹만 표시
    //   (M_LEGACY_SIM 을 함께 넣어도 대분류 dummy 코드는 GROUPS 매칭 안 됨 → 무시됨)
    const groupedB = PS.groupMenus([M_STEST, M_LEGACY_SIM]);
    assert(groupedB.length === 1, 'B-15: 경영시뮬 하위 1개만 → 1개 그룹');
    assert(groupedB[0].group.key === 'simulation', 'B-15b: 유일한 그룹 = simulation');
    assert(groupedB[0].items.length === 1 && groupedB[0].items[0].menu_code === 'simulation-test',
        'B-15b2: simulation 그룹 items = [simulation-test] (dummy 대분류 코드 무시)');

    // 시나리오 C: permission 하위만 → sysadmin 그룹만
    const groupedC = PS.groupMenus([M_PERM, M_LEGACY_SADM]);
    assert(groupedC.length === 1, 'B-15c: 권한관리 1개만 → 1개 그룹 (sysadmin)');
    assert(groupedC[0].group.key === 'sysadmin', 'B-15d: 유일한 그룹 = sysadmin');
    assert(groupedC[0].items.length === 1 && groupedC[0].items[0].menu_code === 'permission',
        'B-15d2: sysadmin 그룹 items = [permission]');

    // 시나리오 D: 완전 무권한 → 그룹 0개
    const groupedD = PS.groupMenus([]);
    assert(groupedD.length === 0, 'B-15e: 무권한 → 0개 그룹 (홈은 render()가 별도 처리)');

    // 시나리오 E: 관리자 (전체) → 3개 그룹 모두
    const groupedE = PS.groupMenus([M_NLQ, M_BUILDER, M_INTERFACE, M_STEST, M_PERM]);
    assert(groupedE.length === 3, 'B-16: 3개 그룹 모두 표시 (수익성분석/경영시뮬/시스템관리)');
    assert(groupedE[0].group.key === 'profitability' && groupedE[1].group.key === 'simulation' && groupedE[2].group.key === 'sysadmin',
        'B-16b: 순서 profitability → simulation → sysadmin');

    // 시나리오 F: 대분류 dummy 코드만 (하위 X) → 그룹 0개 (더 이상 대분류 권한은 유효하지 않음)
    const dummyOnly = PS.groupMenus([M_LEGACY_SIM, M_LEGACY_SADM]);
    assert(dummyOnly.length === 0, 'B-16c: 대분류 dummy 코드만 있으면 그룹 0개 (하위 없음)');

    // 시나리오 G: 알려지지 않은 코드 → 그룹 0개
    const unknown = PS.groupMenus([{ menu_code:'unknown', menu_name:'X', menu_url:'/x', icon_class:'', sort_order:99 }]);
    assert(unknown.length === 0, 'B-17: 알려지지 않은 menu_code → 0개 그룹');
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
        // [2026-09-23-3] 대분류는 하위 메뉴 존재 여부로 자동 노출.
        //   → I-13/I-15 검증을 위해 sample 에 simulation 하위 (simulation-test) 포함.
        const sampleAll = [
            { menu_code:'nlq',             menu_name:'자연어 질의', menu_url:'/nlq',                  icon_class:'fas fa-comments', sort_order:1 },
            { menu_code:'simulation-test', menu_name:'테스트 메뉴',  menu_url:'/simulation-test.html', icon_class:'fas fa-vial',     sort_order:101 },
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
// L 섹션 (2026-09-23-3): 대분류 별도 권한 폐지 (사용자 요청)
//   - 대분류(수익성분석/경영시뮬레이션/시스템관리) 는 하위 메뉴 권한 존재 여부로 자동 노출
//   - simulation / sysadmin dummy 대분류 메뉴 코드 폐기
//   - DEFAULT_MENUS_ALL / 시드 INSERT 에서 두 코드 제거
//   - 기존 DB 마이그레이션 블록에서 두 코드 자동 삭제
// ============================================================
// L-1: DEFAULT_MENUS_ALL 에 simulation dummy 코드가 없어야 함
assert(!/menu_code:'simulation',[\s\S]*?menu_url:'#simulation'/.test(server),
    'L-1: DEFAULT_MENUS_ALL 에서 simulation dummy 대분류 제거');
// L-2: DEFAULT_MENUS_ALL 에 sysadmin dummy 코드가 없어야 함
assert(!/menu_code:'sysadmin',[\s\S]*?menu_url:'#sysadmin'/.test(server),
    'L-2: DEFAULT_MENUS_ALL 에서 sysadmin dummy 대분류 제거');
// L-3: 시드 INSERT 에도 없어야 함
assert(!/INSERT INTO menus[\s\S]*?'simulation',\s*'경영시뮬레이션',\s*'#simulation'/.test(server),
    'L-3: 시드 INSERT 에서 simulation dummy 제거');
assert(!/INSERT INTO menus[\s\S]*?'sysadmin',\s*'시스템관리',\s*'#sysadmin'/.test(server),
    'L-4: 시드 INSERT 에서 sysadmin dummy 제거');
// L-5: 기존 DB 마이그레이션 — 두 legacy 코드 DELETE 로직 존재
assertMatch(server, /for\s*\(\s*const legacyCode of\s*\[\s*'simulation'\s*,\s*'sysadmin'\s*\]\s*\)/,
    'L-5: 기존 DB 마이그레이션에서 legacy dummy 코드 DELETE 루프 존재');
assertMatch(server, /DELETE FROM role_menus WHERE menu_id = \?/,
    'L-5b: role_menus 매핑도 함께 DELETE (FK 안전)');
assertMatch(server, /DELETE FROM menus WHERE id = \?/,
    'L-5c: menus 테이블에서 legacy 코드 DELETE');
// L-6: simulation-test 하위 메뉴는 여전히 DEFAULT_MENUS_ALL 에 유지
assertMatch(server, /menu_code:'simulation-test',[\s\S]*?menu_name:'테스트 메뉴',[\s\S]*?menu_url:'\/simulation-test\.html'/,
    'L-6: simulation-test (하위 메뉴, 실제 URL) 는 DEFAULT_MENUS_ALL 에 유지');
// L-7: simulation-test 시드/마이그레이션도 유지
assertMatch(server, /INSERT INTO menus[\s\S]*?'simulation-test',\s*'테스트 메뉴',\s*'\/simulation-test\.html'/,
    'L-7: simulation-test 시드 INSERT 유지');
assertMatch(server, /SELECT id FROM menus WHERE menu_code = 'simulation-test'/,
    'L-8: simulation-test 마이그레이션 SELECT 유지');

// L-9~L-11: platform-sidebar.js GROUPS — requiredCodes 폐기, codes 기반만 사용
if (PS && PS.GROUPS) {
    for (const g of PS.GROUPS) {
        assert(!('requiredCodes' in g),
            `L-9-${g.key}: GROUPS[${g.key}] 에 requiredCodes 필드 없음 (폐기됨)`);
        assert(Array.isArray(g.codes) && g.codes.length > 0,
            `L-10-${g.key}: GROUPS[${g.key}].codes 는 비어있지 않은 배열`);
        assert(!g.disabled,
            `L-11-${g.key}: GROUPS[${g.key}] 에 disabled 필드 없음 (모든 그룹 정상 drop-down)`);
    }
    // sysadmin 그룹은 여전히 존재해야 함
    const saGroup = PS.GROUPS.find(g => g.key === 'sysadmin');
    assert(saGroup && saGroup.codes.includes('permission'),
        'L-12: sysadmin 그룹 codes 에 permission 유지');
    const simGroup = PS.GROUPS.find(g => g.key === 'simulation');
    assert(simGroup && simGroup.codes.includes('simulation-test'),
        'L-13: simulation 그룹 codes 에 simulation-test 유지');
    const profitGroup = PS.GROUPS.find(g => g.key === 'profitability');
    assert(profitGroup && !profitGroup.codes.includes('permission'),
        'L-14: profitability 그룹 codes 에 permission 없음 (sysadmin 소속)');
}

// L-15~L-25: 사용자 시나리오 (사용자 요구 5번 그대로)
if (PS && PS.render) {
    const M_NLQ     = { menu_code:'nlq',             menu_name:'자연어 질의', menu_url:'/nlq',                  icon_class:'fas fa-comments',   sort_order:1 };
    const M_BUILDER = { menu_code:'builder',         menu_name:'비주얼',       menu_url:'/builder.html',         icon_class:'fas fa-th-large',   sort_order:2 };
    const M_LEARN   = { menu_code:'learning',        menu_name:'학습',         menu_url:'/learning.html',        icon_class:'fas fa-graduation-cap', sort_order:4 };
    const M_PERM    = { menu_code:'permission',      menu_name:'권한 관리',    menu_url:'/permission.html',      icon_class:'fas fa-shield-alt', sort_order:5 };
    const M_STEST   = { menu_code:'simulation-test', menu_name:'테스트',       menu_url:'/simulation-test.html', icon_class:'fas fa-vial',       sort_order:101 };
    // Legacy dummy 코드가 서버 응답에 남아있어도 무시되어야 함
    const M_LEGACY_SIM  = { menu_code:'simulation', menu_name:'X', menu_url:'#simulation', icon_class:'fas fa-flask', sort_order:100 };
    const M_LEGACY_SADM = { menu_code:'sysadmin',   menu_name:'X', menu_url:'#sysadmin',   icon_class:'fas fa-cogs',  sort_order:200 };

    const capture = { innerHTML: '' };
    const originalGet = fakeDocument.getElementById;
    fakeDocument.getElementById = (id) => id === 'sidebarMenu'
        ? { set innerHTML(v){ capture.innerHTML = v; }, get innerHTML(){ return capture.innerHTML; } }
        : null;
    try {
        // 시나리오 A (사용자 요구 예시): 사용자 A = [자연어 질의, 비주얼 쿼리 빌더]
        //   → 홈 + 수익성분석 ▼(2개), 경영시뮬레이션/시스템관리 숨김
        capture.innerHTML = '';
        PS.render([M_NLQ, M_BUILDER], { activeUrl: '/nlq' });
        assertMatch(capture.innerHTML, /home-link/, 'L-15: 사용자 A → 홈 노출');
        assertMatch(capture.innerHTML, /data-group-key="profitability"/, 'L-16: 사용자 A → 수익성분석 대분류 노출');
        assert(!/data-group-key="simulation"/.test(capture.innerHTML), 'L-17: 사용자 A → 경영시뮬레이션 숨김');
        assert(!/data-group-key="sysadmin"/.test(capture.innerHTML), 'L-18: 사용자 A → 시스템관리 숨김');

        // 시나리오 B (사용자 요구 예시): 사용자 B = [경영시뮬레이션 하위(simulation-test)]
        //   → 홈 + 경영시뮬레이션, 수익성분석/시스템관리 숨김
        capture.innerHTML = '';
        PS.render([M_STEST], { activeUrl: '/simulation-test.html' });
        assertMatch(capture.innerHTML, /data-group-key="simulation"/, 'L-19: 사용자 B → 경영시뮬레이션 대분류 노출');
        assert(!/data-group-key="profitability"/.test(capture.innerHTML), 'L-20: 사용자 B → 수익성분석 숨김');
        assert(!/data-group-key="sysadmin"/.test(capture.innerHTML), 'L-21: 사용자 B → 시스템관리 숨김');

        // 시나리오 C: 관리자 = 전체 → 홈 + 3개 대분류 모두
        capture.innerHTML = '';
        PS.render([M_NLQ, M_BUILDER, M_LEARN, M_PERM, M_STEST], { activeUrl: '/' });
        assertMatch(capture.innerHTML, /data-group-key="profitability"/, 'L-22: 관리자 → 수익성분석 노출');
        assertMatch(capture.innerHTML, /data-group-key="simulation"/, 'L-23: 관리자 → 경영시뮬레이션 노출');
        assertMatch(capture.innerHTML, /data-group-key="sysadmin"/, 'L-24: 관리자 → 시스템관리 노출');

        // 시나리오 D: 서버 응답에 legacy dummy 코드가 있어도 대분류 표시 여부는 하위 메뉴로만 결정
        //   → dummy 만 있으면 아무 그룹도 노출 안 됨
        capture.innerHTML = '';
        PS.render([M_LEGACY_SIM, M_LEGACY_SADM], { activeUrl: '/' });
        assertMatch(capture.innerHTML, /home-link/, 'L-25: dummy 만 있어도 홈은 노출');
        assert(!/data-group-key="/.test(capture.innerHTML),
            'L-26: legacy dummy (simulation/sysadmin) 만 있으면 대분류 그룹 0개');
    } finally {
        fakeDocument.getElementById = originalGet;
    }
}

// [2026-09-23-4] 그룹 시각적 강조: 각 그룹 컨테이너를 굵은 border 로 감쌈 (사용자 요청)
// L-26b~L-26e: 그룹 컨테이너 border 스타일 검증
{
    const permHtmlPreCheck = fs.readFileSync(path.resolve(publicDir, 'permission.html'), 'utf8');
    // 2.5px solid ${group.color} 인라인 스타일이 render 함수 내에 존재
    assertMatch(permHtmlPreCheck, /border:2\.5px solid \$\{group\.color\}/,
        'L-26b: 그룹 컨테이너에 2.5px solid <group.color> border 인라인 스타일 존재');
    // renderGroupSection 함수 존재
    assertMatch(permHtmlPreCheck, /function\s+renderGroupSection\s*\(/,
        'L-26c: renderGroupSection 헬퍼 함수 정의 (그룹 컨테이너 렌더 통합)');
    // 카운트 뱃지 (n/total)
    assertMatch(permHtmlPreCheck, /\$\{checkedCount\}\s*\/\s*\$\{totalCount\}/,
        'L-26d: 그룹 헤더에 (checkedCount / totalCount) 카운트 뱃지');
    // .menu-group-section hover shadow CSS
    assertMatch(permHtmlPreCheck, /\.menu-group-section:hover\{box-shadow/,
        'L-26e: 그룹 hover 시 shadow 강조 CSS');
}

// L-27~L-32: 권한관리 UI (permission.html) — 그룹별 하위 메뉴 렌더, 대분류 체크 폐지
const permHtmlPath = path.resolve(publicDir, 'permission.html');
const permHtml = fs.readFileSync(permHtmlPath, 'utf8');
// PLATFORM_CATEGORY_CODES 는 더 이상 사용되지 않아야 함 (또는 존재해도 실제 렌더에는 영향 없음)
assert(!/const PLATFORM_CATEGORY_CODES/.test(permHtml),
    'L-27: permission.html 에서 PLATFORM_CATEGORY_CODES 상수 폐지');
// GROUP_LAYOUT 배열로 대체
assertMatch(permHtml, /const GROUP_LAYOUT\s*=\s*\[/,
    'L-28: permission.html 에 GROUP_LAYOUT 배열 정의 (그룹별 렌더 설정)');
assertMatch(permHtml, /key:\s*'profitability'[\s\S]*?codes:\s*\[[\s\S]*?'nlq'/,
    'L-29: GROUP_LAYOUT 에 profitability 항목 (codes 에 nlq)');
assertMatch(permHtml, /key:\s*'simulation'[\s\S]*?codes:\s*\[[\s\S]*?'simulation-test'/,
    'L-30: GROUP_LAYOUT 에 simulation 항목 (codes 에 simulation-test)');
assertMatch(permHtml, /key:\s*'sysadmin'[\s\S]*?codes:\s*\[[\s\S]*?'permission'/,
    'L-31: GROUP_LAYOUT 에 sysadmin 항목 (codes 에 permission)');
// 그룹 전체선택 체크박스 (UI 편의 기능)
assertMatch(permHtml, /function\s+toggleGroupSelect\s*\(/,
    'L-32: 그룹 전체선택 체크박스 핸들러 (toggleGroupSelect) 존재');
assertMatch(permHtml, /class="group-toggle"/,
    'L-33: 그룹 헤더에 .group-toggle 체크박스 클래스');
// 저장 시 그룹 헤더 체크박스는 제외 (menu-group-items 하위만 저장)
assertMatch(permHtml, /#menuCheckList\s+\.menu-group-items\s+input\[type="checkbox"\]:checked/,
    'L-34: saveMenuMapping — group-toggle 제외, menu-group-items 내부만 저장');

// L-35~L-38: 새 3그룹 섹션 타이틀
assertMatch(permHtml, /수익성분석[\s\S]*?자연어 질의/,
    'L-35: 권한관리 UI 에 [수익성분석] 그룹 설명 (자연어 질의 언급)');
assertMatch(permHtml, /경영시뮬레이션[\s\S]*?테스트 메뉴/,
    'L-36: 권한관리 UI 에 [경영시뮬레이션] 그룹 설명 (테스트 메뉴 언급)');
assertMatch(permHtml, /시스템관리[\s\S]*?권한 관리/,
    'L-37: 권한관리 UI 에 [시스템관리] 그룹 설명 (권한 관리 언급)');
assertMatch(permHtml, /하위 메뉴 권한이 하나라도 있으면[\s\S]*?자동 노출/,
    'L-38: 권한관리 UI 에 "하위 메뉴 권한 → 대분류 자동 노출" 안내');

// L-39: simulation-test.html 페이지 파일 존재 (기존 유지)
const stestPath = path.resolve(publicDir, 'simulation-test.html');
assert(fs.existsSync(stestPath), 'L-39: simulation-test.html 파일 존재');
if (fs.existsSync(stestPath)) {
    const stestHtml = fs.readFileSync(stestPath, 'utf8');
    assertMatch(stestHtml, /platform-sidebar\.js/, 'L-40: simulation-test.html 이 platform-sidebar.js 로드');
    assertMatch(stestHtml, /PlatformSidebar\.render/, 'L-41: simulation-test.html 이 PlatformSidebar.render 호출');
    assertMatch(stestHtml, /activeUrl:\s*['"]\/simulation-test\.html['"]/, 'L-42: activeUrl = /simulation-test.html');
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
