/* =====================================================================
 * area-tabs.js  —  업무영역(수익성분석 / 제조원가) 탭 UI + 테마 스와핑
 * ---------------------------------------------------------------------
 *  [2026-07-23] 도입
 *   - 자연어 질의 / 비주얼 쿼리 빌더 / 학습 관리 3개 화면 상단에
 *     [수익성분석] [제조원가] 탭을 공통 배치하고,
 *     제조원가 선택 시 본문 강조 색을 업무영역 테마로 스와핑.
 *
 *  [2026-07-23] 리팩터링
 *   - 제조원가 테마 컬러를 오렌지 → "딥 스카이 블루" 로 교체 (전문적 톤).
 *   - 3개 화면 공통으로 사용되는 강조 요소 커버 확대:
 *     * 사용자 말풍선 / 봇 아바타 (로고) / welcome 아이콘
 *     * 예시 칩 / 전송 버튼 / SQL 모드 토글 / 라디오
 *     * VQB 사이드바 [+ 새 쿼리] 버튼 / 상단 탭 (표/차트/SQL 등)
 *     * 학습관리 도메인 탭 / 항목 탭 / btn-primary / 뱃지 등
 *     * 도메인(PS/HL/MGMT) 버튼 활성색, 알림/힌트 배너
 *   - 사이드바 자체(dark 인디고) 는 사용자 요구대로 유지.
 *
 *  본 파일은 오직 프론트 CSS/DOM 만 다룸.
 *  서버 API / DB / 응답 스키마 / 이력 저장 로직 등은 절대 미변경.
 * ===================================================================== */
/* ─────────────────────────────────────────────────────────────────────
 * [2026-07-30] 도메인 표시명 공통 유틸 (프런트 전역)
 *
 *   요구사항: 사용자에게 노출되는 화면에서 MGMT 는 '통합' 으로 표시하되
 *   내부 domain_code (API 파라미터·세션·SQL·권한) 는 그대로 유지.
 *   화면마다 개별 문자열 치환을 하지 않고 이 헬퍼 하나로 통일한다.
 *
 *   서버 /api/domains 응답에도 display_code 필드가 함께 오지만
 *   서버 응답 없이 코드 상수만 있는 경우(예: domainIcons, hardcoded string)를
 *   위해 프런트에도 미러 매핑을 둔다.
 *
 *   사용:
 *     window.__domainDisplayCode('MGMT')     // → '통합'
 *     window.__domainDisplayCode('PS')       // → 'PS'  (변경 없음)
 *     window.__domainDisplayCode(d.display_code || d.domain_code)
 *
 *   서버 응답 우선 원칙:
 *     - domainsList 배열의 각 원소에는 display_code 가 이미 채워져 있음.
 *       가능한 경우 그것을 그대로 쓰고, 문자열 상수 라벨링 시에만 이 유틸을 호출.
 * ───────────────────────────────────────────────────────────────────── */
(function () {
    if (window.__domainDisplayCode) return;
    var MAP = { MGMT: '통합' };  // 필요 시 여기에만 추가
    window.__DOMAIN_DISPLAY_CODE_MAP = MAP;
    window.__domainDisplayCode = function (code) {
        if (code == null) return code;
        return MAP[code] || code;
    };
    // 사용자 입력 인식용 역매핑 ('통합' → 'MGMT'). 대소문자 무관.
    var REV = {};
    Object.keys(MAP).forEach(function (k) { REV[MAP[k].toUpperCase()] = k; });
    window.__resolveDomainAlias = function (input) {
        if (input == null) return input;
        var key = String(input).trim().toUpperCase();
        return REV[key] || input;
    };
})();

(function() {
    'use strict';

    // ------------------------------------------------------------------
    // 0. 상수 & 팔레트
    // ------------------------------------------------------------------
    //
    // ⓐ 수익성분석: 기존 시스템 톤 (인디고/퍼플). CSS 는 원본 그대로 사용,
    //    본 파일에서는 상단 탭바 색상만 정의.
    // ⓑ 제조원가: 전문적 파랑 (Tailwind sky 계열).
    //    - 인디고와 명확히 톤이 분리되어 업무영역 구분감이 살아남.
    //    - #2563eb (기존 VQB primary) 와도 계열이 달라 충돌 없음.
    //
    const AREAS = {
        profitability: {
            key: 'profitability',
            label: '수익성분석',
            icon: 'fa-chart-line',
            activeBg: 'linear-gradient(135deg,#6366f1,#8b5cf6)',
            activeColor: '#fff',
        },
        'manufacturing-cost': {
            key: 'manufacturing-cost',
            label: '제조원가',
            icon: 'fa-industry',
            activeBg: 'linear-gradient(135deg,#0284c7,#0369a1)',
            activeColor: '#fff',
        },
    };
    const DEFAULT_AREA = 'profitability';
    const STORAGE_KEY = 'selectedArea';
    const AREA_QUERY = 'area';

    // ─────────────────────────────────────────────────────────────────
    // [2026-08-24] 세부업무영역(sub-area) 지원
    //
    // 요구사항:
    //   - [제조원가] 영역 하위에 3개 세부업무영역 노출:
    //       · 제품별원가  (cost-product)  → sys_aimd_cot015
    //       · 부서별원가  (cost-dept)     → sys_aimd_cot043
    //       · 호기별원가  (cost-machine)  → sys_aimd_cot043
    //   - 상위 영역: 수익성분석 / 제조원가
    //     수익성분석은 서브영역이 없으므로 subArea = null
    //     (내부 매핑상 기본 테이블 bw_profitability_data 로 그대로 라우팅)
    //
    // 첨부 원칙:
    //   - 화면과 payload 만 다룸. SQL 생성/실행 로직은 다음 단계.
    //   - 이 파일은 다른 페이지(빌더/학습관리)에도 로드되지만,
    //     하위 탭은 자연어 질의 화면에서만 명시적으로 mountSubAreaBar() 호출.
    //   - 상단 PS/HL/통합 잠금 UX 와 동일한 시각언어(fa-lock 아이콘 · alert 문구) 사용.
    // ─────────────────────────────────────────────────────────────────
    const SUB_AREAS = {
        'manufacturing-cost': [
            { key: 'cost-product', label: '제품별원가', icon: 'fa-box',      table: 'sys_aimd_cot015' },
            { key: 'cost-dept',    label: '부서별원가', icon: 'fa-sitemap',  table: 'sys_aimd_cot043' },
            { key: 'cost-machine', label: '호기별원가', icon: 'fa-cogs',     table: 'sys_aimd_cot043' },
        ],
    };
    // 수익성분석은 서브영역 없이 곧바로 대상 테이블에 매핑
    const AREA_DEFAULT_TABLE = {
        'profitability':      'bw_profitability_data',
        'manufacturing-cost': null,   // 반드시 subArea 로 결정
    };
    const SUB_AREA_STORAGE_KEY = 'selectedSubArea';   // { areaKey: subAreaKey } JSON
    const SUB_AREA_QUERY = 'subarea';                 // URL 파라미터
    const hasSubAreas = (areaKey) => Array.isArray(SUB_AREAS[areaKey]) && SUB_AREAS[areaKey].length > 0;
    const defaultSubAreaOf = (areaKey) => (hasSubAreas(areaKey) ? SUB_AREAS[areaKey][0].key : null);
    const findSubAreaMeta = (areaKey, subKey) => (SUB_AREAS[areaKey] || []).find(s => s.key === subKey) || null;

    // 서버 area_code(대문자 스네이크) ↔ 프론트 탭 key(소문자 케밥) 매핑
    // 서버가 새 area를 추가하면 여기에 매핑만 추가하면 자동 반영됨.
    const AREA_CODE_TO_KEY = {
        'PROFITABILITY':      'profitability',
        'MANUFACTURING_COST': 'manufacturing-cost',
    };

    // 런타임 결정: 로그인 사용자가 접근 가능한 탭 key 집합
    // 초기값은 안전한 profitability 만 (세션 로드 실패해도 최소 접근권 보장)
    let allowedAreaKeys = new Set(['profitability']);

    function isAreaAllowed(key) { return allowedAreaKeys.has(key); }

    async function loadUserAreas() {
        try {
            const r = await fetch('/api/me', { credentials: 'same-origin' });
            if (!r.ok) return;
            const me = await r.json();
            if (!me || !me.loggedIn) return;
            const codes = Array.isArray(me.business_areas) ? me.business_areas : [];
            const keys = codes.map(c => AREA_CODE_TO_KEY[c]).filter(Boolean);
            allowedAreaKeys = new Set(keys.length > 0 ? keys : ['profitability']);
        } catch (e) {
            console.warn('[AreaTabs] business_areas 로딩 실패, 기본값 사용:', e && e.message);
        }
    }

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

    // ── 세부업무영역(sub-area) 상태 ─────────────────────────────────
    // subAreaMap : area 별로 마지막 선택 서브영역을 기억 (localStorage 지속)
    function loadSubAreaMap() {
        try {
            const raw = localStorage.getItem(SUB_AREA_STORAGE_KEY);
            const obj = raw ? JSON.parse(raw) : {};
            return (obj && typeof obj === 'object') ? obj : {};
        } catch (e) { return {}; }
    }
    function saveSubAreaMap(m) {
        try { localStorage.setItem(SUB_AREA_STORAGE_KEY, JSON.stringify(m || {})); } catch (e) {}
    }
    const subAreaMap = loadSubAreaMap();

    function readSubAreaFromUrl() {
        try {
            const v = new URLSearchParams(window.location.search).get(SUB_AREA_QUERY);
            return v || null;
        } catch (e) { return null; }
    }

    // 특정 area 에 대한 현재 subArea 결정: URL > storage > default
    function resolveSubAreaFor(areaKey) {
        if (!hasSubAreas(areaKey)) return null;
        const urlSub = readSubAreaFromUrl();
        if (urlSub && findSubAreaMeta(areaKey, urlSub)) return urlSub;
        const stored = subAreaMap[areaKey];
        if (stored && findSubAreaMeta(areaKey, stored)) return stored;
        return defaultSubAreaOf(areaKey);
    }
    let currentSubArea = resolveSubAreaFor(currentArea);

    // ── 세션 잠금 (첫 질의 후 area/subArea 변경 금지) ────────────────
    //   상단 PS/HL/통합 도메인 잠금(sessionDomainLocked) 과 완전히 동일한 패턴.
    //   외부(스크립트)에서 AreaTabs.lock() / AreaTabs.unlock() 으로 제어.
    let sessionAreaLocked = false;

    function normalizeUrl() {
        try {
            const p = new URLSearchParams(window.location.search);
            let changed = false;
            if (p.get(AREA_QUERY) !== currentArea) {
                p.set(AREA_QUERY, currentArea);
                changed = true;
            }
            if (currentSubArea) {
                if (p.get(SUB_AREA_QUERY) !== currentSubArea) {
                    p.set(SUB_AREA_QUERY, currentSubArea);
                    changed = true;
                }
            } else if (p.has(SUB_AREA_QUERY)) {
                p.delete(SUB_AREA_QUERY);
                changed = true;
            }
            if (changed) {
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
        /* -------------------- 상단 area 탭바 -------------------- */
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
            background: linear-gradient(135deg,#0284c7,#0369a1);
        }

        /* -------------------- 상위 영역 잠금(첫 질의 후) -------------------- */
        /*   상단 PS/HL/통합(domain-btn.locked) 과 동일한 UX 로 통일.
             비활성 탭은 흐리게, 활성 탭은 진하게 + 잠금 아이콘. */
        .area-tab-btn.locked { opacity: 0.5; cursor: not-allowed; }
        .area-tab-btn.locked.active { opacity: 1; }
        .area-lock-icon {
            margin-left: 4px;
            font-size: 10px;
            opacity: 0.8;
        }

        /* -------------------- 세부업무영역 하위 탭바 -------------------- */
        /*   상위 영역 탭 바로 아래에 붙어 노출.
             수익성분석 영역에서는 렌더되지 않음 (SUB_AREAS 미정의).
             제조원가 테마와 통일된 스카이 톤 사용. */
        .sub-area-tab-bar {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 20px 10px 20px;
            background: #f0f9ff;
            border-bottom: 1px solid #bae6fd;
            flex-wrap: wrap;
            flex-shrink: 0;
            position: sticky;
            top: 52px;   /* area-tab-bar 아래에 스티키 */
            z-index: 39;
        }
        .sub-area-tab-bar__label {
            font-size: 11px;
            font-weight: 700;
            color: #0369a1;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            margin-right: 4px;
        }
        .sub-area-tab-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 12px;
            background: #fff;
            border: 1px solid #bae6fd;
            border-radius: 7px;
            font-size: 12.5px;
            font-weight: 600;
            color: #0369a1;
            cursor: pointer;
            font-family: inherit;
            transition: all .15s ease;
            white-space: nowrap;
        }
        .sub-area-tab-btn:hover {
            background: #e0f2fe;
            border-color: #7dd3fc;
            color: #075985;
        }
        .sub-area-tab-btn i { font-size: 11px; }
        .sub-area-tab-btn.active {
            background: linear-gradient(135deg,#0284c7,#0369a1);
            color: #fff;
            border-color: transparent;
            box-shadow: 0 2px 6px rgba(2,132,199,0.28);
        }
        .sub-area-tab-btn.locked { opacity: 0.55; cursor: not-allowed; }
        .sub-area-tab-btn.locked.active { opacity: 1; }
        .sub-area-tab-bar__hint {
            margin-left: auto;
            font-size: 11.5px;
            color: #0c4a6e;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        .sub-area-tab-bar__hint i { color: #0284c7; }
        @media (max-width: 640px) {
            .sub-area-tab-bar { padding: 6px 12px 8px 12px; gap: 6px; }
            .sub-area-tab-bar__label { display: none; }
            .sub-area-tab-btn { padding: 5px 9px; font-size: 11.5px; }
            .sub-area-tab-bar__hint { display: none; }
        }

        /* [2026-08-25] 제조원가 프리뷰 안내 배너 제거 (.area-mc-notice 스타일 삭제).
         *   제조원가 기능이 실제 데이터/질의/학습과 연동 완료되어 안내 배너가 더 이상 필요 없음.
         *   showManufacturingNotice() / ensureNoticeRemoved() 도 함께 제거됨. */

        @media (max-width: 640px) {
            .area-tab-bar { padding: 8px 12px; gap: 6px; }
            .area-tab-bar__label { display: none; }
            .area-tab-btn { padding: 6px 10px; font-size: 12px; }
        }

        /* ================================================================
         * 제조원가 테마 오버라이드
         *   활성 조건: <body data-area="manufacturing-cost">
         *   원칙:
         *     - 기존 CSS 미수정, !important 스코프 오버라이드만.
         *     - 수익성분석 탭 복귀 시 selector 미매치 → 즉시 원복.
         *     - 사이드바(dark 인디고 배경) 자체는 미수정 (사용자 요구).
         *     - 상단 area-tab-bar 는 자체 스타일 유지.
         *
         *   팔레트:
         *     주 그라디언트 : #0284c7 → #0369a1 (sky-600 → sky-700)
         *     짙은 텍스트   : #075985 (sky-800), #0c4a6e (sky-900)
         *     연한 배경     : #f0f9ff (sky-50), #e0f2fe (sky-100)
         *     테두리        : #bae6fd (sky-200), #7dd3fc (sky-300)
         *     라디오 채움   : #0284c7
         * ================================================================ */

        /* ---------- [공통] 사용자 말풍선 (자연어 질의) ---------- */
        body[data-area="manufacturing-cost"] .msg-user {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.20) !important;
        }
        /* ---------- [공통] 봇 아바타 (로고) — inline style 을 덮어써야 하므로 !important ---------- */
        /* 기본(인디고/퍼플) 아바타만 대상. 이미 다른 컬러(회색/오류/타임아웃/노랑)로 설정된 아바타는
           inline style 로 배경이 명시되어 있어 attribute selector 로 회피할 수 없음.
           대신 .msg-bot > .bot-avatar (헤더 로고 위치) 를 전형적 케이스로 잡음. */
        body[data-area="manufacturing-cost"] .bot-avatar {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
        }
        /* 상태성(오류/타임아웃/성공/노랑) 아바타는 원래 색상 복구 */
        body[data-area="manufacturing-cost"] .bot-avatar[style*="ef4444"],
        body[data-area="manufacturing-cost"] .bot-avatar[style*="dc2626"] {
            background: linear-gradient(135deg,#ef4444,#dc2626) !important;
        }
        body[data-area="manufacturing-cost"] .bot-avatar[style*="94a3b8"],
        body[data-area="manufacturing-cost"] .bot-avatar[style*="64748b"] {
            background: linear-gradient(135deg,#94a3b8,#64748b) !important;
        }
        body[data-area="manufacturing-cost"] .bot-avatar[style*="fbbf24"],
        body[data-area="manufacturing-cost"] .bot-avatar[style*="f59e0b"] {
            background: linear-gradient(135deg,#fbbf24,#d97706) !important;
        }

        /* ---------- [자연어 질의] 웰컴 아이콘 ---------- */
        body[data-area="manufacturing-cost"] .welcome-icon {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            box-shadow: 0 4px 16px rgba(2,132,199,0.28) !important;
        }

        /* ---------- [자연어 질의] 예시 칩 ---------- */
        body[data-area="manufacturing-cost"] .chip-sm,
        body[data-area="manufacturing-cost"] .chip {
            border-color: #bae6fd !important;
            color: #075985 !important;
            background: #f0f9ff !important;
        }
        body[data-area="manufacturing-cost"] .chip-sm:hover,
        body[data-area="manufacturing-cost"] .chip:hover {
            background: #0284c7 !important;
            color: #fff !important;
            border-color: #0284c7 !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.25) !important;
        }

        /* ---------- [공통] 전송 버튼 (자연어 질의) — 중지 상태는 회색 유지 ---------- */
        body[data-area="manufacturing-cost"] .send-btn:not(.stop-mode) {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
        }
        body[data-area="manufacturing-cost"] .send-btn:not(.stop-mode):hover {
            box-shadow: 0 4px 12px rgba(2,132,199,0.35) !important;
        }

        /* ---------- [자연어 질의] SQL 모드 토글 ---------- */
        body[data-area="manufacturing-cost"] .mode-toggle:hover {
            color: #075985 !important;
            border-color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .mode-toggle.active {
            color: #075985 !important;
            background: #f0f9ff !important;
            border-color: #7dd3fc !important;
        }

        /* ---------- [자연어 질의] 질문 유형 라디오 ---------- */
        body[data-area="manufacturing-cost"] .query-mode-radio:hover {
            border-color: #7dd3fc !important;
            color: #075985 !important;
        }
        body[data-area="manufacturing-cost"] .query-mode-radio input[type="radio"]:checked {
            border-color: #0284c7 !important;
            background: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .query-mode-radio.checked {
            background: #f0f9ff !important;
            border-color: #7dd3fc !important;
            color: #075985 !important;
        }

        /* ---------- [공통] 입력 필드 포커스 링 ---------- */
        body[data-area="manufacturing-cost"] .input-field:focus,
        body[data-area="manufacturing-cost"] .sql-textarea:focus {
            border-color: #7dd3fc !important;
            box-shadow: 0 0 0 3px rgba(2,132,199,0.18) !important;
        }

        /* ---------- [공통] 상단 도메인(PS/HL/MGMT) 활성 버튼 ---------- */
        body[data-area="manufacturing-cost"] .domain-btn.active {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.3) !important;
        }
        /* 상단 도메인 안내 배너 톤도 시원한 파랑으로 */
        body[data-area="manufacturing-cost"] .domain-info-banner {
            background: linear-gradient(135deg,#f0f9ff,#e0f2fe) !important;
            border-color: #bae6fd !important;
            color: #075985 !important;
        }
        /* 배너 내 info-circle 아이콘 (index.html / builder.html 인라인 style="color:#6366f1")
           — ID + fa-info-circle 조합으로 인라인 스타일 오버라이드.
           원형 배지처럼 보이지만 실제로는 fa-info-circle 아이콘 자체의 color 속성이라
           원 안의 흰 i 는 자동으로 반전되어 잘 보임. */
        body[data-area="manufacturing-cost"] .domain-info-banner .fa-info-circle,
        body[data-area="manufacturing-cost"] #domainInfoBanner .fa-info-circle,
        body[data-area="manufacturing-cost"] #domainInfoBanner i[class*="info-circle"] {
            color: #0284c7 !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 상단 바 좌측 로고 아이콘 (fa-th-large) ---------- */
        /* builder.html L1136: <i class="fas fa-th-large" style="color:var(--indigo);...">
           인라인 style="color:var(--indigo)" (#4f46e5) 를 스카이 톤으로 오버라이드.
           .top-bar 스코프 + fa-th-large 조합으로 specificity 확보. */
        body[data-area="manufacturing-cost"] .top-bar .fa-th-large,
        body[data-area="manufacturing-cost"] .top-bar i[class*="fa-th-large"] {
            color: #0284c7 !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 상단 도메인 셀렉터 (PS / HL / MGMT) ---------- */
        /* builder.html L80-88 원본은 전반적으로 인디고 팔레트 사용:
           - .domain-selector-bar border #c7d2fe / shadow rgba(99,102,241,...)
           - .domain-btn:hover color #4f46e5
           - .domain-btn.active background gradient(#4f46e5,#6366f1) / shadow rgba(79,70,229,...)
           - .glow 애니메이션 keyframe 도 인디고 톤
           → 제조원가 모드에서 모두 스카이 톤으로 오버라이드. */
        /* 컨테이너 pill: 테두리 + 그림자 스카이화 */
        body[data-area="manufacturing-cost"] .domain-selector-bar {
            border-color: #7dd3fc !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.10) !important;
        }
        /* 비활성 버튼 hover: 배경/글자 스카이 파스텔 톤 */
        body[data-area="manufacturing-cost"] .domain-btn:hover {
            background: #f0f9ff !important;
            color: #165274 !important;
        }
        /* 활성 버튼: 딥 스카이 그라디언트 + 스카이 그림자 (제조원가 테마 컬러) */
        body[data-area="manufacturing-cost"] .domain-btn.active {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.30) !important;
            color: #fff !important;
        }
        /* .glow 상태 (사이드바 도메인 변경 시 3회 반복 애니메이션):
           border-color 는 정적 스카이 톤으로 고정, box-shadow 는 애니메이션이라
           개별 keyframe 재정의 없이 border만 강제해도 인디고 flash 대부분 억제됨 */
        body[data-area="manufacturing-cost"] .domain-selector-bar.glow {
            border-color: #38bdf8 !important;
            animation: none !important;
            box-shadow: 0 0 16px rgba(2,132,199,0.35), 0 0 32px rgba(2,132,199,0.15) !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 사이드 [+ 새 쿼리] 버튼 ---------- */
        /* [2026-07-24] 사용자 요청으로 이 버튼은 영역 전환과 무관하게 항상
           builder.html L101 원본 스타일(인디고 그라디언트 + 흰 텍스트)을 유지.
           → 제조원가 모드 전용 오버라이드를 두지 않음. (수익성분석과 동일한 모양) */

        /* ---------- [비주얼 쿼리 빌더] 좌측 [필드 목록] 패널 ---------- */
        /* 패널 헤더 (짙은 인디고 그라디언트 → 딥 스카이 블루) */
        body[data-area="manufacturing-cost"] .field-panel-header {
            background: linear-gradient(135deg,#0284c7,#0c4a6e) !important;
        }
        /* 필드 검색 입력 focus */
        body[data-area="manufacturing-cost"] .field-search input:focus {
            border-color: #0284c7 !important;
        }
        /* 필드 앞 아이콘 뱃지 (T 마크): text/number/metric */
        body[data-area="manufacturing-cost"] .field-item .icon.text {
            background: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .field-item .icon.number {
            background: #0369a1 !important;
        }
        body[data-area="manufacturing-cost"] .field-item .icon.metric {
            background: linear-gradient(135deg,#0284c7,#075985) !important;
        }
        /* 필드 항목 hover (기본 eff6ff는 유지해도 조화, 스카이 톤으로 통일) */
        body[data-area="manufacturing-cost"] .field-item:hover {
            background: #f0f9ff !important;
        }
        /* Metric 필드 (연보라 배경/보더 → 스카이 톤) */
        body[data-area="manufacturing-cost"] .field-item.metric-field {
            background: #f0f9ff !important;
            border-left-color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .field-item.metric-field:hover {
            background: #e0f2fe !important;
            border-left-color: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .field-item.metric-field .metric-line1 .fcode {
            color: #38bdf8 !important;
        }
        body[data-area="manufacturing-cost"] .metric-formula-badge {
            background: #e0f2fe !important;
            color: #0369a1 !important;
        }
        body[data-area="manufacturing-cost"] .selected-metric {
            border-left-color: #0284c7 !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 날짜 조건 카드 ---------- */
        body[data-area="manufacturing-cost"] .date-section {
            background: linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%) !important;
            border-color: #bae6fd !important;
        }
        body[data-area="manufacturing-cost"] .date-section-header {
            color: #075985 !important;
        }
        body[data-area="manufacturing-cost"] .date-section-header .badge {
            background: #bae6fd !important;
            color: #0c4a6e !important;
        }
        body[data-area="manufacturing-cost"] .date-input-group select {
            border-color: #bae6fd !important;
        }
        body[data-area="manufacturing-cost"] .date-input-group select:focus {
            border-color: #0284c7 !important;
            box-shadow: 0 0 0 3px rgba(2,132,199,0.12) !important;
        }
        body[data-area="manufacturing-cost"] .date-tilde {
            color: #7dd3fc !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 섹션 헤더 아이콘/뱃지 ---------- */
        /* 조회 필드: <span style="color:var(--indigo);">□</span> — 인라인 style 오버라이드 */
        body[data-area="manufacturing-cost"] .section-header span[style*="--indigo"],
        body[data-area="manufacturing-cost"] .section-header span[style*="indigo"] {
            color: #0284c7 !important;
        }
        /* 추가 프롬프트: <span style="color:var(--purple);">✎</span> — 인라인 style 오버라이드 */
        body[data-area="manufacturing-cost"] .section-header span[style*="--purple"],
        body[data-area="manufacturing-cost"] .section-header span[style*="purple"] {
            color: #0369a1 !important;
        }
        /* 조회 필드 카운트 뱃지 (인라인 style로 eef2ff/indigo) */
        body[data-area="manufacturing-cost"] .section-header .badge[style*="eef2ff"],
        body[data-area="manufacturing-cost"] #fieldCountBadge {
            background: #e0f2fe !important;
            color: #0369a1 !important;
        }

        /* ---------- [비주얼 쿼리 빌더] Drop zone / Selected field ---------- */
        body[data-area="manufacturing-cost"] .drop-zone.dragover {
            border-color: #0284c7 !important;
            background: rgba(2,132,199,0.06) !important;
        }
        body[data-area="manufacturing-cost"] .selected-field {
            background: #e0f2fe !important;
            border-color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .selected-field:hover {
            background: #bae6fd !important;
        }
        body[data-area="manufacturing-cost"] .selected-field.sf-insert-left {
            border-left-color: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .selected-field.sf-insert-right {
            border-right-color: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .selected-field .drag-handle {
            color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .selected-field:hover .drag-handle {
            color: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .selected-field .agg-select {
            border-color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .sf-ghost {
            background: #e0f2fe !important;
            border-color: #0284c7 !important;
            box-shadow: 0 8px 24px rgba(2,132,199,0.25) !important;
        }

        /* ---------- [비주얼 쿼리 빌더] + 조건 추가 버튼 ---------- */
        body[data-area="manufacturing-cost"] .add-condition-btn {
            background: #f0f9ff !important;
            color: #0369a1 !important;
            border-color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .add-condition-btn:hover {
            background: #e0f2fe !important;
            border-color: #0284c7 !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 필터 조건 combo popup ---------- */
        body[data-area="manufacturing-cost"] .combo-popup .combo-group-label {
            color: #0369a1 !important;
            background: #f0f9ff !important;
        }
        body[data-area="manufacturing-cost"] .combo-popup .combo-item:hover,
        body[data-area="manufacturing-cost"] .combo-popup .combo-item.active {
            background: #e0f2fe !important;
        }
        body[data-area="manufacturing-cost"] .condition-row .field-combo-trigger:hover,
        body[data-area="manufacturing-cost"] .condition-row .field-combo-trigger.open {
            border-color: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .condition-row select:focus,
        body[data-area="manufacturing-cost"] .condition-row input:focus {
            border-color: #0284c7 !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 추가 프롬프트 textarea focus ---------- */
        body[data-area="manufacturing-cost"] .prompt-area textarea:focus {
            border-color: #0284c7 !important;
        }

        /* ---------- [비주얼 쿼리 빌더] 피벗 생성 버튼 (핵심 실행 버튼) ---------- */
        body[data-area="manufacturing-cost"] .exec-btn {
            background: linear-gradient(135deg,#0284c7,#0c4a6e) !important;
            box-shadow: 0 4px 12px rgba(2,132,199,0.3) !important;
        }
        body[data-area="manufacturing-cost"] .exec-btn:hover {
            box-shadow: 0 6px 20px rgba(2,132,199,0.4) !important;
        }
        body[data-area="manufacturing-cost"] .exec-btn:disabled {
            background: #94a3b8 !important;
            box-shadow: none !important;
        }

        /* ---------- [학습 관리] 도메인 탭 ---------- */
        body[data-area="manufacturing-cost"] .domain-tab:hover {
            background: #f0f9ff !important;
            color: #075985 !important;
            border-color: #bae6fd !important;
        }
        body[data-area="manufacturing-cost"] .domain-tab.active {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            color: #fff !important;
            border-color: transparent !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.28) !important;
        }
        body[data-area="manufacturing-cost"] .domain-tab.locked.active {
            box-shadow: 0 2px 8px rgba(2,132,199,0.28) !important;
        }
        /* [학습 관리] 항목 탭 (Ontology/Metric/동의어/규칙/피드백 SQL) */
        body[data-area="manufacturing-cost"] .tab-btn.active {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            color: #fff !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.28) !important;
        }
        /* [학습 관리] Primary 액션 버튼 */
        body[data-area="manufacturing-cost"] .btn-primary {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            box-shadow: 0 2px 6px rgba(2,132,199,0.24) !important;
        }
        body[data-area="manufacturing-cost"] .btn-primary:hover {
            filter: brightness(1.05);
        }

        /* ---------- [학습 관리] 최상단 학사모 로고 (Tailwind text-indigo-500) ---------- */
        body[data-area="manufacturing-cost"] .top-bar h1 .fa-graduation-cap,
        body[data-area="manufacturing-cost"] .top-bar .text-indigo-500 {
            color: #0284c7 !important;
        }

        /* ---------- [학습 관리] 영역 선택 라벨 좌측 아이콘 (레이어) ---------- */
        body[data-area="manufacturing-cost"] .domain-banner-label i {
            color: #0284c7 !important;
        }

        /* ---------- [학습 관리] 통계 카드 첫 번째 - 등록 컬럼 (인디고 계열만) ----------
           나머지 카드(초록/보라/노랑/빨강)는 통계 종류별 컬러 코드라 유지.
           첫 카드만 인디고 → 스카이로 교체. */
        body[data-area="manufacturing-cost"] .stat-icon[style*="eef2ff"] {
            background: #e0f2fe !important;
            color: #0369a1 !important;
        }

        /* ---------- [학습 관리] 데이터 테이블 컬럼명 (mono 스타일) ----------
           사용자 지정: RGB(0,112,192) = #0070C0 (오피스 표준 진한 파랑).
           font-weight 600 유지. */
        body[data-area="manufacturing-cost"] .dtable .mono {
            color: #0070C0 !important;
            font-weight: 600 !important;
        }

        /* ---------- [학습 관리] RAG 상태 텍스트 ("● RAG 활성 · N청크") ----------
           learning.html 의 loadRagStatus() 가 JS 로 인라인 style.color 를
           #7c3aed (퍼플) 로 직접 세팅함. CSS !important 로 인라인 스타일 이김.
           앞의 <i class="fa-circle"> 아이콘도 인라인 style="color:#a78bfa" 라
           #0070C0 로 통일. */
        body[data-area="manufacturing-cost"] #ragStatusText,
        body[data-area="manufacturing-cost"] #metricRagStatusText {
            color: #0070C0 !important;
        }
        body[data-area="manufacturing-cost"] #ragStatusText .fa-circle,
        body[data-area="manufacturing-cost"] #metricRagStatusText .fa-circle,
        body[data-area="manufacturing-cost"] #ragStatusText i[class*="fa-circle"],
        body[data-area="manufacturing-cost"] #metricRagStatusText i[class*="fa-circle"] {
            color: #0070C0 !important;
        }

        /* ---------- [학습 관리] 저장 버튼 (RAG Build 트리거) ----------
           learning.html 은 인라인 style 로 짙은 퍼플 그라디언트(#7c3aed→#6d28d9) 지정.
           ID 선택자 + !important 로 오버라이드해서 스카이 그라디언트로 교체.
           Ontology / Metric 두 곳 모두 동일 처리. */
        body[data-area="manufacturing-cost"] #ragBuildBtn,
        body[data-area="manufacturing-cost"] #metricRagBuildBtn {
            background: linear-gradient(135deg,#0284c7,#0369a1) !important;
            box-shadow: 0 2px 8px rgba(2,132,199,0.22) !important;
        }
        body[data-area="manufacturing-cost"] #ragBuildBtn:hover,
        body[data-area="manufacturing-cost"] #metricRagBuildBtn:hover {
            box-shadow: 0 4px 14px rgba(2,132,199,0.38) !important;
        }
        /* save-btn-glow 애니메이션: 원본은 rgba(109,40,217) 퍼플 그림자.
           제조원가 테마에서는 스카이 톤 그림자로 재정의. */
        body[data-area="manufacturing-cost"] .save-btn-glow {
            animation: saveGlowMc 1.5s infinite !important;
        }
        @keyframes saveGlowMc {
            0%, 100% { box-shadow: 0 2px 8px rgba(2,132,199,0.22); }
            50%      { box-shadow: 0 2px 16px rgba(2,132,199,0.5); }
        }

        /* ---------- [학습 관리] 동의어 chip (인디고 톤) ---------- */
        body[data-area="manufacturing-cost"] .syn-chip {
            background: #e0f2fe !important;
            color: #0369a1 !important;
            border-color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .syn-chip .syn-del {
            color: #7dd3fc !important;
        }

        /* ---------- [학습 관리] 정렬 가능 컬럼 헤더 활성 상태 ---------- */
        body[data-area="manufacturing-cost"] .dtable th.sort-th:hover {
            background: linear-gradient(135deg,#f0f9ff,#e0f2fe) !important;
            color: #075985 !important;
        }
        body[data-area="manufacturing-cost"] .dtable th.sort-th.sort-asc,
        body[data-area="manufacturing-cost"] .dtable th.sort-th.sort-desc {
            background: linear-gradient(135deg,#0369a1,#0284c7) !important;
            border-bottom-color: #075985 !important;
            box-shadow: inset 0 -3px 0 #0c4a6e !important;
        }
        body[data-area="manufacturing-cost"] .dtable th.sort-th.sort-asc .sort-ico .arr-up,
        body[data-area="manufacturing-cost"] .dtable th.sort-th.sort-desc .sort-ico .arr-down {
            color: #0284c7 !important;
        }
        body[data-area="manufacturing-cost"] .sort-active-badge {
            background: linear-gradient(135deg,#0369a1,#0284c7) !important;
            box-shadow: 0 2px 6px rgba(2,132,199,0.35) !important;
        }

        /* ---------- [학습 관리] btn-outline hover / 인라인 동의어 입력 ---------- */
        body[data-area="manufacturing-cost"] .btn-outline:hover {
            border-color: #7dd3fc !important;
            color: #0369a1 !important;
        }
        body[data-area="manufacturing-cost"] .add-syn-input {
            border-color: #7dd3fc !important;
        }
        body[data-area="manufacturing-cost"] .add-syn-input:focus {
            border-color: #0284c7 !important;
        }

        /* ---------- [학습 관리] 모달 input focus ---------- */
        body[data-area="manufacturing-cost"] .modal input:focus,
        body[data-area="manufacturing-cost"] .modal select:focus {
            border-color: #0284c7 !important;
            box-shadow: 0 0 0 3px rgba(2,132,199,0.12) !important;
        }

        /* ---------- [공통] "학습 SQL 정확 매칭" 등 하이라이트 톤 (필요 시) ----------
           기존 노랑 톤은 상태 표시(warning) 성격이라 건드리지 않음. */
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
        label.textContent = '영역';
        bar.appendChild(label);

        Object.values(AREAS).forEach(a => {
            // ★ 권한 없는 area 는 DOM 자체를 만들지 않음 (완전 비노출)
            if (!isAreaAllowed(a.key)) return;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'area-tab-btn area-' + a.key;
            btn.dataset.area = a.key;
            btn.innerHTML = `<i class="fas ${a.icon}"></i><span>${a.label}</span>`;
            btn.addEventListener('click', () => setArea(a.key));
            bar.appendChild(btn);
        });

        return bar;
    }

    // ─────────────────────────────────────────────────────────────────
    // 3-b. 세부업무영역(sub-area) 탭바 렌더 / 상태 갱신
    //
    //   자연어 질의 화면에서만 명시적으로 mountSubAreaBar() 호출.
    //   호출 지점: index.html DOMContentLoaded 이후.
    //
    //   원칙:
    //     - 상위 영역이 SUB_AREAS 미정의(=수익성분석)면 바 자체를 hidden 처리.
    //     - 세션 잠금 상태(sessionAreaLocked=true) 이면
    //       버튼 클릭 시 alert 안내 후 return (상위 area 잠금과 동일 UX).
    //     - 클릭 성공 시 currentSubArea 갱신 + localStorage/URL 저장 + 이벤트 발행.
    // ─────────────────────────────────────────────────────────────────
    function buildSubAreaBar() {
        const bar = document.createElement('div');
        bar.className = 'sub-area-tab-bar';
        bar.id = 'subAreaTabBar';
        bar.innerHTML = `
            <span class="sub-area-tab-bar__label">세부영역</span>
            <div id="subAreaTabBarButtons" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;"></div>
            <span class="sub-area-tab-bar__hint" id="subAreaTabBarHint">
                <i class="fas fa-info-circle"></i>
                <span>이 채팅의 참조 테이블이 결정됩니다</span>
            </span>`;
        return bar;
    }
    function refreshSubAreaBar() {
        const bar = document.getElementById('subAreaTabBar');
        if (!bar) return;
        const btnHost = document.getElementById('subAreaTabBarButtons');
        const hintEl  = document.getElementById('subAreaTabBarHint');
        const subs = SUB_AREAS[currentArea];

        // [2026-08-25] 제조원가 세부탭 UI 통합 (사용자 확정)
        //   - UI 에서 3개 세부탭(제품별/부서별/호기별)을 제거하고
        //     하나의 자연어 질의창에서 서버가 자동 라우팅.
        //   - SUB_AREAS 정의는 유지 (name/table 매핑은 다른 로직도 참조).
        //   - 여기서는 항상 바 자체를 hidden 처리.
        bar.style.display = 'none';
        return;

        /* eslint-disable no-unreachable */
        // 상위 영역이 서브 미보유 → 바 자체 숨김
        if (!subs || subs.length === 0) {
            bar.style.display = 'none';
            return;
        }
        bar.style.display = 'flex';

        // 현재 subArea 가 유효하지 않으면 기본값으로 보정
        if (!findSubAreaMeta(currentArea, currentSubArea)) {
            currentSubArea = defaultSubAreaOf(currentArea);
        }

        // 버튼 렌더
        if (btnHost) {
            btnHost.innerHTML = '';
            subs.forEach(s => {
                const isActive = s.key === currentSubArea;
                const btn = document.createElement('button');
                btn.type = 'button';
                let cls = 'sub-area-tab-btn';
                if (isActive) cls += ' active';
                if (sessionAreaLocked) cls += ' locked';
                btn.className = cls;
                btn.dataset.subarea = s.key;
                const lockIco = (sessionAreaLocked && isActive) ? '<i class="fas fa-lock area-lock-icon"></i>' : '';
                btn.innerHTML = `<i class="fas ${s.icon}"></i><span>${s.label}</span>${lockIco}`;
                btn.title = `${s.label} · 참조 테이블: ${s.table}`;
                btn.addEventListener('click', () => setSubArea(s.key));
                btnHost.appendChild(btn);
            });
        }

        // 힌트: 잠긴 상태에서는 사용자에게 안내
        if (hintEl) {
            if (sessionAreaLocked) {
                hintEl.innerHTML = '<i class="fas fa-lock"></i><span>새 채팅 시작 후 변경 가능</span>';
            } else {
                const cur = findSubAreaMeta(currentArea, currentSubArea);
                hintEl.innerHTML = '<i class="fas fa-database"></i>' +
                    `<span>참조 테이블: <code style="background:#e0f2fe;padding:1px 6px;border-radius:4px;color:#0c4a6e;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${cur ? cur.table : '-'}</code></span>`;
            }
        }
    }

    function mountSubAreaBar() {
        if (document.getElementById('subAreaTabBar')) return;
        const bar = buildSubAreaBar();
        // 상단 area-tab-bar 바로 아래에 삽입 (같은 sticky 흐름 유지)
        const areaBar = document.getElementById('areaTabBar');
        if (areaBar && areaBar.parentNode) {
            areaBar.parentNode.insertBefore(bar, areaBar.nextSibling);
        } else {
            const topBar = document.querySelector('.top-bar');
            if (topBar && topBar.parentNode) {
                topBar.parentNode.insertBefore(bar, topBar.nextSibling);
            } else {
                document.body.insertBefore(bar, document.body.firstChild);
            }
        }
        refreshSubAreaBar();
    }

    function setSubArea(nextKey, opts) {
        opts = opts || {};
        // 잠금 상태 처리 (상위 도메인 잠금 alert 와 동일 문구 톤)
        if (sessionAreaLocked && !opts.force) {
            const cur  = findSubAreaMeta(currentArea, currentSubArea);
            const next = findSubAreaMeta(currentArea, nextKey);
            const areaLabel = (AREAS[currentArea] || {}).label || currentArea;
            const curLabel  = cur  ? cur.label  : currentSubArea;
            const nextLabel = next ? next.label : nextKey;
            try {
                alert(
                    `현재 채팅은 [${areaLabel} > ${curLabel}] 기준으로 진행 중입니다.\n` +
                    `세부업무영역을 변경하면 조회 대상 테이블이 달라집니다.\n\n` +
                    `[${nextLabel}](으)로 변경하려면 새 채팅을 시작해주세요.`
                );
            } catch (e) {}
            return false;
        }
        const meta = findSubAreaMeta(currentArea, nextKey);
        if (!meta) return false;
        if (nextKey === currentSubArea && !opts.force) return false;
        currentSubArea = nextKey;
        subAreaMap[currentArea] = nextKey;
        saveSubAreaMap(subAreaMap);
        normalizeUrl();
        refreshSubAreaBar();
        try {
            window.dispatchEvent(new CustomEvent('subareachange', {
                detail: { area: currentArea, subArea: currentSubArea, table: meta.table }
            }));
        } catch (e) {}
        return true;
    }

    function mountTabBar() {
        if (document.getElementById('areaTabBar')) return;
        const bar = buildTabBar();
        const placeholder = document.getElementById('areaTabBarSlot');
        if (placeholder) { placeholder.appendChild(bar); return; }
        const topBar = document.querySelector('.top-bar');
        if (topBar && topBar.parentNode) {
            topBar.parentNode.insertBefore(bar, topBar.nextSibling);
            return;
        }
        const wrap = document.querySelector('.main-wrapper');
        if (wrap) { wrap.insertBefore(bar, wrap.firstChild); return; }
        document.body.insertBefore(bar, document.body.firstChild);
    }

    // ------------------------------------------------------------------
    // 4. 탭 상태 반영 (active 표시 + 준비중 오버레이 + body data-area)
    // ------------------------------------------------------------------
    function refreshActiveStyle() {
        document.querySelectorAll('.area-tab-btn').forEach(btn => {
            const isActive = (btn.dataset.area === currentArea);
            btn.classList.toggle('active', isActive);
            btn.classList.toggle('locked', sessionAreaLocked);
            // 잠금 아이콘: 상단 도메인 버튼과 동일하게 active 탭에만 자물쇠 노출
            const label = (AREAS[btn.dataset.area] || {}).label || btn.dataset.area;
            const icon  = (AREAS[btn.dataset.area] || {}).icon  || 'fa-layer-group';
            const lockIco = (sessionAreaLocked && isActive) ? '<i class="fas fa-lock area-lock-icon"></i>' : '';
            btn.innerHTML = `<i class="fas ${icon}"></i><span>${label}</span>${lockIco}`;
        });
    }

    // [2026-08-25] 제조원가 프리뷰 안내 배너 제거.
    //   showManufacturingNotice() / ensureNoticeRemoved() 및 관련 CSS 삭제됨.
    //   제조원가 기능(데이터/질의/학습) 연동 완료로 안내 배너가 더 이상 필요 없음.
    //   혹시 이전 세션에서 남아있을 수 있는 DOM 은 안전하게 정리하도록 leftover cleanup 만 유지.

    function applyAreaVisuals() {
        refreshActiveStyle();
        // body 에 data-area 세팅 → CSS 스코프 오버라이드 발동/해제
        if (document.body) {
            document.body.setAttribute('data-area', currentArea);
        }
        // 과거 배너 DOM leftover 방어 (캐시된 페이지 대비)
        const leftover = document.getElementById('areaMcNotice');
        if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
    }

    // ------------------------------------------------------------------
    // 5. 사이드바 링크 하이재킹 — 페이지 이동 시 area 유지
    // ------------------------------------------------------------------
    function shouldAppendArea(href) {
        if (!href) return false;
        if (href.startsWith('#')) return false;
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return false;
        if (/^https?:\/\//i.test(href)) return false;
        if (href.startsWith('/api/')) return false;
        return true;
    }
    function appendAreaToHref(href) {
        try {
            const base = window.location.origin;
            const u = new URL(href, base);
            u.searchParams.set(AREA_QUERY, currentArea);
            return u.pathname + (u.search || '') + (u.hash || '');
        } catch (e) { return href; }
    }
    function hijackSidebarLinks() {
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
        const targets = document.querySelectorAll(
            '#sidebarMenu, .sidebar, .sidebar-menu, aside, nav'
        );
        if (!targets.length) return;
        const mo = new MutationObserver(() => {
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
        // ★ 권한 없는 area 진입 시도 → 기본 area 로 강제 다운그레이드
        if (!isAreaAllowed(next)) {
            console.warn('[AreaTabs] 권한 없는 area 접근 차단:', next);
            next = isAreaAllowed(DEFAULT_AREA) ? DEFAULT_AREA
                 : (Array.from(allowedAreaKeys)[0] || DEFAULT_AREA);
        }
        if (next === currentArea && !opts.force) return;

        // ─── 세션 잠금 (첫 질의 후 area/subArea 변경 금지) ───────────
        //   상단 PS/HL/통합 도메인 잠금과 동일한 UX. force 로만 우회.
        if (sessionAreaLocked && !opts.force) {
            const curLabel  = (AREAS[currentArea] || {}).label || currentArea;
            const nextLabel = (AREAS[next] || {}).label || next;
            try {
                alert(
                    `현재 채팅은 [${curLabel}] 영역 기준으로 진행 중입니다.\n` +
                    `업무영역을 변경하면 조회 대상 테이블이 달라집니다.\n\n` +
                    `[${nextLabel}](으)로 변경하려면 새 채팅을 시작해주세요.`
                );
            } catch (e) {}
            return;
        }

        currentArea = next;
        try { localStorage.setItem(STORAGE_KEY, currentArea); } catch (e) {}

        // 상위 area 변경 → 해당 area 에 맞는 subArea 재결정
        currentSubArea = resolveSubAreaFor(currentArea);

        normalizeUrl();
        applyAreaVisuals();
        refreshSubAreaBar();
        setTimeout(hijackSidebarLinks, 0);
        try {
            window.dispatchEvent(new CustomEvent('areachange', {
                detail: { area: currentArea, subArea: currentSubArea }
            }));
        } catch (e) {}
    }

    // ------------------------------------------------------------------
    // 7. 외부 노출 API
    // ------------------------------------------------------------------
    window.AreaTabs = {
        get current() { return currentArea; },
        AREAS: AREAS,
        SUB_AREAS: SUB_AREAS,
        set: setArea,
        remount: mountTabBar,
        refreshLinks: hijackSidebarLinks,
        // 권한 조회 헬퍼 (다른 페이지 스크립트에서 사용)
        hasArea: (key) => isAreaAllowed(key),
        allowedKeys: () => Array.from(allowedAreaKeys),
        // 제조원가 전용 DOM 을 권한 없을 때 완전 제거하는 헬퍼
        //  - display:none 이 아니라 remove() 로 DOM 자체를 제거
        hideIfNoArea: (key, selector) => {
            if (!isAreaAllowed(key)) {
                try {
                    document.querySelectorAll(selector).forEach(el => el.remove());
                } catch (e) {}
            }
        },
        // ── [2026-08-24] 세부업무영역 지원 API ────────────────────────
        //   자연어 질의 화면(index.html)의 잠금/상태 관리와 연동.
        get subArea() { return currentSubArea; },
        setSubArea: setSubArea,
        mountSubAreaBar: mountSubAreaBar,
        refreshSubAreaBar: refreshSubAreaBar,
        // 현재 (area, subArea) 조합의 참조 테이블 (payload 에 포함할 값)
        currentTable: () => {
            const meta = findSubAreaMeta(currentArea, currentSubArea);
            if (meta) return meta.table;
            return AREA_DEFAULT_TABLE[currentArea] || null;
        },
        // 현재 selection 스냅샷 (payload 삽입용 · 새 채팅 히스토리 저장용)
        //
        // [2026-08-25] 제조원가 세부탭 UI 통합:
        //   - 제조원가일 때 subArea/subAreaLabel/table 을 null 로 반환
        //     → 서버가 inferManufacturingCostSubArea() 로 자동 라우팅
        //   - 수익성분석은 기존과 동일 (세부영역 없음)
        snapshot: () => {
            if (currentArea === 'manufacturing-cost') {
                return {
                    area: currentArea,
                    areaLabel: (AREAS[currentArea] || {}).label || currentArea,
                    subArea: null,      // ← 세부탭 제거 → 서버 자동 라우팅
                    subAreaLabel: null,
                    table: null,
                };
            }
            const meta = findSubAreaMeta(currentArea, currentSubArea);
            return {
                area: currentArea,
                areaLabel: (AREAS[currentArea] || {}).label || currentArea,
                subArea: currentSubArea,
                subAreaLabel: meta ? meta.label : null,
                table: meta ? meta.table : (AREA_DEFAULT_TABLE[currentArea] || null),
            };
        },
        // 세션 잠금 제어 (첫 질의 완료 시 lock, 새 채팅 시 unlock)
        //   상단 도메인 잠금(sessionDomainLocked) 과 별도 필드지만 UX 는 동일.
        lock: () => {
            if (sessionAreaLocked) return;
            sessionAreaLocked = true;
            refreshActiveStyle();
            refreshSubAreaBar();
        },
        unlock: () => {
            if (!sessionAreaLocked) return;
            sessionAreaLocked = false;
            refreshActiveStyle();
            refreshSubAreaBar();
        },
        isLocked: () => sessionAreaLocked,
    };

    // ------------------------------------------------------------------
    // 8. 부팅
    // ------------------------------------------------------------------
    async function boot() {
        // ★ 세션 기반 접근 권한 먼저 로드 (탭 렌더 전에 완료 필수)
        await loadUserAreas();
        // URL 로 강제 진입한 area 가 권한 없는 경우 → 감지 후 알림 & 다운그레이드
        const urlArea = readAreaFromUrl();
        const blockedByUrl = urlArea && !isAreaAllowed(urlArea);
        // 초기 currentArea 가 허용되지 않으면 강제 다운그레이드
        if (!isAreaAllowed(currentArea)) {
            currentArea = isAreaAllowed(DEFAULT_AREA) ? DEFAULT_AREA
                        : (Array.from(allowedAreaKeys)[0] || DEFAULT_AREA);
            try { localStorage.setItem(STORAGE_KEY, currentArea); } catch (e) {}
        }
        if (blockedByUrl) {
            // URL 로 직접 접근 시도가 차단되었음을 사용자에게 알림
            try {
                console.warn('[AreaTabs] URL 로 접근 시도된 area 가 권한 없음:', urlArea);
                // 페이지 로드 후 1초 뒤에 조용히 안내 (필수 기능 방해 없음)
                setTimeout(() => {
                    const msg = document.createElement('div');
                    msg.style.cssText = 'position:fixed;top:20px;right:20px;background:#fef3c7;color:#92400e;border:1px solid #fbbf24;padding:12px 18px;border-radius:8px;font-size:13px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.1);max-width:320px;';
                    msg.innerHTML = '<i class="fas fa-exclamation-triangle" style="margin-right:6px;"></i>해당 업무영역에 접근 권한이 없습니다.';
                    document.body.appendChild(msg);
                    setTimeout(() => msg.remove(), 4000);
                }, 800);
            } catch (e) {}
        }
        injectStyle();
        mountTabBar();
        normalizeUrl();
        applyAreaVisuals();
        hijackSidebarLinks();
        watchSidebarMutations();
        // 페이지 내 [data-area-required="manufacturing-cost"] 요소들 자동 제거
        try {
            document.querySelectorAll('[data-area-required]').forEach(el => {
                const req = el.getAttribute('data-area-required');
                if (req && !isAreaAllowed(req)) el.remove();
            });
        } catch (e) {}
        // 다른 스크립트가 AreaTabs 로딩 완료를 기다릴 수 있도록 이벤트 발행
        try {
            window.dispatchEvent(new CustomEvent('areatabs:ready', {
                detail: { current: currentArea, allowed: Array.from(allowedAreaKeys) }
            }));
        } catch (e) {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
