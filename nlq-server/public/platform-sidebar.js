/**
 * 통합 플랫폼 공통 사이드바 렌더러
 * ===================================================================
 * 목적:
 *   /api/me 응답의 menus 배열을 받아 좌측 사이드바를 대분류(수익성분석 /
 *   경영시뮬레이션) → 하위 메뉴 드롭다운 구조로 렌더링한다.
 *
 * 사용법:
 *   HTML 에 <nav id="sidebarMenu"></nav> 컨테이너를 두고,
 *   /api/me 로 받은 menus 배열을 아래처럼 전달:
 *     window.PlatformSidebar.render(me.menus || [], { activeUrl: window.location.pathname });
 *
 * 그룹핑 규칙 (menu_code 기준):
 *   - 수익성분석 (profitability): nlq, builder, learning, permission, batch, interface, report
 *   - 경영시뮬레이션 (simulation): (아직 준비중, 하위 메뉴 없음)
 *
 * 권한 반영:
 *   /api/me 가 사용자에게 허용된 메뉴만 반환하므로 (RBAC),
 *   여기서는 별도 필터링 없이 그대로 렌더링만 담당.
 *   → 예: user 가 nlq, builder 만 있으면 [수익성분석] 그룹 아래 두 개만 표시.
 *   → 사용자가 수익성분석 하위 메뉴가 하나도 없으면 그룹 자체는 표시하되
 *     "접근 가능한 메뉴 없음" 안내 표시.
 *
 * 대분류 클릭 → 하위 접기/펼치기 (localStorage 로 상태 저장).
 *
 * ⚠️ 실행 SQL / LLM / 서버 로직 무관. 순수 프론트엔드 렌더링 헬퍼.
 * ===================================================================
 */
(function(global) {
    'use strict';

    // ─────────────────────────────────────────────────────────────
    // [2026-10-02] 통합 사이드바 공통 CSS — 모든 페이지가 유일하게 참조하는 소스.
    //
    // 설계 원칙:
    //   1. CSS 변수(:root 수준) 로 사이드바 색상/간격 토큰 정의 → 중복 하드코딩 금지
    //   2. 모든 사이드바 관련 selector 는 매우 높은 specificity 로 각 페이지의 중복
    //      .sidebar 규칙을 덮어쓰기 (!important 없이 cascade 로 승리)
    //   3. 각 페이지의 레거시 .sidebar / .sidebar-divider / .sidebar-menu-item /
    //      .sidebar-overlay CSS 는 전부 삭제됐으므로, 이 CSS 가 유일한 소스.
    //   4. 홈 버튼 위쪽 여백 (brand/divider 아래) 은 공통으로 작게 유지.
    // ─────────────────────────────────────────────────────────────
    function injectCssOnce() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('platform-sidebar-style')) return;
        const style = document.createElement('style');
        style.id = 'platform-sidebar-style';
        style.textContent = `
/* ===== design tokens (유일한 색상/치수 소스) ===== */
:root{
    /* 사이드바 배경: 사용자 요청 2번 이미지 기준 보라빛 네이비 */
    --sb-bg-top: #1e1b4b;
    --sb-bg-bottom: #312e81;
    --sb-text: #e0e7ff;
    --sb-text-dim: #c7d2fe;
    --sb-border: rgba(255,255,255,0.08);
    /* 사이드바 치수 */
    --sb-width: 280px;
    --sb-brand-pt: 20px;      /* brand 영역 상단 padding */
    --sb-brand-pb: 14px;      /* brand 영역 하단 padding (divider 와의 간격) */
    --sb-brand-px: 20px;
    --sb-menu-pt: 10px;       /* divider 와 첫 '홈' 버튼 사이 여백 (작게) */
    --sb-menu-pb: 8px;
    /* 메뉴 카드 색상 (indigo tint) */
    --sb-cat-bg:          rgba(99,102,241,.10);
    --sb-cat-border:      rgba(99,102,241,.22);
    --sb-cat-hover-bg:    rgba(99,102,241,.22);
    --sb-cat-hover-bd:    rgba(99,102,241,.42);
    --sb-cat-active-bg:   rgba(99,102,241,.32);
    --sb-cat-active-bd:   rgba(165,180,252,.62);
    --sb-cat-icon:        #a5b4fc;
    --sb-cat-icon-hover:  #c7d2fe;
    /* 하위 메뉴 */
    --sb-sub-text:        #cbd5e1;
    --sb-sub-icon:        #94a3b8;
    --sb-sub-hover-bg:    rgba(99,102,241,.14);
    --sb-sub-active-bg:   rgba(99,102,241,.24);
}

/* ===== 사이드바 뼈대 (shell) — 모든 페이지 공통 ===== */
aside#sidebar.sidebar{
    position:fixed; top:0; left:0;
    width:var(--sb-width); height:100vh;
    background:linear-gradient(180deg, var(--sb-bg-top) 0%, var(--sb-bg-bottom) 100%);
    color:var(--sb-text);
    z-index:100;
    display:flex; flex-direction:column;
    overflow-y:auto; overflow-x:hidden;
    font-family:'Noto Sans KR','Segoe UI',sans-serif;
    font-size:14px;
    box-shadow:4px 0 24px rgba(0,0,0,0.15);
    transition:transform .3s ease;
    box-sizing:border-box;
    /* 모바일에서는 숨김 (open 클래스로 노출) */
}
@media (max-width:900px){
    aside#sidebar.sidebar{transform:translateX(-100%);}
    aside#sidebar.sidebar.open{transform:translateX(0);}
}
@media (min-width:901px){
    aside#sidebar.sidebar{transform:none !important;}
}
aside#sidebar.sidebar::-webkit-scrollbar{width:6px;}
aside#sidebar.sidebar::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:3px;}

/* ===== brand 영역 ===== */
aside#sidebar .sb-brand{
    padding:var(--sb-brand-pt) var(--sb-brand-px) var(--sb-brand-pb);
    flex-shrink:0;
}
aside#sidebar .sb-brand-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;}
aside#sidebar .sb-brand-link{
    display:flex;flex-direction:column;gap:2px;
    text-decoration:none;color:inherit;flex:1;
    transition:opacity .15s;
}
aside#sidebar .sb-brand-link:hover{opacity:.85;}
aside#sidebar .sb-brand-title{
    font-size:18px;font-weight:800;letter-spacing:-.3px;color:#fff;line-height:1.2;margin:0;
    transition:color .15s;
}
aside#sidebar .sb-brand-link:hover .sb-brand-title{color:#a5b4fc;}
aside#sidebar .sb-brand-sub{
    font-size:11.5px;color:#a5b4fc;opacity:.85;margin:0;line-height:1.3;
}
aside#sidebar .sb-close{
    width:30px;height:30px;display:flex;align-items:center;justify-content:center;
    border:0;background:transparent;color:#a5b4fc;cursor:pointer;border-radius:6px;
    font-size:16px;flex-shrink:0;
}
aside#sidebar .sb-close:hover{background:rgba(255,255,255,.08);color:#fff;}
@media (min-width:901px){
    aside#sidebar .sb-close{display:none;}
}

/* ===== divider ===== */
aside#sidebar .sb-divider{
    height:1px;background:var(--sb-border);margin:0 var(--sb-brand-px);flex-shrink:0;
}

/* ===== menu 영역 ===== */
/* [2026-10-02 수정] history 영역(/nlq, /builder.html)이 nav 이후에 올 수 있으므로
 *   nav 는 flex:1 로 모든 공간을 차지하지 않고 '내용 크기 만큼' 차지한다.
 *   - history 영역이 없는 페이지 (대부분): nav 만 flex:1 로 늘어나야 하므로 아래 스타일 유지
 *   - history 영역이 있는 페이지 (/nlq, /builder.html): nav 는 flex-shrink:0 (내용 크기),
 *     history 영역이 flex:1 로 나머지 공간을 차지하면서 내부 스크롤
 *   → :has() 셀렉터를 사용하여 history 영역 유무로 분기.
 *   → 레거시 fallback: :has() 미지원 브라우저에서도 nav 단독일 때 flex:1 유지됨.
 */
aside#sidebar nav#sidebarMenu{
    flex:1;overflow-y:auto;overflow-x:hidden;
    padding:var(--sb-menu-pt) 0 var(--sb-menu-pb);
    margin:0;
}
/* history 영역이 존재할 때: nav 는 내용 크기, history 가 남은 공간 차지 */
aside#sidebar:has(> .sidebar-history-section, > .sidebar-divider) nav#sidebarMenu{
    flex:0 0 auto;overflow:visible;
}

/* ===== 페이지별 하단 history 영역 (nav 이후, 조건부) =====
 *   /nlq (자연어 질의): "+ 새 채팅" + "질의 이력" + 탭 + 리스트
 *   /builder.html (비주얼 쿼리 빌더): .sidebar-history-section wrapper 로 감쌈
 *   → 두 페이지는 각자 inline CSS 로 .history-list / .history-header / .history-tabs 등을
 *     이미 가지고 있으므로, 여기서는 "aside 안에서의 레이아웃 정렬"만 담당.
 */
aside#sidebar > .sidebar-divider{
    height:1px;background:var(--sb-border);margin:4px var(--sb-brand-px);flex-shrink:0;
}
/* /builder.html: .sidebar-history-section 이 flex:1 로 남은 공간 차지, 내부 .history-list 스크롤 */
aside#sidebar > .sidebar-history-section{
    flex:1 1 auto;min-height:0;display:flex;flex-direction:column;overflow:hidden;
}
aside#sidebar > .sidebar-history-section > .history-header,
aside#sidebar > .sidebar-history-section > .new-builder-btn,
aside#sidebar > .sidebar-history-section > .history-tabs{flex-shrink:0;}
aside#sidebar > .sidebar-history-section > .history-list{flex:1 1 auto;min-height:0;overflow-y:auto;}

/* /nlq (index.html): .sidebar-history-section 래퍼가 없고 aside 직속 자식 (div > history-header, tabs, list)
 *   구조이므로, nav 다음에 오는 요소들을 그룹으로 묶지 못함.
 *   → aside 자체가 flex column 이고 overflow:auto 이므로 nav 이후 요소들은 자연 흐름.
 *   → 다만 history-list 가 내부 스크롤이 되도록 .history-list 의 max-height 기존 CSS 유지.
 *   → /nlq 는 inline CSS 에 .history-list{max-height:calc(100vh - 420px);overflow-y:auto;} 이미 있음.
 */


/* ===== 대분류 카드 (홈 / 수익성분석 / 경영시뮬레이션 / 시스템관리 공통) ===== */
#sidebarMenu .category-item{
    display:flex;align-items:center;gap:12px;
    margin:6px 14px;padding:12px 16px;
    min-height:46px;box-sizing:border-box;
    background:var(--sb-cat-bg);
    border:1px solid var(--sb-cat-border);
    border-radius:10px;
    color:var(--sb-text);font-size:14px;font-weight:700;letter-spacing:-.2px;
    text-decoration:none;cursor:pointer;user-select:none;
    transition:background .15s,border-color .15s,color .15s,box-shadow .15s,transform .15s;
}
#sidebarMenu .category-item > .cat-icon{
    color:var(--sb-cat-icon);font-size:15px;width:18px;text-align:center;flex-shrink:0;
}
#sidebarMenu .category-item > .cat-label{flex:1;}
#sidebarMenu .category-item:hover{
    background:var(--sb-cat-hover-bg);border-color:var(--sb-cat-hover-bd);color:#fff;
    transform:translateY(-1px);box-shadow:0 4px 10px rgba(99,102,241,.15);
}
#sidebarMenu .category-item:hover > .cat-icon{color:var(--sb-cat-icon-hover);}
#sidebarMenu .category-item.active{
    background:var(--sb-cat-active-bg);border-color:var(--sb-cat-active-bd);color:#fff;
    box-shadow:0 0 0 1px rgba(165,180,252,.20) inset;
}
#sidebarMenu .category-item.active > .cat-icon{color:var(--sb-cat-icon-hover);}
#sidebarMenu .category-item > .chevron{
    font-size:11px;color:var(--sb-cat-icon);transition:transform .18s;flex-shrink:0;
}
#sidebarMenu .menu-group.collapsed > .category-item > .chevron{transform:rotate(-90deg);}
/* 준비중 뱃지 (레거시, 현재는 사용 X) */
#sidebarMenu .category-item > .ready-badge{
    font-size:11px;font-weight:600;color:#cbd5e1;
    background:rgba(148,163,184,.18);border:1px solid rgba(148,163,184,.28);
    padding:3px 9px;border-radius:999px;letter-spacing:0;flex-shrink:0;
}

/* 대분류 그룹 body */
#sidebarMenu .menu-group{margin:0;}
#sidebarMenu .menu-group-body{padding:2px 0 4px;}
#sidebarMenu .menu-group.collapsed > .menu-group-body{display:none;}
#sidebarMenu > .menu-group:last-child > .category-item{margin-bottom:0;}
#sidebarMenu > .menu-group:last-child > .menu-group-body{padding-bottom:0;}

/* ===== 하위 메뉴 (들여쓰기) ===== */
#sidebarMenu .menu-item{
    display:flex;align-items:center;gap:10px;
    margin:2px 22px 2px 34px;padding:7px 12px;
    border-radius:7px;
    font-size:13.5px;font-weight:500;color:var(--sb-sub-text);
    text-decoration:none;cursor:pointer;
    transition:background .12s,color .12s;
}
#sidebarMenu .menu-item > i{width:15px;text-align:center;font-size:12.5px;color:var(--sb-sub-icon);flex-shrink:0;}
#sidebarMenu .menu-item:hover{background:var(--sb-sub-hover-bg);color:#fff;}
#sidebarMenu .menu-item:hover > i{color:var(--sb-cat-icon-hover);}
#sidebarMenu .menu-item.active{background:var(--sb-sub-active-bg);color:#fff;font-weight:600;}
#sidebarMenu .menu-item.active > i{color:var(--sb-cat-icon-hover);}
#sidebarMenu .menu-empty{
    margin:2px 22px 2px 34px;padding:7px 12px;
    font-size:12.5px;color:#64748b;font-style:italic;
}

/* ===== 모바일 오버레이 ===== */
.sidebar-overlay{
    position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:90;display:none;
}
.sidebar-overlay.active{display:block;}
@media (min-width:901px){
    .sidebar-overlay{display:none !important;}
}

/* ===== 레거시 class 호환 (삭제 예정) ===== */
/* 기존 각 페이지가 .sidebar-menu-item 를 참조해도 사이드바 색상이 깨지지 않도록
   최소한의 reset 만 유지. 신규 구현은 모두 .category-item/.menu-item 사용. */
aside#sidebar .sidebar-menu-item{color:var(--sb-sub-text);text-decoration:none;}

/* 공통 PC 레이아웃 보정: body 좌측 padding (사이드바 폭 확보) */
@media (min-width:901px){
    body.has-platform-sidebar{padding-left:var(--sb-width);}
}
`;
        document.head.appendChild(style);
    }

    /**
     * 사이드바 전체 shell (brand + divider + nav) 을 DOM 에 보장.
     * 각 페이지의 HTML 은 <aside id="sidebar" class="sidebar"></aside> 빈 shell 만 두면 됨.
     * 이미 shell 내부가 채워져 있으면 (brand/nav) 그대로 유지.
     * 모바일 overlay (<div id="sidebarOverlay" class="sidebar-overlay">) 도 함께 보장.
     * [2026-10-02] 추가: 모든 페이지에서 동일한 DOM 구조 보장.
     */
    function ensureShell() {
        if (typeof document === 'undefined') return;
        // body 에 공통 class 부여 (좌측 padding 확보)
        if (document.body && !document.body.classList.contains('has-platform-sidebar')) {
            document.body.classList.add('has-platform-sidebar');
        }
        // overlay
        if (!document.getElementById('sidebarOverlay')) {
            const ov = document.createElement('div');
            ov.id = 'sidebarOverlay';
            ov.className = 'sidebar-overlay';
            // onclick 바인딩: setAttribute 가 아니라 직접 핸들러 할당 (jsdom 호환)
            ov.onclick = function(){ try { global.PlatformSidebar.close(); } catch(_) {} };
            document.body.appendChild(ov);
        }
        // aside shell
        let aside = document.getElementById('sidebar');
        if (!aside) {
            aside = document.createElement('aside');
            aside.id = 'sidebar';
            aside.className = 'sidebar';
            document.body.insertBefore(aside, document.body.firstChild);
        }
        // 사이드바 class 보장 (일부 페이지는 class 없이 id 만 가짐)
        if (!aside.classList.contains('sidebar')) aside.classList.add('sidebar');
        // brand 영역이 없으면 생성 (공통 템플릿)
        let brand = aside.querySelector('.sb-brand');
        if (!brand) {
            // 기존 .brand / .p-5 등 레거시 wrapper 제거 (중복 방지)
            const legacyBrands = aside.querySelectorAll('.brand, .p-5, .pb-3');
            legacyBrands.forEach(el => el.remove());
            // [2026-10-02 BUGFIX] .sidebar-divider 전역 삭제는 제거.
            //   이유: /nlq, /builder.html 는 "메뉴 아래 전용 하단 영역 (질의 이력 / 쿼리 이력)"
            //         시작 지점에 <div class="sidebar-divider"></div> 를 두는데,
            //         구 로직은 이 divider 까지 지워버려 하단 영역의 시각적 구분이 사라짐.
            //   현재 모든 페이지의 레거시 .brand / .p-5 wrapper 는 이미 제거되었고
            //   (PR #512 참조), 신규 .sb-divider 는 brand 바로 뒤에 별도로 생성되므로
            //   .sidebar-divider 를 그대로 둬도 레거시 wrapper 와 겹치지 않는다.
            //   → .sidebar-divider 는 각 페이지 하단 영역 전용 divider 로만 사용.
            brand = document.createElement('div');
            brand.className = 'sb-brand';
            brand.innerHTML = `
                <div class="sb-brand-row">
                    <a href="/" class="sb-brand-link" title="통합 플랫폼 HOME">
                        <span class="sb-brand-title">통합 플랫폼</span>
                        <span class="sb-brand-sub">수익성분석 · 경영시뮬레이션</span>
                    </a>
                    <button type="button" class="sb-close" onclick="window.PlatformSidebar.close();" title="닫기">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`;
            aside.insertBefore(brand, aside.firstChild);
        }
        // divider
        let divider = aside.querySelector('.sb-divider');
        if (!divider) {
            divider = document.createElement('div');
            divider.className = 'sb-divider';
            brand.insertAdjacentElement('afterend', divider);
        }
        // nav
        //   [2026-10-02] nav 는 반드시 'sb-divider 바로 뒤' 위치에 삽입한다.
        //   이유: /nlq, /builder.html 처럼 aside 안에 이미 하단 전용 영역
        //         (<div class="sidebar-divider"> + history panel) 이 markup 으로
        //         들어있는 경우, nav 를 aside.appendChild() 하면 history 영역 뒤로
        //         밀려서 "메뉴가 이력 아래에 표시" 되는 역순이 되어버린다.
        //   → 신규 nav 생성 시: divider 바로 뒤에 insertAdjacentElement('afterend')
        //   → 기존 nav 가 다른 위치에 있을 때도: divider 뒤로 재배치.
        let nav = document.getElementById('sidebarMenu');
        if (!nav) {
            nav = document.createElement('nav');
            nav.id = 'sidebarMenu';
            divider.insertAdjacentElement('afterend', nav);
        } else if (nav.parentElement !== aside) {
            divider.insertAdjacentElement('afterend', nav);
        } else if (nav.previousElementSibling !== divider) {
            // aside 자식이지만 divider 바로 뒤가 아니면 재배치
            divider.insertAdjacentElement('afterend', nav);
        }
        return { aside, brand, divider, nav };
    }

    /** 모바일 사이드바 열기/닫기 */
    function open() {
        const aside = document.getElementById('sidebar');
        const ov = document.getElementById('sidebarOverlay');
        if (aside) aside.classList.add('open');
        if (ov) ov.classList.add('active');
    }
    function close() {
        const aside = document.getElementById('sidebar');
        const ov = document.getElementById('sidebarOverlay');
        if (aside) aside.classList.remove('open');
        if (ov) ov.classList.remove('active');
    }

    // ─────────────────────────────────────────────────────────────
    // 대분류 정의 (사용자 요구: 수익성분석 / 경영시뮬레이션 / 시스템관리)
    // [2026-09-23-3] 대분류 별도 권한 폐지 (사용자 요청):
    //   - 각 대분류의 노출 여부는 오직 "하위 메뉴 권한 존재 여부" 로 자동 결정.
    //   - 하위 메뉴 1개 이상 me.menus 에 있음 → 대분류 노출
    //   - 하위 메뉴 0개 → 대분류 숨김
    //   - dummy 대분류 코드 (simulation, sysadmin) 및 requiredCodes 로직 제거.
    //   → 권한 구조 단순화 + 프론트/백엔드 규칙 통일
    // ─────────────────────────────────────────────────────────────
    const GROUPS = [
        {
            key: 'profitability',
            name: '수익성분석',
            icon: 'fas fa-chart-pie',
            // 이 codes 안에 해당하는 하위 메뉴 중 하나라도 me.menus 에 있으면 대분류 노출.
            codes: ['nlq', 'builder', 'learning', 'batch', 'interface', 'report'],
        },
        {
            key: 'simulation',
            name: '경영시뮬레이션',
            icon: 'fas fa-flask',
            // 현재 하위: 테스트 메뉴 (simulation-test). 향후 추가 시 이 배열에 append.
            codes: ['simulation-test'],
        },
        {
            key: 'sysadmin',
            name: '시스템관리',
            icon: 'fas fa-cogs',
            // 하위: 권한 관리. 향후 시스템관리 관련 메뉴는 여기에 추가.
            codes: ['permission'],
        },
    ];

    // localStorage 키 (그룹별 접힘 상태)
    const LS_KEY = 'platformSidebarCollapsed_v1';

    function readCollapsedState() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (_) { return {}; }
    }
    function writeCollapsedState(state) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (_) {}
    }

    function escapeHtml(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    /**
     * menus 배열을 대분류 그룹별로 분류. 하위 메뉴가 0개인 그룹은 반환 제외.
     * [2026-09-23-3] 대분류 표시 규칙 단순화 (사용자 요청):
     *   - 하위 메뉴 (codes 매칭) 가 1개 이상이면 그룹 반환 → 대분류 노출
     *   - 하위 메뉴 0개면 그룹 자체 미반환 → 대분류 숨김
     *   - 별도의 대분류 권한 코드는 사용하지 않음.
     * 반환: [{group, items:[menu,...]}, ...]
     */
    function groupMenus(menus) {
        const menusByCode = {};
        for (const m of (menus || [])) {
            if (m && m.menu_code) menusByCode[m.menu_code] = m;
        }
        const result = [];
        for (const g of GROUPS) {
            // 이 그룹의 하위 메뉴 (권한 있는 것만)
            const items = g.codes
                .map(code => menusByCode[code])
                .filter(Boolean);
            items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
            // 하위 메뉴가 하나도 없으면 그룹 자체 숨김
            if (items.length === 0) continue;
            result.push({ group: g, items });
        }
        return result;
    }

    /**
     * URL 이 현재 활성 페이지인지 판정.
     * - 정확히 일치하거나 pathname startsWith
     * - '/' 는 index.html 도 포함
     */
    function isActive(menuUrl, activeUrl) {
        if (!menuUrl || !activeUrl) return false;
        // 표준화
        const a = String(activeUrl).replace(/\?.*$/, '').replace(/#.*$/, '');
        const m = String(menuUrl).replace(/\?.*$/, '').replace(/#.*$/, '');
        if (a === m) return true;
        // 자연어질의 여러 alias 처리
        if (m === '/nlq' && (a === '/nlq' || a === '/nlq/' || a === '/index.html')) return true;
        // /report 는 SPA fallback 이므로 startsWith
        if (m === '/report' && a.startsWith('/report')) return true;
        return false;
    }

    /**
     * 사이드바 렌더링.
     * @param {Array} menus - /api/me 응답의 menus 배열
     * @param {Object} opts - { activeUrl: string, containerId?: string }
     */
    function render(menus, opts) {
        const options = opts || {};
        const containerId = options.containerId || 'sidebarMenu';
        const activeUrl = options.activeUrl || (typeof location !== 'undefined' ? location.pathname : '');
        injectCssOnce();
        // [2026-10-02] shell 자동 보장 — 각 페이지가 HTML 로 brand/divider 를 직접
        //   정의하지 않아도 공통 DOM 이 자동 생성됨 → 모든 페이지 UI 100% 동일.
        ensureShell();
        const container = document.getElementById(containerId);
        if (!container) {
            // 컨테이너 없으면 조용히 no-op (해당 페이지가 아직 통합 사이드바 도입 전일 수 있음)
            return false;
        }

        const grouped = groupMenus(menus);
        const collapsed = readCollapsedState();

        // 어느 그룹에 activeUrl 이 속하는지 판정 → 그 그룹은 자동으로 펼침
        let activeGroupKey = null;
        for (const g of grouped) {
            if (g.items.some(m => isActive(m.menu_url, activeUrl))) {
                activeGroupKey = g.group.key;
                break;
            }
        }
        // active 그룹은 강제로 펼침 (collapsed 무시)
        if (activeGroupKey) collapsed[activeGroupKey] = false;

        // [2026-09-23-3] 대분류는 하위 메뉴가 1개 이상일 때만 groupMenus 가 반환하므로
        //   disabled/menu-empty 분기는 더 이상 필요 없음 (단순화).
        //   모든 대분류가 홈과 동일한 .category-item 스타일 + chevron drop-down 을 가진다.
        //   - 홈: <a> 태그 (링크, 권한 무관 항상 노출)
        //   - 각 대분류: 클릭 시 접힘/펼침 토글 + chevron 표시
        const homeActive = isActive('/', activeUrl) ? ' active' : '';
        const homeHtml = `<a href="/" class="home-link category-item${homeActive}" title="통합 플랫폼 HOME">
            <i class="fas fa-home cat-icon"></i><span class="cat-label">홈</span>
        </a>`;

        const groupsHtml = grouped.map(g => {
            const isCollapsed = !!collapsed[g.group.key];
            const groupCls = ['menu-group', isCollapsed ? 'collapsed' : ''].filter(Boolean).join(' ');
            const headerActive = g.items.some(m => isActive(m.menu_url, activeUrl)) ? ' active' : '';
            const itemsHtml = g.items.map(m => {
                const active = isActive(m.menu_url, activeUrl) ? ' active' : '';
                return `<a href="${escapeHtml(m.menu_url)}" class="menu-item${active}" data-menu-code="${escapeHtml(m.menu_code)}">
                    <i class="${escapeHtml(m.icon_class || 'fas fa-circle')}"></i><span>${escapeHtml(m.menu_name)}</span>
                </a>`;
            }).join('');
            // .menu-group-header 클래스는 하위 호환으로 함께 유지
            return `<div class="${groupCls}" data-group-key="${g.group.key}">
                <div class="menu-group-header category-item${headerActive}" onclick="window.PlatformSidebar.toggle('${g.group.key}')">
                    <i class="${escapeHtml(g.group.icon)} cat-icon"></i>
                    <span class="cat-label">${escapeHtml(g.group.name)}</span>
                    <i class="fas fa-chevron-down chevron"></i>
                </div>
                <div class="menu-group-body">${itemsHtml}</div>
            </div>`;
        }).join('');

        container.innerHTML = homeHtml + groupsHtml;
        return true;
    }

    /**
     * 대분류 클릭 시 접기/펼치기 토글.
     */
    function toggle(groupKey) {
        const el = document.querySelector(`.menu-group[data-group-key="${groupKey}"]`);
        if (!el) return;
        el.classList.toggle('collapsed');
        const state = readCollapsedState();
        state[groupKey] = el.classList.contains('collapsed');
        writeCollapsedState(state);
    }

    /**
     * [2026-10-02] 자동 부트스트랩:
     *   - DOMContentLoaded 시점에 /api/me 를 호출하여 사이드바를 자동 렌더.
     *   - 각 페이지의 init() 가 render() 를 또 호출해도 idempotent (menus 는 같은 응답).
     *   - 이 자동 렌더는 "defer timing 버그" (각 페이지 inline async script 가
     *     PlatformSidebar 로드 전에 render 를 호출하려다 undefined 참조) 를 근본 해결.
     *   - 각 페이지의 render(...) 호출은 하위호환으로 유지되지만, 호출되지 않더라도
     *     이 bootstrap 이 사이드바를 보장함.
     */
    async function bootstrap() {
        try {
            ensureShell();
            // /api/me 는 각 페이지가 어차피 호출하지만, 사이드바는 즉시 그릴 수 있도록
            //   별도로 미리 호출. 404/401 등은 조용히 무시 (사이드바만 빈 상태).
            let menus = [];
            try {
                const r = await fetch('/api/me');
                if (r.ok) {
                    const me = await r.json();
                    menus = (me && me.menus) || [];
                }
            } catch(_) { /* no-op */ }
            render(menus, { activeUrl: location.pathname });
        } catch(e) {
            // 사이드바 렌더 실패해도 페이지는 계속 작동해야 함
            if (typeof console !== 'undefined') console.warn('[PlatformSidebar] bootstrap 실패:', e);
        }
    }
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
        } else {
            // DOMContentLoaded 이미 발생 → 즉시 실행
            bootstrap();
        }
    }

    // 전역 export
    global.PlatformSidebar = {
        render,
        toggle,
        ensureShell,     // 공통 shell 보장 (brand + divider + nav)
        bootstrap,       // 외부에서 재부트 트리거 가능
        open,            // 모바일: 사이드바 열기
        close,           // 모바일: 사이드바 닫기
        injectCssOnce,   // 테스트에서 사용
        groupMenus,      // 테스트에서 사용
        isActive,        // 테스트에서 사용
        GROUPS,          // 테스트에서 사용
    };
})(typeof window !== 'undefined' ? window : globalThis);
