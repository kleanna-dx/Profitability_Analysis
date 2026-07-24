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
        .area-tab-bar__hint {
            margin-left: auto;
            font-size: 11px;
            color: #94a3b8;
            font-style: italic;
        }

        /* -------------------- 제조원가 안내 오버레이 -------------------- */
        .area-mc-notice {
            position: fixed;
            left: 50%;
            top: 96px;
            transform: translateX(-50%);
            z-index: 45;
            background: #f0f9ff;
            border: 1px solid #7dd3fc;
            border-radius: 12px;
            padding: 14px 22px;
            display: flex;
            align-items: center;
            gap: 12px;
            box-shadow: 0 8px 24px rgba(2,132,199,0.15);
            max-width: 92vw;
        }
        .area-mc-notice__icon {
            width: 34px; height: 34px;
            border-radius: 8px;
            background: linear-gradient(135deg,#0284c7,#0369a1);
            color: #fff;
            display: flex; align-items: center; justify-content: center;
            font-size: 15px;
            flex-shrink: 0;
        }
        .area-mc-notice__text { font-size: 13px; color: #075985; line-height: 1.5; }
        .area-mc-notice__text strong { color: #0c4a6e; }
        .area-mc-notice__close {
            background: transparent; border: 0;
            color: #0c4a6e; cursor: pointer;
            font-size: 15px; padding: 2px 6px; border-radius: 6px;
            font-family: inherit;
        }
        .area-mc-notice__close:hover { background: #bae6fd; }

        @media (max-width: 640px) {
            .area-tab-bar { padding: 8px 12px; gap: 6px; }
            .area-tab-bar__label { display: none; }
            .area-tab-btn { padding: 6px 10px; font-size: 12px; }
            .area-tab-bar__hint { display: none; }
            .area-mc-notice { top: auto; bottom: 90px; padding: 10px 14px; }
            .area-mc-notice__text { font-size: 12px; }
        }

        /* ================================================================
         * 제조원가 테마 오버라이드
         *   활성 조건: <body data-area="manufacturing-cost">
         *   원칙:
         *     - 기존 CSS 미수정, !important 스코프 오버라이드만.
         *     - 수익성분석 탭 복귀 시 selector 미매치 → 즉시 원복.
         *     - 사이드바(dark 인디고 배경) 자체는 미수정 (사용자 요구).
         *     - 상단 area-tab-bar 및 area-mc-notice 는 자체 스타일 유지.
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

        /* ---------- [비주얼 쿼리 빌더] 사이드 [+ 새 쿼리] 버튼 ---------- */
        /* 사용자 지정 팔레트: 밝은 파스텔 스카이 배경 + 짙은 네이비 텍스트
           - 배경: RGB(231,245,255) = #E7F5FF (연한 스카이/거의 흰색 톤)
           - 텍스트: RGB(22,82,116)  = #165274 (짙은 네이비 블루)
           - 원본 CSS의 color:#fff / 그라디언트를 완전히 대체하기 위해 solid + !important 사용
           - hover 는 배경만 한 단계 진하게(#D0EBFF), 텍스트/그림자는 부드럽게 유지 */
        body[data-area="manufacturing-cost"] .new-builder-btn {
            background: #E7F5FF !important;
            color: #165274 !important;
            box-shadow: 0 2px 6px rgba(22,82,116,0.10) !important;
        }
        body[data-area="manufacturing-cost"] .new-builder-btn:hover {
            background: #D0EBFF !important;
            color: #165274 !important;
            box-shadow: 0 4px 10px rgba(22,82,116,0.16) !important;
        }
        body[data-area="manufacturing-cost"] .new-builder-btn i {
            color: #165274 !important;
        }

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

        const hint = document.createElement('span');
        hint.className = 'area-tab-bar__hint';
        hint.innerHTML = '<i class="fas fa-eye" style="margin-right:4px;"></i>디자인 프리뷰';
        bar.appendChild(hint);

        return bar;
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
        // body 에 data-area 세팅 → CSS 스코프 오버라이드 발동/해제
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
        if (next === currentArea && !opts.force) return;
        currentArea = next;
        try { localStorage.setItem(STORAGE_KEY, currentArea); } catch (e) {}
        normalizeUrl();
        applyAreaVisuals();
        setTimeout(hijackSidebarLinks, 0);
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
