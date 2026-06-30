// ============================================================
// [2026-06-30] 후속 질문 의도(intent) 분류 + 핸들러 모듈
// ------------------------------------------------------------
// 목적:
//   기존 /api/nlq 는 사용자가 라디오에서 선택한 두 가지 모드
//   (aggregate=현황집계 / analysis=분석질문) 만 지원했음.
//   사용자 요구: 라디오는 유지하되, 실제 질문 의도가 다음 8가지 중
//   어느 것인지 자동 판별하여 적절한 답변을 돌려줘야 함:
//     1) data_query        — 표 조회 (기존 현황집계 경로)
//     2) analysis          — 분석/요약/시사점 (기존 분석질문 경로)
//     3) metric_lookup     — "X 의 산식이 뭔데?" (Metric 사전 조회)
//     4) ontology_lookup   — "X 컬럼은 뭘 의미해?" (Ontology 사전 조회)
//     5) troubleshooting   — "왜 데이터가 안 나와?" (직전 SQL 진단)
//     6) sql_explain       — "이 SQL 무슨 뜻이야?" (직전 SQL 절별 설명)
//     7) domain_explain    — "PS 도메인은 뭐야?" (도메인 + DIVISION 안내)
//     8) general_chat      — 시스템 사용법 / FAQ (잡담은 거절)
//
//   3-tier 분류기:
//     Tier 1: 휴리스틱(정규식) — 0ms, 명확한 패턴 즉시 분류
//     Tier 2: LLM 분류        — ~500ms, 휴리스틱 미매칭 시
//     Tier 3: Fallback        — 라디오 선택값(aggregate→data_query / analysis→analysis)
//
// 사용법 (server.mjs):
//   import { initConversationalIntent } from './conversational_intent.mjs';
//   const ci = initConversationalIntent({ pool, openai, GPT_MODEL, applyDomainFilter });
//   const { intent, confidence, tier } = await ci.classifyConversationalIntent(query, ctx, queryMode);
//   if (intent === 'metric_lookup') {
//     const resp = await ci.handleMetricLookup(query, activeDomain, ctx);
//     return res.json(resp);
//   }
//
// 응답 표준 JSON 포맷:
//   {
//     success: true,
//     intent: 'metric_lookup',
//     intentLabel: 'Metric 산식 조회',
//     answer: '...',                  // 자연어 답변 (마크다운 가능)
//     answerType: 'conversational',   // 'conversational' | 'sql_result' | 'analysis'
//     isAnalysisAnswer: true,         // 프론트엔드에서 표/차트 영역 숨김 처리
//     referenced: {...},              // 핸들러별 참조 데이터(디버그/배지용)
//     suggestedMode: null,            // 라디오↔intent 미스매치 안내문 ('aggregate'|'analysis'|null)
//     suggestedModeMessage: null,     // 미스매치 안내 텍스트
//     rows: [], sql: null,
//     chartType: 'analysis',
//   }
// ============================================================

// ------------------------------------------------------------
// intent → 한글 라벨 매핑 (배지/로그/UI 표시용)
// ------------------------------------------------------------
export const INTENT_LABELS = {
  data_query:      'DB 조회 (표)',
  analysis:        '분석/요약',
  metric_lookup:   'Metric 산식 조회',
  ontology_lookup: '컬럼/용어 설명',
  troubleshooting: '오류 진단',
  sql_explain:     'SQL 설명',
  domain_explain:  '도메인 설명',
  general_chat:    '시스템 안내',
};

// ------------------------------------------------------------
// Tier 1: 휴리스틱 정규식 분류
// ------------------------------------------------------------
// 명확하게 패턴이 잡히는 케이스만 즉시 분류.
// 애매하면 null 을 돌려 Tier 2(LLM) 로 넘긴다.
//
// 분류 우선순위 (앞쪽 매칭이 우선):
//   1) troubleshooting — "왜 X 안 X" / "에러" / "조회가 안 돼" / "이상해"
//   2) sql_explain     — "이 SQL" / "방금 만든 SQL" / "쿼리 설명"
//   3) metric_lookup   — "산식" / "공식" / "Metric" / "지표 정의"
//   4) ontology_lookup — "X 컬럼" / "X 의미" / "동의어" / "용어"
//   5) domain_explain  — "PS/HL/MGMT 도메인" / "분석 영역"
//   6) general_chat    — "사용법" / "어떻게 써" / "FAQ" / "도움말"
//   7) analysis        — "분석" / "시사점" / "왜" / "어떻게 해석"
//   8) data_query      — "TOP" / "조회" / "건수" / "합계"
// ------------------------------------------------------------
export function classifyConversationalIntentHeuristic(query) {
  if (!query || typeof query !== 'string') return null;
  const q = query.trim();
  if (q.length === 0) return null;
  const ql = q.toLowerCase();

  // 1) troubleshooting — "왜 ~ 안 나와/없어/조회 안돼/이상"
  //    + "에러", "오류", "왜 X은 데이터가 있는데 조회가 안돼"
  if (
    /왜.*(안\s*(나|되|돼|보이|뜨)|없|이상|틀)/.test(q) ||
    /(데이터|결과|값).*(없|안\s*나|안\s*보|빠졌|누락)/.test(q) ||
    /(조회|쿼리|SQL).*(안\s*(되|돼)|실패|에러|오류)/i.test(q) ||
    /(에러|오류|exception|error).*(났|발생|뭐)/i.test(q) ||
    /이상한데|이상해/.test(q)
  ) {
    return 'troubleshooting';
  }

  // 2) sql_explain — "이 SQL/쿼리 무슨 뜻", "방금 SQL 설명"
  if (
    /(이|방금|위|직전|아까|만든).*(SQL|쿼리).*(설명|뭐|뜻|의미|왜|어떻게)/i.test(q) ||
    /(SQL|쿼리).*(설명해|풀어|뜯어|해석)/i.test(q) ||
    /^(SQL|쿼리)\s*(설명|해석)/i.test(q)
  ) {
    return 'sql_explain';
  }

  // 3) metric_lookup — "X 산식", "X 공식", "Metric X"
  //    예) "HL 영업이익에 등록된 산식이 뭔데?"
  //    예) "영업이익 산식 알려줘"
  //    예) "ZAMT001 metric formula"
  if (
    /(산식|공식|계산식|수식|formula)/i.test(q) ||
    /(어떻게\s*계산|어떻게\s*구해|어떻게\s*나오)/.test(q) ||
    /(Metric|메트릭|지표).*(정의|뭐|뜻|어떻게)/i.test(q)
  ) {
    return 'metric_lookup';
  }

  // 4) ontology_lookup — "X 컬럼 의미", "X 용어", "동의어"
  if (
    /(컬럼|column).*(의미|뜻|뭐|설명)/i.test(q) ||
    /(동의어|약어|용어).*(뭐|어떤|있)/.test(q) ||
    /(.+?)(이|가)?\s*(뭐|뭔|무슨)\s*(의미|뜻)/.test(q) ||
    /(.+?)(은|는)\s*(무엇|뭐)/.test(q) && !/도메인/.test(q)
  ) {
    return 'ontology_lookup';
  }

  // 5) domain_explain — "PS/HL/MGMT 도메인", "분석 영역"
  if (
    /(PS|HL|MGMT).*(도메인|영역|뭐|설명|차이|의미)/i.test(q) ||
    /(분석\s*영역|도메인).*(뭐|어떤|차이|설명|종류)/.test(q) ||
    /도메인이\s*(뭐|뭔)/.test(q)
  ) {
    return 'domain_explain';
  }

  // 6) general_chat — 시스템 사용법/FAQ
  if (
    /(사용법|쓰는\s*법|어떻게\s*(써|사용|이용)|how to use)/i.test(q) ||
    /(FAQ|도움말|help|가이드|매뉴얼)/i.test(q) ||
    /(이\s*시스템|이\s*서비스|이\s*프로그램|이\s*챗봇|이\s*화면).*(뭐|어떤|무엇)/.test(q) ||
    /(어떤\s*질문|뭘\s*물어|무엇을\s*물어).*(할\s*수|가능)/.test(q)
  ) {
    return 'general_chat';
  }

  // 7) analysis — 분석/시사점/해석/원인
  if (
    /(분석|시사점|인사이트|insight|해석|원인|이유|왜\s*그)/i.test(q) ||
    /(요약|정리|총평|평가).*(해|줘|부탁)/.test(q) ||
    /(어떻게\s*보|어떻게\s*해석|판단)/.test(q)
  ) {
    return 'analysis';
  }

  // 8) data_query — TOP/건수/합계 등 명확한 데이터 조회
  if (
    /\bTOP\s*\d+/i.test(q) ||
    /(건수|개수|count|합계|총\s*합|총합|평균|sum|avg)/i.test(q) ||
    /(.+?)별\s*(.+?)\s*(조회|보여|줘|알려)/.test(q) ||
    /(매출|이익|손익|원가|비용|매출액).*(얼마|얼만큼|보여|조회|알려|줘)$/.test(q)
  ) {
    return 'data_query';
  }

  // 매칭 실패 → Tier 2 로 위임
  return null;
}

// ------------------------------------------------------------
// Tier 2: LLM 분류 (Tier 1 미매칭 시)
// ------------------------------------------------------------
// 짧은 시스템 프롬프트 + 직전 컨텍스트 1턴만 전달.
// 응답은 반드시 8개 intent 중 하나여야 하며, 그 외 응답은 null 처리.
// ------------------------------------------------------------
async function classifyConversationalIntentLLM(query, conversationContext, deps) {
  const { openai, GPT_MODEL } = deps;
  if (!query || typeof query !== 'string') return null;

  const lastTurn = Array.isArray(conversationContext) && conversationContext.length > 0
    ? conversationContext[conversationContext.length - 1]
    : null;
  const contextHint = lastTurn
    ? `직전 질문: ${lastTurn.query || ''}\n직전 SQL: ${(lastTurn.sql || '').substring(0, 200)}`
    : '(직전 대화 없음)';

  const systemPrompt = `당신은 사용자 질문의 의도(intent)를 8가지 중 하나로 분류하는 분류기입니다.

[분류 후보 — 정확히 이 영문 코드 하나만 출력]
- data_query        : 표/리스트 형태의 데이터 조회 (예: "PS TOP5 매출", "9월 영업이익", "고객별 건수")
- analysis          : 분석/시사점/해석/원인 분석 (예: "왜 이익이 감소했나", "수익성 분석해줘")
- metric_lookup     : Metric(지표)의 정의/산식/공식 조회 (예: "영업이익 산식 뭐야", "ZAMT001 공식")
- ontology_lookup   : 컬럼/용어의 의미·동의어 조회 (예: "DIVISION 컬럼 뭐야", "고객명 동의어")
- troubleshooting   : 직전 결과가 이상하다/오류/안 나옴 진단 (예: "왜 데이터가 없어?", "조회 안돼")
- sql_explain       : 방금/직전 SQL 의 의미·동작 설명 요청 (예: "이 SQL 설명해줘")
- domain_explain    : 도메인(PS/HL/MGMT) 자체에 대한 설명 (예: "PS는 뭐야?", "도메인 차이")
- general_chat      : 시스템 사용법/FAQ/도움말 (예: "어떻게 써?", "어떤 질문 가능?")

[직전 대화 컨텍스트]
${contextHint}

[규칙]
1. 위 8개 중 정확히 하나의 영문 코드만 출력 (예: data_query)
2. 설명/마침표/문장 절대 추가 금지
3. 애매하면 가장 가까운 코드 하나만 출력
4. 위 8개에 해당 안 되면 general_chat 출력`;

  try {
    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0,
      max_tokens: 20,
    });
    const raw = (completion.choices?.[0]?.message?.content || '').trim().toLowerCase();
    const allowed = ['data_query', 'analysis', 'metric_lookup', 'ontology_lookup',
                     'troubleshooting', 'sql_explain', 'domain_explain', 'general_chat'];
    // 응답 안에 8개 중 하나가 포함되어 있으면 그것을 채택
    for (const code of allowed) {
      if (raw.includes(code)) return code;
    }
    return null;
  } catch (e) {
    console.error('[ConversationalIntent] LLM 분류 실패:', e.message);
    return null;
  }
}

// ------------------------------------------------------------
// 통합 3-tier 분류기
// ------------------------------------------------------------
// 반환: { intent, confidence, tier }
//   - intent: 8개 중 하나
//   - confidence: 'high'(Tier1) | 'medium'(Tier2) | 'low'(Tier3 fallback)
//   - tier: 1 | 2 | 3
// ------------------------------------------------------------
export async function classifyConversationalIntent(query, conversationContext, userQueryMode, deps) {
  // Tier 1: 휴리스틱
  const heur = classifyConversationalIntentHeuristic(query);
  if (heur) {
    return { intent: heur, confidence: 'high', tier: 1 };
  }
  // Tier 2: LLM
  const llm = await classifyConversationalIntentLLM(query, conversationContext, deps);
  if (llm) {
    return { intent: llm, confidence: 'medium', tier: 2 };
  }
  // Tier 3: Fallback — 라디오 선택값 기반
  const fallback = (userQueryMode === 'analysis') ? 'analysis' : 'data_query';
  return { intent: fallback, confidence: 'low', tier: 3 };
}

// ------------------------------------------------------------
// 컨텍스트 추출 — 직전 1턴에서 활용 가능한 모든 필드 모음
// ------------------------------------------------------------
export function extractLastContext(conversationContext) {
  if (!Array.isArray(conversationContext) || conversationContext.length === 0) {
    return {
      hasContext: false,
      query: null, sql: null, domain: null,
      rowCount: null, filters: null, metricUsed: null,
      errorMessage: null, historyId: null, queryMode: null, timestamp: null,
    };
  }
  const last = conversationContext[conversationContext.length - 1] || {};
  return {
    hasContext: true,
    query:        last.query        || null,
    sql:          last.sql          || null,
    domain:       last.domain       || null,
    rowCount:     (typeof last.rowCount === 'number') ? last.rowCount : null,
    filters:      last.filters      || null,
    metricUsed:   last.metricUsed   || null,
    errorMessage: last.errorMessage || null,
    historyId:    last.historyId    || null,
    queryMode:    last.queryMode    || null,
    timestamp:    last.timestamp    || null,
  };
}

// ------------------------------------------------------------
// 표준 로깅 (requestId, intent, tier, history_id 등)
// ------------------------------------------------------------
export function logConversationalIntent(info) {
  const {
    requestId, query, userQueryMode, intent, confidence, tier,
    historyId, durationMs,
  } = info || {};
  const parts = [
    `[ConversationalIntent]`,
    `req=${requestId || '-'}`,
    `mode=${userQueryMode || '-'}`,
    `intent=${intent || '-'}`,
    `conf=${confidence || '-'}`,
    `tier=${tier || '-'}`,
  ];
  if (historyId !== undefined && historyId !== null) parts.push(`hist=${historyId}`);
  if (durationMs !== undefined && durationMs !== null) parts.push(`ms=${durationMs}`);
  if (query) parts.push(`q="${String(query).substring(0, 80).replace(/"/g, '\\"')}"`);
  console.log(parts.join(' '));
}

// ------------------------------------------------------------
// 라디오↔intent 미스매치 안내문 결정
// ------------------------------------------------------------
//  - aggregate(현황집계) 라디오인데 intent 가 analysis/metric_lookup 등 분석성이면
//    "분석질문 모드를 추천드립니다" 안내
//  - analysis(분석질문) 라디오인데 intent 가 data_query 면
//    "현황집계 모드를 추천드립니다" 안내
//  - 일치하거나 라디오와 무관한 intent(metric_lookup, troubleshooting 등 대화형)는
//    suggestedMode=null (안내 안 띄움)
// ------------------------------------------------------------
export function determineSuggestedMode(intent, userQueryMode) {
  // 대화형 intent (metric/ontology/troubleshooting/sql_explain/domain/general)
  // 는 라디오와 직접 매핑이 없으므로 안내 생략
  const conversational = new Set([
    'metric_lookup', 'ontology_lookup', 'troubleshooting',
    'sql_explain', 'domain_explain', 'general_chat',
  ]);
  if (conversational.has(intent)) {
    return { suggestedMode: null, suggestedModeMessage: null };
  }
  if (intent === 'analysis' && userQueryMode !== 'analysis') {
    return {
      suggestedMode: 'analysis',
      suggestedModeMessage:
        '이번 질문은 분석성 질문으로 보입니다. 상단의 "분석질문" 라디오를 선택하시면 더 풍부한 시사점을 받을 수 있습니다.',
    };
  }
  if (intent === 'data_query' && userQueryMode === 'analysis') {
    return {
      suggestedMode: 'aggregate',
      suggestedModeMessage:
        '이번 질문은 단순 데이터 조회로 보입니다. 상단의 "현황집계" 라디오를 선택하시면 표와 차트로 결과를 받을 수 있습니다.',
    };
  }
  return { suggestedMode: null, suggestedModeMessage: null };
}

// ------------------------------------------------------------
// 표준 응답 빌더
// ------------------------------------------------------------
export function buildConversationalResponse({
  intent,
  answer,
  referenced = null,
  userQueryMode = 'aggregate',
  requestId = null,
  extra = {},
}) {
  const intentLabel = INTENT_LABELS[intent] || intent;
  const { suggestedMode, suggestedModeMessage } = determineSuggestedMode(intent, userQueryMode);

  return {
    success: true,
    intent,
    intentLabel,
    answer: answer || '',
    answerType: 'conversational',
    isAnalysisAnswer: true,   // 프론트엔드에서 표/차트 영역 숨김
    referenced,
    suggestedMode,
    suggestedModeMessage,
    rows: [],
    sql: null,
    chartType: 'analysis',
    requestId,
    ...extra,
  };
}

// ============================================================
// 핸들러 1: handleMetricLookup
// ------------------------------------------------------------
// 예) "HL 영업이익에 등록된 산식이 뭔데?"
//
// 흐름:
//   1. query 에서 metric 키워드 추출 시도 (metric_code 직접 언급 / 한글명)
//   2. metric + metric_synonym JOIN 으로 후보 찾기 (domain_code=activeDomain)
//   3. formula 가 참조하는 ontology_column 한글명을 보완 결합
//   4. LLM 으로 자연어 답변 생성 (산식 + 의미 설명)
// ============================================================
export async function handleMetricLookup(query, activeDomain, conversationContext, deps) {
  const { pool, openai, GPT_MODEL } = deps;
  const dc = activeDomain || 'PS';

  // 1) metric 후보 검색 — synonym/description/metric_code 모두 부분매칭
  let candidates = [];
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT m.id, m.metric_code, m.aggregation, m.formula, m.description
       FROM metric m
       LEFT JOIN metric_synonym s ON s.metric_id = m.id
       WHERE m.domain_code = ?
         AND (
           m.metric_code = ?
           OR m.metric_code LIKE CONCAT('%', ?, '%')
           OR m.description LIKE CONCAT('%', ?, '%')
           OR s.synonym_text LIKE CONCAT('%', ?, '%')
         )
       ORDER BY
         CASE WHEN s.synonym_text IS NOT NULL THEN 0 ELSE 1 END,
         CHAR_LENGTH(COALESCE(s.synonym_text, m.description))
       LIMIT 5`,
      [dc, query.trim(), query.trim().substring(0, 20), query.trim().substring(0, 20), query.trim().substring(0, 20)]
    );
    candidates = rows || [];
  } catch (e) {
    console.error('[MetricLookup] DB 조회 실패:', e.message);
  }

  // 1-b) 후보가 없으면 동의어/설명을 풀어서 다시 시도 (사용자 질문에서 한글 단어 분리)
  if (candidates.length === 0) {
    const tokens = query.trim().split(/[\s,./()?!"'`~·]+/).filter(t => t && t.length >= 2);
    if (tokens.length > 0) {
      try {
        const orClauses = tokens.map(() => `(m.description LIKE CONCAT('%', ?, '%') OR s.synonym_text LIKE CONCAT('%', ?, '%'))`).join(' OR ');
        const params = [dc];
        for (const t of tokens) { params.push(t, t); }
        const [rows] = await pool.query(
          `SELECT DISTINCT m.id, m.metric_code, m.aggregation, m.formula, m.description
           FROM metric m
           LEFT JOIN metric_synonym s ON s.metric_id = m.id
           WHERE m.domain_code = ? AND (${orClauses})
           LIMIT 5`,
          params
        );
        candidates = rows || [];
      } catch (e) {
        console.error('[MetricLookup] 토큰 검색 실패:', e.message);
      }
    }
  }

  // 후보 0건 → 자연어 거절 (단순 에러 금지)
  if (candidates.length === 0) {
    return buildConversationalResponse({
      intent: 'metric_lookup',
      answer: `요청하신 지표(Metric)를 도메인 **${dc}** 에서 찾지 못했습니다.\n\n` +
              `다음 방법으로 다시 시도해 보세요:\n` +
              `- 정확한 한글 지표명으로 질문 (예: "영업이익 산식이 뭐야?")\n` +
              `- Metric 코드로 질문 (예: "ZAMT001 산식")\n` +
              `- 도메인을 다른 영역(PS/HL/MGMT)으로 바꾼 뒤 다시 시도`,
      referenced: { domain: dc, candidateCount: 0 },
    });
  }

  // 2) formula 에서 ontology_column 한글명 풀기 (단순 치환 — 사용자 가독성용)
  const formulaTokens = new Set();
  for (const c of candidates) {
    const f = c.formula || '';
    const matches = f.match(/[A-Z][A-Z0-9_]{2,}/g) || [];
    for (const m of matches) formulaTokens.add(m);
  }
  let columnNameMap = {};
  if (formulaTokens.size > 0) {
    try {
      const tokenList = Array.from(formulaTokens);
      const placeholders = tokenList.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT column_name, description FROM ontology_column
         WHERE domain_code = ? AND is_active = 1 AND column_name IN (${placeholders})`,
        [dc, ...tokenList]
      );
      for (const r of rows) {
        const desc = (r.description || '').split(',')[0].trim();
        if (desc) columnNameMap[r.column_name] = desc;
      }
    } catch (e) {
      console.error('[MetricLookup] ontology 한글명 조회 실패:', e.message);
    }
  }

  // 3) LLM 답변 생성
  const metricInfo = candidates.slice(0, 3).map(c => {
    const desc = (c.description || c.metric_code).split(',')[0].trim();
    const agg = (c.aggregation || '').toUpperCase();
    const formula = (c.formula || '').trim();
    const hasAggInside = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(formula);
    let sqlExpr;
    if (agg === 'CALC' || hasAggInside) sqlExpr = formula;
    else if (['SUM','AVG','COUNT','MAX','MIN'].includes(agg)) sqlExpr = `${agg}(${formula})`;
    else sqlExpr = formula;
    // 컬럼 한글명 보조 표기
    let humanFormula = sqlExpr;
    for (const [col, name] of Object.entries(columnNameMap)) {
      humanFormula = humanFormula.replace(new RegExp(`\\b${col}\\b`, 'g'), `${col}(${name})`);
    }
    return {
      metric_code: c.metric_code,
      description: desc,
      aggregation: agg || '(미지정)',
      sql_formula: sqlExpr,
      human_formula: humanFormula,
    };
  });

  let llmAnswer = '';
  try {
    const sysPrompt = `당신은 기업 수익성 분석 시스템의 도메인 안내 도우미입니다.
사용자가 특정 지표(Metric)의 산식·공식을 물어봤습니다.
아래 DB 정보를 토대로 **한국어**로 친절하고 명확하게 설명해 주세요.

[작성 규칙]
1. 가장 사용자 질문과 가까운 지표 한 개를 메인으로 설명
2. 산식은 **백틱(\`)으로 감싸서** SQL 식 그대로 보여줄 것
3. 산식 안의 컬럼이 한글명을 가지면 "ZAMT001(총매출)" 형태로 풀어줄 것
4. 집계방식(SUM/AVG/CALC 등)이 어떤 의미인지 짧게 설명
5. 추가로 비슷한 후보 지표가 있으면 마지막에 마크다운 리스트로 제시
6. 절대 추측하지 말 것. DB 에 없는 산식은 만들지 말 것
7. 코드 블록은 사용하지 말고 인라인 \`...\` 만 사용`;

    const usrPrompt = `[도메인] ${dc}
[사용자 질문] ${query}

[DB에서 찾은 후보 Metric (최대 3개)]
${JSON.stringify(metricInfo, null, 2)}

위 정보를 토대로 사용자 질문에 답하세요.`;

    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: usrPrompt },
      ],
      temperature: 0.2,
      max_tokens: 800,
    });
    llmAnswer = (completion.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('[MetricLookup] LLM 호출 실패:', e.message);
    // LLM 실패 시 fallback — DB 정보 그대로 표시
    const lines = [`도메인 **${dc}** 에서 찾은 지표 정보입니다:`, ''];
    for (const m of metricInfo) {
      lines.push(`- **${m.description}** (${m.metric_code})`);
      lines.push(`  - 산식: \`${m.sql_formula}\``);
      lines.push(`  - 집계: ${m.aggregation}`);
    }
    llmAnswer = lines.join('\n');
  }

  return buildConversationalResponse({
    intent: 'metric_lookup',
    answer: llmAnswer,
    referenced: { domain: dc, metrics: metricInfo, candidateCount: candidates.length },
  });
}

// ============================================================
// 핸들러 2: handleOntologyLookup
// ------------------------------------------------------------
// 예) "DIVISION 컬럼은 뭘 의미해?", "고객명 동의어는?"
// ============================================================
export async function handleOntologyLookup(query, activeDomain, conversationContext, deps) {
  const { pool, openai, GPT_MODEL } = deps;
  const dc = activeDomain || 'PS';

  // 1) ontology_column + ontology_synonym 후보 검색
  let candidates = [];
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT c.id, c.column_name, c.table_name, c.description, c.data_type
       FROM ontology_column c
       LEFT JOIN ontology_synonym s ON s.column_id = c.id
       WHERE c.domain_code = ? AND c.is_active = 1
         AND (
           c.column_name = ?
           OR c.column_name LIKE CONCAT('%', ?, '%')
           OR c.description LIKE CONCAT('%', ?, '%')
           OR s.synonym_text LIKE CONCAT('%', ?, '%')
         )
       ORDER BY
         CASE WHEN c.column_name = ? THEN 0 ELSE 1 END,
         CHAR_LENGTH(c.description)
       LIMIT 5`,
      [dc, query.trim(), query.trim().substring(0, 20),
       query.trim().substring(0, 20), query.trim().substring(0, 20),
       query.trim()]
    );
    candidates = rows || [];
  } catch (e) {
    console.error('[OntologyLookup] DB 조회 실패:', e.message);
  }

  // 1-b) 토큰 단위 재검색
  if (candidates.length === 0) {
    const tokens = query.trim().split(/[\s,./()?!"'`~·]+/).filter(t => t && t.length >= 2);
    if (tokens.length > 0) {
      try {
        const orClauses = tokens.map(() => `(c.description LIKE CONCAT('%', ?, '%') OR s.synonym_text LIKE CONCAT('%', ?, '%') OR c.column_name LIKE CONCAT('%', ?, '%'))`).join(' OR ');
        const params = [dc];
        for (const t of tokens) { params.push(t, t, t); }
        const [rows] = await pool.query(
          `SELECT DISTINCT c.id, c.column_name, c.table_name, c.description, c.data_type
           FROM ontology_column c
           LEFT JOIN ontology_synonym s ON s.column_id = c.id
           WHERE c.domain_code = ? AND c.is_active = 1 AND (${orClauses})
           LIMIT 5`,
          params
        );
        candidates = rows || [];
      } catch (e) {
        console.error('[OntologyLookup] 토큰 검색 실패:', e.message);
      }
    }
  }

  if (candidates.length === 0) {
    return buildConversationalResponse({
      intent: 'ontology_lookup',
      answer: `요청하신 컬럼/용어를 도메인 **${dc}** 에서 찾지 못했습니다.\n\n` +
              `다음 방법으로 다시 시도해 보세요:\n` +
              `- 정확한 컬럼명으로 질문 (예: "DIVISION 컬럼 뜻")\n` +
              `- 한글 동의어로 질문 (예: "고객명이 뭘 의미해?")\n` +
              `- 도메인을 다른 영역(PS/HL/MGMT)으로 바꾼 뒤 다시 시도`,
      referenced: { domain: dc, candidateCount: 0 },
    });
  }

  // 2) 각 후보에 대해 동의어 모음 조회
  const colIds = candidates.map(c => c.id);
  const synonymMap = {};
  if (colIds.length > 0) {
    try {
      const placeholders = colIds.map(() => '?').join(',');
      const [rows] = await pool.query(
        `SELECT column_id, synonym_text FROM ontology_synonym WHERE column_id IN (${placeholders})`,
        colIds
      );
      for (const r of rows) {
        if (!synonymMap[r.column_id]) synonymMap[r.column_id] = [];
        synonymMap[r.column_id].push(r.synonym_text);
      }
    } catch (e) {
      console.error('[OntologyLookup] 동의어 조회 실패:', e.message);
    }
  }

  const ontologyInfo = candidates.slice(0, 3).map(c => ({
    column_name: c.column_name,
    table_name:  c.table_name  || 'bw_profitability_data',
    description: (c.description || '').trim(),
    data_type:   c.data_type   || '',
    synonyms:    synonymMap[c.id] || [],
  }));

  // 3) LLM 자연어 답변
  let llmAnswer = '';
  try {
    const sysPrompt = `당신은 기업 수익성 분석 시스템의 도메인 안내 도우미입니다.
사용자가 특정 컬럼/용어의 의미를 물어봤습니다.
아래 DB 정보를 토대로 **한국어**로 친절하고 명확하게 설명해 주세요.

[작성 규칙]
1. 가장 가까운 컬럼 한 개를 메인으로 설명 (column_name, 한글명, 데이터타입, 동의어 목록)
2. 컬럼명은 \`백틱\`으로 감싸기
3. 동의어는 마크다운 리스트로 표시
4. 추가로 비슷한 후보가 있으면 마지막에 간단히 언급
5. DB 에 없는 내용을 추측하지 말 것`;

    const usrPrompt = `[도메인] ${dc}
[사용자 질문] ${query}

[DB에서 찾은 후보 컬럼 (최대 3개)]
${JSON.stringify(ontologyInfo, null, 2)}

위 정보를 토대로 사용자 질문에 답하세요.`;

    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: usrPrompt },
      ],
      temperature: 0.2,
      max_tokens: 700,
    });
    llmAnswer = (completion.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('[OntologyLookup] LLM 호출 실패:', e.message);
    const lines = [`도메인 **${dc}** 에서 찾은 컬럼 정보입니다:`, ''];
    for (const c of ontologyInfo) {
      lines.push(`- \`${c.column_name}\` (${c.data_type})`);
      if (c.description) lines.push(`  - 의미: ${c.description}`);
      if (c.synonyms.length > 0) lines.push(`  - 동의어: ${c.synonyms.join(', ')}`);
    }
    llmAnswer = lines.join('\n');
  }

  return buildConversationalResponse({
    intent: 'ontology_lookup',
    answer: llmAnswer,
    referenced: { domain: dc, columns: ontologyInfo, candidateCount: candidates.length },
  });
}

// ============================================================
// 핸들러 3: handleTroubleshooting
// ------------------------------------------------------------
// 예) "왜 DB에는 데이터가 있는데 조회가 안돼?"
//
// 흐름:
//   1. 직전 SQL 추출 (없으면 안내문 반환)
//   2. SQL 안에서 의심 조건 분석:
//      - DIVISION 필터 (도메인-DIVISION 불일치 가능성)
//      - CALMONTH 필터 (날짜 범위/포맷)
//      - CUSTOMER_NM / MATERIAL_NM 등 NM 컬럼 (이 테이블에 _NM 없음)
//      - PLANT 필터
//      - Dummy 제외 조건
//      - Metric 산식 적용 여부
//      - 직전 rowCount=0 였는지
//   3. LLM 종합 진단
// ============================================================
export async function handleTroubleshooting(query, activeDomain, conversationContext, deps) {
  const { openai, GPT_MODEL } = deps;
  const dc = activeDomain || 'PS';
  const ctx = extractLastContext(conversationContext);

  if (!ctx.hasContext || !ctx.sql) {
    return buildConversationalResponse({
      intent: 'troubleshooting',
      answer: `진단할 직전 SQL/결과가 없습니다.\n\n` +
              `먼저 데이터를 조회한 뒤 "왜 결과가 비었어?" 같은 후속 질문을 해주시면 직전 SQL 을 분석해서 원인을 진단해 드립니다.`,
      referenced: { domain: dc, hasContext: false },
    });
  }

  const sql = ctx.sql || '';
  const sqlUpper = sql.toUpperCase();
  const findings = [];

  // 1) DIVISION 필터 검사
  const divMatch = sql.match(/DIVISION\s*=\s*'?(\d+)'?/i);
  if (divMatch) {
    const div = divMatch[1];
    const expectedDiv = dc === 'PS' ? '10' : dc === 'HL' ? '20' : null;
    if (expectedDiv && div !== expectedDiv) {
      findings.push(`SQL 의 DIVISION='${div}' 이 현재 도메인(${dc})의 기대값(${expectedDiv})과 다릅니다. 도메인을 ${div === '10' ? 'PS' : div === '20' ? 'HL' : 'MGMT'}(으)로 바꾸거나 SQL 의 DIVISION 조건을 수정해야 합니다.`);
    }
  } else if (dc === 'PS' || dc === 'HL') {
    findings.push(`SQL 에 DIVISION 필터가 없습니다. ${dc} 도메인은 자동으로 DIVISION='${dc === 'PS' ? '10' : '20'}' 가 적용되어야 합니다.`);
  }

  // 2) CALMONTH 검사
  const calMatch = sql.match(/CALMONTH\s*(=|>=|<=|<>|>|<|BETWEEN|LIKE|IN)\s*([^\s)]+)/i);
  if (calMatch) {
    findings.push(`날짜 필터(CALMONTH ${calMatch[1]} ${calMatch[2].substring(0, 30)}) 가 적용되어 있습니다. CALMONTH 는 'YYYYMM' 6자리 문자열이어야 합니다 (예: '202506'). 다른 형식이면 결과가 비어 나옵니다.`);
  } else {
    findings.push(`날짜 필터(CALMONTH) 가 없습니다. 매우 큰 데이터 범위를 조회하거나, 의도와 다른 시점의 데이터를 보고 있을 수 있습니다.`);
  }

  // 3) _NM (명칭) 컬럼 직접 참조 — bw_profitability_data 는 _NM 컬럼 없음
  const nmMatches = sql.match(/\b[A-Z][A-Z0-9_]*_NM\b/g);
  if (nmMatches && nmMatches.length > 0) {
    const unique = [...new Set(nmMatches)];
    findings.push(`SQL 에 명칭(_NM) 컬럼이 직접 참조되어 있습니다: ${unique.join(', ')}. bw_profitability_data 테이블에는 _NM 컬럼이 존재하지 않습니다. 명칭은 CASE WHEN 으로 코드값을 매핑해 표시해야 합니다.`);
  }

  // 4) PLANT 필터
  const plantMatch = sql.match(/PLANT\s*(=|<>|!=|LIKE|IN)\s*'([^']+)'/i);
  if (plantMatch) {
    findings.push(`PLANT 필터(${plantMatch[0]}) 가 적용되어 있습니다. PLANT 코드가 실제 데이터에 존재하지 않으면 결과가 비어 나옵니다.`);
  }

  // 5) CUSTOMER 필터
  const custMatch = sql.match(/CUSTOMER\s*(=|<>|!=|LIKE|IN)\s*'([^']+)'/i);
  if (custMatch) {
    findings.push(`CUSTOMER 필터(${custMatch[0]}) 가 적용되어 있습니다. 코드 오타/존재하지 않는 코드일 가능성을 확인하세요.`);
  }

  // 6) MATERIAL 필터
  const matMatch = sql.match(/MATERIAL\s*(=|<>|!=|LIKE|IN)\s*'([^']+)'/i);
  if (matMatch) {
    findings.push(`MATERIAL 필터(${matMatch[0]}) 가 적용되어 있습니다. 코드 오타/존재하지 않는 코드일 가능성을 확인하세요.`);
  }

  // 7) Dummy 제외
  if (/Dummy/i.test(sql)) {
    findings.push(`Dummy 제외 조건이 적용되어 있습니다. Dummy 값 자체를 보고 싶었다면 이 조건을 빼야 합니다.`);
  }

  // 8) HAVING / Group by 단독 행 0
  if (/HAVING\b/i.test(sqlUpper)) {
    findings.push(`HAVING 절이 있습니다. 집계 후 필터링되어 행이 모두 제외되었을 수 있습니다.`);
  }

  // 9) Metric 산식
  if (ctx.metricUsed) {
    findings.push(`이 SQL 은 Metric "${ctx.metricUsed}" 산식을 적용했습니다. Metric 정의 자체를 확인하려면 "${ctx.metricUsed} 산식이 뭐야?" 처럼 질문해 주세요.`);
  }

  // 10) rowCount 0
  if (ctx.rowCount === 0) {
    findings.push(`직전 조회 결과가 0 행이었습니다. 필터 조건 중 하나가 너무 강하게 좁혔거나, 해당 기간/도메인의 데이터가 실제로 존재하지 않을 수 있습니다.`);
  }

  // 11) 에러 메시지가 있었으면
  if (ctx.errorMessage) {
    findings.push(`직전 실행에서 다음 메시지가 있었습니다: ${ctx.errorMessage}`);
  }

  if (findings.length === 0) {
    findings.push('SQL 의 명시적 구조에서는 의심 조건이 발견되지 않았습니다. 데이터 자체가 비어 있거나, 다른 컬럼 조합으로 인해 0 행이 나왔을 수 있습니다.');
  }

  // LLM 종합 진단
  let llmAnswer = '';
  try {
    const sysPrompt = `당신은 SQL 진단 도우미입니다.
사용자가 직전 데이터 조회가 비어 나오거나 이상하다고 호소하고 있습니다.
아래 SQL 과 발견된 의심 포인트를 토대로 **한국어**로 친절히 진단해 주세요.

[작성 규칙]
1. 가장 가능성 높은 원인 1~2가지를 먼저 짚기
2. 각 원인별로 "어떻게 확인/수정하면 되는지" 짧은 액션 아이템 제시
3. 마크다운 리스트와 \`백틱\` 사용 허용 (코드 블록 금지)
4. 추측 단정 금지 — "~일 가능성이 있습니다", "~를 먼저 확인해 보세요" 톤
5. 마지막에 "재실행 권장 질문" 한 줄 추천 (예: 'CALMONTH 를 '202506' 으로 명시해서 다시 질문해 보세요')`;

    const usrPrompt = `[도메인] ${dc}
[사용자 질문] ${query}

[직전 SQL]
${sql}

[직전 조회 행 수] ${ctx.rowCount === null ? '(알 수 없음)' : ctx.rowCount}
[직전 에러 메시지] ${ctx.errorMessage || '(없음)'}
[직전 사용 Metric] ${ctx.metricUsed || '(없음)'}

[자동 분석으로 발견된 의심 포인트]
${findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

위 정보를 토대로 사용자에게 자연어로 진단을 제공하세요.`;

    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: usrPrompt },
      ],
      temperature: 0.3,
      max_tokens: 900,
    });
    llmAnswer = (completion.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('[Troubleshooting] LLM 호출 실패:', e.message);
    // Fallback — 발견 리스트 그대로 보여주기
    llmAnswer = `직전 SQL 을 분석한 결과 다음 포인트가 의심됩니다:\n\n` +
                findings.map((f, i) => `${i + 1}. ${f}`).join('\n');
  }

  return buildConversationalResponse({
    intent: 'troubleshooting',
    answer: llmAnswer,
    referenced: {
      domain: dc,
      lastSql: sql.substring(0, 500),
      lastRowCount: ctx.rowCount,
      lastErrorMessage: ctx.errorMessage,
      findings,
    },
  });
}

// ============================================================
// 핸들러 4: handleSqlExplain
// ------------------------------------------------------------
// 예) "이 SQL 무슨 뜻이야?", "방금 만든 쿼리 설명해줘"
// ============================================================
export async function handleSqlExplain(query, activeDomain, conversationContext, deps) {
  const { openai, GPT_MODEL } = deps;
  const dc = activeDomain || 'PS';
  const ctx = extractLastContext(conversationContext);

  if (!ctx.hasContext || !ctx.sql) {
    return buildConversationalResponse({
      intent: 'sql_explain',
      answer: `설명할 직전 SQL 이 없습니다.\n\n먼저 데이터를 조회한 뒤 "이 SQL 설명해줘" 라고 물어주시면 SELECT/FROM/WHERE 등 절별로 풀어드립니다.`,
      referenced: { domain: dc, hasContext: false },
    });
  }

  const sql = ctx.sql;

  let llmAnswer = '';
  try {
    const sysPrompt = `당신은 SQL 교육자입니다.
사용자가 방금 시스템이 생성한 SQL 의 의미를 묻고 있습니다.
아래 SQL 을 절(SELECT / FROM / WHERE / GROUP BY / HAVING / ORDER BY / LIMIT) 단위로 한국어 설명해 주세요.

[작성 규칙]
1. 절별로 마크다운 제목(### SELECT, ### FROM 등) 사용
2. 각 절 아래 1~3줄의 평문 설명
3. 컬럼명/값/표현식은 \`백틱\` 으로 감싸기
4. 도메인(${dc}) 컨텍스트가 있으면 짧게 언급 (DIVISION 자동 필터 등)
5. 코드 블록 금지, 인라인 백틱만`;

    const usrPrompt = `[도메인] ${dc}
[설명 대상 SQL]
${sql}

위 SQL 을 절별로 설명해 주세요.`;

    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: sysPrompt },
        { role: 'user', content: usrPrompt },
      ],
      temperature: 0.2,
      max_tokens: 900,
    });
    llmAnswer = (completion.choices?.[0]?.message?.content || '').trim();
  } catch (e) {
    console.error('[SqlExplain] LLM 호출 실패:', e.message);
    llmAnswer = `직전 SQL 을 절별로 자동 설명하지 못했습니다 (LLM 오류). 원본 SQL 은 다음과 같습니다:\n\n\`${sql.substring(0, 500)}\``;
  }

  return buildConversationalResponse({
    intent: 'sql_explain',
    answer: llmAnswer,
    referenced: { domain: dc, sql: sql.substring(0, 1000) },
  });
}

// ============================================================
// 핸들러 5: handleDomainExplain
// ------------------------------------------------------------
// 예) "PS 도메인은 뭐야?", "도메인 차이 뭐야"
// ============================================================
export async function handleDomainExplain(query, activeDomain, conversationContext, deps) {
  const dc = activeDomain || 'PS';

  // 정적 도메인 사전 (DIVISION 매핑은 server.mjs applyDomainFilter 와 일치)
  const DOMAIN_DICT = {
    PS:   { label: 'PS (Production & Sales)',  division: '10',   desc: '생산·판매 영역. 제조 라인 단위의 매출/원가/수익성 분석 중심.' },
    HL:   { label: 'HL (Heavy & Logistics)',   division: '20',   desc: '중공업/물류 영역. 대형 설비, 프로젝트성 매출, 장기 계약 중심.' },
    MGMT: { label: 'MGMT (Management)',        division: '(없음)', desc: '경영 관리 영역. DIVISION 자동 필터 없이 전체 데이터 대상 — 본사 통합 KPI 용도.' },
  };

  const q = query.toLowerCase();
  let askedDomains = [];
  if (/\bps\b/i.test(query)) askedDomains.push('PS');
  if (/\bhl\b/i.test(query)) askedDomains.push('HL');
  if (/\bmgmt\b/i.test(query) || /경영관리|매니지/i.test(query)) askedDomains.push('MGMT');
  if (askedDomains.length === 0) askedDomains = ['PS', 'HL', 'MGMT'];

  const lines = [`현재 시스템의 분석 영역(도메인) 안내입니다.`, ''];
  for (const code of askedDomains) {
    const d = DOMAIN_DICT[code];
    if (!d) continue;
    lines.push(`### ${d.label}`);
    lines.push(`- **DIVISION 자동 필터**: \`DIVISION = '${d.division}'\`` + (code === 'MGMT' ? ' (조건 없음)' : ''));
    lines.push(`- **설명**: ${d.desc}`);
    lines.push('');
  }

  lines.push(`현재 선택된 도메인: **${dc}**`);
  lines.push('');
  lines.push(`다른 도메인으로 바꾸려면 상단 도메인 선택 모달에서 변경해 주세요.`);

  return buildConversationalResponse({
    intent: 'domain_explain',
    answer: lines.join('\n'),
    referenced: { currentDomain: dc, askedDomains, dictionary: DOMAIN_DICT },
  });
}

// ============================================================
// 핸들러 6: handleGeneralChat
// ------------------------------------------------------------
// 시스템 사용법/FAQ 만 답변. 그 외 잡담은 거절.
// ============================================================
export async function handleGeneralChat(query, activeDomain, conversationContext, deps) {
  const dc = activeDomain || 'PS';
  const q = query.toLowerCase();

  // 시스템 관련 키워드인지 검사
  const isSystemRelated =
    /(사용법|쓰는\s*법|어떻게\s*(써|사용|이용)|how to use)/i.test(query) ||
    /(FAQ|도움말|help|가이드|매뉴얼)/i.test(query) ||
    /(이\s*시스템|이\s*서비스|이\s*프로그램|이\s*챗봇|이\s*화면)/.test(query) ||
    /(어떤\s*질문|뭘\s*물어|무엇을\s*물어).*(할\s*수|가능)/.test(query);

  if (!isSystemRelated) {
    // 잡담 거절
    return buildConversationalResponse({
      intent: 'general_chat',
      answer: `저는 **사내 수익성 분석 시스템** 의 데이터 질의 도우미입니다.\n\n` +
              `데이터/분석/지표/도메인 외의 일상 대화에는 답변할 수 없습니다.\n\n` +
              `다음과 같은 질문을 시도해 주세요:\n` +
              `- "PS 9월 매출 TOP5"\n` +
              `- "영업이익 산식이 뭐야?"\n` +
              `- "왜 조회 결과가 비었어?"\n` +
              `- "이 시스템 어떻게 써?"`,
      referenced: { domain: dc, refused: true },
    });
  }

  // 시스템 사용법 FAQ
  const answer = `**사내 수익성 분석 시스템 사용 가이드**

### 1. 두 가지 질문 유형 (상단 라디오)
- **현황집계**: 표/차트가 필요한 데이터 조회 — 예: "9월 PS TOP5 매출"
- **분석질문**: 텍스트로 분석/시사점을 받고 싶을 때 — 예: "수익성 추이 분석해줘"

### 2. 후속 질문 자동 의도 분류
질문 의도에 따라 자동으로 다음 중 하나로 분류됩니다:
- 표 조회 / 분석 / Metric 산식 / 컬럼 의미 / 오류 진단 / SQL 설명 / 도메인 설명 / 시스템 안내

### 3. 도메인 (분석 영역)
- **PS** (DIVISION='10') — 생산·판매
- **HL** (DIVISION='20') — 중공업·물류
- **MGMT** — 경영 관리 (필터 없음)

### 4. 자주 묻는 후속 질문
- "{지표명} 산식이 뭐야?" → Metric 정의 조회
- "{컬럼명} 컬럼은 뭘 의미해?" → Ontology 조회
- "왜 데이터가 비었어?" → 직전 SQL 자동 진단
- "이 SQL 설명해줘" → 직전 SQL 절별 설명

현재 선택된 도메인: **${dc}**`;

  return buildConversationalResponse({
    intent: 'general_chat',
    answer,
    referenced: { domain: dc, refused: false },
  });
}

// ============================================================
// 초기화 — server.mjs 의존성 주입
// ------------------------------------------------------------
// 사용:
//   import { initConversationalIntent } from './conversational_intent.mjs';
//   const ci = initConversationalIntent({ pool, openai, GPT_MODEL, applyDomainFilter });
//   const result = await ci.classifyConversationalIntent(query, ctx, mode);
// ============================================================
export function initConversationalIntent(deps) {
  if (!deps || !deps.pool || !deps.openai || !deps.GPT_MODEL) {
    throw new Error('initConversationalIntent: pool / openai / GPT_MODEL 의존성이 필요합니다.');
  }
  return {
    INTENT_LABELS,
    classifyConversationalIntent: (q, ctx, mode) =>
      classifyConversationalIntent(q, ctx, mode, deps),
    classifyConversationalIntentHeuristic,
    extractLastContext,
    logConversationalIntent,
    determineSuggestedMode,
    buildConversationalResponse,
    handleMetricLookup:    (q, dc, ctx) => handleMetricLookup(q, dc, ctx, deps),
    handleOntologyLookup:  (q, dc, ctx) => handleOntologyLookup(q, dc, ctx, deps),
    handleTroubleshooting: (q, dc, ctx) => handleTroubleshooting(q, dc, ctx, deps),
    handleSqlExplain:      (q, dc, ctx) => handleSqlExplain(q, dc, ctx, deps),
    handleDomainExplain:   (q, dc, ctx) => handleDomainExplain(q, dc, ctx, deps),
    handleGeneralChat:     (q, dc, ctx) => handleGeneralChat(q, dc, ctx, deps),
  };
}
