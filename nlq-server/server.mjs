import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

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
// System Prompt (동적 생성 - 코드값 매핑 포함)
// ============================================================
async function buildSystemPrompt() {
  let codeMappingText = '';
  try {
    const [rows] = await pool.query(
      `SELECT column_name, column_name_nm, code_value, display_name
       FROM code_mapping WHERE is_active = 1 ORDER BY column_name, code_value`
    );
    if (rows.length > 0) {
      // 컬럼별로 그룹핑
      const grouped = {};
      for (const r of rows) {
        if (!grouped[r.column_name]) grouped[r.column_name] = { nm: r.column_name_nm, items: [] };
        grouped[r.column_name].items.push({ code: r.code_value, name: r.display_name });
      }
      codeMappingText = '\n\n코드값-명칭 매핑 사전 (Code Mapping Dictionary):\n';
      codeMappingText += '**중요 규칙**:\n';
      codeMappingText += '1. 이 테이블에는 _NM(명칭) 컬럼이 전혀 없습니다. 절대로 _NM 컬럼을 참조하지 마세요.\n';
      codeMappingText += '2. GROUP BY/SELECT에는 반드시 코드 컬럼(예: PROFIT_CTR)을 기준으로 사용하세요.\n';
      codeMappingText += '3. 명칭 표시는 반드시 CASE WHEN으로 변환하세요. 예:\n';
      codeMappingText += '   CASE PROFIT_CTR WHEN \'0000002000\' THEN \'제지사업부\' WHEN \'0000001000\' THEN \'생활용품사업부\' ELSE PROFIT_CTR END AS 손익센터\n';
      codeMappingText += '4. PROFIT_CTR은 10자리 선행0 포함 형태입니다 (예: 0000002000, 0000001000). WHERE/CASE에서 반드시 이 형태로 비교하세요.\n';
      codeMappingText += '5. 사용자가 명칭(예: "제지사업부")으로 질문하면 코드값(예: PROFIT_CTR=\'0000002000\')으로 WHERE 필터링하세요.\n';
      codeMappingText += '6. MATERIAL_DESC 컬럼에 자재명이 있으므로 자재명 조회 시 이 컬럼을 사용하세요.\n\n';
      for (const [col, info] of Object.entries(grouped)) {
        codeMappingText += `[${col}]:\n`;
        for (const item of info.items) {
          codeMappingText += `  '${item.code}' = ${item.name}\n`;
        }
      }
    }
  } catch (e) {
    console.error('[CodeMapping] 프롬프트 빌드 실패:', e.message);
  }

  // 피드백 학습 데이터 로드
  let feedbackText = '';
  try {
    const [fbRows] = await pool.query(
      `SELECT query_text, corrected_sql FROM sql_feedback WHERE is_active = 1 ORDER BY created_at DESC LIMIT 30`
    );
    if (fbRows.length > 0) {
      feedbackText = '\n\n사용자 검증 완료 SQL 예시 (동일/유사 질문 시 이 SQL을 그대로 사용하세요):\n';
      for (const fb of fbRows) {
        const typeLabel = fb.feedback_type === 'corrected' ? '[사용자 수정 - 최우선]' : '[검증 완료]';
        feedbackText += `${typeLabel} 질문: "${fb.query_text}"\nSQL: ${fb.corrected_sql}\n\n`;
      }
    }
  } catch (e) {
    console.error('[Feedback] 학습 데이터 로드 실패:', e.message);
  }

  return `당신은 수익성 분석 데이터베이스 전문가입니다.
사용자의 자연어 질문을 MariaDB SQL로 변환합니다.

규칙:
1. SELECT 문만 생성 (INSERT/UPDATE/DELETE/DROP 절대 금지)
2. 테이블은 bw_profitability_data 하나만 사용
3. 계산 지표는 반드시 아래 Metric Dictionary만 사용 (새로운 수식을 만들지 마세요)
4. 결과 행은 최대 1000행으로 제한 (LIMIT 1000)
5. 금액 표시: FORMAT(SUM(ZAMT***), 0) 사용하여 천 단위 콤마 포함. 정렬이 필요하면 SUM(ZAMT***)으로 ORDER BY하고, SELECT에는 FORMAT() 적용 컬럼만 표시
6. 비율 표시: ROUND(..., 1) 사용, 소수점 1자리
7. GROUP BY 사용 시 반드시 집계 함수(SUM, COUNT, AVG 등) 사용
8. 컬럼 alias는 한글로 작성 (예: AS 총매출, AS 플랜트별)
9. 정렬은 의미 있는 순서로 (금액은 DESC, 코드는 ASC)
10. NULL 방지를 위해 COALESCE 또는 IFNULL 사용
11. 이 테이블에는 _NM(명칭) 컬럼이 없습니다. 절대로 PROFIT_CTR_NM, DIVISION_NM 등 _NM 컬럼을 사용하지 마세요
12. 코드값 매핑이 등록된 컬럼은 GROUP BY에 코드 컬럼을 사용하고, SELECT에서 CASE WHEN으로 명칭을 표시하세요
13. 사용자가 명칭(예: "제지사업부")으로 질문하면 코드값(예: PROFIT_CTR='0000002000')으로 WHERE 조건을 작성하세요
14. PROFIT_CTR은 10자리 선행0 포함 형태입니다 (예: '0000002000', '0000001000'). 반드시 이 형태로 비교하세요
15. 자재명은 MATERIAL_DESC 컬럼을 사용하세요 (MATERIAL_NM 컬럼은 없습니다)
16. 브랜드 컬럼은 ZBRAND1(브랜드1), ZBRAND2(브랜드2)입니다 (ZBRAND, ZSBRAND 컬럼은 없습니다)
17. 수량 컬럼은 ZQTYBOX(BOX), ZQTYBAG(BAG), ZQTYKGEA(KG/EA)입니다 (ZQTY_BOX, ZQTY_BAG, ZQTY_KE 컬럼은 없습니다)
18. 수량단위 컬럼은 ZUNITBOX, ZUNITBAG, ZUNITKGEA입니다 (ZBOXUNIT, ZBAGUNIT, ZUNIT 컬럼은 없습니다)
19. **중요 - 학습 데이터 우선 사용**: 아래 "사용자 검증 완료 SQL 예시"에 동일하거나 유사한 질문이 있으면, 해당 SQL을 최대한 그대로 사용하세요. 특히 corrected 타입의 SQL은 사용자가 직접 수정한 것이므로 반드시 우선 적용하세요.

응답 형식 (반드시 JSON으로):
{
  "sql": "SELECT ...",
  "explanation": "이 쿼리는 ... 을 조회합니다",
  "chartType": "bar|line|pie|table",
  "chartConfig": {
    "labelColumn": "라벨이 될 컬럼명(alias)",
    "dataColumns": ["데이터 컬럼명(alias) 배열"],
    "title": "차트 제목"
  }
}

chartType 선택 기준:
- bar: 카테고리별 비교 (예: 플랜트별, 브랜드별)
- line: 시계열 추이 (예: 월별, 일별)
- pie: 비율/구성비 (예: 제품군별 매출 비중)
- table: 상세 데이터, 다수 컬럼

${TABLE_SCHEMA}

${METRIC_DICTIONARY}
${codeMappingText}
${feedbackText}`;
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
      // 1. ChatGPT로 SQL 생성 (코드값 매핑 포함 동적 프롬프트)
      const systemPrompt = await buildSystemPrompt();
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
      explanation: explanation + (matchedSql ? ' 📚' : ''),
      chartType: chartType || 'table',
      chartConfig: chartConfig || {},
      data: rows,
      rowCount: rows.length,
      executionTimeMs: execTime,
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
    res.json({
      db: 'connected',
      table: 'bw_profitability_data',
      totalRows: rows[0].cnt,
      ai: 'gpt-5-mini',
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
    res.json({
      ontologyColumns: o[0].cnt,
      ontologySynonyms: os[0].cnt,
      metrics: m[0].cnt,
      metricSynonyms: ms[0].cnt,
      joins: j[0].cnt,
      codeMappings: cm[0].cnt,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// SPA fallback
// ============================================================
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(import.meta.dirname, 'public', 'index.html'));
});

// ============================================================
// Start
// ============================================================
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 NLQ Server running on http://0.0.0.0:${PORT}`);
});
