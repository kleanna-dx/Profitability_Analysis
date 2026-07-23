/* ==========================================================================
   Unified Platform - Global Sidebar Loader
   - <div id="globalSidebarNav"></div> 컨테이너를 찾아 공통 네비게이션을 렌더링
   - 홈 / 수익성분석(드롭다운, /api/me.menus 기반) / 경영시뮬레이션(정적, alert 스텁)
   - 기존 페이지의 <nav id="sidebarMenu"> RBAC 렌더링과 공존
     → 중복 노출을 피하기 위해 sidebarMenu는 감춤(display:none)
   - 페이지 전용 위젯(질의 이력, 쿼리 이력, 테이블 스키마 등)은 페이지에 그대로 둠
   ========================================================================== */
(function () {
    'use strict';

    // 경영시뮬레이션 정적 메뉴 (준비 중 - alert만)
    // 참고 자료로만 사용: kleanna-dx/management-simulation_2607
    const MGMT_SIM_MENUS = [
        { label: '개요',            icon: 'fas fa-info-circle' },
        { label: '시뮬레이션 대시보드', icon: 'fas fa-tachometer-alt' },
        { label: '시나리오 관리',    icon: 'fas fa-project-diagram' },
        { label: '가정치 입력',      icon: 'fas fa-sliders-h' },
        { label: '손익 시뮬레이션',  icon: 'fas fa-chart-line' },
        { label: '민감도 분석',      icon: 'fas fa-wave-square' },
        { label: '리포트',          icon: 'fas fa-file-alt' },
        { label: '설정',            icon: 'fas fa-cog' },
        { label: '도움말',          icon: 'fas fa-question-circle' },
    ];

    // 수익성분석 상위 URL 세트 (드롭다운 활성 판단용)
    const PA_URLS = new Set([
        '/', '/index.html',
        '/builder.html',
        '/report', '/report.html',
        '/learning.html',
        '/permission.html',
        '/batch.html',
        '/interface.html',
        '/upload.html'
    ]);

    function normalizePath(p) {
        if (!p) return '/';
        // 쿼리스트링/해시 제거
        const q = p.indexOf('?'); if (q >= 0) p = p.slice(0, q);
        const h = p.indexOf('#'); if (h >= 0) p = p.slice(0, h);
        return p || '/';
    }

    function isSamePath(a, b) {
        const A = normalizePath(a), B = normalizePath(b);
        if (A === B) return true;
        // '/'와 '/index.html' 은 동일 취급
        if ((A === '/' && B === '/index.html') || (A === '/index.html' && B === '/')) return true;
        // '/report' 와 '/report.html' 은 동일 취급
        if ((A === '/report' && B === '/report.html') || (A === '/report.html' && B === '/report')) return true;
        return false;
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function render(menus) {
        const container = document.getElementById('globalSidebarNav');
        if (!container) return;

        const curPath = normalizePath(window.location.pathname);

        // ---- 홈 ----
        const isHomeActive = isSamePath(curPath, '/home.html');
        const homeHtml = `
            <a href="/home.html" class="gs-item${isHomeActive ? ' active' : ''}" data-gs-nav="home">
                <i class="fas fa-home gs-icon"></i>
                <span>홈</span>
            </a>
        `;

        // ---- 수익성분석 (RBAC 메뉴 기반) ----
        const paItems = (menus || []).map(m => {
            const url = m.menu_url || '#';
            const name = m.menu_name || '(이름 없음)';
            const icon = m.icon_class || 'fas fa-circle';
            const active = isSamePath(curPath, url);
            return { url, name, icon, active };
        });
        const paHasActive = paItems.some(x => x.active);
        // 사용자가 수익성분석 하위 페이지에 있으면 자동 확장
        // (홈/미매칭 페이지에서는 기본 접힘)
        const paExpanded = paHasActive;
        const paSubHtml = paItems.map(x => `
            <a href="${esc(x.url)}" class="gs-subitem${x.active ? ' active' : ''}" data-gs-nav="pa-child">
                <i class="${esc(x.icon)} gs-icon"></i>
                <span>${esc(x.name)}</span>
            </a>
        `).join('');
        const paGroupHtml = `
            <div class="gs-group${paExpanded ? ' expanded' : ''}" data-gs-group="profitability">
                <div class="gs-item${paHasActive ? ' has-active-child' : ''}" data-gs-toggle="profitability">
                    <i class="fas fa-chart-pie gs-icon"></i>
                    <span>수익성분석</span>
                    <i class="fas fa-chevron-right gs-chevron"></i>
                </div>
                <div class="gs-submenu">
                    ${paSubHtml || '<div class="gs-subitem disabled"><span>메뉴 권한 없음</span></div>'}
                </div>
            </div>
        `;

        // ---- 경영시뮬레이션 (정적 · 준비 중 alert) ----
        const msSubHtml = MGMT_SIM_MENUS.map(m => `
            <a href="#" class="gs-subitem disabled" data-gs-nav="ms-child" data-gs-label="${esc(m.label)}">
                <i class="${esc(m.icon)} gs-icon"></i>
                <span>${esc(m.label)}</span>
                <span class="gs-badge">준비중</span>
            </a>
        `).join('');
        // 경영시뮬레이션은 항상 접힌 상태로 시작 (활성 페이지 없음)
        const msGroupHtml = `
            <div class="gs-group" data-gs-group="mgmt-sim">
                <div class="gs-item" data-gs-toggle="mgmt-sim">
                    <i class="fas fa-flask gs-icon"></i>
                    <span>경영시뮬레이션</span>
                    <i class="fas fa-chevron-right gs-chevron"></i>
                </div>
                <div class="gs-submenu">
                    ${msSubHtml}
                </div>
            </div>
        `;

        container.innerHTML = homeHtml + paGroupHtml + msGroupHtml;

        // ---- 이벤트 바인딩 ----
        // 드롭다운 토글
        container.querySelectorAll('[data-gs-toggle]').forEach(el => {
            el.addEventListener('click', function (e) {
                const group = this.closest('.gs-group');
                if (group) group.classList.toggle('expanded');
                e.preventDefault();
            });
        });
        // 경영시뮬레이션 자식 클릭 → alert
        container.querySelectorAll('[data-gs-nav="ms-child"]').forEach(el => {
            el.addEventListener('click', function (e) {
                e.preventDefault();
                const label = this.getAttribute('data-gs-label') || '해당 메뉴';
                alert('[' + label + ']\n\n경영시뮬레이션은 준비 중입니다.\n곧 서비스될 예정입니다.');
            });
        });

        // 기존 #sidebarMenu (RBAC 렌더) 중복 노출 방지
        // - 공통 사이드바에 동일 항목이 이미 표시되므로 감춤
        // - display:none 처리로 기존 코드의 innerHTML 세팅은 계속 동작함 (에러 없음)
        const legacyMenu = document.getElementById('sidebarMenu');
        if (legacyMenu) legacyMenu.style.display = 'none';
    }

    function boot() {
        // CSS는 <head>에서 <link>로 로드된다고 가정하지만, 누락 시 자동 삽입 (안전장치)
        if (!document.querySelector('link[href="/static/global-sidebar.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = '/static/global-sidebar.css';
            document.head.appendChild(link);
        }

        // 컨테이너가 없으면 <aside id="sidebar"> 상단에 자동 생성
        // → 개별 HTML 편집 누락 시에도 최소한 렌더 (본 PR에선 9개 페이지에 명시적으로 삽입)
        let container = document.getElementById('globalSidebarNav');
        if (!container) {
            const aside = document.getElementById('sidebar');
            if (aside) {
                container = document.createElement('div');
                container.id = 'globalSidebarNav';
                // 헤더(로고) 뒤, sidebarMenu 이전 위치 (첫 divider 뒤가 이상적)
                const firstDivider = aside.querySelector('.sidebar-divider');
                if (firstDivider && firstDivider.nextSibling) {
                    aside.insertBefore(container, firstDivider.nextSibling);
                } else {
                    aside.appendChild(container);
                }
            } else {
                // sidebar 자체가 없는 페이지(로그인 등)는 스킵
                return;
            }
        }

        fetch('/api/me', { credentials: 'same-origin' })
            .then(r => r.json())
            .then(me => {
                if (!me || !me.loggedIn) {
                    // 비로그인이면 공통 사이드바도 표시하지 않음 (각 페이지가 별도로 /login 리다이렉트)
                    container.innerHTML = '';
                    return;
                }
                render(me.menus || []);
            })
            .catch(err => {
                console.warn('[global-sidebar] /api/me 로드 실패:', err && err.message);
                render([]);   // 폴백: 홈 + 경영시뮬만 표시
            });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
