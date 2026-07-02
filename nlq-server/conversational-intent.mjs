// ============================================================
// conversational-intent.mjs
// Phase 1: 후속 대화 의도 자동 분류 + 6개 신규 의도 핸들러
//
// 사용자 라디오(현황집계/분석질문)는 유지하되,
// 자연어 후속 질문의 의도를 자동 분류하여 라우팅한다.
//
// 8가지 의도:
//   - data_query       : 일반 데이터 조회  (기존 aggregate 흐름)
//   - analysis         : 데이터 분석/해석  (기존 analysis 흐름)
//   - metric_lookup    : 지표 정의/산식 조회 (DB metric 테이블 직접 조회)
//   - ontology_lookup  : 컬럼/용어 의미 조회 (DB ontology 테이블 직접 조회)
//   - troubleshooting  : 조회 실패 원인 진단 (직전 SQL/필터 분석)
//   - sql_explain      : 생성된 SQL 설명
//   - domain_explain   : 현재 도메인/필터 조건 설명
//   - general_chat     : 시스템 사용법/FAQ (잡담은 정중히 거절)
//
// 모든 함수는 외부 의존성(pool, openai, model)을 인자로 받아 모듈 독립성을 유지.
// ============================================================

// ─── 산식(formula) 오버라이드 감지 헬퍼 ─────────────────────────
// ★ 원칙:
//   1. 자연어질의 답변은 학습관리(Ontology/Metric)가 최우선.
//   2. Metric 산식(계산식)은 사용자가 개인 규칙으로 바꿀 수 없다.
//   3. 산식을 개인 규칙으로 만드는 어떤 시도도 저장 단계에서 차단한다.
//
// 검사 대상: rule_json 뿐 아니라 normalized_meaning / trigger_text /
//           user_expression 같은 텍스트 필드까지 전부 훑는다.
//
// 감지 패턴:
//   - JSON 키: "formula", "sql"
//   - SQL 예약어/집계함수: SELECT, SUM(, AVG(, COUNT(, MIN(, MAX(, CASE WHEN
//   - 산술식이 섞인 지표 계산 시도: 컬럼명/한글 지표명 + 사칙연산 + 숫자
//     예) "매출액 / 영업이익 * 100", "SUM(ZAMT099) - SUM(ZAMT100)"
//   - "산식", "계산식", "formula" 라는 단어가 직접 등장
// ─────────────────────────────────────────────────────────────
const _FORMULA_KEYWORDS_REGEX = /"formula"|"sql"\s*:|\bselect\s|\bsum\s*\(|\bavg\s*\(|\bcount\s*\(|\bmin\s*\(|\bmax\s*\(|\bcase\s+when\b|\bgroup\s+by\b|\bhaving\b/i;
const _FORMULA_WORD_REGEX = /산식|계산식|계산\s*방법|공식|수식/;
// 지표성 산술식: 한글 2자 이상 또는 영문 컬럼명 뒤에 +-*/ 연산자와 다른 피연산자가 이어지는 형태
const _ARITHMETIC_FORMULA_REGEX = /(?:[가-힣A-Za-z_][가-힣A-Za-z_0-9]{1,})\s*[\+\-\*\/]\s*(?:[가-힣A-Za-z_0-9\(]|\d)/;

/**
 * 산식 오버라이드 시도인지 판정.
 * @param {string} text - 검사할 문자열 (null/undefined 허용)
 * @returns {{ blocked: boolean, reason?: string }}
 */
export function detectFormulaOverride(text) {
  if (!text || typeof text !== 'string') return { blocked: false };
  const s = text.trim();
  if (!s) return { blocked: false };

  if (_FORMULA_KEYWORDS_REGEX.test(s)) {
    return { blocked: true, reason: 'SQL/집계함수/JSON formula 키' };
  }
  if (_FORMULA_WORD_REGEX.test(s)) {
    return { blocked: true, reason: '"산식/계산식/공식/수식" 표현' };
  }
  if (_ARITHMETIC_FORMULA_REGEX.test(s)) {
    // 단, 백분율/단위 표기(예: "70%", "3.5배") 같은 흔한 표현은 예외로 통과
    // → 규칙: 사칙연산이 있어야 하고, 피연산자 중 하나 이상이 영문/한글 식별자여야 산식으로 간주
    const hasIdentifierBothSides = /(?:[가-힣A-Za-z_][가-힣A-Za-z_0-9]{1,})\s*[\+\-\*\/]\s*(?:[가-힣A-Za-z_][가-힣A-Za-z_0-9]{0,}|\([^)]*\))/.test(s);
    if (hasIdentifierBothSides) {
      return { blocked: true, reason: '식별자 + 사칙연산 조합 (산식 형태)' };
    }
  }
  return { blocked: false };
}

/**
 * user memory payload 전체 필드에서 산식 시도 검사.
 * @param {object} payload - { rule_json, normalized_meaning, trigger_text, user_expression, ... }
 * @returns {{ blocked: boolean, field?: string, reason?: string }}
 */
export function detectFormulaOverrideInPayload(payload) {
  if (!payload || typeof payload !== 'object') return { blocked: false };
  const fields = ['rule_json', 'normalized_meaning', 'trigger_text', 'user_expression'];
  for (const f of fields) {
    const v = payload[f];
    const check = detectFormulaOverride(typeof v === 'string' ? v : (v ? JSON.stringify(v) : ''));
    if (check.blocked) {
      return { blocked: true, field: f, reason: check.reason };
    }
  }
  return { blocked: false };
}

// 산식 차단 시 사용자에게 반환하는 표준 안내 문구
export const FORMULA_OVERRIDE_MESSAGE =
  '지표 계산식(예: 영업이익율 계산 방법)은 회사 공식 표준이라 개인 규칙으로 바꿀 수 없습니다. ' +
  '자연어질의 답변은 항상 학습관리에 등록된 산식을 최우선으로 사용합니다. ' +
  '계산식 변경이 필요하면 학습관리 담당자에게 요청해 주세요.';

// ─── 의도 라벨 (사용자 표시용) ─────────────────────────────────
export const INTENT_LABELS = {
  data_query:      '데이터 조회',
  analysis:        '데이터 분석',
  metric_lookup:   'Metric 산식 조회',
  ontology_lookup: '용어/컬럼 조회',
  troubleshooting: '조회 실패 원인 진단',
  sql_explain:     'SQL 설명',
  domain_explain:  '도메인/필터 설명',
  general_chat:    '시스템 사용법',
  memory_save:     '개인 규칙 등록',
};

// ─── 도메인-DIVISION 매핑 (server.mjs applyDomainFilter와 동일 규칙) ───
const DOMAIN_DIVISION = {
  PS:   "DIVISION = '10'",
  HL:   "DIVISION = '20'",
  MGMT: '(필터 없음 — 전사)',
};

// ============================================================
// 1. 분류기 (3-tier: 휴리스틱 → LLM → 폴백)
// ============================================================

/**
 * Tier 1: 휴리스틱 정규식 분류 (0ms)
 * 명확한 키워드 패턴이 있는 질문만 즉시 라벨링.
 * 우선순위: troubleshooting > sql_explain > domain_explain
 *           > metric_lookup > ontology_lookup > general_chat
 * 일치하는 패턴이 없으면 null 반환 (LLM으로 위임).
 */
export function classifyConversationalIntentHeuristic(query, conversationContext) {
  if (!query || typeof query !== 'string') return null;
  const q = query.trim();
  const lower = q.toLowerCase();

  // [PR: user memory] memory_save 최우선 — "앞으로 X를 Y로 …" 같은 개인 규칙 등록 요청
  //   - "앞으로", "이제부터", "항상", "매번" + "부르/불러/불러줘/포함/추가/같이/함께"
  //   - "X는 Y야 / X를 Y로 / X라고 부르/X 라고 부르"
  //   - "X 질문(하)면 Y도" 형태의 룰 지시
  //   - 위 5개 intent(sql_explain 등)보다 먼저 잡아야 오분류 방지
  if (
    /(앞으로|이제부터|항상|매번|늘|반드시|무조건)/.test(q) &&
    /(불러|부르|라고 부르|라고 해|로 해석|로 표시|같이|함께|포함|추가|보여|반영|기억|저장|해줘|해 줘)/.test(q)
  ) {
    return 'memory_save';
  }
  // "X는 Y야 / X를 Y로 부를게 / X를 Y로 해줘" 형태 (앞으로/항상 없어도 매핑 선언은 잡음)
  if (
    /^\s*"?[^"]{1,30}"?\s*(은|는|을|를|이|가)\s*"?[^"]{1,50}"?\s*(로|으로)\s*(부를게|부르자|불러|해석|바꿔|바꾸자|봐|보자|생각|생각해|말할게|이라고|라고)/.test(q)
  ) {
    return 'memory_save';
  }

  // [2026-06-30] 직전 턴에 SQL이 있으면, "SQL/쿼리" 단어 없이도 후속 SQL 관련 질문을
  //   sql_explain 으로 분류. 사용자 사례: "근데 넌 왜 컬럼마다 SUM을 붙여놨어?" "왜 묶지 않았어?"
  //   - 직전 SQL이 있고, "왜/어디서/어떻게/그건" + "SUM/컬럼/산식/계산/묶/펼쳐/감싸/분배" 키워드면 sql_explain
  //   - 또는 "이/저/그/방금" + (산식/SQL/쿼리/컬럼) + (어디|출처|왜|어떻게) 형태도 sql_explain
  const hasPrevSql = Array.isArray(conversationContext) && conversationContext.length > 0
    && conversationContext.slice().reverse().some(t => t && t.sql);
  if (hasPrevSql) {
    if (
      // (a) 의문어 → 키워드 (앞 → 뒤 순서)
      /(왜|어디서|어디|어떻게|뭐|무슨|어째서).{0,40}(sum|컬럼|산식|공식|계산|묶|펼치|감싸|분배|붙여|붙였|왜그|왜 그|쿼리|sql|select|group|where|case|when|join|order|출처|근거|등록|가져)/i.test(q) ||
      // (b) 키워드 → 의문어 (뒤 → 앞 순서, "산식은 어디서" 같은 패턴)
      /(sum|컬럼|산식|공식|쿼리|sql).{0,40}(왜|어디서|어디|어떻게|뭐|무슨|어째서|출처|근거|가져|등록)/i.test(q) ||
      // (c) 지시어 + SQL/산식 관련 + 의문/요청
      /(이|저|그|방금|위|아까).{0,5}(산식|공식|쿼리|sql|컬럼).{0,30}(어디|출처|근거|왜|어떻게|설명|풀어)/i.test(q) ||
      // (d) 단정형 불일치 표현
      /(이상해|이상한|틀린|잘못|왜이래|이게 맞|이게맞|왜 이렇)/.test(q)
    ) {
      return 'sql_explain';
    }
  }

  // 0) ontology_lookup 강제 우선 — "컬럼/필드/용어" 명시어가 있고 "뭐/뜻/의미/설명"이면
  //    domain_explain / metric_lookup 보다 먼저 ontology로 라우팅.
  //    (이전 케이스: "DIVISION 컬럼이 뭐야", "필드 뜻이 뭐야" 분류 오류 보정)
  if (
    /(컬럼|필드|용어|단어|column|field)/i.test(q) &&
    /(뭐|무엇|뜻|의미|설명|어떤)/.test(q)
  ) {
    return 'ontology_lookup';
  }

  // 1) troubleshooting — 조회 실패/이상 진단
  //    "왜 ~ 안 ~", "왜 ~ 못 ~", "왜 안 ~", "왜 ~ 없어", "왜 ~ 안돼", "왜 ~ 안 나와"
  //    "왜 조회", "왜 결과", "왜 데이터"
  if (
    /왜.{0,15}(안|못|없|실패|에러|오류|0건|결과)/.test(q) ||
    /왜\s*(조회|데이터|결과)/.test(q) ||
    /(조회|결과)\s*(안\s*돼|안돼|안되|안 나|안나|실패|0건|없)/.test(q) ||
    /데이터.{0,5}있는데.{0,10}(안|못)/.test(q) ||
    /(어디서|왜)\s*틀/.test(q)
  ) {
    return 'troubleshooting';
  }

  // 2) sql_explain — SQL 설명/해석
  //    "이 SQL", "SQL 설명", "쿼리 설명", "이 쿼리", "어떻게 만들었", "어떻게 짜"
  if (
    /\bsql\b/i.test(q) && /(설명|해석|뜻|의미|풀어|어떻게)/.test(q) ||
    /(이|위|방금|그)\s*(sql|쿼리)/i.test(q) ||
    /(쿼리|sql).{0,5}(설명|풀어|해석)/i.test(q) ||
    /select.{0,10}이.{0,5}(뭐|무슨|어떤)/i.test(q)
  ) {
    return 'sql_explain';
  }

  // 3) domain_explain — 도메인/필터 설명
  //    "지금 어느 도메인", "현재 도메인", "PS/HL/MGMT가 뭐", "DIVISION", "분석 영역"
  if (
    /(지금|현재|now).{0,10}(도메인|domain|영역|division)/i.test(q) ||
    /(어떤|어느|무슨).{0,5}(도메인|영역|division)/i.test(q) ||
    /\b(ps|hl|mgmt)\b.{0,15}(뭐|무엇|의미|차이|구분)/i.test(q) ||
    /division.{0,15}(뭐|무엇|어떤|의미|적용)/i.test(q) ||
    /도메인.{0,10}(설명|뭐|무엇|차이|뭔지)/i.test(q)
  ) {
    return 'domain_explain';
  }

  // 4) metric_lookup — 지표/산식 정의 조회
  //    "산식이 뭐", "공식 어떻게", "어떻게 계산", "정의가 뭐", "metric이 뭐"
  //    "영업이익 산식", "ROIC 정의" 등
  if (
    /(산식|공식|formula).{0,10}(뭐|무엇|어떻게|어떤|보여|알려)/i.test(q) ||
    /어떻게.{0,5}(계산|구해|산출)/.test(q) ||
    /계산.{0,5}(방법|식|공식)/.test(q) ||
    /(정의|뜻|의미).{0,10}(뭐|무엇)/.test(q) && !/도메인|영역/i.test(q) ||
    /\b(metric|지표|kpi).{0,10}(뭐|무엇|정의|설명)/i.test(q) ||
    /(영업이익|매출|roic|roe|roa|ebitda|margin).{0,8}(산식|공식|어떻게|계산|뭐|정의)/i.test(q)
  ) {
    return 'metric_lookup';
  }

  // 5) ontology_lookup — 용어/컬럼 의미 조회
  //    "~ 컬럼이 뭐", "~ 가 뭐야", "~ 무슨 뜻", "용어 설명"
  if (
    /(컬럼|column|필드|field).{0,10}(뭐|무엇|의미|뜻|설명)/i.test(q) ||
    /(용어|단어).{0,10}(뭐|무엇|뜻|의미|설명)/i.test(q) ||
    /무슨\s*(뜻|의미)/.test(q) ||
    /[a-z_]+\s*(컬럼|필드|용어)/i.test(q)
  ) {
    return 'ontology_lookup';
  }

  // 6) general_chat — 시스템 사용법/FAQ
  //    "어떻게 써", "사용법", "도와줘", "뭐 할 수 있어", "기능"
  //    인사("안녕")는 LLM에게 위임 → 거절 응답
  if (
    /(사용법|어떻게\s*(써|쓰|사용))/.test(q) ||
    /(뭐\s*(할\s*수|가능|되)|기능.{0,5}(뭐|무엇|소개))/.test(q) ||
    /(도와줘|help|도움말)/i.test(q) ||
    /(질문.{0,10}예시|예시.{0,5}(보여|알려))/.test(q)
  ) {
    return 'general_chat';
  }

  return null; // 불명확 → Tier 2 LLM에게 위임
}

/**
 * Tier 2: LLM 분류 (~500ms)
 * 휴리스틱이 null을 반환했을 때만 호출.
 * gpt-5.5, max_tokens=80, JSON 응답.
 */
export async function classifyConversationalIntentLLM(query, conversationContext, openai, model) {
  const ctxSummary = (conversationContext && conversationContext.length > 0)
    ? conversationContext.slice(-2).map((t, i) =>
        `[직전질문 ${i + 1}] ${(t.query || '').slice(0, 80)}${t.sql ? ' (SQL 생성됨)' : ''}`
      ).join('\n')
    : '(직전 대화 없음)';

  const systemPrompt = `당신은 BI/데이터 분석 시스템의 후속 질문 의도 분류기입니다.
사용자 질문을 아래 8개 중 하나로 분류하세요.

- data_query      : 데이터 조회 요청 (예: "이번 달 매출", "PS 영업이익 상위 5개")
- analysis        : 데이터 분석/해석 요청 (예: "왜 매출이 줄었는지 분석", "추세 보여줘")
- metric_lookup   : 지표 정의/산식 조회 (예: "영업이익 산식이 뭐", "ROIC 어떻게 계산")
- ontology_lookup : 컬럼/용어 의미 조회 (예: "DIVISION 컬럼이 뭐", "CALMONTH 뜻")
- troubleshooting : 조회 실패/이상 원인 진단 (예: "왜 데이터 있는데 조회 안돼", "왜 0건이야")
- sql_explain     : 생성된 SQL 설명 (예: "방금 SQL 설명해줘", "이 쿼리 풀어줘")
- domain_explain  : 현재 도메인/필터 설명 (예: "지금 어느 도메인이야", "PS와 HL 차이")
- general_chat    : 시스템 사용법/FAQ (예: "어떻게 사용해", "뭐 할 수 있어")
- memory_save     : 사용자가 자신의 개인 규칙/선호를 앞으로도 적용해달라고 요청 (예: "앞으로 rt는 두루마리라고 불러줘", "매출 순위 물어보면 매출액도 같이 보여줘", "이제부터 xxx는 yyy로 해석해")

반드시 다음 JSON 형식으로만 응답:
{"intent":"<라벨>","confidence":<0.0~1.0>}`;

  const userPrompt = `직전 대화:\n${ctxSummary}\n\n현재 질문: ${query}`;

  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 80,
      temperature: 0,
    });
    const text = resp.choices?.[0]?.message?.content || '{}';
    const parsed = JSON.parse(text);
    const intent = parsed.intent && INTENT_LABELS[parsed.intent] ? parsed.intent : null;
    const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5;
    return { intent, confidence };
  } catch (e) {
    console.error('[NLQ:Intent] LLM 분류 실패:', e.message);
    return { intent: null, confidence: 0 };
  }
}

/**
 * Tier 3: 폴백 — 신뢰도 낮거나 분류 실패시 라디오 설정으로 복귀.
 *
 * 최종 반환: { intent, confidence, tier }
 *   - tier: 'heuristic' | 'llm' | 'fallback'
 */
export async function classifyConversationalIntent(query, conversationContext, userQueryMode, openai, model) {
  // Tier 1 — conversationContext 전달 (직전 SQL 유무에 따른 분류 차이 반영)
  const h = classifyConversationalIntentHeuristic(query, conversationContext);
  if (h) {
    return { intent: h, confidence: 0.95, tier: 'heuristic' };
  }

  // Tier 2
  const { intent, confidence } = await classifyConversationalIntentLLM(query, conversationContext, openai, model);
  if (intent && confidence >= 0.6) {
    return { intent, confidence, tier: 'llm' };
  }

  // Tier 3 — 라디오 설정으로 복귀
  const fallback = (userQueryMode === 'analysis') ? 'analysis' : 'data_query';
  return { intent: fallback, confidence: 0.4, tier: 'fallback' };
}

// ============================================================
// 2. 공통 헬퍼
// ============================================================

/** conversationContext에서 SQL이 있는 가장 최근 턴 반환 */
export function extractLastContext(conversationContext) {
  if (!Array.isArray(conversationContext) || conversationContext.length === 0) return null;
  for (let i = conversationContext.length - 1; i >= 0; i--) {
    const t = conversationContext[i];
    if (t && t.sql) return t;
  }
  return null;
}

/** 표준 로그 출력 — [NLQ:Intent] JSON */
export function logConversationalIntent(info) {
  try {
    console.log(`[NLQ:Intent] ${JSON.stringify(info)}`);
  } catch {
    console.log(`[NLQ:Intent] (로그 직렬화 실패) intent=${info?.intent}`);
  }
}

/** 라디오 모드와 분류 의도가 어긋날 때 안내용 suggestedMode 결정 */
export function determineSuggestedMode(intent, userQueryMode) {
  if (intent === 'analysis' && userQueryMode !== 'analysis') return 'analysis';
  if (intent === 'data_query' && userQueryMode !== 'aggregate') return 'aggregate';
  return null;
}

/**
 * 표준 응답 빌더 — 6개 신규 핸들러의 공통 출력 포맷.
 * 기존 /api/nlq 응답 스키마(sql, results, explanation, chartType ...) 와 호환되도록
 * 빈 값들도 채워준다.
 */
export function buildConversationalResponse({
  intent,
  answer,
  referenced = null,
  suggestedMode = null,
  requestId = null,
}) {
  return {
    intent,
    intentLabel: INTENT_LABELS[intent] || intent,
    isAnalysisAnswer: true,           // 프론트가 텍스트 영역에 렌더링하도록
    chartType: 'analysis',            // 차트 없음
    sql: '',
    results: [],
    explanation: answer,              // 메인 답변 (markdown 허용)
    analysisText: answer,
    referenced,                       // { sourceTable, rows, lastSql ... } 디버깅용
    suggestedMode,                    // null | 'aggregate' | 'analysis'
    requestId,
  };
}

// ============================================================
// 3. 의도별 핸들러
// ============================================================

/**
 * handleMetricLookup — 지표 정의/산식 조회
 * metric 테이블에서 description/aggregation/formula 조회.
 * metric_synonym으로 동의어 매칭, 컬럼 설명은 ontology_column 참조.
 */
export async function handleMetricLookup({ query, activeDomain, conversationContext, pool, openai, model }) {
  // 1) metric_synonym → metric 매칭
  let metrics = [];
  try {
    // 동의어 매칭 (LIKE)
    const [synRows] = await pool.query(
      `SELECT DISTINCT m.metric_code, m.aggregation, m.formula, m.description
       FROM metric_synonym s
       JOIN metric m ON s.metric_id = m.id
       WHERE m.domain_code = ?
         AND (? LIKE CONCAT('%', s.synonym_text, '%') OR s.synonym_text LIKE CONCAT('%', SUBSTRING(?, 1, 20), '%'))
       LIMIT 5`,
      [activeDomain, query, query]
    );
    metrics = synRows;
  } catch (e) {
    console.error('[Intent:metric_lookup] synonym 조회 실패:', e.message);
  }

  // 2) 직접 코드/설명 LIKE
  if (metrics.length === 0) {
    try {
      const [rows] = await pool.query(
        `SELECT metric_code, aggregation, formula, description
         FROM metric
         WHERE domain_code = ?
           AND (description LIKE CONCAT('%', SUBSTRING(?, 1, 15), '%')
                OR metric_code LIKE CONCAT('%', SUBSTRING(?, 1, 15), '%'))
         LIMIT 5`,
        [activeDomain, query, query]
      );
      metrics = rows;
    } catch (e) {
      console.error('[Intent:metric_lookup] direct 조회 실패:', e.message);
    }
  }

  if (metrics.length === 0) {
    // metric을 못 찾았지만 단순 에러 금지 — LLM에게 "어떤 지표를 찾으시나요?" 안내
    return buildConversationalResponse({
      intent: 'metric_lookup',
      answer: `요청하신 지표(산식)를 \`${activeDomain}\` 도메인 metric 사전에서 찾지 못했습니다.\n\n` +
        `다음과 같이 다시 질문해 주세요:\n` +
        `- 정확한 지표명/코드 사용 (예: \`영업이익 산식이 뭐야?\`, \`ROIC 어떻게 계산해?\`)\n` +
        `- 현재 도메인(\`${activeDomain}\`)에 등록된 지표를 확인하려면 **현황집계** 모드에서 "${activeDomain} 지표 목록 보여줘"로 조회 가능합니다.`,
      referenced: { sourceTable: 'metric', domainCode: activeDomain, rows: 0 },
    });
  }

  // 3) metric.formula에 등장하는 컬럼명을 ontology_column에서 보강 (선택)
  const allCols = new Set();
  for (const m of metrics) {
    const colMatches = (m.formula || '').match(/[A-Z_][A-Z0-9_]+/g) || [];
    colMatches.forEach(c => allCols.add(c));
  }
  let colDescriptions = [];
  if (allCols.size > 0) {
    try {
      const [colRows] = await pool.query(
        `SELECT column_name, description FROM ontology_column
         WHERE domain_code = ? AND is_active = 1 AND column_name IN (?)`,
        [activeDomain, Array.from(allCols)]
      );
      colDescriptions = colRows;
    } catch (e) {
      console.error('[Intent:metric_lookup] ontology 보강 실패:', e.message);
    }
  }

  // 4) LLM으로 자연어 답변 생성
  const metricList = metrics.map(m =>
    `- **${m.metric_code}** (${m.aggregation}): ${m.description || '(설명 없음)'}\n  - 산식: \`${m.formula || '(미정의)'}\``
  ).join('\n');

  const colHint = colDescriptions.length > 0
    ? '\n\n관련 컬럼 설명:\n' + colDescriptions.map(c => `- \`${c.column_name}\`: ${c.description}`).join('\n')
    : '';

  const systemPrompt = `당신은 한국 기업의 BI 시스템에서 지표 정의를 설명하는 어시스턴트입니다.
사용자가 묻는 지표의 산식과 의미를 DB에서 조회한 정확한 정보 기반으로 자연스럽게 설명하세요.
- 산식은 코드 블록(\`)으로 표시
- 마크다운 표/리스트 활용 가능
- 절대 거짓말하지 말고, 제공된 정보만 사용
- "조회 실패", "처리할 수 없습니다" 같은 표현 금지

[응답 길이/형식 규칙 — 매우 중요]
- 응답이 중간에 잘리지 않도록 핵심 결론부터 먼저 답하고, 산식 본문은 마지막에 코드 블록으로 배치
- 산식의 컬럼이 **15개 이상**이면 "총 N개 컬럼 합산"이라고 요약 + 처음 3개·마지막 2개만 표기 + 전체 산식은 \`\`\`sql 블록\`\`\`에 한 번만
- 동일 metric이 여러 도메인에 있으면 사용자의 활성 도메인 우선, 다른 도메인은 "타 도메인: HL, MGMT에도 존재" 한 줄로만 언급`;

  const userPrompt = `사용자 질문: "${query}"
도메인: ${activeDomain}

DB에서 조회한 매칭 지표 (${metrics.length}건):
${metricList}${colHint}

위 정보로 사용자 질문에 자연스럽게 답해주세요.`;

  let answer;
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1200, // [Fix-D] 산식 노출 시 잘림 방지: 600 → 1200
      temperature: 0.2,
    });
    answer = resp.choices?.[0]?.message?.content?.trim() || metricList;
  } catch (e) {
    console.error('[Intent:metric_lookup] LLM 응답 실패:', e.message);
    // LLM 실패시 fallback: 구조화된 metricList 그대로 반환 (단순 에러 메시지 금지)
    answer = `**${activeDomain} 도메인에서 매칭된 지표 ${metrics.length}건**\n\n${metricList}${colHint}`;
  }

  return buildConversationalResponse({
    intent: 'metric_lookup',
    answer,
    referenced: {
      sourceTable: 'metric',
      domainCode: activeDomain,
      rows: metrics.length,
      metrics: metrics.map(m => m.metric_code),
    },
  });
}

/**
 * handleOntologyLookup — 컬럼/용어 의미 조회
 * ontology_column + ontology_synonym 조인.
 */
export async function handleOntologyLookup({ query, activeDomain, conversationContext, pool, openai, model }) {
  let cols = [];
  // 1) 동의어 매칭
  try {
    const [synRows] = await pool.query(
      `SELECT DISTINCT c.column_name, c.table_name, c.description, c.data_type
       FROM ontology_synonym s
       JOIN ontology_column c ON s.column_id = c.id
       WHERE c.domain_code = ? AND c.is_active = 1
         AND (? LIKE CONCAT('%', s.synonym_text, '%') OR s.synonym_text LIKE CONCAT('%', SUBSTRING(?, 1, 20), '%'))
       LIMIT 5`,
      [activeDomain, query, query]
    );
    cols = synRows;
  } catch (e) {
    console.error('[Intent:ontology_lookup] synonym 실패:', e.message);
  }

  // 2) 직접 column_name/description LIKE
  if (cols.length === 0) {
    try {
      const [rows] = await pool.query(
        `SELECT column_name, table_name, description, data_type
         FROM ontology_column
         WHERE domain_code = ? AND is_active = 1
           AND (column_name LIKE CONCAT('%', SUBSTRING(?, 1, 15), '%')
                OR description LIKE CONCAT('%', SUBSTRING(?, 1, 15), '%'))
         LIMIT 5`,
        [activeDomain, query, query]
      );
      cols = rows;
    } catch (e) {
      console.error('[Intent:ontology_lookup] direct 실패:', e.message);
    }
  }

  if (cols.length === 0) {
    return buildConversationalResponse({
      intent: 'ontology_lookup',
      answer: `\`${activeDomain}\` 도메인 온톨로지에서 해당 컬럼/용어를 찾지 못했습니다.\n\n` +
        `다음과 같이 다시 질문해 주세요:\n` +
        `- 컬럼 영문명 사용 (예: \`DIVISION 컬럼이 뭐야?\`, \`CALMONTH 뜻이 뭐야?\`)\n` +
        `- 한국어 용어 사용 (예: \`사업부 컬럼\`, \`회계연월 의미\`)\n` +
        `- 도메인 전체 용어 사전은 관리자 페이지에서 확인 가능합니다.`,
      referenced: { sourceTable: 'ontology_column', domainCode: activeDomain, rows: 0 },
    });
  }

  const colList = cols.map(c =>
    `- **\`${c.column_name}\`** (${c.data_type || 'unknown'}, table: ${c.table_name || '-'}): ${c.description || '(설명 없음)'}`
  ).join('\n');

  const systemPrompt = `당신은 한국 기업의 BI 시스템에서 데이터 컬럼/용어 의미를 설명하는 어시스턴트입니다.
- DB ontology에서 조회한 정확한 정보만 사용
- 마크다운 활용 가능
- 절대 추측하지 말고, 제공된 설명만 인용해 자연스럽게 풀어쓰기
- "처리할 수 없습니다" 같은 표현 금지`;

  const userPrompt = `사용자 질문: "${query}"
도메인: ${activeDomain}

조회된 컬럼/용어 (${cols.length}건):
${colList}

위 정보로 자연스럽게 답해주세요.`;

  let answer;
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 500,
      temperature: 0.2,
    });
    answer = resp.choices?.[0]?.message?.content?.trim() || colList;
  } catch (e) {
    console.error('[Intent:ontology_lookup] LLM 실패:', e.message);
    answer = `**${activeDomain} 도메인에서 매칭된 컬럼/용어 ${cols.length}건**\n\n${colList}`;
  }

  return buildConversationalResponse({
    intent: 'ontology_lookup',
    answer,
    referenced: {
      sourceTable: 'ontology_column',
      domainCode: activeDomain,
      rows: cols.length,
      columns: cols.map(c => c.column_name),
    },
  });
}

/**
 * handleTroubleshooting — 조회 실패 원인 진단
 * 직전 SQL에서 DIVISION/CALMONTH/필터/지표를 분석하여 가능한 원인 진단.
 */
export async function handleTroubleshooting({ query, activeDomain, conversationContext, pool, openai, model }) {
  const last = extractLastContext(conversationContext);

  if (!last) {
    return buildConversationalResponse({
      intent: 'troubleshooting',
      answer: `이전에 실행된 조회 내역이 없어 원인을 진단할 수 없습니다.\n\n` +
        `먼저 데이터를 조회해 본 뒤 다시 질문해 주세요. 예: "이번 달 ${activeDomain} 매출 조회 후" → "왜 결과가 0건이야?"`,
      referenced: { sourceTable: 'nl_query_history', rows: 0 },
    });
  }

  // 직전 SQL 분석
  const lastSql = last.sql || '';
  const lastQuery = last.query || '';
  const sqlUpper = lastSql.toUpperCase();

  const checks = {
    hasDivision: /DIVISION\s*=/i.test(lastSql),
    divisionValue: (lastSql.match(/DIVISION\s*=\s*['"]?(\d+)['"]?/i) || [])[1] || null,
    hasCalmonth:  /CALMONTH/i.test(lastSql),
    calmonthFilter: (lastSql.match(/CALMONTH\s*(=|>=|<=|BETWEEN|LIKE)\s*[^A-Z]+/i) || [])[0] || null,
    fromTable:    (lastSql.match(/FROM\s+([A-Za-z0-9_.]+)/i) || [])[1] || null,
    hasWhere:     /\bWHERE\b/i.test(lastSql),
    metricMatch:  (lastSql.match(/SUM\s*\(([^)]+)\)|AVG\s*\(([^)]+)\)|COUNT\s*\(([^)]+)\)/i) || [])[0] || null,
    rowCount:     last.rowCount,
  };

  // 활성 도메인과 SQL DIVISION 일치 여부
  const expectedDivision = { PS: '10', HL: '20' }[activeDomain];
  const divisionMismatch = expectedDivision && checks.divisionValue && checks.divisionValue !== expectedDivision;

  const diagnostics = [];
  if (!checks.hasWhere) diagnostics.push('직전 SQL에 WHERE 절이 없어 전체 데이터를 조회했습니다.');
  if (activeDomain !== 'MGMT' && !checks.hasDivision) diagnostics.push(`현재 도메인은 \`${activeDomain}\` 이지만 SQL에 DIVISION 조건이 빠져 있을 수 있습니다.`);
  if (divisionMismatch) diagnostics.push(`도메인(\`${activeDomain}\`)에 기대되는 DIVISION='${expectedDivision}' 과 SQL의 DIVISION='${checks.divisionValue}' 가 다릅니다.`);
  if (!checks.hasCalmonth) diagnostics.push('SQL에 CALMONTH(기간) 조건이 없거나 광범위해서 결과가 비었을 수 있습니다.');
  if (checks.rowCount === 0) diagnostics.push('직전 조회 결과가 0건으로 기록되어 있습니다.');

  const systemPrompt = `당신은 BI 시스템의 조회 실패 진단 어시스턴트입니다.
사용자의 "왜 안돼?" 류 후속 질문에 대해, 직전 SQL과 도메인 정보를 근거로 차분히 진단합니다.
- 절대 "조회 실패", "처리할 수 없습니다" 같은 표현 금지
- 가능한 원인을 1~3가지 제시하고, 각각의 해결 방안(질문 재작성 예시)을 제안
- 마크다운 활용, 친절하고 구체적인 톤`;

  const userPrompt = `사용자 후속 질문: "${query}"
현재 도메인: ${activeDomain}

직전 조회:
- 질문: ${lastQuery}
- 결과 행수: ${checks.rowCount ?? '(미상)'}
- SQL: \`\`\`sql\n${lastSql}\n\`\`\`

자동 진단 체크:
${diagnostics.length > 0 ? diagnostics.map(d => `- ${d}`).join('\n') : '- (특이사항 없음)'}

위 정보를 근거로 사용자에게 가능한 원인과 다음 행동을 제안하세요.`;

  let answer;
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1200, // [Fix-D] 진단 본문 잘림 방지: 600 → 1200
      temperature: 0.3,
    });
    answer = resp.choices?.[0]?.message?.content?.trim();
  } catch (e) {
    console.error('[Intent:troubleshooting] LLM 실패:', e.message);
  }

  if (!answer) {
    // LLM 실패시 자동 진단 결과를 그대로 노출 (단순 에러 메시지 금지)
    answer = `**조회 진단 결과** (도메인: \`${activeDomain}\`)\n\n` +
      `**직전 질문**: ${lastQuery}\n` +
      `**결과 행수**: ${checks.rowCount ?? '(미상)'}\n\n` +
      `**점검 항목**:\n` +
      (diagnostics.length > 0 ? diagnostics.map(d => `- ${d}`).join('\n') : '- 특이사항이 발견되지 않았습니다.') +
      `\n\n다른 조건(기간, 필터)으로 다시 시도해 보세요.`;
  }

  return buildConversationalResponse({
    intent: 'troubleshooting',
    answer,
    referenced: {
      lastQuery,
      lastSql: lastSql.slice(0, 500),
      rowCount: checks.rowCount,
      diagnostics,
    },
  });
}

/**
 * [2026-06-30] sql_explain sub-intent 휴리스틱 분류
 *   - structure_explain: 절별 SQL 구조 풀이 ("이 쿼리 설명", "절별로 풀어")
 *   - formula_source   : 산식 출처/근거 ("어디서 가져왔어", "어떻게 결정")
 *   - formula_compare  : 직전 SQL ↔ 현재 metric 산식 비교 ("왜 컬럼마다 SUM", "왜 묶지 않았")
 *   - formula_reason   : 왜 이렇게 짰는지 ("왜 이렇게", "왜 이 컬럼")
 *   - judgment         : 적절성 판단 ("맞아?", "이상한 거 아냐?", "괜찮아?")
 */
export function classifySqlExplainSubIntent(query) {
  const q = (query || '').trim();
  if (!q) return 'structure_explain';
  // formula_compare: 산식 비교 의도 (SUM/컬럼 분배/묶기 관련)
  if (/(왜|어째서|어떻게).{0,30}(컬럼마다|각 컬럼|컬럼별).{0,15}(sum|합)/i.test(q) ||
      /(왜|어째서).{0,30}(묶지|감싸지|한 번|한번|크게|전체로)/.test(q) ||
      /(분배|펼쳐|펼치|컬럼별.{0,5}sum)/i.test(q) ||
      /(왜|어째서).{0,30}(sum.{0,5}붙)/i.test(q)) {
    return 'formula_compare';
  }
  // formula_source: 산식 출처/근거
  if (/(어디서|어디에서|어디).{0,15}(가져|왔|등록|참조|기반|기준)/.test(q) ||
      /(출처|근거|기반|기준|레퍼런스)/.test(q) ||
      /(어떤 산식|무슨 산식|어떤 공식|무슨 공식)/.test(q)) {
    return 'formula_source';
  }
  // judgment: 적절성 판단
  if (/(맞아|맞나|맞는|이게 맞|이상해|이상한|잘못|틀린|틀렸|괜찮|적절|이게 답)/.test(q)) {
    return 'judgment';
  }
  // formula_reason: 왜 이렇게 짰는지
  if (/(왜|어째서).{0,30}(이렇|이런 식|이 컬럼|이 산식|이 방식|이 함수)/.test(q) ||
      /(왜|어째서).{0,30}(선택|골라|뽑|쓴|썼|골랐)/.test(q)) {
    return 'formula_reason';
  }
  // 기본
  return 'structure_explain';
}

/**
 * [2026-06-30] SQL에서 metric_code 토큰을 추출 후, metric 테이블의 현재 산식과 비교.
 *   - 직전 SQL 안의 ZAMTxxx / SUM(ZAMTxxx) 같은 패턴 식별
 *   - LLM에게 비교 컨텍스트로 전달할 metric 목록 반환
 *
 *   주의: SQL 안의 모든 컬럼이 metric_code는 아니므로, metric 테이블에 등록된 코드와 교집합만 사용.
 */
async function loadMetricsForExplain(pool, activeDomain) {
  try {
    const [rows] = await pool.query(
      `SELECT metric_code, aggregation, formula, description FROM metric WHERE domain_code = ?`,
      [activeDomain || 'PS']
    );
    return rows.map(r => ({
      metric_code: r.metric_code,
      aggregation: (r.aggregation || '').toUpperCase(),
      formula: (r.formula || '').trim(),
      description: r.description || '',
    }));
  } catch (e) {
    console.error('[Intent:sql_explain] metric 조회 실패:', e.message);
    return [];
  }
}

/**
 * [2026-06-30] 직전 SQL ↔ 현재 metric 산식의 차이 분석.
 *   휴리스틱 검출:
 *   - "AGG 분배" 패턴: SUM(A) - SUM(B) + SUM(C) 형태인데, metric formula는 row-level (A-B+C)
 *   - "단독 컬럼 사용" 패턴: SUM(ZAMT035) 단독인데, ZAMT035 산식이 row-level로 등록됨
 *   - "산식 일치" : SQL이 SUM(전체 formula) 형태 그대로 사용 중
 */
function analyzeSqlVsMetric(sql, metrics) {
  const s = sql || '';
  const norm = x => (x || '').replace(/\s+/g, '');
  const sqlNorm = norm(s);
  const findings = [];
  for (const m of metrics) {
    const code = m.metric_code;
    const formula = m.formula;
    if (!code || !formula) continue;
    const hasAggInsideFormula = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(formula);
    const level = hasAggInsideFormula ? 'column-level' : 'row-level';
    // formula에 등장하는 원시 컬럼 추출 (ZAMTxxx, BIC_xxx, ZQTYxxx)
    const cols = (formula.match(/ZAMT\d{3}|BIC_[A-Z0-9_]+|ZQTY[A-Z_]*|[A-Z_][A-Z0-9_]{2,}/g) || [])
      .filter((v,i,a) => a.indexOf(v) === i);
    const codeAppearsInSql = new RegExp(`\\b${code}\\b`, 'i').test(s);
    // formula의 컬럼들이 SQL에 충분히(>=60%) 등장하는지
    const colMatchCount = cols.filter(c => new RegExp(`\\b${c}\\b`, 'i').test(s)).length;
    const colMatchRatio = cols.length > 0 ? colMatchCount / cols.length : 0;
    const formulaColumnsAppearInSql = cols.length >= 2 && colMatchRatio >= 0.6;
    // 둘 다 아니면 이 metric은 SQL과 무관 → 스킵
    if (!codeAppearsInSql && !formulaColumnsAppearInSql) continue;

    // (1) SUM(전체 산식) 그대로 들어있는가? (공백 무시)
    const wrapped = `SUM(${norm(formula)})`;
    if (sqlNorm.includes(wrapped) || sqlNorm.includes(norm(formula))) {
      findings.push({ code, level, status: 'matches_wrapped', formula, description: m.description, viaColumns: !codeAppearsInSql });
      continue;
    }
    // (2) 단독 SUM(metric_code) — row-level metric이라면 부적절
    const standaloneSum = new RegExp(`SUM\\s*\\(\\s*${code}\\s*\\)`, 'i').test(s);
    if (standaloneSum && level === 'row-level') {
      findings.push({ code, level, status: 'standalone_sum_on_rowlevel', formula, description: m.description });
      continue;
    }
    // (3) AGG 분배 의심: formula의 모든 원시 컬럼이 SQL에서 개별 SUM()으로 등장
    if (level === 'row-level' && cols.length >= 2) {
      const summedCount = cols.filter(c => new RegExp(`SUM\\s*\\(\\s*${c}\\s*\\)`, 'i').test(s)).length;
      // 60% 이상의 컬럼이 개별 SUM()으로 감싸여 있으면 분배 패턴으로 판정
      if (summedCount / cols.length >= 0.6) {
        findings.push({
          code, level,
          status: 'agg_distributed',
          formula,
          description: m.description,
          columns: cols,
          summedCount,
          totalCols: cols.length,
          viaColumns: !codeAppearsInSql,
        });
        continue;
      }
    }
    // (4) 그 외 — 등장은 하지만 명확한 패턴 매칭 안 됨
    findings.push({ code, level, status: 'appears_unclear', formula, description: m.description, viaColumns: !codeAppearsInSql });
  }
  return findings;
}

/**
 * handleSqlExplain — 직전 생성 SQL 설명 (sub-intent 분기 지원)
 *   [2026-06-30] sub-intent 휴리스틱 + 직전 SQL ↔ 현재 metric 비교 + 응답 잘림 방지
 */
export async function handleSqlExplain({ query, activeDomain, conversationContext, pool, openai, model }) {
  const last = extractLastContext(conversationContext);

  if (!last || !last.sql) {
    return buildConversationalResponse({
      intent: 'sql_explain',
      answer: `설명할 SQL이 없습니다. 먼저 데이터 조회 질문을 하여 SQL이 생성된 뒤 "방금 SQL 설명해줘"로 다시 물어주세요.`,
      referenced: { rows: 0 },
    });
  }

  const subIntent = classifySqlExplainSubIntent(query);
  const metrics = await loadMetricsForExplain(pool, activeDomain);
  const findings = analyzeSqlVsMetric(last.sql, metrics);

  // findings 요약 문자열 (LLM에 컨텍스트로 전달)
  const findingsForLLM = findings.length === 0
    ? '(관련 metric 코드가 SQL에서 발견되지 않음 — 일반 SQL 설명만 진행)'
    : findings.map(f => {
        const head = `- ${f.code} (${f.description || ''}) [${f.level}, status=${f.status}]`;
        const formula = `\n    학습관리 산식: ${f.formula}`;
        const extra = f.status === 'agg_distributed'
          ? `\n    ⚠ 직전 SQL은 각 컬럼에 SUM()을 분배함. 학습관리 산식은 row-level이므로 SUM(산식 전체)로 묶는 것이 올바름.`
          : f.status === 'standalone_sum_on_rowlevel'
          ? `\n    ⚠ 직전 SQL은 SUM(${f.code})만 단독 사용. 학습관리에는 row-level 산식이 등록되어 있어 단순 컬럼 합산은 부적절.`
          : f.status === 'matches_wrapped'
          ? `\n    ✓ 직전 SQL은 학습관리 산식과 일치(또는 전체 SUM 형태로 사용 중).`
          : '';
        return head + formula + extra;
      }).join('\n');

  // sub-intent별 systemPrompt
  const baseHeader = `당신은 SQL/데이터 분석 어시스턴트입니다.
도메인: ${activeDomain}
응답 언어: 한국어, 마크다운 사용.
"처리할 수 없습니다" 같은 회피 표현 금지.

**응답 길이/형식 규칙 (매우 중요)**:
- 절대 응답이 중간에 잘리지 않도록 핵심부터 먼저 답하고, 결론을 끝에 명시할 것.
- 긴 산식이나 컬럼 목록은 코드 블록(\`\`\`)으로 짧게 표시하고, "총 N개 컬럼" 처럼 개수만 요약.
- 27개 이상의 컬럼이 있는 산식은 처음 3개 + ... + 마지막 1개 형태로 축약 표기.
- 풀(full) SQL이나 풀 산식이 필요하면 \`\`\`sql 블록\`\`\` 안에 한 번만 표기.`;

  const subPrompts = {
    structure_explain: `${baseHeader}

[작업] 직전 SQL을 절(節) 단위로 친절히 설명하세요.
- SELECT / FROM / WHERE / GROUP BY / ORDER BY / LIMIT 각 절을 1-2줄로
- 핵심 컬럼이 도메인적으로 무엇을 의미하는지 짧게 해석
- 산식이 길면 "총 N개 컬럼의 합" 식으로 요약`,

    formula_source: `${baseHeader}

[작업] 사용자가 "이 산식이 어디서 왔는지" 묻고 있습니다.
- 직전 SQL에서 사용된 산식이 학습관리(metric 테이블)의 어느 metric_code에서 왔는지 명시
- 해당 metric의 원본 산식(학습관리 등록값)을 그대로 인용 (길면 요약 + 코드블록)
- "산식이 학습관리 → metric 테이블 → domain=${activeDomain} 의 OOO 항목에서 가져왔습니다" 형식 문장 포함`,

    formula_compare: `${baseHeader}

[작업] 사용자가 "직전 SQL이 산식을 왜 컬럼마다 SUM으로 펼쳤는지(또는 왜 묶지 않았는지)" 묻고 있습니다.
- 아래 [SQL ↔ 학습관리 산식 비교 결과]를 근거로 답하세요.
- status=agg_distributed: 직전 SQL이 row-level 산식을 SUM(A)-SUM(B)+... 형태로 펼쳤다는 사실을 인정하고, **수학적으로는 동치지만 학습관리 권장 형태(SUM(산식 전체))와 표현이 다르다**고 설명. 향후엔 SUM(전체 산식)으로 묶어야 함을 안내.
- status=matches_wrapped: 이미 SUM(전체 산식) 형태이므로 올바름을 확인하고, 사용자에게 "현재 SQL은 산식 전체를 한 번의 SUM()으로 묶고 있습니다"라고 명확히 답.
- status=standalone_sum_on_rowlevel: SUM(metric_code) 단독은 부적절함을 지적.
- 비교 후 **권장 SQL 표현식**도 함께 제시 (전체 산식이 너무 길면 축약 + 코드블록).`,

    formula_reason: `${baseHeader}

[작업] 사용자가 "왜 이렇게 짰는지" 묻고 있습니다.
- 직전 SQL의 컬럼/조건/집계 선택의 근거를 설명
- 가능하면 학습관리 등록 산식/동의어/도메인 규칙을 근거로 인용`,

    judgment: `${baseHeader}

[작업] 사용자가 "이게 맞는지/이상한지" 판단을 묻고 있습니다.
- 직전 SQL이 학습관리 산식 기준으로 적절한지 평가
- 적절하면 "이 SQL은 학습관리 산식 기준으로 올바른 형태입니다" 명시
- 부적절하면 어떤 점이 어긋났는지 + 권장 형태 제시`,
  };

  const systemPrompt = subPrompts[subIntent] || subPrompts.structure_explain;

  // SQL 요약 — 너무 길면 LLM에게 압축본도 같이 줌
  const sqlForLLM = last.sql.length > 2500 ? last.sql.slice(0, 2400) + '\n-- ...(이하 생략)...' : last.sql;

  const userPrompt = `원래 질문: ${last.query || '(불명)'}
직전 SQL:
\`\`\`sql
${sqlForLLM}
\`\`\`

[SQL ↔ 학습관리 산식 비교 결과] (sub-intent: ${subIntent})
${findingsForLLM}

사용자 후속 요청: "${query}"

위 컨텍스트를 바탕으로 sub-intent에 맞춰 답해주세요.`;

  let answer;
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1400, // [Fix-D] 응답 잘림 방지: 700 → 1400 확장
      temperature: 0.2,
    });
    answer = resp.choices?.[0]?.message?.content?.trim();
  } catch (e) {
    console.error('[Intent:sql_explain] LLM 실패:', e.message);
  }

  if (!answer) {
    answer = `**직전 SQL**\n\n\`\`\`sql\n${last.sql.slice(0, 1500)}${last.sql.length > 1500 ? '\n-- ...(이하 생략)' : ''}\n\`\`\`\n\n` +
      `(자동 설명 생성에 일시 실패했습니다. 위 SQL을 직접 확인해 주세요.)`;
  }

  return buildConversationalResponse({
    intent: 'sql_explain',
    answer,
    referenced: {
      lastQuery: last.query,
      lastSql: last.sql.slice(0, 500),
      subIntent,
      findings: findings.map(f => ({ code: f.code, status: f.status, level: f.level })),
    },
  });
}

/**
 * handleDomainExplain — 현재 도메인/필터 조건 설명
 */
export async function handleDomainExplain({ query, activeDomain, conversationContext, pool, openai, model }) {
  let domainInfo = null;
  let metricCount = 0;
  let columnCount = 0;

  try {
    const [drows] = await pool.query(
      `SELECT domain_code, domain_name FROM domain_master WHERE domain_code = ? AND is_active = 1`,
      [activeDomain]
    );
    domainInfo = drows[0] || null;
  } catch (e) {
    console.error('[Intent:domain_explain] domain_master 실패:', e.message);
  }

  try {
    const [mc] = await pool.query(`SELECT COUNT(*) AS c FROM metric WHERE domain_code = ?`, [activeDomain]);
    metricCount = mc[0]?.c || 0;
  } catch (e) { /* ignore */ }

  try {
    const [oc] = await pool.query(
      `SELECT COUNT(*) AS c FROM ontology_column WHERE domain_code = ? AND is_active = 1`,
      [activeDomain]
    );
    columnCount = oc[0]?.c || 0;
  } catch (e) { /* ignore */ }

  const divisionDesc = DOMAIN_DIVISION[activeDomain] || '(미정의)';

  const fact = `**현재 분석 영역**: \`${activeDomain}\` ${domainInfo?.domain_name ? `(${domainInfo.domain_name})` : ''}\n` +
    `**자동 적용 필터**: ${divisionDesc}\n` +
    `**등록 지표 수**: ${metricCount}개\n` +
    `**등록 컬럼 수**: ${columnCount}개`;

  const systemPrompt = `당신은 BI 시스템의 도메인/필터 설명 어시스턴트입니다.
- DB에서 조회한 사실(현재 도메인 메타정보)만 사용
- 마크다운 활용
- "처리할 수 없습니다" 같은 표현 금지`;

  const userPrompt = `사용자 질문: "${query}"

확인된 사실:
${fact}

위 사실 기반으로 사용자에게 친절하게 설명해주세요. 다른 도메인(PS/HL/MGMT)이 무엇인지 비교 설명해도 좋습니다.

참고 - 다른 도메인:
- PS: DIVISION='10'
- HL: DIVISION='20'
- MGMT: 전사 (DIVISION 필터 없음)`;

  let answer;
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });
    answer = resp.choices?.[0]?.message?.content?.trim();
  } catch (e) {
    console.error('[Intent:domain_explain] LLM 실패:', e.message);
  }

  if (!answer) answer = fact;

  return buildConversationalResponse({
    intent: 'domain_explain',
    answer,
    referenced: {
      sourceTable: 'domain_master',
      domainCode: activeDomain,
      metricCount,
      columnCount,
    },
  });
}

/**
 * handleGeneralChat — 시스템 사용법/FAQ
 * 잡담(인사/감정/날씨)은 정중히 거절하고 시스템 사용법으로 유도.
 */
export async function handleGeneralChat({ query, activeDomain, conversationContext, pool, openai, model }) {
  const systemPrompt = `당신은 한국 기업의 BI(자연어 질의) 시스템의 사용 안내 어시스턴트입니다.
당신의 역할은 **시스템 사용법/FAQ 안내**에만 국한됩니다.

규칙:
- 인사/잡담/감정/날씨/뉴스 등 시스템과 무관한 질문은 **정중히 거절**하고 시스템 사용 예시로 유도하세요.
- 시스템 사용법 질문이면 다음 4가지 모드를 친절히 안내:
  1. **현황집계 모드** (라디오: 현황집계) — 표/차트로 데이터 조회 (예: "이번 달 PS 매출 상위 10건")
  2. **분석질문 모드** (라디오: 분석질문) — 텍스트 분석/해석 (예: "PS 매출이 줄어든 원인 분석")
  3. **후속 자동 분류** — 라디오 그대로 두고 다음과 같이 물으면 자동 처리:
     - "영업이익 산식이 뭐야?" → 지표 사전 조회
     - "DIVISION 컬럼이 뭐야?" → 용어 사전 조회
     - "왜 결과가 0건이야?" → 직전 조회 원인 진단
     - "방금 SQL 설명해줘" → SQL 풀어쓰기
     - "지금 어느 도메인이야?" → 도메인/필터 설명
- 마크다운 사용 가능
- "처리할 수 없습니다" / "지원하지 않는 질문입니다" 같은 표현 절대 금지`;

  const userPrompt = `현재 도메인: ${activeDomain}
사용자 질문: "${query}"

위 질문에 답하세요.`;

  let answer;
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 600,
      temperature: 0.4,
    });
    answer = resp.choices?.[0]?.message?.content?.trim();
  } catch (e) {
    console.error('[Intent:general_chat] LLM 실패:', e.message);
  }

  if (!answer) {
    answer = `**BI 자연어 질의 시스템 사용 안내**\n\n` +
      `다음과 같이 사용할 수 있습니다:\n` +
      `1. **현황집계 모드** — 표/차트로 데이터 조회 (예: "이번 달 ${activeDomain} 매출 상위 10건")\n` +
      `2. **분석질문 모드** — 텍스트 분석/해석 (예: "${activeDomain} 매출 감소 원인 분석")\n` +
      `3. **후속 자동 분류** — "영업이익 산식이 뭐야?", "왜 결과가 0건이야?" 등 자유롭게 물어보세요.`;
  }

  return buildConversationalResponse({
    intent: 'general_chat',
    answer,
  });
}

// ============================================================
// handleMemorySave — 사용자 개인 규칙 자동 등록 (nl_user_memory)
// ============================================================
// - 사용자가 "앞으로 rt는 두루마리로 불러줘" 처럼 개인 규칙을 선언하면
//   LLM 으로 규칙을 JSON 으로 추출 → 서버가 INSERT.
// - Metric 산식 오버라이드 시도는 서버(POST /api/user-memory) 저장 단계에서 차단.
// - 상한(50개) 초과 시 저장 실패 안내 반환.
// - 필수 컨텍스트: userId (server.mjs 가 handler 호출 시 넘겨줌)
// ============================================================
export async function handleMemorySave({ query, activeDomain, conversationContext, pool, openai, model, userId }) {
  // userId 없으면 규칙 저장 불가 (로그인 사용자만)
  if (!userId) {
    return buildConversationalResponse({
      intent: 'memory_save',
      answer: '개인 규칙을 저장하려면 로그인이 필요합니다.',
      referenced: [],
    });
  }

  const systemPrompt = `당신은 사용자 발화에서 "앞으로 적용할 개인 규칙"을 추출하는 파서입니다.
사용자가 방금 말한 규칙을 다음 3가지 유형 중 하나로 분류하고, 저장용 JSON 을 생성하세요.

[유형]
- term_alias         : 사용자 개인 용어 별칭 (예: "rt 는 두루마리로 불러줘")
                       필드: { "memory_type":"term_alias", "user_expression":"rt", "normalized_meaning":"두루마리" }
- query_preference   : 특정 질문 패턴에 컬럼/포맷 선호 (예: "영업팀별 영업이익 순위 물으면 영업이익율도 같이")
                       필드: { "memory_type":"query_preference", "trigger_text":"영업팀별 영업이익 순위",
                                "rule_json": {"add_columns":["영업이익율(%)"]} }
- metric_preference  : 특정 지표 조회 시 추가 지표/각도 함께 (예: "매출 볼 때 지급수수료도 같이")
                       필드: { "memory_type":"metric_preference", "trigger_text":"매출",
                                "rule_json": {"note":"지급수수료 컬럼 함께 조회"} }

[절대 규칙]
1. Metric 산식(계산식/formula/SQL 표현) 을 사용자가 바꾸려 하면 → { "reject": true, "reason": "산식은 학습관리에서만 변경 가능합니다." }
   예: "영업이익 산식을 SUM(ZAMT099)로 바꿔줘" → reject.
2. 시스템 전체 규칙(다른 사용자에게도 적용) 을 만들려 하면 → reject.
3. 유형 판별이 어려우면 → { "reject": true, "reason": "규칙 의도를 파악할 수 없습니다. 예시: '앞으로 rt는 두루마리라고 불러줘'" }
4. 규칙 하나만 추출 (여러 규칙 요청은 첫 규칙만).

[응답 형식]
반드시 아래 두 형식 중 하나로 JSON 응답:
성공: {"memory_type":"...", "user_expression":"...", "normalized_meaning":"...", "trigger_text":"...", "rule_json":{...}, "confirm_message":"저장 확인 메시지"}
거부: {"reject": true, "reason":"...", "confirm_message":"사용자에게 보여줄 안내"}`;

  const userPrompt = `사용자 발화: "${query}"`;

  let parsed = null;
  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 400,
      temperature: 0,
    });
    parsed = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
  } catch (e) {
    console.error('[Intent:memory_save] 파서 LLM 실패:', e.message);
    return buildConversationalResponse({
      intent: 'memory_save',
      answer: '개인 규칙을 이해하지 못했습니다. 예를 들어 이렇게 말씀해 주세요:\n\n' +
              '- "앞으로 rt는 두루마리라고 불러줘"\n' +
              '- "영업팀별 영업이익 순위 물으면 영업이익율도 같이 보여줘"',
      referenced: [],
    });
  }

  // 거부 케이스
  if (parsed.reject) {
    const msg = parsed.confirm_message || parsed.reason || '이 규칙은 개인 규칙으로 저장할 수 없습니다.';
    return buildConversationalResponse({
      intent: 'memory_save',
      answer: `⚠️ ${msg}`,
      referenced: [],
    });
  }

  // 저장 실행
  try {
    // 상한 검증
    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS c FROM nl_user_memory WHERE user_id = ? AND is_active = 'Y'`,
      [userId]
    );
    if (cnt[0].c >= 50) {
      return buildConversationalResponse({
        intent: 'memory_save',
        answer: `⚠️ 개인 규칙이 이미 50개 등록되어 있습니다.\n\n좌측 메뉴의 **"내 개인 규칙"** 화면에서 사용하지 않는 규칙을 삭제한 뒤 다시 시도해 주세요.`,
        referenced: [],
      });
    }

    // 필드 검증
    const memory_type = parsed.memory_type;
    if (!['term_alias', 'query_preference', 'metric_preference'].includes(memory_type)) {
      return buildConversationalResponse({
        intent: 'memory_save',
        answer: '규칙 유형을 판별하지 못했습니다. 다시 시도해 주세요.',
        referenced: [],
      });
    }

    // rule_json 문자열화 (있으면)
    let rule_json_str = null;
    if (parsed.rule_json && typeof parsed.rule_json === 'object') {
      rule_json_str = JSON.stringify(parsed.rule_json);
    }

    // ★ 산식 오버라이드 방지 — 모든 필드(rule_json + 텍스트 필드) 전수 검사
    //   자연어질의 답변은 학습관리(metric.formula)가 최우선. 개인 규칙은 산식을 덮어쓸 수 없음.
    const _formulaCheck = detectFormulaOverrideInPayload({
      rule_json: rule_json_str,
      normalized_meaning: parsed.normalized_meaning,
      trigger_text: parsed.trigger_text,
      user_expression: parsed.user_expression,
    });
    if (_formulaCheck.blocked) {
      console.log(`[Intent:memory_save] 산식 시도 차단 (field=${_formulaCheck.field}, reason=${_formulaCheck.reason}, userId=${userId})`);
      return buildConversationalResponse({
        intent: 'memory_save',
        answer: `⚠️ ${FORMULA_OVERRIDE_MESSAGE}`,
        referenced: [],
      });
    }

    const [ins] = await pool.query(
      `INSERT INTO nl_user_memory
         (user_id, memory_type, trigger_text, user_expression, normalized_meaning, rule_json, source_query, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'Y')`,
      [
        userId, memory_type,
        parsed.trigger_text       ? String(parsed.trigger_text).slice(0, 500)       : null,
        parsed.user_expression    ? String(parsed.user_expression).slice(0, 500)    : null,
        parsed.normalized_meaning ? String(parsed.normalized_meaning).slice(0, 500) : null,
        rule_json_str,
        String(query).slice(0, 2000),
      ]
    );

    const confirmMsg = parsed.confirm_message || _defaultMemorySaveConfirm(parsed);
    return buildConversationalResponse({
      intent: 'memory_save',
      answer: `✅ 개인 규칙을 저장했습니다.\n\n${confirmMsg}\n\n> 이 규칙은 앞으로 이 계정의 자연어 질의에 자동 적용됩니다. 좌측 메뉴의 **"내 개인 규칙"** 에서 언제든 삭제/수정할 수 있습니다.`,
      referenced: [{ type: 'user_memory', id: ins.insertId }],
    });
  } catch (dbErr) {
    console.error('[Intent:memory_save] DB 저장 실패:', dbErr.message);
    return buildConversationalResponse({
      intent: 'memory_save',
      answer: `⚠️ 개인 규칙 저장 중 오류가 발생했습니다: ${dbErr.message}`,
      referenced: [],
    });
  }
}

function _defaultMemorySaveConfirm(parsed) {
  if (parsed.memory_type === 'term_alias') {
    return `"${parsed.user_expression}" 은/는 "${parsed.normalized_meaning}" 로 해석됩니다.`;
  }
  if (parsed.memory_type === 'query_preference') {
    let extra = '';
    if (parsed.rule_json && Array.isArray(parsed.rule_json.add_columns)) {
      extra = ` — 다음 컬럼 함께 포함: ${parsed.rule_json.add_columns.join(', ')}`;
    }
    return `"${parsed.trigger_text}" 유형 질문에 개인 선호가 적용됩니다.${extra}`;
  }
  if (parsed.memory_type === 'metric_preference') {
    const note = parsed.rule_json?.note || '개인 선호 반영';
    return `"${parsed.trigger_text}" 관련 조회 시: ${note}`;
  }
  return '규칙이 저장되었습니다.';
}
