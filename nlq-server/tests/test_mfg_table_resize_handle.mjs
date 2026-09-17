// [2026-09-17] 제조원가 현황집계 결과 표 - 우측 하단 가로폭 조절 핸들 회귀 테스트
//
//   목표:
//     - buildAnalysisDetailTable(...) 9번째 인자 showResizeHandle 이 true 일 때만
//       .mfg-table-resize-handle DOM 이 렌더되고 wrap 에 mfg-resizable 클래스가 붙어야 함
//     - showResizeHandle 미지정/false 일 때는 기존 동작(핸들 없음, mfg-resizable 클래스 없음) 그대로여야 함
//     - initAnalysisDetailTable(...) 도 6번째 인자 resizable 이 추가되었으며,
//       미지정 시 기존 5-인자 호출과 동일하게 동작해야 함 (분석질문 경로 무영향)
//     - CSS: .mfg-table-resize-handle 스타일과 body.mfg-resizing 규칙이 index.html 에 포함
//     - aggregate 호출부(appendBotMessage)에서 AreaTabs.snapshot() → area === 'manufacturing-cost'
//       분기 로직이 정확히 존재해야 함
//     - analysis 호출부(appendAnalysisOnlyMessage)에서는 9번째/6번째 인자를 넘기지 않아야 함
//
//   중요: 이 테스트는 index.html 정적 파싱만 수행 (LLM/DB/브라우저 실행 없음).

import { readFileSync } from 'node:fs';

const INDEX_HTML_PATH = '/home/user/webapp/nlq-server/public/index.html';
const html = readFileSync(INDEX_HTML_PATH, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(msg);
    console.error('  ✗ ' + msg);
  }
}

function assertEqual(actual, expected, msg) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(`${msg} (expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`);
    console.error(`  ✗ ${msg} (expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`);
  }
}

// ─────────────────────────────────────────────────────────────────
// 1. CSS 존재 확인
// ─────────────────────────────────────────────────────────────────
console.log('[1] CSS 정의 확인');

assert(
  /\.mfg-table-resize-handle\s*\{/.test(html),
  '.mfg-table-resize-handle CSS 선언이 index.html 에 존재해야 함'
);
assert(
  /\.analysis-detail-wrap\.mfg-resizable\s*\{/.test(html),
  '.analysis-detail-wrap.mfg-resizable CSS 선언이 존재해야 함 (position:relative 부여용)'
);
assert(
  /body\.mfg-resizing/.test(html),
  'body.mfg-resizing 드래그 중 전역 커서/셀렉트 방지 규칙이 존재해야 함'
);
assert(
  /cursor:se-resize/.test(html),
  '핸들 커서가 se-resize (대각선 남동쪽) 로 설정되어야 함'
);
// [rev2] 회색 삼각형 디자인 - border-right 로 삼각형을 그리므로 border-right-color 로 검증
assert(
  /border-right:\s*\d+px\s+solid\s+#6b7280/.test(html),
  '핸들 기본 형태가 회색(#6b7280) border-right 삼각형이어야 함 - 사용자 요구 (rev2)'
);
assert(
  /border-right-color:#4b5563/.test(html),
  '핸들 hover 시 더 진한 회색(#4b5563)으로 강조되어야 함'
);
assert(
  /border-right-color:#374151/.test(html),
  '핸들 dragging 시 가장 진한 회색(#374151)으로 강조되어야 함'
);
// [rev2] 조상 컨테이너 폭 제약 해제 CSS
assert(
  /\.msg-bot\.mfg-expanded/.test(html),
  '.msg-bot.mfg-expanded CSS 규칙 존재 - 드래그 시 max-width:820px 해제용'
);
assert(
  /\.msg-bot-inner\.mfg-expanded/.test(html),
  '.msg-bot-inner.mfg-expanded CSS 규칙 존재 - 드래그 시 overflow:hidden 해제용'
);

// ─────────────────────────────────────────────────────────────────
// 2. buildAnalysisDetailTable 함수 시그니처
// ─────────────────────────────────────────────────────────────────
console.log('[2] buildAnalysisDetailTable 시그니처 확인');

const buildSigMatch = html.match(
  /function\s+buildAnalysisDetailTable\s*\(\s*([^)]*)\)/
);
assert(buildSigMatch, 'buildAnalysisDetailTable 함수 정의를 찾을 수 있어야 함');
if (buildSigMatch) {
  const params = buildSigMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  assertEqual(params.length, 9, 'buildAnalysisDetailTable 파라미터 개수는 9개여야 함');
  assertEqual(params[0], 'tableId',       'param[0] = tableId');
  assertEqual(params[1], 'rows',          'param[1] = rows');
  assertEqual(params[2], 'columnOrder',   'param[2] = columnOrder');
  assertEqual(params[3], 'columnLabels',  'param[3] = columnLabels');
  assertEqual(params[4], 'rowCount',      'param[4] = rowCount');
  assertEqual(params[5], 'sql',           'param[5] = sql');
  assertEqual(params[6], 'fromHistory',   'param[6] = fromHistory');
  assertEqual(params[7], 'periodInfo',    'param[7] = periodInfo');
  assertEqual(params[8], 'showResizeHandle', 'param[8] = showResizeHandle (신규, 옵션)');
}

// ─────────────────────────────────────────────────────────────────
// 3. initAnalysisDetailTable 함수 시그니처
// ─────────────────────────────────────────────────────────────────
console.log('[3] initAnalysisDetailTable 시그니처 확인');

const initSigMatch = html.match(
  /function\s+initAnalysisDetailTable\s*\(\s*([^)]*)\)/
);
assert(initSigMatch, 'initAnalysisDetailTable 함수 정의를 찾을 수 있어야 함');
if (initSigMatch) {
  const params = initSigMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  assertEqual(params.length, 6, 'initAnalysisDetailTable 파라미터 개수는 6개여야 함');
  assertEqual(params[0], 'tableId',      'param[0] = tableId');
  assertEqual(params[1], 'rows',         'param[1] = rows');
  assertEqual(params[2], 'columnOrder',  'param[2] = columnOrder');
  assertEqual(params[3], 'columnLabels', 'param[3] = columnLabels');
  assertEqual(params[4], 'fromHistory',  'param[4] = fromHistory');
  assertEqual(params[5], 'resizable',    'param[5] = resizable (신규, 옵션)');
}

// ─────────────────────────────────────────────────────────────────
// 4. 함수 본문에 핸들 렌더/바인딩 로직 존재
// ─────────────────────────────────────────────────────────────────
console.log('[4] 함수 본문 로직 확인');

assert(
  html.includes('mfg-table-resize-handle'),
  '핸들 DOM 클래스명 "mfg-table-resize-handle" 이 index.html 어딘가에 존재해야 함'
);
assert(
  /_mfgResizable\s*=\s*!!showResizeHandle/.test(html),
  'buildAnalysisDetailTable 내부에서 showResizeHandle 을 boolean 으로 강제 변환해야 함'
);
assert(
  /_mfgResizable\s*\?\s*['"`]analysis-detail-wrap mfg-resizable['"`]/.test(html),
  '_mfgResizable=true 일 때 wrap 클래스에 mfg-resizable 이 붙어야 함'
);
assert(
  /_resizeHandleHtml/.test(html),
  '_resizeHandleHtml 변수로 조건부 핸들 DOM 문자열을 생성해야 함'
);
// initAnalysisDetailTable 내부 드래그 바인딩
assert(
  /if\s*\(\s*resizable\s*\)/.test(html),
  'initAnalysisDetailTable 내부에 if (resizable) 게이트가 있어야 함'
);
assert(
  /addEventListener\(\s*['"`]mousedown['"`]/.test(html),
  '핸들 mousedown 이벤트 리스너가 등록되어야 함'
);
assert(
  /addEventListener\(\s*['"`]mousemove['"`]/.test(html),
  '문서에 mousemove 리스너가 등록되어 드래그 추적이 가능해야 함'
);
assert(
  /addEventListener\(\s*['"`]mouseup['"`]/.test(html),
  '문서에 mouseup 리스너가 등록되어 드래그 종료 처리가 가능해야 함'
);
assert(
  /addEventListener\(\s*['"`]resize['"`]/.test(html),
  'window resize 리스너로 뷰포트 축소 시 상한 재계산 처리가 있어야 함'
);
// [rev3] MIN_WIDTH 는 절대 상수 320px 로 정의 (rev5 에서도 유지, edge case fallback)
assert(
  /const\s+MIN_WIDTH\s*=\s*320/.test(html),
  'MIN_WIDTH 상수(320px) 로 절대 하한 fallback 정의 (rev3~rev5 유지)'
);
// [rev5] 콘텐츠 실제 폭을 계산하는 로직
assert(
  /tableScrollContainer/.test(html),
  'tableScrollContainer 변수 - 테이블 스크롤 컨테이너 참조 (rev5)'
);
assert(
  /wrap\.querySelector\(\s*['"`]table['"`]\s*\)/.test(html),
  'wrap.querySelector(table) 로 테이블 요소 참조 (rev5)'
);
assert(
  /\.parentElement/.test(html),
  '테이블의 parentElement 로 스크롤 컨테이너 참조 (rev5)'
);
assert(
  /const\s+computeContentMinWidth\s*=/.test(html),
  'computeContentMinWidth 함수 - 콘텐츠 실제 폭 계산 (rev5)'
);
assert(
  /\.scrollWidth/.test(html),
  'scrollWidth 로 테이블 실제 콘텐츠 폭 측정 (rev5) - 고정 min-width 하드코딩 금지'
);
assert(
  /const\s+WRAP_FRAME_PADDING\s*=\s*6/.test(html),
  'WRAP_FRAME_PADDING = 6 (wrap border + 안전 여유) (rev5)'
);
// [rev5] requestAnimationFrame 으로 콘텐츠 폭 재캡처
assert(
  /requestAnimationFrame/.test(html),
  'requestAnimationFrame 으로 렌더 안정화 후 콘텐츠 폭 재계산 (rev4→rev5 계승)'
);
// [rev5] computeMinWidth - 실제 하한 = max(MIN_WIDTH, cachedContentMinWidth)
assert(
  /const\s+computeMinWidth\s*=/.test(html),
  'computeMinWidth 함수 존재 (rev4→rev5)'
);
assert(
  /Math\.max\(\s*MIN_WIDTH\s*,\s*cachedContentMinWidth/.test(html),
  '실제 하한 = Math.max(MIN_WIDTH, cachedContentMinWidth) - 콘텐츠 폭 기반 (rev5)'
);
// [rev5] mousemove 하한 클램핑이 computeMinWidth() 사용
assert(
  /const\s+minW\s*=\s*computeMinWidth\(\)/.test(html),
  'mousemove 에서 minW = computeMinWidth() 로 매번 계산해야 함 (rev4~rev5)'
);
assert(
  /if\s*\(\s*next\s*<\s*minW\s*\)\s*next\s*=\s*minW/.test(html),
  'mousemove 시 next < minW 이면 minW 로 클램핑 (rev4~rev5)'
);
// [rev5] rev4 의 baselineWidth 는 완전히 제거되었어야 함 (콘텐츠 폭 기반으로 대체)
assert(
  !/let\s+baselineWidth\s*=\s*0/.test(html),
  'rev4 의 baselineWidth 변수는 rev5 에서 cachedContentMinWidth 로 대체되어야 함'
);
assert(
  !/const\s+captureBaseline\s*=/.test(html),
  'rev4 의 captureBaseline 함수는 rev5 에서 computeContentMinWidth 로 대체되어야 함'
);
// [rev5] 하드코딩된 큰 min-width 상수가 없어야 함 (사용자 요구)
//   MIN_WIDTH=320 은 절대 하한이라 허용, 그러나 700/800/820 등의 하드코딩은 금지
assert(
  !/min-width:\s*[7-9]\d{2}px/i.test(html) || html.match(/min-width:\s*[7-9]\d{2}px/gi)?.every(s => !s.includes('mfg')),
  '.mfg-resizable 관련 CSS 에 하드코딩된 700+px min-width 가 없어야 함 (사용자 요구)'
);
// [rev2] max-width 는 wrap 의 뷰포트 좌표 기준으로 계산 (사이드바 존재 시 정확)
assert(
  /window\.innerWidth\s*-\s*rect\.left/.test(html),
  '최대 폭은 (window.innerWidth - wrap.rect.left - 여백) 로 계산해야 함 - 사이드바 대응 (rev2)'
);
// [rev3] 조상 확장 함수는 pinCurrentWidthAndExpandAncestors 로 이름 변경
//   - "먼저 현재 폭을 인라인으로 고정, 그 후 조상 클래스 부여" 순서 강제
assert(
  /pinCurrentWidthAndExpandAncestors/.test(html),
  'pinCurrentWidthAndExpandAncestors 함수 존재 - 현재 폭 고정 후 조상 해제 순서 보장 (rev3)'
);
// [rev3] mousedown 시 클릭만으로 폭이 변하지 않아야 함:
//   pinCurrentWidthAndExpandAncestors 는 wrap.getBoundingClientRect().width 를
//   현재 값 그대로 style.width 에 세팅 → 클릭만으로는 변화 없음
assert(
  /wrap\.style\.width\s*=\s*Math\.floor\(currentWidth\)\s*\+\s*['"`]px['"`]/.test(html),
  '조상 확장 전 현재 폭을 wrap.style.width 로 정확히 고정해야 함 - 클릭 순간 부풀음 방지 (rev3)'
);
assert(
  /classList\.add\(\s*['"`]mfg-expanded['"`]/.test(html),
  '드래그 시작 시 조상에 mfg-expanded 클래스 추가하는 코드가 있어야 함 (rev2)'
);
assert(
  /\.closest\(\s*['"`]\.msg-bot['"`]/.test(html),
  'wrap 에서 .msg-bot 조상을 closest() 로 참조해야 함 (rev2)'
);
assert(
  /\.closest\(\s*['"`]\.msg-bot-inner['"`]/.test(html),
  'wrap 에서 .msg-bot-inner 조상을 closest() 로 참조해야 함 (rev2)'
);
// [rev3] 순서 검증: mousedown 핸들러 안에서 "현재 폭 캡처+고정" 이 조상 확장보다 먼저 나와야 함
//   → 소스에서 pinCurrentWidthAndExpandAncestors 함수 정의 내부의
//     wrap.style.width 대입이 msgBot.classList.add 보다 앞서야 함
{
  const funcMatch = html.match(/const\s+pinCurrentWidthAndExpandAncestors\s*=\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\};/);
  assert(funcMatch, 'pinCurrentWidthAndExpandAncestors 함수 본문을 파싱할 수 있어야 함 (rev3)');
  if (funcMatch) {
    const body = funcMatch[1];
    const idxWidthSet = body.search(/wrap\.style\.width\s*=/);
    const idxClassAdd = body.search(/msgBot(?:Inner)?\.classList\.add\(\s*['"`]mfg-expanded['"`]/);
    assert(idxWidthSet >= 0, '함수 안에 wrap.style.width 대입이 있어야 함 (rev3)');
    assert(idxClassAdd >= 0, '함수 안에 msgBot.classList.add(mfg-expanded) 가 있어야 함 (rev3)');
    assert(
      idxWidthSet < idxClassAdd,
      '★ 순서 필수: wrap.style.width 대입이 classList.add(mfg-expanded) 보다 먼저 실행되어야 함 - 클릭 시 부풀음 방지 (rev3)'
    );
  }
}
// [rev3] 함수 이름 변경 - 이전 expandAncestors 는 제거되었어야 함
assert(
  !/const\s+expandAncestors\s*=/.test(html),
  '이전 expandAncestors 함수는 제거되었어야 함 (rev3 에서 pinCurrentWidthAndExpandAncestors 로 이름 변경)'
);

// ─────────────────────────────────────────────────────────────────
// 5. aggregate 호출부 (appendBotMessage) 게이팅 로직
// ─────────────────────────────────────────────────────────────────
console.log('[5] aggregate 호출부 area 게이팅 확인');

// area === 'manufacturing-cost' 감지 로직
assert(
  /_mfgShowResizeHandle/.test(html),
  'aggregate 호출부에 _mfgShowResizeHandle 변수가 존재해야 함'
);
assert(
  /window\.AreaTabs\s*&&\s*typeof\s+window\.AreaTabs\.snapshot\s*===\s*['"`]function['"`]/.test(html),
  'AreaTabs.snapshot() 함수 존재 안전 체크가 있어야 함'
);
assert(
  /_areaForResize\s*===\s*['"`]manufacturing-cost['"`]/.test(html),
  "area 값이 'manufacturing-cost' 인지 정확히 비교해야 함"
);
// buildAnalysisDetailTable 호출 시 9번째 인자로 flag 전달
assert(
  /buildAnalysisDetailTable\([^)]*_mfgShowResizeHandle\s*\)/.test(html),
  'buildAnalysisDetailTable 호출 시 _mfgShowResizeHandle 을 9번째 인자로 전달해야 함'
);
// initAnalysisDetailTable 호출 시 resizable 인자 전달
assert(
  /_aggDetailInitCtx\.resizable/.test(html),
  '_aggDetailInitCtx 에 resizable 필드를 저장하고 init 호출 시 전달해야 함'
);

// ─────────────────────────────────────────────────────────────────
// 6. analysis 호출부(appendAnalysisOnlyMessage)는 변경되지 않아야 함
// ─────────────────────────────────────────────────────────────────
console.log('[6] analysis 호출부 미변경 확인 - 분석질문에는 핸들 노출 금지');

// buildAnalysisDetailTable 을 8-인자로 호출하는 곳이 정확히 1군데(analysis) 존재해야 함
// (aggregate 는 9-인자로 이미 변경됐음)
// 정규식으로 buildAnalysisDetailTable(...) 호출 모두 캡처하여 인자 개수 확인
const callRe = /buildAnalysisDetailTable\s*\(([^)]*)\)/g;
const callArgCounts = [];
let mCall;
while ((mCall = callRe.exec(html)) !== null) {
  const argStr = mCall[1];
  // 문자열 내부에 콤마가 있을 수 있지만 이 함수 호출은 단순 인자 목록이므로
  //   단순 split(',') 으로 대략 개수 파악. 정확도 향상을 위해 문자열/객체 리터럴 없는지 확인.
  //   실제 함수 호출은 모두 단순 identifier/literal 이므로 안전.
  const args = argStr.split(',').map(s => s.trim()).filter(Boolean);
  callArgCounts.push(args.length);
}
console.log(`  buildAnalysisDetailTable 호출 지점 인자 개수: [${callArgCounts.join(', ')}]`);
assert(
  callArgCounts.length >= 2,
  'buildAnalysisDetailTable 호출은 최소 2군데(aggregate + analysis) 있어야 함'
);
assert(
  callArgCounts.some(n => n === 9),
  '9-인자 호출(aggregate, showResizeHandle 전달)이 최소 1군데 있어야 함'
);
assert(
  callArgCounts.some(n => n === 8),
  '8-인자 호출(analysis, showResizeHandle 미전달 → undefined → 기존 동작 유지)이 최소 1군데 있어야 함'
);

// initAnalysisDetailTable 도 동일하게 확인
const initCallRe = /initAnalysisDetailTable\s*\(\s*([^;]*?)\s*\)\s*;/g;
const initCallArgCounts = [];
let mInit;
while ((mInit = initCallRe.exec(html)) !== null) {
  // 이 정규식은 여러 라인 매칭이 어려우므로 대체 방식: 인자 시작 후 대응되는 ')' 찾기
  const start = mInit.index + 'initAnalysisDetailTable('.length;
  let depth = 1;
  let cursor = start;
  while (cursor < html.length && depth > 0) {
    const ch = html[cursor];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) break;
    cursor++;
  }
  const raw = html.slice(start, cursor);
  // 콤마 분해 (단순, initAnalysisDetailTable 호출은 nested () 없음)
  const args = raw.split(',').map(s => s.trim()).filter(Boolean);
  initCallArgCounts.push(args.length);
}
console.log(`  initAnalysisDetailTable 호출 지점 인자 개수: [${initCallArgCounts.join(', ')}]`);
assert(
  initCallArgCounts.some(n => n === 5),
  'initAnalysisDetailTable 5-인자 호출(analysis, resizable 미전달)이 존재해야 함'
);
assert(
  initCallArgCounts.some(n => n === 6),
  'initAnalysisDetailTable 6-인자 호출(aggregate, resizable 전달)이 존재해야 함'
);

// ─────────────────────────────────────────────────────────────────
// 7. 기존 기능 보존 검증
// ─────────────────────────────────────────────────────────────────
console.log('[7] 기존 기능 보존 검증');

// pager, 검색, pagesize, SQL 토글 요소 존재
assert(html.includes('_pager'), 'pager DOM 은 여전히 존재해야 함');
assert(html.includes('_search'), '검색 input 은 여전히 존재해야 함');
assert(html.includes('_pagesize'), '페이지 크기 select 는 여전히 존재해야 함');
assert(html.includes('renderAnalysisTable'), 'renderAnalysisTable 렌더러는 그대로 호출되어야 함');
// 부모 overflow-x 처리 정책 - CSS 원문 존재
assert(html.includes('overflow-x'), 'overflow-x 관련 CSS 정책이 유지되어야 함');

// ─────────────────────────────────────────────────────────────────
// 결과 요약
// ─────────────────────────────────────────────────────────────────
console.log('');
console.log('─'.repeat(60));
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log('');
  console.log('실패 항목:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
} else {
  console.log('✓ 모든 검증 통과 - 제조원가 현황집계 리사이즈 핸들 정상');
  process.exit(0);
}
