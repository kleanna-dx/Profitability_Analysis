// ============================================================
// [PR #339 / 2026-08-04] 수익성분석 ↔ 제조원가 테이블 접근 분리 회귀 테스트
// ------------------------------------------------------------
//  배경:
//   PR #328 에서 신규 제조원가 테이블 `sys_aimd_cot015` 가 생성되었고
//   PR #331 / #332 로 RFC 인터페이스(NLP_RFC_002) 가 `sys_aimd_cot015`
//   에 적재하도록 구성되었다.
//
//   자연어질의(NLQ) 파이프라인은 **수익성분석 영역에서만 동작**하도록
//   설계되어 있으며, 제조원가 테이블 `sys_aimd_cot015` 는
//   RFC 적재 로직 이외의 곳에서는 참조되면 안 된다.
//
//   본 테스트는 리팩터링 / LLM 프롬프트 튜닝 / RAG 인덱서 개편 등으로
//   무심코 `sys_aimd_cot015` 가 자연어질의(SQL 생성/검증/실행) 경로에
//   섞여 들어가는 것을 원천 차단하기 위한 static-code 회귀 테스트다.
//
//   ※ 이 테스트는 DB 연결 / OpenAI 호출 없이 파일 문자열만 검사하므로
//     CI 어디서나 실행 가능하다.
//
//  검증 항목:
//   1. RAG 스키마 인덱서 (rag.mjs) 는 `bw_profitability_data` 만 인덱싱하고
//      `sys_aimd_cot015` 는 절대 참조하지 않는다.
//   2. NLQ SQL 생성 시스템 프롬프트 (server.mjs 의 TABLE_SCHEMA / 핵심 규칙
//      / analysisSqls 프롬프트) 는 `bw_profitability_data` 만 언급하고
//      `sys_aimd_cot015` 를 언급하지 않는다.
//   3. 분석용 보조 SQL 검증 로직은 `bw_profitability_data` 를 참조하지
//      않는 SQL 을 실행 대상에서 제외한다 (implicit deny 로 cot015 차단).
//   4. `applyDomainFilter` 는 `bw_profitability_data` 를 참조하는 SQL 에만
//      DIVISION 조건을 주입한다 (cot015 SQL 에는 영향 없음).
//   5. `server.mjs` 내에서 `sys_aimd_cot015` 를 참조하는 유일한 곳은
//      RFC 인터페이스 라우팅 블록(EXPECTED_INTERFACE_MAPPING / 관련 주석) 뿐이며,
//      NLQ / RAG / analysisSqls / applyDomainFilter / SQL validator 등
//      질의 파이프라인에는 존재하지 않는다.
//
//  실행:  node _test_profitability_cot015_isolation.mjs
// ============================================================

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let pass = 0;
let fail = 0;

function assert(name, cond, detail) {
  if (cond) {
    pass++; console.log(`  ✓ ${name}`);
  } else {
    fail++; console.log(`  ✗ ${name}`);
    if (detail) console.log(`    ${detail}`);
  }
}

// ------------------------------------------------------------
// 파일 로드
// ------------------------------------------------------------
const RAG_MJS_PATH    = path.resolve(__dirname, 'rag.mjs');
const SERVER_MJS_PATH = path.resolve(__dirname, 'server.mjs');

const ragSrc    = fs.readFileSync(RAG_MJS_PATH, 'utf-8');
const serverSrc = fs.readFileSync(SERVER_MJS_PATH, 'utf-8');

// 주석과 문자열을 분리해서 검사하기 위해 각각 유지.
// server.mjs 는 파일이 커서 라인 단위로 인덱싱한다.
const serverLines = serverSrc.split('\n');

// ────────────────────────────────────────────────────────────
// 1. RAG 스키마 인덱서 → bw_profitability_data 만 인덱싱
// ────────────────────────────────────────────────────────────
console.log('\n━━━ [Group 1] rag.mjs 스키마 인덱서 ━━━');
{
  // getSchemaColumns 함수 본문 안에 TABLE_NAME = 'bw_profitability_data' 존재
  const hasBwOnlyFilter =
    /TABLE_NAME\s*=\s*'bw_profitability_data'/i.test(ragSrc);
  assert(
    '1-1) getSchemaColumns 는 TABLE_NAME=\'bw_profitability_data\' 필터 유지',
    hasBwOnlyFilter,
    '스키마 컬럼 로딩 필터가 변경되면 다른 테이블 컬럼이 RAG 컨텍스트에 섞임'
  );

  // rag.mjs 안에서 sys_aimd_cot015 문자열이 아예 등장하지 않아야 함
  const cot015InRag = /sys_aimd_cot015/i.test(ragSrc);
  assert(
    '1-2) rag.mjs 어디에도 sys_aimd_cot015 참조가 없음',
    !cot015InRag,
    'RAG 인덱스가 제조원가 테이블을 로딩하면 NLQ 프롬프트에 cot015 스키마가 주입됨'
  );
}

// ────────────────────────────────────────────────────────────
// 2. NLQ SQL 생성 프롬프트 - bw_profitability_data 만 언급
// ────────────────────────────────────────────────────────────
console.log('\n━━━ [Group 2] NLQ 시스템 프롬프트 (TABLE_SCHEMA / 핵심규칙 / analysisSqls) ━━━');
{
  // (a) TABLE_SCHEMA 상수: "테이블명: bw_profitability_data" 로 시작해야 함
  const schemaHeader = /const\s+TABLE_SCHEMA\s*=\s*`\s*[\r\n]+테이블명:\s*bw_profitability_data\b/.test(serverSrc);
  assert(
    '2-1) TABLE_SCHEMA 상수 헤더가 "테이블명: bw_profitability_data" 로 시작',
    schemaHeader,
    'TABLE_SCHEMA 헤더 테이블명이 바뀌면 LLM 이 다른 테이블로 SQL 을 생성함'
  );

  // (b) 핵심 규칙 문구: "테이블은 bw_profitability_data 하나만 사용" 유지
  const singleTableRule = /테이블은\s*bw_profitability_data\s*하나만\s*사용/.test(serverSrc);
  assert(
    '2-2) 핵심 규칙에 "테이블은 bw_profitability_data 하나만 사용" 문구 유지',
    singleTableRule,
    '핵심 규칙 문구가 사라지면 LLM 이 임의 테이블 이름을 SQL 에 넣을 여지가 생김'
  );

  // (c) analysisSqls 프롬프트: "단일 테이블 bw_profitability_data 만 사용" 유지
  const analysisSingleTable = /단일\s*테이블\s*bw_profitability_data\s*만\s*사용/.test(serverSrc);
  assert(
    '2-3) analysisSqls 프롬프트에 "단일 테이블 bw_profitability_data 만 사용" 문구 유지',
    analysisSingleTable,
    '분석형 보조 SQL 이 다른 테이블로 흘러갈 위험'
  );
}

// ────────────────────────────────────────────────────────────
// 3. 분석용 보조 SQL 후처리: bw_profitability_data 미참조 SQL 차단
// ────────────────────────────────────────────────────────────
console.log('\n━━━ [Group 3] analysisSqls 후처리 (implicit deny for cot015) ━━━');
{
  // if (!/\bbw_profitability_data\b/i.test(sql)) { continue; } 패턴 유지
  // → 즉 LLM 이 실수로 sys_aimd_cot015 SELECT 를 생성해도 실행 대상에서 제외
  const denyBlock =
    /!\/\\bbw_profitability_data\\b\/i\.test\(sql\)/.test(serverSrc);
  assert(
    '3-1) analysisSqls 결과 필터에 !/\\bbw_profitability_data\\b/i.test(sql) 가드 존재',
    denyBlock,
    'LLM 이 cot015 SELECT 를 생성해도 실행되지 않도록 하는 마지막 방벽'
  );
}

// ────────────────────────────────────────────────────────────
// 4. applyDomainFilter: bw_profitability_data 미참조 SQL 은 그대로 통과 (cot015 SQL 에 DIVISION 조건 주입 안 함)
// ────────────────────────────────────────────────────────────
console.log('\n━━━ [Group 4] applyDomainFilter 대상 테이블 게이트 ━━━');
{
  // 함수 본문 안에 아래 short-circuit 이 존재해야 함:
  //   if (!/\bbw_profitability_data\b/i.test(inputSql)) return inputSql;
  const startIdx = serverSrc.indexOf('function applyDomainFilter(');
  assert('4-0) applyDomainFilter 함수 정의 존재', startIdx >= 0);
  if (startIdx >= 0) {
    // 함수 본문(넉넉히 4KB) 안에 short-circuit 존재 검사
    const fnBody = serverSrc.slice(startIdx, startIdx + 4000);
    const hasShortCircuit =
      /!\/\\bbw_profitability_data\\b\/i\.test\(inputSql\)/.test(fnBody);
    assert(
      '4-1) applyDomainFilter 는 bw_profitability_data 미참조 SQL 을 그대로 통과',
      hasShortCircuit,
      'DIVISION 조건이 cot015 SQL 에 잘못 주입되는 것을 막는 게이트'
    );
  }
}

// ────────────────────────────────────────────────────────────
// 5. server.mjs 안의 sys_aimd_cot015 참조 위치는 RFC 라우팅 블록에만 존재
// ────────────────────────────────────────────────────────────
console.log('\n━━━ [Group 5] server.mjs 안의 sys_aimd_cot015 참조 위치 감사 ━━━');
{
  // 라인 번호별 참조 위치 수집
  const cot015Lines = [];
  serverLines.forEach((line, idx) => {
    if (/sys_aimd_cot015/.test(line)) {
      cot015Lines.push({ line: idx + 1, text: line.trim() });
    }
  });

  // (a) 예상: 참조는 존재하되 모두 "RFC 라우팅 블록" 안에 있어야 함.
  //     현재 (PR #331/#332) 시점 기준 4곳:
  //       ① EXECUTE 라우팅 주석 (NLP_RFC_002 소개)
  //       ② Spring Boot 분기 처리 주석
  //       ③ EXPECTED_INTERFACE_MAPPING 상수 값
  //       ④ 인터페이스 이력관리 UI 표시 관련 주석
  //     라인 수는 그때그때 변할 수 있으니 라인 수치는 assert 하지 않고
  //     "각 참조가 RFC 라우팅 코드 블록 안에 있는지" 만 확인한다.
  assert(
    '5-1) sys_aimd_cot015 참조가 존재 (RFC 라우팅 블록 안, ≥1건)',
    cot015Lines.length >= 1,
    '테이블이 아직 존재하는데 코드에서 완전히 사라졌다면 RFC 라우팅 자체가 깨진 것'
  );

  // (b) EXPECTED_INTERFACE_MAPPING 상수 안에 정확한 매핑 존재
  //     'NLP_RFC_002': { rfc_name: 'Z_BI_WEB_EX_BL_4', target_table: 'sys_aimd_cot015' ...
  const mappingLine = cot015Lines.find(r =>
    /'NLP_RFC_002'\s*:\s*\{[^}]*target_table\s*:\s*'sys_aimd_cot015'/.test(r.text)
  );
  assert(
    '5-2) EXPECTED_INTERFACE_MAPPING 에 NLP_RFC_002 → sys_aimd_cot015 매핑 유지',
    !!mappingLine,
    'RFC 실행 직전 매핑 검증 게이트가 깨졌음을 의미'
  );

  // (c) 참조 위치가 NLQ / RAG / analysisSqls / applyDomainFilter / SQL validator
  //     같은 자연어질의 파이프라인 근처에 존재하면 안 됨.
  //     간단한 heuristic: 각 참조 라인의 ±50 라인 창(window)에
  //     NLQ 파이프라인 심볼이 등장하는지 검사한다.
  const NLQ_PIPELINE_SYMBOLS = [
    'app.post(\'/api/nlq',
    'buildAggregationSqlFromPlan',
    'generateAnalysisSqls',
    'validateSqlPreExecution',
    'applyDomainFilter',
    'applyMetricFormulaReplacement',
    'normalizeDivisionFilter',
    'searchRelevantMeta',
    'buildRagIndex',
  ];

  const winSize = 50;
  let contaminated = [];
  for (const ref of cot015Lines) {
    const from = Math.max(0, ref.line - 1 - winSize);
    const to   = Math.min(serverLines.length, ref.line - 1 + winSize + 1);
    const window = serverLines.slice(from, to).join('\n');
    for (const sym of NLQ_PIPELINE_SYMBOLS) {
      if (window.includes(sym)) {
        contaminated.push({ line: ref.line, symbol: sym, text: ref.text });
        break;
      }
    }
  }

  assert(
    '5-3) sys_aimd_cot015 참조가 NLQ 파이프라인 심볼 근처(±50줄)에 존재하지 않음',
    contaminated.length === 0,
    contaminated.length > 0
      ? `오염 감지:\n${contaminated.map(c => `      L${c.line} near "${c.symbol}" → ${c.text}`).join('\n')}`
      : ''
  );

  // 참고용 로그 (실제 참조 목록 출력)
  console.log(`    [참고] server.mjs 안 sys_aimd_cot015 참조 ${cot015Lines.length}건:`);
  for (const r of cot015Lines) {
    console.log(`      L${r.line}: ${r.text.slice(0, 140)}`);
  }
}

// ────────────────────────────────────────────────────────────
// 총평
// ────────────────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  결과:  통과 ${pass}건 / 실패 ${fail}건`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (fail > 0) {
  console.error('\n[FAIL] 수익성분석 ↔ 제조원가 테이블 분리 회귀 테스트가 실패했습니다.');
  console.error('       자연어질의 파이프라인이 sys_aimd_cot015 를 참조할 위험이 있는지');
  console.error('       위 실패 항목을 확인하세요.\n');
  process.exit(1);
}
console.log('\n[PASS] 자연어질의 파이프라인은 bw_profitability_data 만 사용하며,');
console.log('       sys_aimd_cot015 는 RFC 라우팅 블록에서만 참조됩니다.\n');
