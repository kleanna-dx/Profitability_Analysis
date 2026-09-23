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
/* 통합 사이드바 대분류 그룹 */
#sidebarMenu .menu-group{margin-top:6px;}
#sidebarMenu .menu-group-header{
    display:flex;align-items:center;gap:8px;
    padding:10px 22px;font-size:12px;font-weight:700;
    color:#e5e7eb;cursor:pointer;user-select:none;
    transition:background .12s;
}
#sidebarMenu .menu-group-header:hover{background:rgba(255,255,255,.05);}
#sidebarMenu .menu-group-header i.chevron{font-size:10px;margin-left:auto;color:#94a3b8;transition:transform .18s;}
#sidebarMenu .menu-group.collapsed .menu-group-header i.chevron{transform:rotate(-90deg);}
#sidebarMenu .menu-group-header i.group-icon{color:#a5b4fc;font-size:13px;}
#sidebarMenu .menu-group-body{padding:2px 0 6px;}
#sidebarMenu .menu-group.collapsed .menu-group-body{display:none;}
#sidebarMenu .menu-group.disabled .menu-group-header{color:#64748b;cursor:default;}
#sidebarMenu .menu-group.disabled .menu-group-header:hover{background:transparent;}
#sidebarMenu .menu-item{
    display:flex;align-items:center;gap:10px;
    padding:8px 22px 8px 40px;font-size:13px;color:#cbd5e1;
    text-decoration:none;cursor:pointer;transition:background .12s,color .12s;
}
#sidebarMenu .menu-item i{width:16px;text-align:center;font-size:12px;color:#94a3b8;}
#sidebarMenu .menu-item:hover{background:rgba(99,102,241,.15);color:#fff;}
#sidebarMenu .menu-item:hover i{color:#c7d2fe;}
#sidebarMenu .menu-item.active{background:rgba(99,102,241,.25);color:#fff;font-weight:600;}
#sidebarMenu .menu-item.active i{color:#c7d2fe;}
#sidebarMenu .menu-empty{
    padding:8px 22px 8px 40px;font-size:12px;color:#64748b;font-style:italic;
}

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

    // 대분류 정의 (사용자 요구: 수익성분석 / 경영시뮬레이션)
    const GROUPS = [
        {
            key: 'profitability',
            name: '수익성분석',
            icon: 'fas fa-chart-pie',
            // 이 codes 안에 해당하는 menu 만 이 그룹에 매핑
            codes: ['nlq', 'builder', 'learning', 'permission', 'batch', 'interface', 'report'],
        },
        {
            key: 'simulation',
            name: '경영시뮬레이션',
            icon: 'fas fa-flask',
            codes: [],       // 아직 준비중 (하위 메뉴 없음)
            disabled: true,  // 준비중 표시 + 클릭 비활성
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
     * menus 배열을 대분류 그룹별로 분류.
     * 반환: [{group, items:[menu,...]}, ...]
     */
    function groupMenus(menus) {
        const menusByCode = {};
        for (const m of (menus || [])) {
            if (m && m.menu_code) menusByCode[m.menu_code] = m;
        }
        const result = [];
        for (const g of GROUPS) {
            const items = g.codes
                .map(code => menusByCode[code])
                .filter(Boolean);
            // sort_order 있으면 그것 우선, 없으면 원래 순서 유지
            items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
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

        const html = grouped.map(g => {
            const isCollapsed = !!collapsed[g.group.key];
            const isDisabled = !!g.group.disabled;
            const groupCls = ['menu-group', isCollapsed ? 'collapsed' : '', isDisabled ? 'disabled' : ''].filter(Boolean).join(' ');
            const chevron = isDisabled
                ? '<span style="font-size:10.5px;font-weight:600;color:#94a3b8;margin-left:auto;">준비중</span>'
                : '<i class="fas fa-chevron-down chevron"></i>';
            const itemsHtml = isDisabled
                ? '' // 준비중 그룹은 하위 항목 없음
                : (g.items.length === 0
                    ? '<div class="menu-empty">접근 가능한 메뉴가 없습니다</div>'
                    : g.items.map(m => {
                        const active = isActive(m.menu_url, activeUrl) ? ' active' : '';
                        return `<a href="${escapeHtml(m.menu_url)}" class="menu-item${active}" data-menu-code="${escapeHtml(m.menu_code)}">
                            <i class="${escapeHtml(m.icon_class || 'fas fa-circle')}"></i><span>${escapeHtml(m.menu_name)}</span>
                        </a>`;
                    }).join(''));

            return `<div class="${groupCls}" data-group-key="${g.group.key}">
                <div class="menu-group-header" ${isDisabled ? '' : `onclick="window.PlatformSidebar.toggle('${g.group.key}')"`}>
                    <i class="${escapeHtml(g.group.icon)} group-icon"></i>
                    <span>${escapeHtml(g.group.name)}</span>
                    ${chevron}
                </div>
                <div class="menu-group-body">${itemsHtml}</div>
            </div>`;
        }).join('');

        container.innerHTML = html;
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
