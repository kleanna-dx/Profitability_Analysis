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
if (PS && PS.GROUPS) {
    assert(PS.GROUPS.length === 2, 'B-5: 대분류 그룹 정확히 2개 (수익성분석/경영시뮬레이션)');
    assert(PS.GROUPS[0].key === 'profitability', 'B-6: 첫 번째 그룹 key = profitability');
    assert(PS.GROUPS[0].name === '수익성분석', 'B-7: 첫 번째 그룹 이름 = 수익성분석');
    assert(PS.GROUPS[1].key === 'simulation', 'B-8: 두 번째 그룹 key = simulation');
    assert(PS.GROUPS[1].name === '경영시뮬레이션', 'B-9: 두 번째 그룹 이름 = 경영시뮬레이션');
    assert(PS.GROUPS[1].disabled === true, 'B-10: 경영시뮬레이션은 disabled (준비중)');
    // 수익성분석 그룹에 사용자 요구 6개 메뉴 코드 모두 포함
    const profitCodes = PS.GROUPS[0].codes;
    for (const code of ['nlq','builder','learning','permission','batch','interface']) {
        assert(profitCodes.includes(code), `B-11-${code}: 수익성분석 그룹에 ${code} 포함`);
    }
}

// B-12: groupMenus 로직 검증
if (PS && PS.groupMenus) {
    const sample = [
        { menu_code:'nlq',       menu_name:'자연어 질의',        menu_url:'/nlq',            icon_class:'fas fa-comments',        sort_order:1 },
        { menu_code:'builder',   menu_name:'비주얼 쿼리 빌더',  menu_url:'/builder.html',   icon_class:'fas fa-th-large',        sort_order:2 },
        { menu_code:'interface', menu_name:'인터페이스 관리',    menu_url:'/interface.html', icon_class:'fas fa-plug',            sort_order:7 },
    ];
    const grouped = PS.groupMenus(sample);
    assert(grouped.length === 2, 'B-12: groupMenus 결과 2개 그룹');
    assert(grouped[0].group.key === 'profitability', 'B-13: 첫 번째 그룹 = profitability');
    assert(grouped[0].items.length === 3, 'B-14: 수익성분석 그룹에 3개 메뉴 매핑');
    assert(grouped[1].items.length === 0, 'B-15: 경영시뮬레이션 그룹에 0개 (준비중)');

    // 권한이 nlq, builder 만 있을 때 → 딱 그 2개만
    const restricted = PS.groupMenus([sample[0], sample[1]]);
    assert(restricted[0].items.length === 2, 'B-16: 권한 제한 시 그 메뉴만 그룹에 포함');
    // 없는 메뉴 (unknown) 는 무시
    const unknown = PS.groupMenus([{ menu_code:'unknown', menu_name:'X', menu_url:'/x', icon_class:'', sort_order:99 }]);
    assert(unknown[0].items.length === 0, 'B-17: 알려지지 않은 menu_code 는 어느 그룹에도 매핑 안 됨');
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
// H. [홈] 버튼 (2026-09-23 사용자 요청)
//   - 사이드바 최상단, 대분류 위에 독립 [홈] 버튼 표시
//   - href="/" 로 통합 플랫폼 HOME 이동
//   - 현재 페이지가 / 이면 active 스타일
// ============================================================
// H-1: platform-sidebar.js 소스에 home-link CSS + HTML 정의
const sidebarSrcForHome = fs.readFileSync(sidebarJsPath, 'utf8');
assertMatch(sidebarSrcForHome, /#sidebarMenu\s+\.home-link\s*\{/, 'H-1: home-link CSS 정의');
assertMatch(sidebarSrcForHome, /<a href="\/" class="home-link\$\{homeActive\}"/, 'H-2: home-link HTML 이 render() 안에 있음');
assertMatch(sidebarSrcForHome, /class="fas fa-home home-icon"/, 'H-3: 홈 아이콘 (fa-home) 사용');
assertMatch(sidebarSrcForHome, /<span>홈<\/span>/, 'H-4: "홈" 텍스트');
assertMatch(sidebarSrcForHome, /isActive\('\/', activeUrl\)/, 'H-5: 홈 active 판정 (activeUrl === "/")');
assertMatch(sidebarSrcForHome, /container\.innerHTML\s*=\s*homeHtml\s*\+\s*groupsHtml/, 'H-6: innerHTML 에 homeHtml 이 groups 앞에 삽입됨');

// H-7~H-11: 실제 렌더링 결과 검증 (isActive 판정, HTML 마크업)
if (PS && PS.render) {
    // fakeDocument 를 innerHTML 캡처 가능한 스텁으로 교체
    const capture = { innerHTML: '' };
    const originalGet = fakeDocument.getElementById;
    fakeDocument.getElementById = (id) => id === 'sidebarMenu'
        ? { set innerHTML(v){ capture.innerHTML = v; }, get innerHTML(){ return capture.innerHTML; } }
        : null;
    try {
        // H-7: HOME 페이지 (activeUrl='/') → home-link 에 active 클래스
        capture.innerHTML = '';
        PS.render([], { activeUrl: '/' });
        assertMatch(capture.innerHTML, /class="home-link active"/, 'H-7: HOME 페이지에서 home-link 에 active 클래스');
        assertMatch(capture.innerHTML, /<a href="\/"/, 'H-8: 홈 링크 href="/"');
        assertMatch(capture.innerHTML, /<span>홈<\/span>/, 'H-9: 홈 텍스트 렌더링');
        // H-10: 다른 페이지 (activeUrl='/nlq') → home-link 는 active 아님
        capture.innerHTML = '';
        PS.render([], { activeUrl: '/nlq' });
        assert(/class="home-link"/.test(capture.innerHTML) && !/class="home-link active"/.test(capture.innerHTML),
            'H-10: /nlq 페이지에서 home-link 는 active 아님');
        // H-11: 홈 링크가 대분류 앞에 위치
        capture.innerHTML = '';
        PS.render([], { activeUrl: '/builder.html' });
        const homeIdx = capture.innerHTML.indexOf('home-link');
        const groupIdx = capture.innerHTML.indexOf('menu-group');
        assert(homeIdx > -1 && groupIdx > -1 && homeIdx < groupIdx, 'H-11: 홈 링크가 대분류 이전에 위치');
    } finally {
        fakeDocument.getElementById = originalGet;
    }
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
