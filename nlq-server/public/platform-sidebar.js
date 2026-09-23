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
    // CSS 자동 주입 (기존 페이지 스타일과 공존)
    //   - .sidebar-menu-item (기존) 과 .menu-item/.menu-group (통합) 을 함께 지원
    //   - 각 페이지 CSS 를 건드리지 않고도 통합 사이드바 스타일 적용
    // ─────────────────────────────────────────────────────────────
    function injectCssOnce() {
        if (typeof document === 'undefined') return;
        if (document.getElementById('platform-sidebar-style')) return;
        const style = document.createElement('style');
        style.id = 'platform-sidebar-style';
        style.textContent = `
/* ─────────────────────────────────────────────────────────────
 * 통합 대분류 카드 (홈 / 수익성분석 / 경영시뮬레이션 공통)
 *   [2026-09-23 사용자 요청] 3개 대분류를 완전히 동일한 카드 스타일로 통일
 *   - 동일한 높이 / 여백 / 아이콘 / 폰트 크기
 *   - 둥근 박스 디자인 공통 적용
 *   - active 상태 명확 (배경/테두리 강조)
 *   - 기존 사이드바 컬러톤 유지 (indigo 계열 tint)
 * ────────────────────────────────────────────────────────────*/
/* [2026-09-23 사용자 요청] 마지막 대분류(경영시뮬레이션) 아래 여백 제거.
   기존 padding-bottom:20px 은 사이드바 하단의 "새 채팅" / "질의 이력" 영역과 사이에
   시각적으로 불필요한 공백을 만들었음. 상단은 로고와 첫 카드 사이 살짝 여유(8px)만 유지. */
#sidebarMenu{padding:8px 0 4px;}
#sidebarMenu .category-item{
    /* 공통 base: 홈/수익성분석/경영시뮬레이션 모두 이 스타일을 상속 */
    display:flex;align-items:center;gap:12px;
    margin:6px 14px;padding:12px 16px;
    min-height:46px;box-sizing:border-box;
    background:rgba(99,102,241,.10);
    border:1px solid rgba(99,102,241,.22);
    border-radius:10px;
    color:#e0e7ff;font-size:14px;font-weight:700;letter-spacing:-.2px;
    text-decoration:none;cursor:pointer;user-select:none;
    transition:background .15s,border-color .15s,color .15s,box-shadow .15s,transform .15s;
}
#sidebarMenu .category-item > .cat-icon{
    color:#a5b4fc;font-size:15px;width:18px;text-align:center;flex-shrink:0;
}
#sidebarMenu .category-item > .cat-label{flex:1;}
#sidebarMenu .category-item:hover{
    background:rgba(99,102,241,.22);border-color:rgba(99,102,241,.42);color:#fff;
    transform:translateY(-1px);box-shadow:0 4px 10px rgba(99,102,241,.15);
}
#sidebarMenu .category-item:hover > .cat-icon{color:#c7d2fe;}
#sidebarMenu .category-item.active{
    background:rgba(99,102,241,.32);border-color:rgba(165,180,252,.62);color:#fff;
    box-shadow:0 0 0 1px rgba(165,180,252,.20) inset;
}
#sidebarMenu .category-item.active > .cat-icon{color:#c7d2fe;}
/* 대분류(그룹) 헤더 특화: chevron 회전 */
#sidebarMenu .category-item > .chevron{
    font-size:11px;color:#a5b4fc;transition:transform .18s;flex-shrink:0;
}
#sidebarMenu .menu-group.collapsed > .category-item > .chevron{transform:rotate(-90deg);}
/* 준비중 뱃지 (경영시뮬레이션) — 대분류 카드 안에 우측 정렬 */
#sidebarMenu .category-item > .ready-badge{
    font-size:11px;font-weight:600;color:#cbd5e1;
    background:rgba(148,163,184,.18);border:1px solid rgba(148,163,184,.28);
    padding:3px 9px;border-radius:999px;letter-spacing:0;flex-shrink:0;
}
/* 준비중 그룹은 hover 시 transform/shadow 없음 (클릭 불가) */
#sidebarMenu .menu-group.disabled > .category-item{cursor:default;color:#cbd5e1;}
#sidebarMenu .menu-group.disabled > .category-item:hover{
    background:rgba(99,102,241,.10);border-color:rgba(99,102,241,.22);color:#cbd5e1;
    transform:none;box-shadow:none;
}
#sidebarMenu .menu-group.disabled > .category-item:hover > .cat-icon{color:#a5b4fc;}

/* 대분류 그룹 body (수익성분석 하위 메뉴 컨테이너) */
#sidebarMenu .menu-group{margin:0;}
#sidebarMenu .menu-group-body{padding:2px 0 4px;}
#sidebarMenu .menu-group.collapsed > .menu-group-body{display:none;}
/* [2026-09-23 사용자 요청] 마지막 대분류(경영시뮬레이션) 카드의 하단 여백 제거 */
#sidebarMenu > .menu-group:last-child > .category-item{margin-bottom:0;}
#sidebarMenu > .menu-group:last-child > .menu-group-body{padding-bottom:0;}

/* 하위 메뉴 항목 — 대분류보다 한 단계 작은 크기 + 들여쓰기 (계층 명확)
   [2026-09-23 사용자 요청] 하위 메뉴 글씨 1포인트 증가 (12.5px → 13.5px)
   대분류(14px) 와의 시각적 계층은 여전히 유지되면서 가독성 향상 */
#sidebarMenu .menu-item{
    display:flex;align-items:center;gap:10px;
    margin:2px 22px 2px 34px;padding:7px 12px;
    border-radius:7px;
    font-size:13.5px;font-weight:500;color:#cbd5e1;
    text-decoration:none;cursor:pointer;
    transition:background .12s,color .12s;
}
#sidebarMenu .menu-item > i{width:15px;text-align:center;font-size:12.5px;color:#94a3b8;flex-shrink:0;}
#sidebarMenu .menu-item:hover{background:rgba(99,102,241,.14);color:#fff;}
#sidebarMenu .menu-item:hover > i{color:#c7d2fe;}
#sidebarMenu .menu-item.active{
    background:rgba(99,102,241,.24);color:#fff;font-weight:600;
}
#sidebarMenu .menu-item.active > i{color:#c7d2fe;}
#sidebarMenu .menu-empty{
    margin:2px 22px 2px 34px;padding:7px 12px;
    font-size:12.5px;color:#64748b;font-style:italic;
}

/* ─────────────────────────────────────────────────────────────
 * 하위 호환 (이전 클래스가 남아 있을 때) — 새 .category-item 스타일 우선
 * .home-link 는 이제 .category-item 과 함께 쓰이며, 둘 다 있으면 위 스타일이 이김.
 * ────────────────────────────────────────────────────────────*/
#sidebarMenu .home-link{ /* 신규 렌더는 .category-item 을 사용, 이 규칙은 캐시된 예전 마크업 대비 */ }

/* 사이드바 상단 로고: '통합 플랫폼' 링크 스타일 */
.sidebar .platform-brand-link{
    display:block;text-decoration:none;color:inherit;
    transition:opacity .15s;
}
.sidebar .platform-brand-link:hover{opacity:0.85;}
.sidebar .platform-brand-link:hover h2,
.sidebar .platform-brand-link:hover .platform-brand-title{color:#a5b4fc !important;}
`;
        document.head.appendChild(style);
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

    // 전역 export
    global.PlatformSidebar = {
        render,
        toggle,
        groupMenus,      // 테스트에서 사용
        isActive,        // 테스트에서 사용
        GROUPS,          // 테스트에서 사용
    };
})(typeof window !== 'undefined' ? window : globalThis);
