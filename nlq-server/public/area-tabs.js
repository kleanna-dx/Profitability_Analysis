/* =====================================================================
 * area-tabs.js  —  업무영역(수익성분석 / 제조원가) 탭 UI (프론트 프리뷰)
 * ---------------------------------------------------------------------
 *  [2026-07-23] 도입 배경
 *   - 사용자 요청: 자연어 질의 / 비주얼 쿼리 빌더 / 학습 관리 3개 화면 상단에
 *     [수익성분석] [제조원가] 탭을 공통 배치해 화면 구성을 미리 확인.
 *   - 이번 단계는 "프론트 디자인 프리뷰" 만 담당.
 *     서버 API·DB 스키마·학습데이터 분리·대화 분리는 이 파일에서 다루지 않음.
 *
 *  이 파일이 하는 일
 *   1) 3개 페이지의 top-bar 직후에 area 탭 바를 삽입 (placeholder 있으면 그곳에).
 *   2) URL query ?area=profitability | manufacturing-cost 로 상태 유지.
 *      URL 값이 없으면 localStorage('selectedArea') → 'profitability' fallback.
 *   3) 사이드바 내 <a href="..."> 링크 클릭 시 현재 area 를 자동으로 URL 에 부착
 *      (프론트 하이재킹 — 서버 응답 변경 없이 이동 후에도 area 유지).
 *   4) 제조원가 탭 선택 시 본문 위에 "준비 중" 오버레이 표시.
 *      기존 수익성분석 UI 는 뒤에 그대로 살아있음 (파괴 없음).
 *   5) 반응형: 좁은 화면에서 top-bar 아래에 wrap 되어 자연스럽게 개행.
 *
 *  건드리지 않는 것
 *   - 서버 API 호출, 데이터 페칭, 이력, 학습 데이터, 도메인(PS/HL/MGMT) 상태
 *   - 기존 top-bar / 사이드바 / 채팅 UI / 학습 관리 탭 등 어떤 기존 마크업도
 *     제거하거나 재배치하지 않음. 순수 "추가" 만 수행.
 * ===================================================================== */
(function() {
    'use strict';

    // ------------------------------------------------------------------
    // 0. 상수
    // ------------------------------------------------------------------
    const AREAS = {
        profitability: {
            key: 'profitability',
            label: '수익성분석',
            icon: 'fa-chart-line',
            // 활성 시 색상 (기존 시스템의 인디고/보라 톤과 매치)
            activeBg: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            activeColor: '#fff',
            badgeBg: '#6366f1',
        },
        'manufacturing-cost': {
            key: 'manufacturing-cost',
            label: '제조원가',
            icon: 'fa-industry',
            // 활성 시 색상 (주황 포인트)
            activeBg: 'linear-gradient(135deg,#f97316,#ea580c)',
            activeColor: '#fff',
            badgeBg: '#f97316',
        },
    };
    const DEFAULT_AREA = 'profitability';
    const STORAGE_KEY = 'selectedArea';
    const AREA_QUERY = 'area';

    // ------------------------------------------------------------------
    // 1. area 상태 결정 (URL > localStorage > default)
    // ------------------------------------------------------------------
    function readAreaFromUrl() {
        try {
            const p = new URLSearchParams(window.location.search);
            const v = p.get(AREA_QUERY);
            return (v && AREAS[v]) ? v : null;
        } catch (e) { return null; }
    }
    function readAreaFromStorage() {
        try {
            const v = localStorage.getItem(STORAGE_KEY);
            return (v && AREAS[v]) ? v : null;
        } catch (e) { return null; }
    }
    function resolveInitialArea() {
        return readAreaFromUrl() || readAreaFromStorage() || DEFAULT_AREA;
    }
    let currentArea = resolveInitialArea();

    // URL 에 area 가 없거나 정규화 필요 시, replaceState 로 URL 정돈
    function normalizeUrl() {
        try {
            const p = new URLSearchParams(window.location.search);
            if (p.get(AREA_QUERY) !== currentArea) {
                p.set(AREA_QUERY, currentArea);
                const newUrl = window.location.pathname + '?' + p.toString() + window.location.hash;
                window.history.replaceState({}, '', newUrl);
            }
        } catch (e) {}
    }

    // ------------------------------------------------------------------
    // 2. 스타일 주입 (한 번만)
    // ------------------------------------------------------------------
    function injectStyle() {
        if (document.getElementById('area-tabs-style')) return;
        const css = `
        .area-tab-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 20px;
            background: #f8fafc;
            border-bottom: 1px solid #e5e7eb;
            flex-wrap: wrap;
            flex-shrink: 0;
            position: sticky;
            top: 0;
            z-index: 40;
        }
        .area-tab-bar__label {
            font-size: 11px;
            font-weight: 700;
            color: #94a3b8;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            margin-right: 4px;
        }
        .area-tab-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            color: #64748b;
            cursor: pointer;
            font-family: inherit;
            transition: all .15s ease;
            white-space: nowrap;
        }
        .area-tab-btn:hover {
            background: #f1f5f9;
            color: #334155;
            border-color: #cbd5e1;
        }
        .area-tab-btn i { font-size: 12px; }
        .area-tab-btn.active {
            color: #fff;
            border-color: transparent;
            box-shadow: 0 2px 6px rgba(0,0,0,0.08);
        }
        .area-tab-btn.active.area-profitability {
            background: linear-gradient(135deg,#6366f1,#8b5cf6);
        }
        .area-tab-btn.active.area-manufacturing-cost {
            background: linear-gradient(135deg,#f97316,#ea580c);
        }
        .area-tab-bar__hint {
            margin-left: auto;
            font-size: 11px;
            color: #94a3b8;
            font-style: italic;
        }

        /* 제조원가 준비중 오버레이 (본문 위에 살짝 얹음) */
        .area-mc-notice {
            position: fixed;
            left: 50%;
            top: 96px;
            transform: translateX(-50%);
            z-index: 45;
            background: #fff7ed;
            border: 1px solid #fdba74;
            border-radius: 12px;
            padding: 14px 22px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 8px 24px rgba(249,115,22,0.15);
            max-width: 92vw;
        }
        .area-mc-notice__icon {
            width: 34px; height: 34px;
            border-radius: 8px;
            background: linear-gradient(135deg,#f97316,#ea580c);
            color: #fff;
            display: flex; align-items: center; justify-content: center;
            font-size: 15px;
            flex-shrink: 0;
        }
        .area-mc-notice__text { font-size: 13px; color: #7c2d12; line-height: 1.5; }
        .area-mc-notice__text strong { color: #9a3412; }
        .area-mc-notice__close {
            background: transparent; border: 0;
            color: #9a3412; cursor: pointer;
            font-size: 15px; padding: 2px 6px; border-radius: 6px;
            font-family: inherit;
        }
        .area-mc-notice__close:hover { background: #fed7aa; }

        @media (max-width: 640px) {
            .area-tab-bar { padding: 8px 12px; gap: 6px; }
            .area-tab-bar__label { display: none; }
            .area-tab-btn { padding: 6px 10px; font-size: 12px; }
            .area-tab-bar__hint { display: none; }
            .area-mc-notice { top: auto; bottom: 90px; padding: 10px 14px; }
            .area-mc-notice__text { font-size: 12px; }
        }

        /* ============================================================
         * 제조원가 테마 오버라이드 (본문 내부 강조 색상만 주황으로)
         *   활성 조건: <body data-area="manufacturing-cost">
         *   범위:
         *     - 사용자 질문 말풍선 (.msg-user)
         *     - 하단 예시 칩 (.chip-sm)
         *     - 질문 유형 라디오 (.query-mode-radio)
         *     - SQL 모드 토글 (.mode-toggle)
         *     - 입력 필드 포커스 (.input-field:focus)
         *     - 전송 버튼 (.send-btn) — stop-mode 는 제외 (회색 유지)
         *     - 사이드바 자체는 건드리지 않음 (탭바/오버레이/사이드바 껍데기 유지)
         *   원칙:
         *     - 기존 CSS 는 그대로 두고 !important 로만 덮어씀
         *     - 제조원가 탭 해제 시 즉시 원복 (별도 undo 로직 불필요)
         *     - area-tab-bar 자체와 area-mc-notice 는 영향 받지 않도록
         *       :not() 로 스코프 제한
         * ============================================================ */
        body[data-area="manufacturing-cost"] .msg-user {
            background: linear-gradient(135deg,#ea580c,#f97316) !important;
            box-shadow: 0 2px 8px rgba(234,88,12,0.18) !important;
        }
        /* 예시 칩 (기본 상태 + hover) */
        body[data-area="manufacturing-cost"] .chip-sm {
            border-color: #fed7aa !important;
            color: #c2410c !important;
            background: #fff7ed !important;
        }
        body[data-area="manufacturing-cost"] .chip-sm:hover {
            background: #ea580c !important;
            color: #fff !important;
            border-color: #ea580c !important;
        }
        /* 전송 버튼 (평상시 그라디언트) — stop-mode 는 제외 */
        body[data-area="manufacturing-cost"] .send-btn:not(.stop-mode) {
            background: linear-gradient(135deg,#ea580c,#f97316) !important;
        }
        body[data-area="manufacturing-cost"] .send-btn:not(.stop-mode):hover {
            box-shadow: 0 4px 12px rgba(234,88,12,0.32) !important;
        }
        /* SQL 모드 토글 */
        body[data-area="manufacturing-cost"] .mode-toggle:hover {
            color: #c2410c !important;
            border-color: #fdba74 !important;
        }
        body[data-area="manufacturing-cost"] .mode-toggle.active {
            color: #c2410c !important;
            background: #fff7ed !important;
            border-color: #fdba74 !important;
        }
        /* 질문 유형 라디오 (현황집계 / 분석질문) */
        body[data-area="manufacturing-cost"] .query-mode-radio:hover {
            border-color: #fdba74 !important;
            color: #c2410c !important;
        }
        body[data-area="manufacturing-cost"] .query-mode-radio input[type="radio"]:checked {
            border-color: #ea580c !important;
            background: #ea580c !important;
        }
        body[data-area="manufacturing-cost"] .query-mode-radio.checked {
            background: #fff7ed !important;
            border-color: #fdba74 !important;
            color: #c2410c !important;
        }
        /* 입력 필드 포커스 링 */
        body[data-area="manufacturing-cost"] .input-field:focus,
        body[data-area="manufacturing-cost"] .sql-textarea:focus {
            border-color: #fdba74 !important;
            box-shadow: 0 0 0 3px rgba(249,115,22,0.14) !important;
        }
        /* 채팅 영역 상단 첫 봇 아바타/헤더 그라디언트가 인디고인 경우
           inline style 로 박혀 있어 CSS 로 덮기 어려움 → 무리하게 건드리지 않고
           본문 인터랙션 위주(사용자 발화/입력·전송·칩)만 톤 변경. 답변 카드 자체는
           일관성 위해 그대로 유지 (스크린샷에 표시된 1·2 영역이 핵심). */
        `;
        const st = document.createElement('style');
        st.id = 'area-tabs-style';
        st.textContent = css;
        document.head.appendChild(st);
    }

    // ------------------------------------------------------------------
    // 3. 탭 바 렌더링 / 삽입
    // ------------------------------------------------------------------
    function buildTabBar() {
        const bar = document.createElement('div');
        bar.className = 'area-tab-bar';
        bar.id = 'areaTabBar';

        const label = document.createElement('span');
        label.className = 'area-tab-bar__label';
        label.textContent = '업무영역';
        bar.appendChild(label);

        Object.values(AREAS).forEach(a => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'area-tab-btn area-' + a.key;
            btn.dataset.area = a.key;
            btn.innerHTML = `<i class="fas ${a.icon}"></i><span>${a.label}</span>`;
            btn.addEventListener('click', () => setArea(a.key));
            bar.appendChild(btn);
        });

        // 우측 힌트 (프리뷰 안내)
        const hint = document.createElement('span');
        hint.className = 'area-tab-bar__hint';
        hint.innerHTML = '<i class="fas fa-eye" style="margin-right:4px;"></i>디자인 프리뷰';
        bar.appendChild(hint);

        return bar;
    }

    function mountTabBar() {
        // 이미 있으면 재사용
        if (document.getElementById('areaTabBar')) return;

        const bar = buildTabBar();

        // 우선순위 1: 페이지에 명시적으로 마련한 placeholder
        const placeholder = document.getElementById('areaTabBarSlot');
        if (placeholder) {
            placeholder.appendChild(bar);
            return;
        }
        // 우선순위 2: top-bar 바로 다음 형제로 삽입
        const topBar = document.querySelector('.top-bar');
        if (topBar && topBar.parentNode) {
            topBar.parentNode.insertBefore(bar, topBar.nextSibling);
            return;
        }
        // 우선순위 3: main-wrapper 첫 자식
        const wrap = document.querySelector('.main-wrapper');
        if (wrap) { wrap.insertBefore(bar, wrap.firstChild); return; }
        // 최후: body 상단
        document.body.insertBefore(bar, document.body.firstChild);
    }

    // ------------------------------------------------------------------
    // 4. 탭 상태 반영 (active 표시 + 준비중 오버레이)
    // ------------------------------------------------------------------
    function refreshActiveStyle() {
        document.querySelectorAll('.area-tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.area === currentArea);
        });
    }

    function ensureNoticeRemoved() {
        const n = document.getElementById('areaMcNotice');
        if (n && n.parentNode) n.parentNode.removeChild(n);
    }
    function showManufacturingNotice() {
        if (document.getElementById('areaMcNotice')) return;
        const n = document.createElement('div');
        n.className = 'area-mc-notice';
        n.id = 'areaMcNotice';
        n.innerHTML = `
            <div class="area-mc-notice__icon"><i class="fas fa-industry"></i></div>
            <div class="area-mc-notice__text">
                <strong>[제조원가]</strong> 업무영역은 현재 화면 디자인 프리뷰 상태입니다.<br>
                기능(데이터·질의·학습)은 이후 단계에서 순차적으로 연결됩니다.
            </div>
            <button type="button" class="area-mc-notice__close" title="닫기"
                    onclick="this.parentNode.remove();">
                <i class="fas fa-times"></i>
            </button>`;
        document.body.appendChild(n);
    }

    function applyAreaVisuals() {
        refreshActiveStyle();
        // [2026-07-23] body 에 data-area 세팅 → CSS 오버라이드로 본문 강조 색 스와핑.
        //   - manufacturing-cost 일 때만 오버라이드 규칙 발동.
        //   - profitability 로 돌아오면 규칙이 자동 해제되어 원래 인디고/퍼플 톤 복귀.
        if (document.body) {
            document.body.setAttribute('data-area', currentArea);
        }
        if (currentArea === 'manufacturing-cost') {
            showManufacturingNotice();
        } else {
            ensureNoticeRemoved();
        }
    }

    // ------------------------------------------------------------------
    // 5. 사이드바 링크 하이재킹 — 페이지 이동 시에도 area 유지
    //    - <a href="..."> 로 렌더된 모든 링크에 area 쿼리 자동 부착
    //    - /api/**, 절대 URL(http://...), mailto/tel 은 건드리지 않음
    //    - 사이드바가 동적 렌더이므로 MutationObserver 로도 감지
    // ------------------------------------------------------------------
    function shouldAppendArea(href) {
        if (!href) return false;
        if (href.startsWith('#')) return false;
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return false;
        if (/^https?:\/\//i.test(href)) return false;      // 외부 URL
        if (href.startsWith('/api/')) return false;         // API 다운로드 링크 등
        // 상대 링크 또는 사이트 내부 링크
        return true;
    }
    function appendAreaToHref(href) {
        try {
            // 상대 경로 처리를 위해 임시 URL 사용
            const base = window.location.origin;
            const u = new URL(href, base);
            u.searchParams.set(AREA_QUERY, currentArea);
            // 경로 + 쿼리 + 해시만 반환 (사이트 내부 링크)
            return u.pathname + (u.search || '') + (u.hash || '');
        } catch (e) {
            return href;
        }
    }
    function hijackSidebarLinks() {
        // 사이드바 스코프를 최대한 넓게 잡되, area-tab-bar 는 제외
        const scopes = document.querySelectorAll(
            '.sidebar, .sidebar-menu, #sidebarMenu, aside, nav'
        );
        const seen = new WeakSet();
        scopes.forEach(scope => {
            scope.querySelectorAll('a[href]').forEach(a => {
                if (seen.has(a)) return;
                seen.add(a);
                const href = a.getAttribute('href');
                if (!shouldAppendArea(href)) return;
                a.setAttribute('href', appendAreaToHref(href));
            });
        });
    }
    function watchSidebarMutations() {
        // 사이드바 메뉴가 /api/me 응답 이후 innerHTML 로 새로 그려지는 케이스 대응
        const targets = document.querySelectorAll(
            '#sidebarMenu, .sidebar, .sidebar-menu, aside, nav'
        );
        if (!targets.length) return;
        const mo = new MutationObserver(() => {
            // 짧은 debounce
            clearTimeout(watchSidebarMutations._t);
            watchSidebarMutations._t = setTimeout(hijackSidebarLinks, 40);
        });
        targets.forEach(t => mo.observe(t, { childList: true, subtree: true }));
    }

    // ------------------------------------------------------------------
    // 6. area 전환
    // ------------------------------------------------------------------
    function setArea(next, opts) {
        opts = opts || {};
        if (!AREAS[next]) return;
        if (next === currentArea && !opts.force) return;
        currentArea = next;
        try { localStorage.setItem(STORAGE_KEY, currentArea); } catch (e) {}
        normalizeUrl();
        applyAreaVisuals();
        // 다음 tick 에 사이드바 링크 재하이재킹 (area 값 갱신 반영)
        setTimeout(hijackSidebarLinks, 0);
        // 외부 리스너용 이벤트
        try {
            window.dispatchEvent(new CustomEvent('areachange', {
                detail: { area: currentArea }
            }));
        } catch (e) {}
    }

    // ------------------------------------------------------------------
    // 7. 외부 노출 API
    // ------------------------------------------------------------------
    window.AreaTabs = {
        get current() { return currentArea; },
        AREAS: AREAS,
        set: setArea,
        remount: mountTabBar,
        refreshLinks: hijackSidebarLinks,
    };

    // ------------------------------------------------------------------
    // 8. 부팅
    // ------------------------------------------------------------------
    function boot() {
        injectStyle();
        mountTabBar();
        normalizeUrl();
        applyAreaVisuals();
        hijackSidebarLinks();
        watchSidebarMutations();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
