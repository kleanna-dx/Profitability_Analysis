// [2026-09-17] 제조원가 현황집계 결과 표 - '가로 넓게 보기' 토글 버튼 회귀 테스트
//
//   목표:
//     - buildAnalysisDetailTable 9번째 옵션 인자 showWidenButton 이 true 일 때만
//       .mfg-widen-btn 이 헤더에 렌더되어야 함
//     - showWidenButton 미지정/false → 버튼 미노출 (기존 UI)
//     - initAnalysisDetailTable 6번째 옵션 인자 widenable 이 true 일 때만 클릭 이벤트 바인딩
//     - CSS 클래스: .mfg-widen-btn, .msg-bot.mfg-widened, .msg-bot-inner.mfg-widened
//     - aggregate 호출부(appendBotMessage)에서 AreaTabs.snapshot() → area === 'manufacturing-cost'
//       분기 로직 존재
//     - analysis 호출부(appendAnalysisOnlyMessage)에서는 9번째/6번째 인자를 넘기지 않아야 함
//     - 세로 크기 변경 금지 - toggle 로직에 height/max-height 조작 없어야 함
//
//   중요: 이 테스트는 index.html 정적 파싱만 수행 (LLM/DB/브라우저 실행 없음).

import { readFileSync } from 'node:fs';

const INDEX_HTML_PATH = '/home/user/webapp/nlq-server/public/index.html';
const html = readFileSync(INDEX_HTML_PATH, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.error('  ✗ ' + msg); }
}
function assertEqual(actual, expected, msg) {
  if (actual === expected) { passed++; }
  else { failed++; failures.push(`${msg} (expected=${JSON.stringify(expected)}, actual=${JSON.stringify(actual)})`); console.error(`  ✗ ${msg}`); }
}

// ─────────────────────────────────────────────────────────────────
// 1. CSS 정의
// ─────────────────────────────────────────────────────────────────
console.log('[1] CSS 정의 확인');

assert(
  /\.mfg-widen-btn\s*\{/.test(html),
  '.mfg-widen-btn CSS 선언 존재 (버튼 기본 스타일)'
);
assert(
  /\.mfg-widen-btn\.is-active\s*\{/.test(html),
  '.mfg-widen-btn.is-active CSS 선언 존재 (활성 상태 스타일)'
);
assert(
  /\.mfg-widen-btn:hover\s*\{/.test(html),
  '.mfg-widen-btn:hover CSS 선언 존재 (호버 효과)'
);
// 조상 클래스: 확장 시 폭 제약 해제
{
  const msgBotBlock = html.match(/\.msg-bot\.mfg-widened\s*\{([^}]*)\}/);
  assert(msgBotBlock, '.msg-bot.mfg-widened CSS 블록 존재');
  if (msgBotBlock) {
    assert(/max-width:\s*none/.test(msgBotBlock[1]), '.msg-bot.mfg-widened 에 max-width:none');
  }
}
{
  const msgBotInnerBlock = html.match(/\.msg-bot-inner\.mfg-widened\s*\{([^}]*)\}/);
  assert(msgBotInnerBlock, '.msg-bot-inner.mfg-widened CSS 블록 존재');
  if (msgBotInnerBlock) {
    // 페이지 스크롤 유지를 위해 auto (visible 아님)
    assert(/overflow:\s*auto/.test(msgBotInnerBlock[1]), '.msg-bot-inner.mfg-widened 에 overflow:auto');
    assert(!/overflow:\s*visible/.test(msgBotInnerBlock[1]), '.msg-bot-inner.mfg-widened 에 overflow:visible 없어야 함');
  }
}
// 세로 크기 관련 조작 없음 - .mfg-widened 관련 CSS 에 height/max-height/min-height 없어야 함
{
  const allWidenedBlocks = [...html.matchAll(/\.[\w-]+\.mfg-widened\s*\{([^}]*)\}/g)]
    .map(m => m[1]).join('\n');
  assert(
    !/(?:^|[^-])height:/.test(allWidenedBlocks),
    '.mfg-widened CSS 블록에 height 조작 없어야 함 (세로 크기 변경 금지)'
  );
  assert(
    !/max-height:/.test(allWidenedBlocks),
    '.mfg-widened CSS 블록에 max-height 조작 없어야 함 (세로 크기 변경 금지)'
  );
  assert(
    !/min-height:/.test(allWidenedBlocks),
    '.mfg-widened CSS 블록에 min-height 조작 없어야 함 (세로 크기 변경 금지)'
  );
}

// ─────────────────────────────────────────────────────────────────
// 2. buildAnalysisDetailTable 시그니처
// ─────────────────────────────────────────────────────────────────
console.log('[2] buildAnalysisDetailTable 시그니처 확인');

const buildSigMatch = html.match(/function\s+buildAnalysisDetailTable\s*\(\s*([^)]*)\)/);
assert(buildSigMatch, 'buildAnalysisDetailTable 함수 정의 존재');
if (buildSigMatch) {
  const params = buildSigMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  assertEqual(params.length, 9, 'buildAnalysisDetailTable 파라미터 개수는 9개');
  assertEqual(params[0], 'tableId',         'param[0] = tableId');
  assertEqual(params[1], 'rows',            'param[1] = rows');
  assertEqual(params[2], 'columnOrder',     'param[2] = columnOrder');
  assertEqual(params[3], 'columnLabels',    'param[3] = columnLabels');
  assertEqual(params[4], 'rowCount',        'param[4] = rowCount');
  assertEqual(params[5], 'sql',             'param[5] = sql');
  assertEqual(params[6], 'fromHistory',     'param[6] = fromHistory');
  assertEqual(params[7], 'periodInfo',      'param[7] = periodInfo');
  assertEqual(params[8], 'showWidenButton', 'param[8] = showWidenButton (신규 옵션)');
}

// ─────────────────────────────────────────────────────────────────
// 3. initAnalysisDetailTable 시그니처
// ─────────────────────────────────────────────────────────────────
console.log('[3] initAnalysisDetailTable 시그니처 확인');

const initSigMatch = html.match(/function\s+initAnalysisDetailTable\s*\(\s*([^)]*)\)/);
assert(initSigMatch, 'initAnalysisDetailTable 함수 정의 존재');
if (initSigMatch) {
  const params = initSigMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  assertEqual(params.length, 6, 'initAnalysisDetailTable 파라미터 개수는 6개');
  assertEqual(params[0], 'tableId',      'param[0] = tableId');
  assertEqual(params[1], 'rows',         'param[1] = rows');
  assertEqual(params[2], 'columnOrder',  'param[2] = columnOrder');
  assertEqual(params[3], 'columnLabels', 'param[3] = columnLabels');
  assertEqual(params[4], 'fromHistory',  'param[4] = fromHistory');
  assertEqual(params[5], 'widenable',    'param[5] = widenable (신규 옵션)');
}

// ─────────────────────────────────────────────────────────────────
// 4. 버튼 DOM 및 클릭 로직
// ─────────────────────────────────────────────────────────────────
console.log('[4] 버튼 DOM 및 토글 로직');

assert(
  /_mfgWidenable\s*=\s*!!showWidenButton/.test(html),
  'showWidenButton 을 boolean 으로 강제 변환 (_mfgWidenable)'
);
assert(
  /class="mfg-widen-btn"/.test(html),
  '헤더에 mfg-widen-btn 클래스를 가진 button DOM 생성'
);
assert(
  /\$\{tableId\}_widenBtn/.test(html),
  '버튼 id 는 ${tableId}_widenBtn 형식'
);
assert(
  /fa-arrows-alt-h/.test(html),
  '버튼 아이콘: fa-arrows-alt-h (좌우 화살표)'
);
assert(
  /data-widen-label/.test(html),
  '토글 시 라벨 텍스트 변경을 위한 data-widen-label 속성'
);
assert(
  /aria-pressed/.test(html),
  '토글 상태 표현을 위한 aria-pressed 속성 (a11y)'
);

// 클릭 이벤트 바인딩
assert(
  /if\s*\(\s*widenable\s*\)/.test(html),
  'initAnalysisDetailTable 내부에 if (widenable) 게이트'
);
assert(
  /btn\.addEventListener\(\s*['"`]click['"`]/.test(html),
  '버튼에 click 이벤트 리스너 등록'
);
assert(
  /const\s+applyWidened\s*=/.test(html),
  'applyWidened 함수 - 확장 상태 적용'
);
assert(
  /const\s+applyDefault\s*=/.test(html),
  'applyDefault 함수 - 기본 상태 복귀'
);
// toggle 로직
assert(
  /const\s+isActive\s*=\s*btn\.classList\.contains\(\s*['"`]is-active['"`]\s*\)/.test(html),
  'is-active 클래스로 현재 상태 판단 (toggle 판별)'
);

// 조상 클래스 조작
assert(
  /msgBot\.classList\.add\(\s*['"`]mfg-widened['"`]/.test(html),
  '확장 시 msg-bot 에 mfg-widened 클래스 추가'
);
assert(
  /msgBot\.classList\.remove\(\s*['"`]mfg-widened['"`]/.test(html),
  '기본 복귀 시 msg-bot 에서 mfg-widened 클래스 제거'
);
assert(
  /msgBotInner\.classList\.add\(\s*['"`]mfg-widened['"`]/.test(html),
  '확장 시 msg-bot-inner 에 mfg-widened 클래스 추가'
);
assert(
  /wrap\.classList\.add\(\s*['"`]mfg-widened['"`]/.test(html),
  '확장 시 wrap 에 mfg-widened 클래스 추가'
);

// wrap.style.width 조작
assert(
  /wrap\.style\.width\s*=\s*maxW\s*\+\s*['"`]px['"`]/.test(html),
  '확장 시 wrap.style.width = maxW + px 로 명시적 폭 세팅'
);
assert(
  /wrap\.style\.width\s*=\s*['"`]['"`]/.test(html),
  '기본 복귀 시 wrap.style.width = "" 로 인라인 제거 (자연 폭 복귀)'
);

// ─────────────────────────────────────────────────────────────────
// 5. 최대 폭 계산 로직 (main content 사용가능 폭 기준)
// ─────────────────────────────────────────────────────────────────
console.log('[5] computeMaxWidth 로직 - main content 사용가능 폭 기준');

assert(
  /const\s+computeMaxWidth\s*=/.test(html),
  'computeMaxWidth 함수 존재'
);
// chatArea (main content 컨테이너) 참조
assert(
  /document\.getElementById\(\s*['"`]chatArea['"`]\s*\)/.test(html) ||
    /document\.querySelector\(\s*['"`]\.chat-area['"`]\s*\)/.test(html),
  'main content(#chatArea 또는 .chat-area) 참조 - 사용가능 폭 기준'
);
// [hotfix] rect.right 대신 chatArea.clientWidth 기반 계산 (padding 반영, scrollbar 제외)
//   이전 rev 는 rect.right 를 썼지만 chatArea.padding-right=24 를 무시해서 가로 스크롤 발생
assert(
  /wrapRect\.left/.test(html) || /rect\.left/.test(html),
  'wrap.rect.left 로 wrap 시작점 참조'
);
// [hotfix] SAFETY_MARGIN = 32 (chatArea padding-right 24 + 여유 8)
//   - 24 → 32 로 상향해서 chat-area 가로 스크롤 발생 원천 방지
assert(
  /const\s+SAFETY_MARGIN\s*=\s*32/.test(html),
  'SAFETY_MARGIN = 32 (chatArea padding-right 24 + 반올림 여유 8) - hotfix'
);
// [hotfix] chatArea.clientWidth 기반 계산 (rect.right 아님)
//   - clientWidth 는 padding 포함, scrollbar 제외 → 실제 콘텐츠 영역 폭
assert(
  /chatArea\.clientWidth/.test(html),
  'chatArea.clientWidth 기반 rightBoundary 계산 (padding 반영, scrollbar 제외) - hotfix'
);
assert(
  /chatRect\.left\s*\+\s*chatArea\.clientWidth/.test(html),
  'rightBoundary = chatRect.left + chatArea.clientWidth (정확한 콘텐츠 오른쪽 경계) - hotfix'
);
// window.innerWidth fallback
assert(
  /window\.innerWidth/.test(html),
  'window.innerWidth fallback (chatArea 미검색 시)'
);
// [hotfix] .chat-area.mfg-widen-active CSS 로 overflow-x:hidden 이중 방어
{
  const chatAreaBlock = html.match(/\.chat-area\.mfg-widen-active\s*\{([^}]*)\}/);
  assert(chatAreaBlock, '.chat-area.mfg-widen-active CSS 블록 존재 (hotfix)');
  if (chatAreaBlock) {
    assert(
      /overflow-x:\s*hidden/.test(chatAreaBlock[1]),
      '.chat-area.mfg-widen-active 에 overflow-x:hidden - 페이지 가로 스크롤 원천 차단 (hotfix)'
    );
  }
}
// [hotfix] applyWidened/applyDefault 에서 chatArea 에도 클래스 부여/제거
assert(
  /chatArea\.classList\.add\(\s*['"`]mfg-widen-active['"`]/.test(html),
  '확장 시 chatArea 에 mfg-widen-active 클래스 부여 (hotfix)'
);
assert(
  /chatArea\.classList\.remove\(\s*['"`]mfg-widen-active['"`]/.test(html),
  '기본 복귀 시 chatArea 에서 mfg-widen-active 클래스 제거 (hotfix)'
);
// 하드코딩된 큰 폭 없음 (사용자 요구)
{
  // computeMaxWidth 함수 본문에 1600 같은 하드코딩 없어야 함
  const cmwMatch = html.match(/const\s+computeMaxWidth\s*=\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\};/);
  if (cmwMatch) {
    const body = cmwMatch[1];
    assert(
      !/=\s*1[0-9]{3}[^\d]/.test(body) && !/=\s*[2-9][0-9]{3}[^\d]/.test(body),
      'computeMaxWidth 에 1000+ 하드코딩 상수 없음 (사용자 요구: 고정 px 금지)'
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// 6. window resize 반응형 처리
// ─────────────────────────────────────────────────────────────────
console.log('[6] window resize 반응형 처리');

assert(
  /window\.addEventListener\(\s*['"`]resize['"`]/.test(html),
  'window resize 이벤트 리스너 등록 (반응형)'
);
// resize 리스너 안에 is-active 체크 (확장 상태에서만 재계산)
{
  // resize 콜백 본문 안에 is-active 체크가 있어야 함
  const resizeMatch = html.match(/window\.addEventListener\(\s*['"`]resize['"`]\s*,\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\}\s*\)/);
  if (resizeMatch) {
    const body = resizeMatch[1];
    assert(
      /is-active/.test(body),
      'resize 콜백에서 is-active 체크 - 확장 상태에서만 폭 재계산'
    );
  }
}

// ─────────────────────────────────────────────────────────────────
// 7. 세로 크기 변경 금지 - toggle 로직에 height 조작 없음
// ─────────────────────────────────────────────────────────────────
console.log('[7] 세로 크기 변경 금지 검증');

{
  // applyWidened / applyDefault 함수 본문에 height/maxHeight/minHeight 조작 없어야 함
  const applyWidenedMatch = html.match(/const\s+applyWidened\s*=\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\};/);
  const applyDefaultMatch = html.match(/const\s+applyDefault\s*=\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\};/);
  const combined = (applyWidenedMatch ? applyWidenedMatch[1] : '') + '\n' +
                   (applyDefaultMatch ? applyDefaultMatch[1] : '');
  assert(
    !/style\.height/.test(combined),
    'applyWidened/applyDefault 에 style.height 조작 없음 (세로 크기 변경 금지)'
  );
  assert(
    !/style\.maxHeight/.test(combined),
    'applyWidened/applyDefault 에 style.maxHeight 조작 없음'
  );
  assert(
    !/style\.minHeight/.test(combined),
    'applyWidened/applyDefault 에 style.minHeight 조작 없음'
  );
  assert(
    !/fullscreen/i.test(combined),
    'applyWidened/applyDefault 에 fullscreen 관련 코드 없음 (fullscreen 기능 아님)'
  );
}

// ─────────────────────────────────────────────────────────────────
// 8. aggregate 호출부 (appendBotMessage) area 게이팅
// ─────────────────────────────────────────────────────────────────
console.log('[8] aggregate 호출부 area 게이팅');

assert(
  /_mfgShowWidenBtn/.test(html),
  'aggregate 호출부에 _mfgShowWidenBtn 변수 존재'
);
assert(
  /window\.AreaTabs\s*&&\s*typeof\s+window\.AreaTabs\.snapshot\s*===\s*['"`]function['"`]/.test(html),
  'AreaTabs.snapshot() 함수 존재 안전 체크'
);
assert(
  /_areaForWiden\s*===\s*['"`]manufacturing-cost['"`]/.test(html),
  "area === 'manufacturing-cost' 정확 비교"
);
assert(
  /buildAnalysisDetailTable\([^)]*_mfgShowWidenBtn\s*\)/.test(html),
  'buildAnalysisDetailTable 호출 시 _mfgShowWidenBtn 을 9번째 인자로 전달'
);
assert(
  /_aggDetailInitCtx\.widenable/.test(html),
  '_aggDetailInitCtx.widenable 필드로 init 호출 시 flag 전달'
);

// ─────────────────────────────────────────────────────────────────
// 9. analysis 호출부는 미변경 (분석질문에 버튼 노출 금지)
// ─────────────────────────────────────────────────────────────────
console.log('[9] analysis 호출부 미변경 확인');

// buildAnalysisDetailTable 호출: aggregate 는 9-인자, analysis 는 8-인자
const buildCallRe = /buildAnalysisDetailTable\s*\(([^)]*)\)/g;
const buildCallCounts = [];
let bm;
while ((bm = buildCallRe.exec(html)) !== null) {
  const args = bm[1].split(',').map(s => s.trim()).filter(Boolean);
  buildCallCounts.push(args.length);
}
console.log('  buildAnalysisDetailTable 호출 인자 개수:', buildCallCounts);
assert(buildCallCounts.some(n => n === 9), '9-인자 호출(aggregate) 존재');
assert(buildCallCounts.some(n => n === 8), '8-인자 호출(analysis, showWidenButton undefined) 존재');

// initAnalysisDetailTable 호출: aggregate 는 6-인자, analysis 는 5-인자
const initCallRe = /initAnalysisDetailTable\s*\(/g;
const initCallCounts = [];
let im;
while ((im = initCallRe.exec(html)) !== null) {
  const start = im.index + 'initAnalysisDetailTable('.length;
  let depth = 1, cursor = start;
  while (cursor < html.length && depth > 0) {
    const ch = html[cursor];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (depth === 0) break;
    cursor++;
  }
  const raw = html.slice(start, cursor);
  // 함수 정의(function initAnalysisDetailTable) 는 제외
  const before = html.substring(Math.max(0, im.index - 20), im.index);
  if (/function\s+$/.test(before)) continue;
  const args = raw.split(',').map(s => s.trim()).filter(Boolean);
  initCallCounts.push(args.length);
}
console.log('  initAnalysisDetailTable 호출 인자 개수:', initCallCounts);
assert(initCallCounts.some(n => n === 6), '6-인자 호출(aggregate, widenable=true) 존재');
assert(initCallCounts.some(n => n === 5), '5-인자 호출(analysis, widenable undefined) 존재');

// ─────────────────────────────────────────────────────────────────
// 10. 기존 기능 보존
// ─────────────────────────────────────────────────────────────────
console.log('[10] 기존 기능 보존 검증');

assert(html.includes('_pager'), 'pager DOM 유지');
assert(html.includes('_search'), '검색 input 유지');
assert(html.includes('_pagesize'), '페이지 크기 select 유지');
assert(html.includes('renderAnalysisTable'), 'renderAnalysisTable 렌더러 유지');
assert(html.includes('overflow-x'), 'overflow-x 정책 유지');

// 이전 rev1~rev6 (드래그 리사이즈 핸들) 관련 흔적이 없어야 함
console.log('[11] 이전 드래그 리사이즈 (rev1~rev6) 흔적 제거 확인');
assert(!/mfg-table-resize-handle/.test(html), 'mfg-table-resize-handle CSS/DOM 제거됨');
assert(!/pinCurrentWidthAndExpandAncestors/.test(html), 'pinCurrentWidthAndExpandAncestors 함수 제거됨');
assert(!/mfg-resizing/.test(html), 'mfg-resizing 클래스 제거됨');
assert(!/mfg-resizable/.test(html), 'mfg-resizable 클래스 제거됨');
assert(!/mfg-expanded/.test(html), 'mfg-expanded 클래스(rev2~rev6) 제거됨');

// ─────────────────────────────────────────────────────────────────
// 결과
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
  console.log('✓ 모든 검증 통과 - 제조원가 넓게 보기 토글 버튼 정상');
  process.exit(0);
}
