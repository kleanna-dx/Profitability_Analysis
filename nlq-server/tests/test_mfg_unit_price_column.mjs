// [2026-09-17] 제조원가 결과표 '개당 단가' 컬럼 명칭 표준화 + UI 강조 회귀 테스트
//
//   요구사항 요약:
//     1. 서버 프롬프트 힌트에서 단가 컬럼 alias 를 '개당 단가' 로 통일
//     2. 계산식(ROUND(SUM(TOTAL)/NULLIF(SUM(LBKUM),0),0)) 은 변경 없음
//     3. 프론트에서 '개당 단가' 컬럼(및 과거 호환 '원가 단가' 등)을 자동 감지해 연한 노란색 강조
//     4. 컬럼 index 하드코딩 금지 - 이름 기반 매칭
//     5. 제조원가에만 적용 (area === 'manufacturing-cost') - 수익성분석 미적용
//     6. 계산 근거 컬럼(원가 총액/생산수량/단위) 순서 유지 → '개당 단가' 마지막
//
//   검증 방식: 정적 파싱만 (LLM/DB 미호출)

import { readFileSync } from 'node:fs';

const SERVER_MJS_PATH = '/home/user/webapp/nlq-server/server.mjs';
const INDEX_HTML_PATH = '/home/user/webapp/nlq-server/public/index.html';
const serverMjs = readFileSync(SERVER_MJS_PATH, 'utf8');
const indexHtml = readFileSync(INDEX_HTML_PATH, 'utf8');

let passed = 0, failed = 0;
const failures = [];
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; failures.push(msg); console.error('  ✗ ' + msg); }
}

// ─────────────────────────────────────────────────────────────────
// [1] 서버: 힌트 alias '개당 단가' 통일
// ─────────────────────────────────────────────────────────────────
console.log('[1] 서버 프롬프트 힌트 - alias 표준화');

// 4컬럼 세트 힌트 (SPECIFIC 분기, L4802) 에 '개당 단가' 사용
assert(
  /AS\s+'개당 단가'/.test(serverMjs),
  "서버 힌트에 AS '개당 단가' alias 사용 (요구사항 #1)"
);
// GENERIC 분기 (L4848) 에도 '개당 단가' 사용 - 2군데 이상 매칭
{
  const matches = serverMjs.match(/AS\s+'개당 단가'/g) || [];
  assert(
    matches.length >= 2,
    `AS '개당 단가' 는 SPECIFIC + GENERIC 두 힌트 분기에 모두 있어야 함 (matched=${matches.length})`
  );
}

// 이전 표준 alias '원가 단가' (단독) 가 SPECIFIC/GENERIC 힌트의 SELECT 절 예시에서
// 여전히 남아있는지 확인 → 있으면 힌트 표준화가 완전하지 않다는 뜻
{
  // AS '원가 단가' 형태로 남은 곳
  //   - Delta 분기의 '전월 원가 단가' / '당월 원가 단가' / '원가 단가 증가액' 은 기간/증감을
  //     명시하는 라벨이라 그대로 유지 (요구사항 #6: 계산식 유지, 명칭은 '개당 단가' 통일이
  //     기본 조회에만 적용됨).
  //   → 단독 AS '원가 단가' 는 제거되어야 함.
  const bareOldAlias = serverMjs.match(/AS\s+'원가 단가'(?!\s*증가액)/g) || [];
  assert(
    bareOldAlias.length === 0,
    `이전 단독 AS '원가 단가' 는 SPECIFIC/GENERIC 힌트에서 '개당 단가' 로 교체돼야 함 (found=${bareOldAlias.length})`
  );
}

// 계산식 유지 (요구사항 #2): ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) 형태
assert(
  /ROUND\(SUM\(TOTAL\)\s*\/\s*NULLIF\(SUM\(LBKUM\),\s*0\),\s*0\)\s*AS\s+'개당 단가'/.test(serverMjs),
  "계산식 ROUND(SUM(TOTAL)/NULLIF(SUM(LBKUM),0),0) 은 그대로 유지 (요구사항 #2)"
);

// 계산 근거 컬럼 순서 유지 (요구사항 #6): 총액 → 수량 → 단위 → 개당 단가
//   SPECIFIC 4컬럼 힌트 안에서 순서 검증 - 대괄호 이스케이프 필수
{
  const specificHintMatch = serverMjs.match(
    /★ 제품별 원가 조회 — 4컬럼 세트 필수[\s\S]*?\[중요 규칙\]/
  );
  assert(specificHintMatch, '4컬럼 세트 힌트 블록 파싱 가능');
  if (specificHintMatch) {
    const block = specificHintMatch[0];
    const idxTotal = block.search(/'원가 총액/);
    const idxQty = block.search(/'생산수량'/);
    const idxUom = block.search(/'단위'/);
    const idxUnitPrice = block.search(/'개당 단가'/);
    assert(idxTotal > 0 && idxQty > idxTotal && idxUom > idxQty && idxUnitPrice > idxUom,
      `SPECIFIC 4컬럼 힌트 순서: 원가 총액(${idxTotal}) → 생산수량(${idxQty}) → 단위(${idxUom}) → 개당 단가(${idxUnitPrice})`);
  }
}

// ─────────────────────────────────────────────────────────────────
// [2] 서버 검증 로직: COST_ALIAS_SIGNAL_RE 에 '개당 단가' 포함
// ─────────────────────────────────────────────────────────────────
console.log('[2] 서버 SQL 무결성 검증 - 개당 단가 alias 검증 대상 포함');

assert(
  /COST_ALIAS_SIGNAL_RE\s*=\s*\/[^\/]*개당\\s\*단가/.test(serverMjs),
  "COST_ALIAS_SIGNAL_RE 정규식에 '개당\\s*단가' 포함 (검증 대상 alias)"
);

// ─────────────────────────────────────────────────────────────────
// [3] 프론트: isUnitPriceColumn 함수 존재
// ─────────────────────────────────────────────────────────────────
console.log('[3] 프론트 isUnitPriceColumn 함수 정의');

assert(
  /function\s+isUnitPriceColumn\s*\(\s*col\s*,\s*label\s*\)/.test(indexHtml),
  'isUnitPriceColumn(col, label) 함수 정의 존재'
);
// 표준 alias '개당 단가' 매칭
assert(
  /개당\\s\*단가/.test(indexHtml),
  "isUnitPriceColumn 이 '개당 단가' 를 매칭하는 정규식 포함"
);
// 과거 호환: '원가 단가' 등 alias 도 매칭
{
  const fnMatch = indexHtml.match(/function\s+isUnitPriceColumn[\s\S]*?\n\}/);
  assert(fnMatch, 'isUnitPriceColumn 함수 본문 파싱 가능');
  if (fnMatch) {
    const body = fnMatch[0];
    assert(/원가/.test(body) && /단가/.test(body),
      "isUnitPriceColumn 이 '원가 단가' 등 과거 호환 alias 도 매칭 (이력 재열람 대비)");
    // 오탐 방지: 'delta' 시그널이 함께 있으면 매칭 안 하도록 (negative lookahead)
    assert(/증가|감소|증감|차이|변동|상승|하락/.test(body),
      "isUnitPriceColumn 에 delta 시그널 배제 정규식 (오탐 방지)");
  }
}

// ─────────────────────────────────────────────────────────────────
// [4] 프론트: unitPriceColIdxSet 계산 및 area 게이팅
// ─────────────────────────────────────────────────────────────────
console.log('[4] unitPriceColIdxSet 계산 로직 및 area 게이팅');

// buildAnalysisDetailTable 내부에 unitPriceColIdxSet 계산
assert(
  /const\s+unitPriceColIdxSet\s*=\s*new\s+Set\(\)/.test(indexHtml),
  'buildAnalysisDetailTable / initAnalysisDetailTable 안에 unitPriceColIdxSet 계산'
);
// _mfgUnitPriceHighlight 플래그 (area 게이팅)
assert(
  /_mfgUnitPriceHighlight/.test(indexHtml),
  '_mfgUnitPriceHighlight 플래그로 area 게이팅 (제조원가만 활성)'
);
// widenable 재사용 - showWidenButton 이 area === manufacturing-cost 신호이므로 그대로 재사용
assert(
  /_mfgUnitPriceHighlight\s*=\s*!!showWidenButton/.test(indexHtml),
  '_mfgUnitPriceHighlight = !!showWidenButton (동일 area 게이팅 재사용)'
);
// delta 우선 게이팅
{
  // deltaColIdxSet 에 이미 있는 컬럼은 unit-price 로 추가하지 않음
  const buildLogicMatch = indexHtml.match(
    /if\s*\(\s*_mfgUnitPriceHighlight\s*\)\s*\{[\s\S]*?unitPriceColIdxSet\.add\(idx\)[\s\S]*?\}\);/
  );
  assert(buildLogicMatch, 'buildAnalysisDetailTable 에서 unitPriceColIdxSet.add 로직 파싱');
  if (buildLogicMatch) {
    assert(/deltaColIdxSet\.has\(idx\)/.test(buildLogicMatch[0]),
      '이미 delta 로 판정된 컬럼은 unit-price 로 중복 추가하지 않음 (delta 우선)');
  }
}
// state 에 저장 (initAnalysisDetailTable)
assert(
  /unitPriceColIdxSet:\s*unitPriceColIdxSet/.test(indexHtml),
  'analysisTableState[tableId].unitPriceColIdxSet 로 저장 (renderer 접근용)'
);

// ─────────────────────────────────────────────────────────────────
// [5] 프론트: 헤더/셀 연한 노란색 강조 스타일
// ─────────────────────────────────────────────────────────────────
console.log('[5] 연한 노란색 강조 스타일');

// 헤더 배경: #fef9c3 (Tailwind yellow-100)
assert(
  /isUnitPrice[\s\S]{0,200}background[^;]*#fef9c3/.test(indexHtml) ||
    /thBg\s*=\s*['"]#fef9c3['"]/.test(indexHtml),
  '헤더 배경색: 연한 노란색 (#fef9c3)'
);
// 헤더 텍스트: 진한 노랑/갈색 톤 (#854d0e)
assert(
  /#854d0e/.test(indexHtml),
  '헤더 텍스트색: 진한 노랑/갈색 (#854d0e) - 가독성 확보'
);
// 상단 border 강조 (연한 금색 계열)
assert(
  /border-top:2px solid #eab308/.test(indexHtml),
  '헤더 상단 2px border (#eab308) - delta 컬럼 처럼 시각 구분'
);
// 셀 배경 스타일 상수
assert(
  /unitPriceCellBase\s*=\s*cellStyle/.test(indexHtml),
  'unitPriceCellBase 셀 스타일 상수 정의'
);
assert(
  /background:#fef9c3/.test(indexHtml),
  '셀 배경도 #fef9c3 (헤더와 동일 톤)'
);
// 숫자 포맷 유지: monospace + 우측 정렬
//   unitPriceCellBase 라인을 라인 단위로 찾음 (한 줄 전체)
{
  const lines = indexHtml.split('\n');
  const cellBaseLine = lines.find(l => /const\s+unitPriceCellBase\s*=/.test(l)) || '';
  assert(cellBaseLine.length > 0, 'unitPriceCellBase 정의 라인 파싱');
  if (cellBaseLine) {
    assert(/text-align:right/.test(cellBaseLine), '셀 우측 정렬 (숫자 가독성)');
    assert(/monospace/.test(cellBaseLine), 'monospace 폰트 (숫자 정렬 정확)');
    assert(/background:#fef9c3/.test(cellBaseLine), '연한 노란 배경 (#fef9c3)');
  }
}

// ─────────────────────────────────────────────────────────────────
// [6] delta 컬럼과의 우선순위: delta > unit-price
// ─────────────────────────────────────────────────────────────────
console.log('[6] delta 컬럼과의 우선순위');

// 렌더러: isUnitPrice = !isDelta && unitPriceSet.has(colIdx)
assert(
  /isUnitPrice\s*=\s*!isDelta\s*&&\s*unitPriceSet\.has/.test(indexHtml),
  'renderAnalysisTable: isUnitPrice = !isDelta && unitPriceSet.has(colIdx) - delta 우선'
);
// 헤더도 delta 우선
assert(
  /const\s+isUnitPrice\s*=\s*!isDelta\s*&&\s*unitPriceColIdxSet\.has/.test(indexHtml),
  '헤더도 delta 우선 (isUnitPrice = !isDelta && unitPriceColIdxSet.has(i))'
);

// ─────────────────────────────────────────────────────────────────
// [7] data-* attribute: 자동화 테스트/디버깅 지원
// ─────────────────────────────────────────────────────────────────
console.log('[7] data-unit-price-col attribute');

assert(
  /data-unit-price-col="\$\{isUnitPrice \? '1' : '0'\}"/.test(indexHtml),
  '헤더 <th> 에 data-unit-price-col="1|0" attribute 추가 (자동화 테스트/CSS 훅)'
);

// ─────────────────────────────────────────────────────────────────
// [8] 컬럼 순서 하드코딩 금지 (요구사항 #4)
// ─────────────────────────────────────────────────────────────────
console.log('[8] 컬럼 index 하드코딩 금지 검증');

// unitPriceColIdxSet 계산 로직에 특정 index 상수가 없어야 함
{
  const buildFnMatch = indexHtml.match(
    /if\s*\(\s*_mfgUnitPriceHighlight\s*\)\s*\{([\s\S]*?)\n\s{4}\}/
  );
  if (buildFnMatch) {
    const body = buildFnMatch[1];
    // idx === 5 같은 하드코딩이 없어야 함
    assert(!/idx\s*===?\s*\d+/.test(body),
      "buildAnalysisDetailTable 의 unit-price 감지 로직에 특정 index 하드코딩 없음 (예: idx===5)");
    // isUnitPriceColumn 함수 호출로 이름 기반 매칭
    assert(/isUnitPriceColumn\s*\(/.test(body),
      "isUnitPriceColumn(c, label) 이름 기반 매칭 (index 하드코딩 대신)");
  }
}

// ─────────────────────────────────────────────────────────────────
// [9] area 게이팅 확인: 수익성분석 미적용
// ─────────────────────────────────────────────────────────────────
console.log('[9] 수익성분석/기타 area 미적용 확인');

// buildAnalysisDetailTable 호출부 (analysis route L~5049) 에는 9번째 인자 없음
{
  // "buildAnalysisDetailTable(tableId, rows, columnOrder, columnLabels, rowCount, sql, fromHistory, periodInfo)"
  //   ← 8-인자 호출 (analysis route) 이 여전히 존재해야 함
  const has8ArgCall = /buildAnalysisDetailTable\(tableId,\s*rows,\s*columnOrder,\s*columnLabels,\s*rowCount,\s*sql,\s*fromHistory,\s*periodInfo\)/.test(indexHtml);
  assert(has8ArgCall, '분석질문 route (appendAnalysisOnlyMessage) 는 8-인자 호출 유지 → showWidenButton undefined → 강조 비활성');
}

// aggregate route (제조원가) 에서만 _mfgShowWidenBtn 이 area 로 결정
assert(
  /_mfgShowWidenBtn\s*=\s*\(_areaForWiden\s*===\s*['"`]manufacturing-cost['"`]\)/.test(indexHtml),
  "aggregate route: _mfgShowWidenBtn = area === 'manufacturing-cost' (제조원가 게이팅)"
);

// ─────────────────────────────────────────────────────────────────
// 결과
// ─────────────────────────────────────────────────────────────────
console.log('');
console.log('─'.repeat(60));
console.log(`Total: ${passed + failed} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log('\n실패 항목:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
} else {
  console.log('✓ 모든 검증 통과 - 개당 단가 alias 표준화 + UI 강조 정상');
  process.exit(0);
}
