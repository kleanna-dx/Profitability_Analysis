import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildRagIndex,
  searchRelevantMeta,
  ragResultToPromptContext,
  addToIndex,
  removeFromIndex,
  getRagStats,
} from './rag.mjs';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(import.meta.dirname, 'public')));

// ============================================================
// OpenAI Client 초기화
// ============================================================
const openai = new OpenAI({
  apiKey: process.env.GSK_TOKEN || process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://www.genspark.ai/api/llm_proxy/v1',
});

// ============================================================
// MariaDB 커넥션 풀
// ============================================================
const pool = mysql.createPool({
  host: 'localhost',
  user: 'company',
  password: 'company1234!',
  database: 'company_board',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

// ============================================================
// DB 메타데이터 (테이블 구조, Ontology, Metric, Join)
// ============================================================
const TABLE_SCHEMA = `
테이블명: bw_profitability_data
설명: BW 수익성분석 데이터 (SAP BW 원천, 약 22.7만행)
주의: 이 테이블에는 _NM(명칭) 컬럼이 없습니다. 코드값의 명칭 표시는 반드시 CASE WHEN 구문을 사용하세요.

컬럼 목록 (컬럼명 | 데이터타입 | 설명):
-- PK --
SEQ          | BIGINT (PK, AUTO_INCREMENT) | 일련번호

-- 기간 --
CALMONTH     | VARCHAR(10)   | 달력연도/월 (YYYYMM, 예: 202405)
CALDAY       | VARCHAR(10)   | 달력일 (YYYYMMDD, 예: 20240501)

-- 조직 --
CO_AREA      | VARCHAR(10)   | 관리회계 영역 (예: A100)
PROFIT_CTR   | VARCHAR(20)   | 손익 센터 (10자리, 선행0 포함. 예: 0000002000=제지사업부, 0000001000=생활용품사업부)
DIVISION     | VARCHAR(5)    | 제품군 코드 (예: 10=PS, 20=HL)
PLANT        | VARCHAR(10)   | 플랜트 코드 (예: P100, P200, P300, P400, P500)
DISTR_CHAN   | VARCHAR(5)    | 유통 경로 코드 (예: 10=내수, 20=로컬, 30=수출)
ZDISTCHAN    | VARCHAR(5)    | 내수/수출구분자(사업장)
ZORG_TEAM    | VARCHAR(10)   | 영업팀(사업장그룹) 코드
SALES_OFF    | VARCHAR(10)   | 사업장 코드

-- 자재/제품 --
MATL_TYPE    | VARCHAR(10)   | 자재유형 코드 (예: FERT, HAWA)
MATL_GROUP   | VARCHAR(10)   | 자재 그룹 코드
PRODH1       | VARCHAR(10)   | 제품계층 구조레벨1 코드 (예: 350=생리대, 310=미용티슈, 330=물티슈, 300=두루마리)
PRODH2       | VARCHAR(15)   | 제품계층 구조레벨2 코드
PRODH3       | VARCHAR(15)   | 제품계층 구조레벨3 코드
PRODH4       | VARCHAR(20)   | 제품계층 구조레벨4 코드
ZJPCODE      | VARCHAR(10)   | 지종/제품구분 코드 (예: SN, FT, WT)
ZBRAND1      | VARCHAR(10)   | 브랜드1 코드 (예: BRH006, BRH002)
ZBRAND2      | VARCHAR(10)   | 브랜드2 코드

-- 거래처 --
BILL_TYPE    | VARCHAR(10)   | 대금청구유형 코드
INCOTERMS    | VARCHAR(5)    | 인도 조건 코드
CUST_GROUP   | VARCHAR(5)    | 고객 그룹 코드
CUST_GRP1    | VARCHAR(5)    | 고객 그룹1 코드
COUNTRY      | VARCHAR(5)    | 국가 코드 (예: KR)
ZKUNN2       | VARCHAR(20)   | 영업사원 코드
CUSTOMER     | VARCHAR(20)   | 고객 코드
MATERIAL     | VARCHAR(30)   | 자재 코드 (예: SWT-AAD0027A)
MATERIAL_DESC| VARCHAR(100)  | 자재명 (예: 깨끗한나라 물티슈 페퍼민트 블루 캡형 60매 24입)

-- 수량 단위 --
ZUNITBOX     | VARCHAR(5)    | 수량단위(BOX)
ZUNITBAG     | VARCHAR(5)    | 수량단위(BAG)
ZUNITKGEA    | VARCHAR(5)    | 수량단위(KG/EA)
CURRENCY     | VARCHAR(5)    | 통화 (예: KRW)

-- 수량 --
ZQTYBOX      | DECIMAL(18,3) | 수량(BOX)
ZQTYBAG      | BIGINT        | 수량(BAG)
ZQTYKGEA     | DECIMAL(18,3) | 수량(KG/EA)

-- 금액 (ZAMT001 ~ ZAMT064, 모두 BIGINT 타입) --
ZAMT001 | BIGINT | 총매출
ZAMT002 | BIGINT | 판매장려금
ZAMT003 | BIGINT | 순매출
ZAMT004 | BIGINT | 기타매출
ZAMT005 | BIGINT | 매출원가(제품)
ZAMT006 | BIGINT | 재료비-펄프
ZAMT007 | BIGINT | 재료비-고지
ZAMT008 | BIGINT | 재료비-패드
ZAMT009 | BIGINT | 부재료비-약품
ZAMT010 | BIGINT | 부재료비-포장재
ZAMT011 | BIGINT | 재료비-기타
ZAMT012 | BIGINT | 인건비
ZAMT013 | BIGINT | 인건비_경비
ZAMT014 | BIGINT | 인건비_기타
ZAMT015 | BIGINT | 도급비
ZAMT016 | BIGINT | 에너지비
ZAMT017 | BIGINT | 전력비
ZAMT018 | BIGINT | 감가상각비
ZAMT019 | BIGINT | 수선/소모품비
ZAMT020 | BIGINT | 기타경비
ZAMT021 | BIGINT | 기타경비_폐기물
ZAMT022 | BIGINT | 기타경비_세금과공과
ZAMT023 | BIGINT | 기타경비_지급수수료
ZAMT024 | BIGINT | 외주가공비
ZAMT025 | BIGINT | 매출원가(상품)
ZAMT026 | BIGINT | 매출원가(기타)
ZAMT027 | BIGINT | 기타원가
ZAMT028 | BIGINT | 단수차이
ZAMT029 | BIGINT | 차이잔액
ZAMT030 | BIGINT | 제조파지정산
ZAMT031 | BIGINT | 기타매출원가+감모손+평가손
ZAMT032 | BIGINT | 원재료 투입차이
ZAMT033 | BIGINT | 기타매출원가 배부조정
ZAMT034 | BIGINT | 매출원가 계
ZAMT035 | BIGINT | 매출총이익
ZAMT036 | BIGINT | 판매관리비
ZAMT037 | BIGINT | 급여(변동)
ZAMT038 | BIGINT | 국내운반비(변동)
ZAMT039 | BIGINT | 수출운반비(변동)
ZAMT040 | BIGINT | 지급수수료(변동)
ZAMT041 | BIGINT | 기타판관비(변동)
ZAMT042 | BIGINT | 개발비(변동)
ZAMT043 | BIGINT | 급여(고정)
ZAMT044 | BIGINT | 지급수수료(고정)
ZAMT045 | BIGINT | 기타판관비(고정)
ZAMT046 | BIGINT | 개발비(고정)
ZAMT047 | BIGINT | 마케팅비
ZAMT048 | BIGINT | 광고비
ZAMT049 | BIGINT | 소모품비
ZAMT050 | BIGINT | 지급수수료-마케팅(변동)
ZAMT051 | BIGINT | 지급수수료-마케팅(고정)
ZAMT052 | BIGINT | 마케팅비_장려금(변동)
ZAMT053 | BIGINT | 판촉비
ZAMT054 | BIGINT | 마케팅비 배부조정
ZAMT055 | BIGINT | 영업이익
ZAMT056 | BIGINT | 영업외수익
ZAMT057 | BIGINT | 이자수익
ZAMT058 | BIGINT | 외환이익
ZAMT059 | BIGINT | 기타영업외수익
ZAMT060 | BIGINT | 영업외비용
ZAMT061 | BIGINT | 이자비용
ZAMT062 | BIGINT | 외환손실
ZAMT063 | BIGINT | 기타영업외비용
ZAMT064 | BIGINT | 경상이익
`;

// ============================================================
// Metric Dictionary (AI가 수식을 창작하지 않고 이 사전만 참조)
// ============================================================
const METRIC_DICTIONARY = `
계산 지표 사전 (Metric Dictionary):
- 총매출 = SUM(ZAMT001)
- 판매장려금 = SUM(ZAMT002)
- 순매출 = SUM(ZAMT003)  [또는 SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004)]
- 매출원가 = SUM(ZAMT034)
- 매출총이익 = SUM(ZAMT035)
- 매출총이익률 = SUM(ZAMT035) / NULLIF(SUM(ZAMT003),0) * 100
- 판매관리비 = SUM(ZAMT036)
- 영업이익 = SUM(ZAMT055)
- 영업이익률 = SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100
- 경상이익 = SUM(ZAMT064)
- BOX수량 = SUM(ZQTYBOX)
- BAG수량 = SUM(ZQTYBAG)
- EA수량 = SUM(ZQTYKGEA)
- 평균단가(BOX) = SUM(ZAMT001) / NULLIF(SUM(ZQTYBOX),0)
- 재료비합계 = SUM(ZAMT006)+SUM(ZAMT007)+SUM(ZAMT008)+SUM(ZAMT009)+SUM(ZAMT010)+SUM(ZAMT011)
- 인건비합계 = SUM(ZAMT012)+SUM(ZAMT013)+SUM(ZAMT014)
- 마케팅비합계 = SUM(ZAMT047)+SUM(ZAMT048)+SUM(ZAMT049)+SUM(ZAMT050)+SUM(ZAMT051)+SUM(ZAMT052)+SUM(ZAMT053)+SUM(ZAMT054)
`;

// ============================================================
// RAG 상태 관리
// ============================================================
let ragReady = false;  // RAG 인덱스 빌드 완료 여부

// ============================================================
// System Prompt (RAG 기반 동적 생성)
// ============================================================
// 핵심 규칙만 포함한 경량 기본 프롬프트 (RAG 컨텍스트가 동적으로 추가됨)
const BASE_SYSTEM_PROMPT = `당신은 수익성 분석 데이터베이스 전문가입니다.
사용자의 자연어 질문을 MariaDB SQL로 변환합니다.

[핵심 규칙]
1. SELECT 문만 생성 (INSERT/UPDATE/DELETE/DROP 절대 금지)
2. 테이블은 bw_profitability_data 하나만 사용
3. 계산 지표는 반드시 아래 제공된 Metric Dictionary만 사용 (새로운 수식 창작 금지)
4. 결과 행은 최대 1000행 (LIMIT 1000)
5. **금액 표시**: FORMAT(SUM(ZAMT***), 0) AS 별칭. **ORDER BY에는 FORMAT 별칭 사용 금지!** → ORDER BY SUM(ZAMT***) DESC 사용
6. 비율: ROUND(..., 1), 소수점 1자리
7. GROUP BY 시 반드시 집계 함수 사용
8. 컬럼 alias는 한글
9. 정렬: 금액 DESC, 코드 ASC
10. NULL 방지: COALESCE 또는 IFNULL
11. _NM 컬럼 없음 → CASE WHEN으로 명칭 표시
12. 코드매핑 컬럼은 GROUP BY 코드컬럼 + CASE WHEN 명칭
13. 명칭으로 질문 시 코드값으로 WHERE
14. PROFIT_CTR: 10자리 선행0 (예: '0000002000')
15. 자재명: MATERIAL_DESC (MATERIAL_NM 없음)
16. 브랜드: ZBRAND1, ZBRAND2
17. 수량: ZQTYBOX(BOX), ZQTYBAG(BAG), ZQTYKGEA(KG/EA)
18. 수량단위: ZUNITBOX, ZUNITBAG, ZUNITKGEA
19. **학습 데이터 우선**: 아래 RAG 컨텍스트에 유사 질문의 검증된 SQL이 있으면 우선 사용

응답 형식 (반드시 JSON):
{
  "sql": "SELECT ...",
  "explanation": "이 쿼리는 ... 을 조회합니다",
  "chartType": "bar|line|pie|table",
  "chartConfig": {
    "labelColumn": "라벨컬럼alias",
    "dataColumns": ["데이터컬럼alias"],
    "title": "차트 제목"
  }
}

chartType 기준: bar(카테고리 비교), line(시계열), pie(비율), table(상세 데이터)
`;

/**
 * RAG 기반 시스템 프롬프트 생성
 * - 질문과 관련된 메타데이터만 검색하여 프롬프트에 주입
 * - 전체 덤프(프롬프트 스터핑) 대신 필요한 컨텍스트만 포함
 * @param {string} query - 사용자 질문
 * @returns {Promise<{prompt: string, ragContext: Object}>}
 */
async function buildRAGSystemPrompt(query) {
  let ragContext = null;
  let contextText = '';

  if (ragReady) {
    try {
      // RAG 검색: 질문 관련 메타데이터 청크 검색
      ragContext = await searchRelevantMeta(pool, query, {
        topK: 25,
        minScore: 0.20,
        schemaTopK: 12,
        metricTopK: 5,
        feedbackTopK: 5,
        codeMappingTopK: 5,
        ruleTopK: 5,
      });
      contextText = ragResultToPromptContext(ragContext);
      console.log(`[RAG] 프롬프트 컨텍스트 길이: ${contextText.length}자`);
    } catch (e) {
      console.error('[RAG] 검색 실패, 폴백 프롬프트 사용:', e.message);
      contextText = await buildFallbackContext();
    }
  } else {
    // RAG 미준비 시 폴백 (기존 방식과 동일하게 전체 로드)
    console.warn('[RAG] 인덱스 미준비, 폴백 프롬프트 사용');
    contextText = await buildFallbackContext();
  }

  // 기본 스키마 정보는 항상 포함 (RAG가 충분한 스키마를 못 찾을 수 있으므로)
  const prompt = BASE_SYSTEM_PROMPT + '\n' + TABLE_SCHEMA + '\n' + METRIC_DICTIONARY
    + '\n\n--- RAG 검색 컨텍스트 (질문 관련 메타데이터) ---\n' + contextText;

  return { prompt, ragContext };
}

/**
 * RAG 미준비 시 폴백: 기존 프롬프트 스터핑 방식
 */
async function buildFallbackContext() {
  let ctx = '';
  try {
    const [rows] = await pool.query(
      `SELECT column_name, column_name_nm, code_value, display_name
       FROM code_mapping WHERE is_active = 1 ORDER BY column_name, code_value`
    );
    if (rows.length > 0) {
      const grouped = {};
      for (const r of rows) {
        if (!grouped[r.column_name]) grouped[r.column_name] = [];
        grouped[r.column_name].push({ code: r.code_value, name: r.display_name });
      }
      ctx += '\n[코드값 매핑]\n';
      for (const [col, items] of Object.entries(grouped)) {
        ctx += `${col}: ${items.map(i => `${i.code}=${i.name}`).join(', ')}\n`;
      }
    }
  } catch (e) { /* 무시 */ }
  try {
    const [fbRows] = await pool.query(
      `SELECT query_text, corrected_sql, feedback_type FROM sql_feedback WHERE is_active = 1 ORDER BY created_at DESC LIMIT 20`
    );
    if (fbRows.length > 0) {
      ctx += '\n[검증된 SQL 예시]\n';
      for (const fb of fbRows) {
        const label = fb.feedback_type === 'corrected' ? '[수정]' : '[검증]';
        ctx += `${label} "${fb.query_text}" → ${fb.corrected_sql}\n`;
      }
    }
  } catch (e) { /* 무시 */ }
  return ctx;
}

// ============================================================
// API: 자연어 질의 실행
// ============================================================
app.post('/api/nlq', async (req, res) => {
  const { query } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: '질의를 입력하세요.' });
  }

  try {
    console.log(`[NLQ] 질의: ${query}`);

    // 0. 학습 데이터에서 정확 매칭 검색 (corrected 우선, 가장 최근 것 사용)
    let matchedSql = null;
    try {
      const [fbMatch] = await pool.query(
        `SELECT corrected_sql, feedback_type FROM sql_feedback
         WHERE query_text = ? AND is_active = 1
         ORDER BY FIELD(feedback_type, 'corrected', 'correct') ASC, created_at DESC
         LIMIT 1`,
        [query.trim()]
      );
      if (fbMatch.length > 0) {
        matchedSql = fbMatch[0].corrected_sql;
        console.log(`[NLQ] 학습 데이터 매칭됨 (${fbMatch[0].feedback_type}): ${matchedSql.substring(0, 80)}...`);
      }
    } catch (e) {
      console.error('[NLQ] 학습 데이터 조회 실패:', e.message);
    }

    let sql, explanation, chartType, chartConfig;

    if (matchedSql) {
      // 학습 데이터 매칭 → AI 호출 없이 직접 사용
      sql = matchedSql;
      explanation = '학습된 SQL을 사용합니다 (사용자 검증 완료).';
      // 차트 타입은 AI에게 간단히 판별 요청 (비용 절약을 위해 짧은 프롬프트)
      try {
        const chartCompletion = await openai.chat.completions.create({
          model: 'gpt-5-mini',
          messages: [
            { role: 'system', content: '주어진 SQL의 결과에 가장 적합한 차트 유형을 판단하세요. 응답은 반드시 JSON: {"chartType":"bar|line|pie|table","chartConfig":{"labelColumn":"라벨컬럼alias","dataColumns":["데이터컬럼alias"],"title":"차트 제목"}}' },
            { role: 'user', content: `질문: ${query}\nSQL: ${sql}` },
          ],
          temperature: 0,
          response_format: { type: 'json_object' },
        });
        const chartParsed = JSON.parse(chartCompletion.choices[0].message.content);
        chartType = chartParsed.chartType || 'table';
        chartConfig = chartParsed.chartConfig || {};
      } catch (e) {
        console.error('[NLQ] 차트 판별 실패, table로 기본:', e.message);
        chartType = 'table';
        chartConfig = {};
      }
    } else {
      // 1. RAG 기반 SQL 생성 (질문 관련 메타데이터만 검색하여 프롬프트에 주입)
      const { prompt: systemPrompt, ragContext } = await buildRAGSystemPrompt(query);
      console.log(`[NLQ] RAG 프롬프트 길이: ${systemPrompt.length}자 (RAG 활성: ${ragReady})`);

      const completion = await openai.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0].message.content;
      console.log(`[NLQ] GPT 응답: ${raw}`);

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return res.status(500).json({ error: 'AI 응답 파싱 실패', raw });
      }

      sql = parsed.sql;
      explanation = parsed.explanation;
      chartType = parsed.chartType;
      chartConfig = parsed.chartConfig;
    }

    // 2. SQL 검증
    const sqlUpper = sql.toUpperCase().trim();
    if (!sqlUpper.startsWith('SELECT')) {
      return res.status(400).json({ error: 'SELECT 쿼리만 허용됩니다.', sql });
    }
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'GRANT', 'REVOKE'];
    for (const kw of forbidden) {
      if (sqlUpper.includes(kw)) {
        return res.status(400).json({ error: `금지된 키워드: ${kw}`, sql });
      }
    }

    // 3. DB 실행
    const startTime = Date.now();
    const [rows] = await pool.query(sql);
    const execTime = Date.now() - startTime;

    console.log(`[NLQ] SQL 실행: ${execTime}ms, ${rows.length}행`);

    const result = {
      success: true,
      query,
      sql,
      explanation: explanation + (matchedSql ? ' 📚' : (ragReady ? ' 🔍 RAG' : '')),
      chartType: chartType || 'table',
      chartConfig: chartConfig || {},
      data: rows,
      rowCount: rows.length,
      executionTimeMs: execTime,
      ragEnabled: ragReady,
    };

    // 4. 이력 저장 (비동기, 실패해도 응답에 영향 없음)
    saveHistory(query, sql, explanation, chartType || 'table', chartConfig || {}, rows, rows.length, execTime, 'SUCCESS', null)
      .catch(e => console.error('[History] 저장 실패:', e.message));

    return res.json(result);
  } catch (err) {
    console.error('[NLQ] Error:', err);
    const msg = err.sqlMessage || err.message || String(err);

    // 실패 이력도 저장
    saveHistory(query, null, null, null, null, null, 0, 0, 'FAILED', msg)
      .catch(e => console.error('[History] 실패이력 저장 실패:', e.message));

    return res.status(500).json({ error: msg, query });
  }
});

// ============================================================
// 이력 저장 헬퍼 함수
// ============================================================
async function saveHistory(queryText, sql, explanation, chartType, chartConfig, resultData, rowCount, execTime, status, errorMsg) {
  // result_data는 최대 100행만 저장 (DB 용량 절약)
  const trimmedData = resultData ? JSON.stringify(resultData.slice(0, 100)) : null;
  const configJson = chartConfig ? JSON.stringify(chartConfig) : null;
  await pool.query(
    `INSERT INTO nl_query_history (query_text, generated_sql, explanation, chart_type, chart_config, result_data, row_count, execution_time_ms, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [queryText, sql, explanation, chartType, configJson, trimmedData, rowCount, execTime, status, errorMsg]
  );
}

// ============================================================
// API: 질의 이력 조회 (최근 50건)
// ============================================================
app.get('/api/history', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [rows] = await pool.query(
      `SELECT id, query_text, generated_sql, explanation, chart_type, chart_config, result_data, row_count, execution_time_ms, status, error_message, created_at
       FROM nl_query_history ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
    // JSON 문자열 -> 객체로 파싱
    const result = rows.map(r => ({
      ...r,
      chart_config: r.chart_config ? JSON.parse(r.chart_config) : null,
      result_data: r.result_data ? JSON.parse(r.result_data) : null,
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 단건 조회 (결과 데이터 포함)
app.get('/api/history/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM nl_query_history WHERE id=?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    const r = rows[0];
    r.chart_config = r.chart_config ? JSON.parse(r.chart_config) : null;
    r.result_data = r.result_data ? JSON.parse(r.result_data) : null;
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 삭제
app.delete('/api/history/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM nl_query_history WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 전체 삭제
app.delete('/api/history', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE nl_query_history');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: DB 상태 확인
// ============================================================
app.get('/api/status', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM bw_profitability_data');
    let ragStats = null;
    try {
      ragStats = await getRagStats(pool);
    } catch (e) { /* 무시 */ }
    res.json({
      db: 'connected',
      table: 'bw_profitability_data',
      totalRows: rows[0].cnt,
      ai: 'gpt-5-mini',
      rag: {
        enabled: ragReady,
        totalChunks: ragStats?.total || 0,
        byType: ragStats?.byType || {},
      },
    });
  } catch (err) {
    res.status(500).json({ db: 'error', error: err.message });
  }
});

// ============================================================
// API: 추천 질의
// ============================================================
app.get('/api/suggestions', (req, res) => {
  res.json([
    '플랜트별 총매출 현황을 알려줘',
    '제품계층1(PRODH1)별 매출 비중을 보여줘',
    '일자별 총매출 추이를 보여줘',
    '사업장별 총매출 TOP 10',
    '브랜드별 총매출과 BOX수량을 비교해줘',
    '유통경로별 총매출 구성비를 보여줘',
    '플랜트별, 제품계층1별 총매출을 보여줘',
    '총매출이 가장 높은 자재 TOP 20',
    '고객그룹별 총매출을 보여줘',
    '지종별 총매출과 BOX수량을 알려줘',
  ]);
});

// ============================================================
// 학습관리 API: Ontology (컬럼)
// ============================================================
// 전체 목록 (동의어 포함)
app.get('/api/ontology', async (req, res) => {
  try {
    const [columns] = await pool.query(
      `SELECT c.*, GROUP_CONCAT(s.id, ':::', s.synonym_text ORDER BY s.id SEPARATOR '|||') AS synonyms
       FROM ontology_column c
       LEFT JOIN ontology_synonym s ON s.column_id = c.id
       GROUP BY c.id ORDER BY c.id`
    );
    const result = columns.map(row => ({
      ...row,
      synonyms: row.synonyms
        ? row.synonyms.split('|||').map(s => { const [id, text] = s.split(':::'); return { id: Number(id), text }; })
        : [],
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 추가
app.post('/api/ontology', async (req, res) => {
  const { column_name, table_name, description, data_type } = req.body;
  if (!column_name) return res.status(400).json({ error: 'column_name 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO ontology_column (column_name, table_name, description, data_type) VALUES (?,?,?,?)',
      [column_name, table_name || 'bw_profitability_data', description || '', data_type || '']
    );
    res.json({ id: r.insertId, column_name, table_name: table_name || 'bw_profitability_data', description, data_type });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정
app.put('/api/ontology/:id', async (req, res) => {
  const { column_name, table_name, description, data_type } = req.body;
  try {
    await pool.query(
      'UPDATE ontology_column SET column_name=?, table_name=?, description=?, data_type=? WHERE id=?',
      [column_name, table_name, description, data_type, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 삭제
app.delete('/api/ontology/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM ontology_synonym WHERE column_id=?', [req.params.id]);
    await pool.query('DELETE FROM ontology_column WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 동의어 추가
app.post('/api/ontology/:id/synonym', async (req, res) => {
  const { synonym_text } = req.body;
  if (!synonym_text) return res.status(400).json({ error: 'synonym_text 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO ontology_synonym (column_id, synonym_text) VALUES (?,?)',
      [req.params.id, synonym_text]
    );
    res.json({ id: r.insertId, synonym_text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 동의어 삭제
app.delete('/api/ontology/synonym/:synId', async (req, res) => {
  try {
    await pool.query('DELETE FROM ontology_synonym WHERE id=?', [req.params.synId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 학습관리 API: Metric (계산 지표)
// ============================================================
app.get('/api/metric', async (req, res) => {
  try {
    const [metrics] = await pool.query(
      `SELECT m.*, GROUP_CONCAT(s.id, ':::', s.synonym_text ORDER BY s.id SEPARATOR '|||') AS synonyms
       FROM metric m
       LEFT JOIN metric_synonym s ON s.metric_id = m.id
       GROUP BY m.id ORDER BY m.id`
    );
    const result = metrics.map(row => ({
      ...row,
      synonyms: row.synonyms
        ? row.synonyms.split('|||').map(s => { const [id, text] = s.split(':::'); return { id: Number(id), text }; })
        : [],
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/metric', async (req, res) => {
  const { metric_code, aggregation, formula, table_name, description } = req.body;
  if (!metric_code || !formula) return res.status(400).json({ error: 'metric_code, formula 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO metric (metric_code, aggregation, formula, table_name, description) VALUES (?,?,?,?,?)',
      [metric_code, aggregation || 'SUM', formula, table_name || 'bw_profitability_data', description || '']
    );
    res.json({ id: r.insertId, metric_code, aggregation: aggregation || 'SUM', formula, table_name: table_name || 'bw_profitability_data', description });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/metric/:id', async (req, res) => {
  const { metric_code, aggregation, formula, table_name, description } = req.body;
  try {
    await pool.query(
      'UPDATE metric SET metric_code=?, aggregation=?, formula=?, table_name=?, description=? WHERE id=?',
      [metric_code, aggregation, formula, table_name, description, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/metric/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM metric_synonym WHERE metric_id=?', [req.params.id]);
    await pool.query('DELETE FROM metric WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/metric/:id/synonym', async (req, res) => {
  const { synonym_text } = req.body;
  if (!synonym_text) return res.status(400).json({ error: 'synonym_text 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO metric_synonym (metric_id, synonym_text) VALUES (?,?)',
      [req.params.id, synonym_text]
    );
    res.json({ id: r.insertId, synonym_text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/metric/synonym/:synId', async (req, res) => {
  try {
    await pool.query('DELETE FROM metric_synonym WHERE id=?', [req.params.synId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 학습관리 API: JOIN (조인 조건)
// ============================================================
app.get('/api/join', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM join_condition ORDER BY id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/join', async (req, res) => {
  const { left_column, left_table, right_column, right_table, join_type, operator, description } = req.body;
  if (!left_column || !left_table || !right_column || !right_table)
    return res.status(400).json({ error: '필수 필드 누락' });
  try {
    const [r] = await pool.query(
      'INSERT INTO join_condition (left_column, left_table, right_column, right_table, join_type, operator, description) VALUES (?,?,?,?,?,?,?)',
      [left_column, left_table, right_column, right_table, join_type || 'LEFT', operator || '=', description || '']
    );
    res.json({ id: r.insertId, left_column, left_table, right_column, right_table, join_type: join_type || 'LEFT', operator: operator || '=' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/join/:id', async (req, res) => {
  const { left_column, left_table, right_column, right_table, join_type, operator, description } = req.body;
  try {
    await pool.query(
      'UPDATE join_condition SET left_column=?, left_table=?, right_column=?, right_table=?, join_type=?, operator=?, description=? WHERE id=?',
      [left_column, left_table, right_column, right_table, join_type, operator, description, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/join/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM join_condition WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 학습관리 API: 코드값 매핑 (Code Mapping)
// ============================================================
// 전체 조회 (컬럼별 그룹핑)
app.get('/api/code-mapping', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM code_mapping ORDER BY column_name, code_value');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 컬럼별 조회
app.get('/api/code-mapping/column/:colName', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM code_mapping WHERE column_name=? ORDER BY code_value',
      [req.params.colName]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 추가
app.post('/api/code-mapping', async (req, res) => {
  const { column_name, column_name_nm, code_value, display_name, table_name, description } = req.body;
  if (!column_name || !code_value || !display_name)
    return res.status(400).json({ error: 'column_name, code_value, display_name 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO code_mapping (column_name, column_name_nm, code_value, display_name, table_name, description) VALUES (?,?,?,?,?,?)',
      [column_name, column_name_nm || null, code_value, display_name, table_name || 'bw_profitability_data', description || '']
    );

    // RAG 인덱스 갱신: 해당 컬럼의 매핑 전체를 재인덱싱 (비동기)
    if (ragReady) {
      (async () => {
        try {
          await removeFromIndex(pool, 'code_mapping', null); // 기존 코드매핑 청크 제거
          const [cmRows] = await pool.query(
            `SELECT column_name, GROUP_CONCAT(CONCAT(code_value, '=', display_name) ORDER BY code_value SEPARATOR ', ') AS mappings
             FROM code_mapping WHERE is_active = 1 GROUP BY column_name`
          );
          for (const cm of cmRows) {
            const text = `코드매핑: ${cm.column_name} 값 목록 - ${cm.mappings}`;
            await addToIndex(pool, 'code_mapping', null, text, { column_name: cm.column_name, mappings: cm.mappings });
          }
        } catch (e) { console.error('[RAG] 코드매핑 재인덱싱 실패:', e.message); }
      })();
    }

    res.json({ id: r.insertId, column_name, column_name_nm, code_value, display_name });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '이미 등록된 코드값입니다.' });
    res.status(500).json({ error: err.message });
  }
});

// 수정
app.put('/api/code-mapping/:id', async (req, res) => {
  const { column_name, column_name_nm, code_value, display_name, table_name, description, is_active } = req.body;
  try {
    await pool.query(
      'UPDATE code_mapping SET column_name=?, column_name_nm=?, code_value=?, display_name=?, table_name=?, description=?, is_active=? WHERE id=?',
      [column_name, column_name_nm, code_value, display_name, table_name, description, is_active ?? 1, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 삭제
app.delete('/api/code-mapping/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM code_mapping WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DB 실데이터에 매핑 적용 (현재 스키마에는 _NM 컬럼이 없으므로 AI 프롬프트에만 반영)
app.post('/api/code-mapping/apply', async (req, res) => {
  try {
    // 현재 스키마에는 _NM 컬럼이 없으므로 DB UPDATE 대신 매핑 건수만 확인
    const [mappings] = await pool.query(
      'SELECT column_name, COUNT(*) AS cnt FROM code_mapping WHERE is_active=1 GROUP BY column_name'
    );
    const totalMappings = mappings.reduce((sum, m) => sum + m.cnt, 0);
    res.json({
      success: true,
      totalMappings,
      message: '코드값 매핑이 AI 프롬프트에 반영됩니다. (현재 스키마에는 _NM 컬럼이 없어 DB UPDATE는 수행하지 않습니다)',
      columns: mappings.map(m => ({ column: m.column_name, count: m.cnt }))
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 고유 컬럼명 목록 조회 (드롭다운용)
app.get('/api/code-mapping/columns', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT column_name, column_name_nm, COUNT(*) AS cnt FROM code_mapping GROUP BY column_name, column_name_nm ORDER BY column_name'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SQL 피드백 API (정확해요 / SQL 수정하기)
// ============================================================
// 피드백 저장
app.post('/api/feedback', async (req, res) => {
  const { query_text, original_sql, corrected_sql, feedback_type } = req.body;
  if (!query_text || !original_sql || !feedback_type)
    return res.status(400).json({ error: 'query_text, original_sql, feedback_type 필수' });
  if (!['correct', 'corrected'].includes(feedback_type))
    return res.status(400).json({ error: "feedback_type은 'correct' 또는 'corrected'" });
  try {
    const finalSql = feedback_type === 'correct' ? original_sql : (corrected_sql || original_sql);
    const [r] = await pool.query(
      'INSERT INTO sql_feedback (query_text, original_sql, corrected_sql, feedback_type) VALUES (?,?,?,?)',
      [query_text, original_sql, finalSql, feedback_type]
    );

    // RAG 인덱스에 자동 추가 (비동기)
    if (ragReady) {
      const chunkText = `검증된 SQL 예시 [${feedback_type}]: 질문="${query_text}" → SQL: ${finalSql}`;
      addToIndex(pool, 'feedback', r.insertId, chunkText, {
        query_text, corrected_sql: finalSql, feedback_type
      }).catch(e => console.error('[RAG] 피드백 인덱싱 실패:', e.message));
    }

    res.json({ id: r.insertId, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정된 SQL 실행 (SELECT만 허용)
app.post('/api/execute-sql', async (req, res) => {
  const { sql } = req.body;
  if (!sql || !sql.trim()) return res.status(400).json({ error: 'SQL을 입력하세요.' });

  const sqlUpper = sql.toUpperCase().trim();
  if (!sqlUpper.startsWith('SELECT'))
    return res.status(400).json({ error: 'SELECT 쿼리만 허용됩니다.' });
  const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'GRANT', 'REVOKE'];
  for (const kw of forbidden) {
    if (sqlUpper.includes(kw))
      return res.status(400).json({ error: `금지된 키워드: ${kw}` });
  }

  try {
    const startTime = Date.now();
    const [rows] = await pool.query(sql);
    const execTime = Date.now() - startTime;
    res.json({ success: true, data: rows, rowCount: rows.length, executionTimeMs: execTime });
  } catch (err) {
    res.status(400).json({ error: err.sqlMessage || err.message });
  }
});

// 피드백 목록 조회
app.get('/api/feedback', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM sql_feedback ORDER BY created_at DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 피드백 삭제
app.delete('/api/feedback/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM sql_feedback WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 학습관리 API: 통계
// ============================================================
app.get('/api/learning/stats', async (req, res) => {
  try {
    const [o] = await pool.query('SELECT COUNT(*) AS cnt FROM ontology_column');
    const [os] = await pool.query('SELECT COUNT(*) AS cnt FROM ontology_synonym');
    const [m] = await pool.query('SELECT COUNT(*) AS cnt FROM metric');
    const [ms] = await pool.query('SELECT COUNT(*) AS cnt FROM metric_synonym');
    const [j] = await pool.query('SELECT COUNT(*) AS cnt FROM join_condition');
    const [cm] = await pool.query('SELECT COUNT(*) AS cnt FROM code_mapping WHERE is_active=1');
    let ragStats = null;
    try { ragStats = await getRagStats(pool); } catch (e) { /* 무시 */ }
    res.json({
      ontologyColumns: o[0].cnt,
      ontologySynonyms: os[0].cnt,
      metrics: m[0].cnt,
      metricSynonyms: ms[0].cnt,
      joins: j[0].cnt,
      codeMappings: cm[0].cnt,
      rag: {
        enabled: ragReady,
        totalChunks: ragStats?.total || 0,
        byType: ragStats?.byType || {},
      },
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// RAG 관리 API
// ============================================================

// RAG 인덱스 빌드 (전체 리빌드)
app.post('/api/rag/build', async (req, res) => {
  try {
    console.log('[RAG API] 인덱스 빌드 요청');
    const count = await buildRagIndex(pool);
    ragReady = true;
    res.json({ success: true, totalChunks: count, message: `RAG 인덱스 빌드 완료: ${count}개 청크` });
  } catch (err) {
    console.error('[RAG API] 빌드 실패:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// RAG 상태 조회
app.get('/api/rag/stats', async (req, res) => {
  try {
    const stats = await getRagStats(pool);
    res.json({ ragReady, ...stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RAG 검색 테스트 (디버깅용)
app.post('/api/rag/search', async (req, res) => {
  const { query, topK } = req.body;
  if (!query) return res.status(400).json({ error: 'query 필수' });
  try {
    if (!ragReady) return res.status(400).json({ error: 'RAG 인덱스가 빌드되지 않았습니다. POST /api/rag/build를 먼저 실행하세요.' });
    const result = await searchRelevantMeta(pool, query, { topK: topK || 15 });
    const context = ragResultToPromptContext(result);
    // 점수 정보 포함하여 반환
    const summary = {};
    for (const [cat, items] of Object.entries(result)) {
      summary[cat] = items.map(i => ({ text: i.text.substring(0, 120), score: Math.round(i.score * 1000) / 1000 }));
    }
    res.json({ summary, contextLength: context.length, contextPreview: context.substring(0, 500) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SPA fallback
// ============================================================
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(import.meta.dirname, 'public', 'index.html'));
});

// ============================================================
// Start + RAG 자동 초기화
// ============================================================
const PORT = 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 NLQ Server running on http://0.0.0.0:${PORT}`);

  // 서버 시작 시 RAG 인덱스 자동 빌드 (비동기, 서버 응답에 영향 없음)
  try {
    // rag_embeddings 테이블 존재 확인
    const [tables] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = 'company_board' AND TABLE_NAME = 'rag_embeddings'`
    );
    if (tables[0].cnt === 0) {
      console.log('[RAG] rag_embeddings 테이블이 없습니다. 생성합니다...');
      await pool.query(`
        CREATE TABLE IF NOT EXISTS rag_embeddings (
          id INT AUTO_INCREMENT PRIMARY KEY,
          chunk_type ENUM('schema','ontology','metric','code_mapping','feedback','join_condition','rule') NOT NULL,
          source_id INT NULL,
          chunk_text TEXT NOT NULL,
          embedding LONGTEXT CHARACTER SET utf8mb4 NOT NULL CHECK (JSON_VALID(embedding)),
          metadata LONGTEXT CHARACTER SET utf8mb4 CHECK (JSON_VALID(metadata)),
          is_active TINYINT DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_rag_type (chunk_type),
          INDEX idx_rag_source (chunk_type, source_id),
          INDEX idx_rag_active (is_active)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RAG 메타데이터 벡터 인덱스'
      `);
    }

    // 기존 인덱스 확인
    const [existing] = await pool.query('SELECT COUNT(*) AS cnt FROM rag_embeddings WHERE is_active = 1');
    if (existing[0].cnt > 0) {
      ragReady = true;
      console.log(`[RAG] ✅ 기존 인덱스 로드됨: ${existing[0].cnt}개 청크`);
    } else {
      console.log('[RAG] 인덱스 비어있음, 자동 빌드 시작...');
      const count = await buildRagIndex(pool);
      ragReady = true;
      console.log(`[RAG] ✅ 자동 빌드 완료: ${count}개 청크`);
    }
  } catch (e) {
    console.error('[RAG] 초기화 실패 (폴백 모드로 계속):', e.message);
    ragReady = false;
  }
});
