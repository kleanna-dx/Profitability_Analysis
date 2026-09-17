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
// 색상: 진한 회색 또는 제조원가 관련 색상 사용
assert(
  /color:#4b5563/.test(html) || /color:#6b7280/.test(html),
  '핸들 기본색이 진한 회색(#4b5563 또는 #6b7280)이어야 함 - 사용자 요구'
);
assert(
  /color:#4c1d95/.test(html),
  '핸들 hover/dragging 강조색이 제조원가 관련 진한 보라(#4c1d95)여야 함 - 사용자 요구'
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
// min/max width 안전선
assert(
  /Math\.max\(\s*320\s*,/.test(html),
  '최소 폭 하한선(320px)이 설정되어야 함 - 너무 작아지지 않도록'
);
assert(
  /window\.innerWidth\s*\*\s*0\.96/.test(html),
  '최대 폭은 뷰포트의 96%로 제한해야 함 - 사이드바/스크롤바 침범 방지'
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
