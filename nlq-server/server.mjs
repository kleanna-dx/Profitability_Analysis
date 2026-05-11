import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import multer from 'multer';
import XLSX from 'xlsx-js-style';
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
// File Upload (multer) - 엑셀/PPT 등 공용
// ============================================================
const UPLOAD_DIR = path.join(import.meta.dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /xlsx|xls|xlsb|csv|png|jpg|jpeg|gif|bmp|pdf/;
    const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
    cb(null, allowed.test(ext));
  }
});

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
3. 계산 지표는 반드시 아래 제공된 메트릭/컬럼 정보만 사용 (새로운 수식 창작 금지)
4. 결과 행은 최대 1000행 (LIMIT 1000)
5. **금액 표시**: FORMAT(SUM(ZAMT***), 0) AS 별칭. **ORDER BY에는 FORMAT 별칭 사용 금지!** → ORDER BY SUM(ZAMT***) DESC 사용
6. 비율: ROUND(..., 1), 소수점 1자리
7. GROUP BY 시 반드시 집계 함수 사용
8. 컬럼 alias는 한글, 사용자가 이해하기 쉬운 의미 있는 이름 사용
9. 정렬: 금액 DESC, 코드 ASC
10. NULL 방지: COALESCE 또는 IFNULL
11. _NM 컬럼 없음 → CASE WHEN으로 명칭 표시
12. 코드매핑 컬럼은 GROUP BY 코드컬럼 + CASE WHEN 명칭
13. 명칭으로 질문 시 코드값으로 WHERE
14. PROFIT_CTR: 10자리 선행0 (예: '0000002000')
15. 자재명: MATERIAL_DESC (MATERIAL_NM 없음)
16. 브랜드: ZBRAND1, ZBRAND2
17. **학습 데이터 우선**: 아래 RAG 컨텍스트에 유사 질문의 검증된 SQL이 있으면 그 패턴을 최우선 참고

[날짜/기간 필터링 규칙 - 매우 중요!]
- **ZYEAR, ZMONTH, FISC_YEAR, FISC_PERIOD, YEAR, MONTH 등의 컬럼은 존재하지 않습니다! 절대 사용 금지!**
- 연도/월 필터: CALMONTH 컬럼 사용 (VARCHAR, YYYYMM 형식). 예: "2024년 5월" → WHERE CALMONTH = '202405'
- 연도만 필터: CALMONTH LIKE '2024%' 또는 LEFT(CALMONTH,4) = '2024'
- 일자 필터: CALDAY 컬럼 사용 (VARCHAR, YYYYMMDD 형식). 예: "2024년 5월 1일" → WHERE CALDAY = '20240501'
- 월 범위 필터: CALMONTH BETWEEN '202401' AND '202412'
- 일별 추이: GROUP BY CALDAY, ORDER BY CALDAY ASC
- 월별 추이: GROUP BY CALMONTH, ORDER BY CALMONTH ASC
- 현재 데이터는 CALMONTH='202405' (2024년 5월) 한 달치만 존재

[컬럼 최소화 원칙 - 매우 중요!]
- **질문에서 요청한 항목만 SELECT 하세요. 관련 있어 보이더라도 질문에 없는 항목은 절대 추가하지 마세요.**
- 예: "판매수량 합계"라고 하면 → BOX 수량(ZQTYBOX) 하나만 사용. BAG수량, EA수량은 질문에 없으므로 포함 금지.
- 예: "총매출 합계"라고 하면 → SUM(ZAMT001) 하나만 사용. 순매출, 영업이익 등은 추가하지 마세요.
- 사용자가 "수량" 이라고만 하면 기본 단위는 BOX(ZQTYBOX). BAG/EA는 사용자가 명시적으로 요청할 때만 포함.
- 사용자가 "모든 수량" 또는 "BOX, BAG, EA 수량"처럼 여러 단위를 명시한 경우에만 복수 수량 컬럼 사용.

[컬럼 별칭(alias) 작성 규칙]
- 별칭에는 단위를 괄호로 명시: 예) '판매수량 합계(BOX)', '총매출(원)', '영업이익률(%)'
- 집계 함수를 사용한 경우 "합계", "평균", "최대" 등을 별칭에 포함
- 예시: FORMAT(SUM(ZQTYBOX), 0) AS '판매수량 합계(BOX)',  FORMAT(SUM(ZAMT001), 0) AS '총매출 합계(원)'

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
 * 동의어 직접 매칭 (DB 조회 기반)
 * - RAG 임베딩 유사도 검색의 한계 보완
 * - 사용자 질문에 포함된 동의어를 DB에서 직접 찾아 컬럼 매핑 정보 반환
 * @param {string} query - 사용자 질문
 * @returns {Promise<Array<{synonym: string, column_name: string, description: string, data_type: string, source: string}>>}
 */
async function matchSynonymsDirectly(query) {
  const matched = [];
  try {
    // 1. Ontology 동의어 매칭
    const [ontSyns] = await pool.query(
      `SELECT s.synonym_text, c.column_name, c.description, c.data_type
       FROM ontology_synonym s
       JOIN ontology_column c ON s.column_id = c.id`
    );
    for (const row of ontSyns) {
      if (query.includes(row.synonym_text)) {
        matched.push({
          synonym: row.synonym_text,
          column_name: row.column_name,
          description: row.description || '',
          data_type: row.data_type || '',
          source: 'ontology',
        });
      }
    }

    // 2. Metric 동의어 매칭
    const [metSyns] = await pool.query(
      `SELECT s.synonym_text, m.metric_code, m.aggregation, m.formula, m.description
       FROM metric_synonym s
       JOIN metric m ON s.metric_id = m.id`
    );
    for (const row of metSyns) {
      if (query.includes(row.synonym_text)) {
        matched.push({
          synonym: row.synonym_text,
          column_name: `${row.aggregation}(${row.formula})`,
          description: row.description || row.metric_code,
          data_type: 'metric',
          source: 'metric',
        });
      }
    }

    // 3. Ontology 컬럼 설명(description) 자체도 매칭 (설명이 질문에 포함된 경우)
    const [ontCols] = await pool.query(
      `SELECT column_name, description, data_type FROM ontology_column WHERE description IS NOT NULL AND description != ''`
    );
    for (const row of ontCols) {
      if (row.description.length >= 2 && query.includes(row.description)) {
        // 이미 synonym으로 매칭된 컬럼은 중복 방지
        if (!matched.some(m => m.column_name === row.column_name)) {
          matched.push({
            synonym: row.description,
            column_name: row.column_name,
            description: row.description,
            data_type: row.data_type || '',
            source: 'ontology_desc',
          });
        }
      }
    }

    if (matched.length > 0) {
      console.log(`[Synonym] 직접 매칭 ${matched.length}건: ${matched.map(m => `"${m.synonym}"→${m.column_name}`).join(', ')}`);
    }
  } catch (e) {
    console.error('[Synonym] 직접 매칭 실패:', e.message);
  }
  return matched;
}

/**
 * RAG 기반 시스템 프롬프트 생성
 * - 질문과 관련된 메타데이터만 검색하여 프롬프트에 주입
 * - 전체 덤프(프롬프트 스터핑) 대신 필요한 컨텍스트만 포함
 * - 동의어 직접 매칭 결과를 최우선으로 주입
 * @param {string} query - 사용자 질문
 * @returns {Promise<{prompt: string, ragContext: Object}>}
 */
async function buildRAGSystemPrompt(query) {
  let ragContext = null;
  let contextText = '';

  // ★ 동의어 직접 매칭 (RAG 보완 - 최우선 적용)
  const synonymMatches = await matchSynonymsDirectly(query);
  let synonymContext = '';
  if (synonymMatches.length > 0) {
    synonymContext = '\n[★ 동의어 매칭 결과 - 최우선 적용! 아래 매핑을 반드시 SQL에 사용하세요]\n';
    for (const m of synonymMatches) {
      if (m.source === 'metric') {
        synonymContext += `- 사용자가 말한 "${m.synonym}" → ${m.description} = ${m.column_name}\n`;
      } else {
        synonymContext += `- 사용자가 말한 "${m.synonym}" → 컬럼: ${m.column_name} (${m.data_type}) - ${m.description}\n`;
      }
    }
    synonymContext += '위 매핑된 컬럼을 SQL의 SELECT, WHERE, GROUP BY 등에 반드시 사용하세요. 다른 컬럼으로 대체하지 마세요.\n';
  }

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

  // RAG 모드에서는 검색된 메타데이터만 사용 (전체 스키마/메트릭 덤프 제거)
  // → GPT가 질문과 무관한 컬럼을 보고 불필요한 컬럼을 추가하는 문제 방지
  let prompt;
  if (ragReady && ragContext) {
    // RAG 활성: 기본 규칙 + 동의어 매칭 + RAG 검색 컨텍스트
    prompt = BASE_SYSTEM_PROMPT
      + synonymContext
      + '\n\n--- RAG 검색 컨텍스트 (이 질문과 관련된 메타데이터만 포함됨) ---\n' + contextText;
  } else {
    // 폴백: 기존 방식 (전체 스키마 + 메트릭 + 폴백 컨텍스트)
    prompt = BASE_SYSTEM_PROMPT + synonymContext + '\n' + TABLE_SCHEMA + '\n' + METRIC_DICTIONARY
      + '\n\n--- 컨텍스트 ---\n' + contextText;
  }

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
    let ragInfo = null;  // RAG 검색 상세 정보

    if (matchedSql) {
      // 학습 데이터 매칭 → AI 호출 없이 직접 사용
      sql = matchedSql;
      explanation = '학습된 SQL을 사용합니다 (사용자 검증 완료).';
      ragInfo = { mode: 'learned', chunksUsed: 0, promptLength: 0, details: {} };
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

      // RAG 검색 상세 정보 수집
      if (ragContext) {
        ragInfo = {
          mode: 'rag',
          chunksUsed: Object.values(ragContext).reduce((s, arr) => s + arr.length, 0),
          promptLength: systemPrompt.length,
          details: {},
        };
        for (const [cat, items] of Object.entries(ragContext)) {
          if (items.length > 0) {
            ragInfo.details[cat] = items.map(i => ({
              text: i.text.substring(0, 80),
              score: Math.round(i.score * 1000) / 1000,
            }));
          }
        }
      }

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
      ragInfo: ragInfo,
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
// 학습관리 API: Ontology 엑셀 업로드
// ============================================================

// 엑셀 미리보기 (파싱만 수행, DB 반영 안함)
app.post('/api/ontology/upload-excel/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (rawRows.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: '엑셀 파일에 데이터가 없습니다.' });
    }

    // 헤더 매핑 (유연하게 처리)
    const headerMap = {};
    const firstRow = rawRows[0];
    const keys = Object.keys(firstRow);
    for (const k of keys) {
      const lk = k.trim().toLowerCase().replace(/\s+/g, '');
      if (['column', 'column_name', 'columnname', '컬럼', '컬럼명'].includes(lk)) headerMap.column_name = k;
      else if (['table', 'table_name', 'tablename', '테이블', '테이블명'].includes(lk)) headerMap.table_name = k;
      else if (['설명', 'description', 'desc', '설명(description)'].includes(lk)) headerMap.description = k;
      else if (['데이터타입', 'datatype', 'data_type', 'type', '타입', '데이터유형'].includes(lk)) headerMap.data_type = k;
      else if (['동의어', 'synonyms', 'synonym', '동의어(synonyms)', '동의어(synonym)'].includes(lk)) headerMap.synonyms = k;
    }

    if (!headerMap.column_name) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "'Column' 헤더를 찾을 수 없습니다. 첫 번째 행에 Column, Table, 설명, 데이터타입, 동의어(Synonyms) 헤더가 필요합니다." });
    }

    // 기존 Ontology 데이터 조회 (중복 체크용)
    const [existingCols] = await pool.query(
      'SELECT id, column_name, table_name, description, data_type FROM ontology_column'
    );
    const existingMap = {};
    for (const c of existingCols) {
      existingMap[c.column_name.toUpperCase()] = c;
    }

    // 파싱 + 검증
    const rows = [];
    const errors = [];
    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const rowNum = i + 2; // 엑셀 행 번호 (헤더=1행)
      const columnName = String(raw[headerMap.column_name] || '').trim();
      const tableName = String(raw[headerMap.table_name] || 'bw_profitability_data').trim();
      const description = headerMap.description ? String(raw[headerMap.description] || '').trim() : '';
      const dataType = headerMap.data_type ? String(raw[headerMap.data_type] || '').trim() : '';
      const synonymsRaw = headerMap.synonyms ? String(raw[headerMap.synonyms] || '').trim() : '';
      const synonyms = synonymsRaw ? synonymsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0) : [];

      // 모든 필드가 비어있는 행은 조용히 건너뜀
      const allEmpty = !columnName && !description && !dataType && !synonymsRaw;
      if (!columnName) {
        if (!allEmpty) errors.push({ row: rowNum, message: 'Column 값이 비어있습니다.' });
        continue;
      }

      const existing = existingMap[columnName.toUpperCase()];
      rows.push({
        row: rowNum,
        column_name: columnName,
        table_name: tableName || 'bw_profitability_data',
        description,
        data_type: dataType,
        synonyms,
        status: existing ? 'update' : 'new',
        existing_id: existing ? existing.id : null,
      });
    }

    // 임시 파일 경로를 응답에 포함 (실제 업로드 시 사용)
    res.json({
      fileName: req.file.originalname,
      filePath: req.file.filename, // multer가 생성한 임시 파일명
      totalRows: rawRows.length,
      validRows: rows.length,
      newCount: rows.filter(r => r.status === 'new').length,
      updateCount: rows.filter(r => r.status === 'update').length,
      errors,
      preview: rows.slice(0, 200), // 최대 200개까지 미리보기
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: '엑셀 파싱 실패: ' + err.message });
  }
});

// 엑셀 실제 적용 (미리보기 후 확정)
app.post('/api/ontology/upload-excel/apply', express.json({ limit: '10mb' }), async (req, res) => {
  const { rows, filePath } = req.body;
  if (!rows || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: '적용할 데이터가 없습니다.' });
  }

  const results = { inserted: 0, updated: 0, synonymsAdded: 0, errors: [] };
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const row of rows) {
      try {
        let columnId;

        if (row.status === 'update' && row.existing_id) {
          // 기존 컬럼 업데이트
          await conn.query(
            'UPDATE ontology_column SET table_name=?, description=?, data_type=? WHERE id=?',
            [row.table_name, row.description, row.data_type, row.existing_id]
          );
          columnId = row.existing_id;
          results.updated++;
        } else {
          // 신규 컬럼 추가
          const [r] = await conn.query(
            'INSERT INTO ontology_column (column_name, table_name, description, data_type) VALUES (?,?,?,?)',
            [row.column_name, row.table_name || 'bw_profitability_data', row.description || '', row.data_type || '']
          );
          columnId = r.insertId;
          results.inserted++;
        }

        // 동의어 처리
        if (row.synonyms && row.synonyms.length > 0) {
          // 기존 동의어 조회
          const [existingSyns] = await conn.query(
            'SELECT synonym_text FROM ontology_synonym WHERE column_id=?',
            [columnId]
          );
          const existingSynSet = new Set(existingSyns.map(s => s.synonym_text.toLowerCase()));

          for (const syn of row.synonyms) {
            if (!existingSynSet.has(syn.toLowerCase())) {
              await conn.query(
                'INSERT INTO ontology_synonym (column_id, synonym_text) VALUES (?,?)',
                [columnId, syn]
              );
              results.synonymsAdded++;
            }
          }
        }
      } catch (rowErr) {
        results.errors.push({ column_name: row.column_name, message: rowErr.message });
      }
    }

    await conn.commit();

    // 임시 파일 삭제
    if (filePath) {
      const fullPath = path.join(UPLOAD_DIR, filePath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }

    console.log(`[Excel Upload] Ontology 일괄 등록 완료: 신규 ${results.inserted}, 업데이트 ${results.updated}, 동의어 ${results.synonymsAdded}건`);
    res.json(results);
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: '일괄 등록 실패: ' + err.message });
  } finally {
    conn.release();
  }
});

// 엑셀 템플릿 다운로드 (가이드형 디자인)
app.get('/api/ontology/upload-excel/template', (req, res) => {
  const wb = XLSX.utils.book_new();

  // ── 스타일 정의 ──
  const FONT_DEFAULT = { name: 'Malgun Gothic', sz: 11 };
  const FONT_HEADER = { name: 'Malgun Gothic', sz: 11, bold: true, color: { rgb: '1E1B4B' } };
  const FONT_NOTICE_TITLE = { name: 'Malgun Gothic', sz: 11, bold: true, color: { rgb: 'DC2626' } };
  const FONT_NOTICE = { name: 'Malgun Gothic', sz: 10, color: { rgb: '374151' } };
  const FONT_NOTICE_BOLD = { name: 'Malgun Gothic', sz: 10, bold: true, color: { rgb: '374151' } };
  const FONT_NOTICE_RED = { name: 'Malgun Gothic', sz: 10, bold: true, color: { rgb: 'DC2626' } };
  const FONT_EXAMPLE = { name: 'Malgun Gothic', sz: 10, color: { rgb: '6B7280' }, italic: true };

  const FILL_HEADER = { fgColor: { rgb: 'E2E8F0' } };
  const FILL_NOTICE_TITLE = { fgColor: { rgb: 'FEF2F2' } };
  const FILL_NOTICE = { fgColor: { rgb: 'FAFBFF' } };

  const BORDER_THIN = {
    top: { style: 'thin', color: { rgb: 'CBD5E1' } },
    bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
    left: { style: 'thin', color: { rgb: 'CBD5E1' } },
    right: { style: 'thin', color: { rgb: 'CBD5E1' } },
  };
  const BORDER_HEADER = {
    top: { style: 'medium', color: { rgb: '4F46E5' } },
    bottom: { style: 'medium', color: { rgb: '4F46E5' } },
    left: { style: 'thin', color: { rgb: 'A5B4FC' } },
    right: { style: 'thin', color: { rgb: 'A5B4FC' } },
  };
  const BORDER_NOTICE = {
    top: { style: 'thin', color: { rgb: 'E5E7EB' } },
    bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
    left: { style: 'thin', color: { rgb: 'E5E7EB' } },
    right: { style: 'thin', color: { rgb: 'E5E7EB' } },
  };
  const ALIGN_CENTER = { horizontal: 'center', vertical: 'center' };
  const ALIGN_LEFT = { horizontal: 'left', vertical: 'center', wrapText: true };

  // ── 시트 데이터 구성 ──
  // A열=No, B=Column, C=Table, D=설명, E=데이터타입, F=동의어,  H~J=주의사항 영역
  const wsData = [
    // Row 1: 헤더
    ['No.', 'Column', 'Table', '설명', '데이터타입', '동의어(Synonyms)', '', '주의사항'],
    // Row 2: 예시1
    [1, 'CALMONTH', 'bw_profitability_data', '달력연도/월', 'VARCHAR(6)', '월,연월', '', ''],
    // Row 3: 예시2
    [2, 'MATERIAL_DESC', 'bw_profitability_data', '자재명(설명)', 'VARCHAR(40)', '제품명,상품명', '', ''],
    // Row 4~: 빈 입력 영역
    [3, '', '', '', '', '', '', ''],
    [4, '', '', '', '', '', '', ''],
    [5, '', '', '', '', '', '', ''],
    [6, '', '', '', '', '', '', ''],
    [7, '', '', '', '', '', '', ''],
    [8, '', '', '', '', '', '', ''],
    [9, '', '', '', '', '', '', ''],
    [10, '', '', '', '', '', '', ''],
  ];

  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // ── 컬럼 폭 설정 ──
  ws['!cols'] = [
    { wch: 6 },   // A: No.
    { wch: 22 },  // B: Column
    { wch: 30 },  // C: Table
    { wch: 22 },  // D: 설명
    { wch: 16 },  // E: 데이터타입
    { wch: 35 },  // F: 동의어
    { wch: 3 },   // G: 구분 공백
    { wch: 100 },  // H: 주의사항 (한글 문구 잘림 방지)
  ];

  // ── 행 높이 ──
  ws['!rows'] = [
    { hpt: 32 },  // Row 1: 헤더
    { hpt: 24 },  // Row 2: 예시1
    { hpt: 24 },  // Row 3: 예시2
    { hpt: 22 },  // Row 4~
    { hpt: 22 },
    { hpt: 22 },
    { hpt: 22 },
    { hpt: 22 },
    { hpt: 22 },
    { hpt: 22 },
    { hpt: 22 },
  ];

  // ── 헤더 스타일 (Row 1: A1~F1) ──
  const headers = ['A1','B1','C1','D1','E1','F1'];
  headers.forEach(ref => {
    if (ws[ref]) {
      ws[ref].s = {
        font: FONT_HEADER,
        fill: FILL_HEADER,
        border: BORDER_HEADER,
        alignment: ALIGN_CENTER,
      };
    }
  });

  // ── 예시 데이터 스타일 (Row 2~3) — 배경 없이 흰색 ──
  for (let r = 2; r <= 3; r++) {
    ['A','B','C','D','E','F'].forEach(col => {
      const ref = col + r;
      if (ws[ref]) {
        ws[ref].s = {
          font: col === 'A' ? { ...FONT_DEFAULT, color: { rgb: '6B7280' } } : FONT_DEFAULT,
          border: BORDER_THIN,
          alignment: col === 'A' ? ALIGN_CENTER : ALIGN_LEFT,
        };
      }
    });
  }

  // ── 빈 입력 영역 스타일 (Row 4~11) ──
  for (let r = 4; r <= 11; r++) {
    ['A','B','C','D','E','F'].forEach(col => {
      const ref = col + r;
      if (!ws[ref]) ws[ref] = { v: '', t: 's' };
      ws[ref].s = {
        font: FONT_DEFAULT,
        border: BORDER_THIN,
        alignment: col === 'A' ? ALIGN_CENTER : ALIGN_LEFT,
      };
    });
  }

  // ── 주의사항 영역 (H열, 우측) ──
  // H1: 주의사항 타이틀
  ws['H1'] = {
    v: '⚠ 주의사항',
    t: 's',
    s: {
      font: FONT_NOTICE_TITLE,
      fill: FILL_NOTICE_TITLE,
      border: BORDER_NOTICE,
      alignment: { horizontal: 'left', vertical: 'center' },
    }
  };

  // 주의사항 내용들
  const notices = [
    { text: '○ 모든 양식은 변경하지 말고 그대로 입력해주세요.', font: FONT_NOTICE_BOLD },
    { text: '   (A2번 항목부터 값을 읽습니다. 헤더 행은 수정하지 마세요.)', font: FONT_NOTICE },
    { text: '', font: FONT_NOTICE },
    { text: '○ 동의어(Synonyms)는 여러 개 입력 가능하며,', font: FONT_NOTICE_BOLD },
    { text: '   반드시 쉼표(,) 기준으로 구분하여 작성해주세요.', font: FONT_NOTICE_RED },
    { text: '   예: 제품명, 자재명, 상품명', font: FONT_EXAMPLE },
    { text: '', font: FONT_NOTICE },
    { text: '○ Column, 설명, 데이터타입 값은 필수 입력 항목입니다.', font: FONT_NOTICE_BOLD },
    { text: '○ Table은 비워두면 기본값 bw_profitability_data가 적용됩니다.', font: FONT_NOTICE },
  ];

  notices.forEach((n, i) => {
    const ref = 'H' + (i + 2);
    ws[ref] = {
      v: n.text,
      t: 's',
      s: {
        font: n.font,
        fill: FILL_NOTICE,
        border: BORDER_NOTICE,
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      }
    };
  });

  // ── 셀 병합: 주의사항은 단독 열이므로 병합 불필요, G열은 구분 공백 ──
  // G 열 전체 비움 처리 (구분 공간)
  for (let r = 1; r <= 11; r++) {
    const ref = 'G' + r;
    if (!ws[ref]) ws[ref] = { v: '', t: 's' };
    ws[ref].s = { font: FONT_DEFAULT };
  }

  // ── 시트 범위 갱신 ──
  ws['!ref'] = 'A1:H11';

  XLSX.utils.book_append_sheet(wb, ws, 'Ontology');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename=ontology_template.xlsx');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(Buffer.from(buf));
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
// PPT Report API (Python child_process 호출)
// ============================================================
const execFileAsync = promisify(execFile);
const REPORT_CLI = path.join(import.meta.dirname, 'report_cli.py');

// GET /api/report/months - 사용 가능한 월 목록
app.get('/api/report/months', async (req, res) => {
  try {
    const { stdout } = await execFileAsync('python3', [REPORT_CLI, 'months'], {
      cwd: import.meta.dirname,
      timeout: 30000,
    });
    res.json(JSON.parse(stdout));
  } catch (e) {
    console.error('[Report] months error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/report/preview - 미리보기 데이터
app.post('/api/report/preview', async (req, res) => {
  try {
    const { calmonth } = req.body;
    if (!calmonth) return res.status(400).json({ error: '월을 선택해주세요.' });
    const { stdout } = await execFileAsync('python3', [REPORT_CLI, 'preview', calmonth], {
      cwd: import.meta.dirname,
      timeout: 30000,
    });
    res.json(JSON.parse(stdout));
  } catch (e) {
    console.error('[Report] preview error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/report/ppt - PPT 생성 및 다운로드
app.post('/api/report/ppt', upload.single('attachment'), async (req, res) => {
  let attachmentPath = null;
  try {
    const calmonth = req.body.calmonth || '';
    const prompt = req.body.prompt || '';
    if (!calmonth || calmonth.length !== 6) {
      return res.status(400).json({ error: '올바른 월을 선택해주세요 (예: 202405)' });
    }

    const args = [REPORT_CLI, 'generate', calmonth];
    if (prompt) args.push(prompt);
    else args.push('');

    if (req.file) {
      attachmentPath = req.file.path;
      args.push(attachmentPath);
    }

    const { stdout } = await execFileAsync('python3', args, {
      cwd: import.meta.dirname,
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'buffer',
    });

    const year = calmonth.slice(0, 4);
    const month = parseInt(calmonth.slice(4));
    const filename = encodeURIComponent(`수익성분석_보고서_${year}년_${month}월.pptx`);

    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      'Content-Length': stdout.length,
    });
    res.send(stdout);
  } catch (e) {
    console.error('[Report] PPT generation error:', e.message);
    res.status(500).json({ error: `보고서 생성 오류: ${e.message}` });
  } finally {
    if (attachmentPath && fs.existsSync(attachmentPath)) {
      try { fs.unlinkSync(attachmentPath); } catch {}
    }
  }
});

// POST /api/report/upload-preview - 첨부파일 미리보기
app.post('/api/report/upload-preview', upload.single('file'), async (req, res) => {
  let filePath = null;
  try {
    if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
    filePath = req.file.path;

    // 원래 확장자로 파일명 복원 (Python에서 확장자 기반 분기)
    const ext = path.extname(req.file.originalname).toLowerCase();
    const newPath = filePath + ext;
    fs.renameSync(filePath, newPath);
    filePath = newPath;

    const { stdout } = await execFileAsync('python3', [REPORT_CLI, 'upload-preview', filePath], {
      cwd: import.meta.dirname,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    });
    res.json(JSON.parse(stdout));
  } catch (e) {
    console.error('[Report] upload-preview error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
});

// ============================================================
// 비주얼 쿼리 빌더 API
// ============================================================

// GET /api/builder/columns - 쿼리 빌더용 컬럼 목록 (Ontology 기반 + DB 실제 컬럼)
app.get('/api/builder/columns', async (req, res) => {
  try {
    // 1. DB 실제 컬럼 정보 조회
    const [dbCols] = await pool.query(`
      SELECT COLUMN_NAME, COLUMN_TYPE, COLUMN_COMMENT
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='company_board' AND TABLE_NAME='bw_profitability_data'
      ORDER BY ORDINAL_POSITION
    `);

    // 2. Ontology 컬럼 정보 조회 (설명 보강)
    const [ontoCols] = await pool.query(`SELECT column_name, description, data_type FROM ontology_column`);
    const ontoMap = {};
    for (const o of ontoCols) {
      ontoMap[o.column_name.toUpperCase()] = o;
    }

    // 카테고리 분류
    const catMap = {
      'SEQ': 'system',
      'CALMONTH': 'period', 'CALDAY': 'period',
      'CO_AREA': 'org', 'PROFIT_CTR': 'org', 'DIVISION': 'org', 'PLANT': 'org',
      'DISTR_CHAN': 'org', 'ZDISTCHAN': 'org', 'ZORG_TEAM': 'org', 'SALES_OFF': 'org',
      'MATL_TYPE': 'product', 'MATL_GROUP': 'product',
      'PRODH1': 'product', 'PRODH2': 'product', 'PRODH3': 'product', 'PRODH4': 'product',
      'ZJPCODE': 'product', 'ZBRAND1': 'product', 'ZBRAND2': 'product',
      'MATERIAL': 'product', 'MATERIAL_DESC': 'product',
      'BILL_TYPE': 'trade', 'INCOTERMS': 'trade', 'CUST_GROUP': 'trade',
      'CUST_GRP1': 'trade', 'COUNTRY': 'trade', 'ZKUNN2': 'trade', 'CUSTOMER': 'trade',
      'ZUNITBOX': 'unit', 'ZUNITBAG': 'unit', 'ZUNITKGEA': 'unit', 'CURRENCY': 'unit',
    };

    const columns = [];
    for (const r of dbCols) {
      const name = r.COLUMN_NAME;
      const ctype = r.COLUMN_TYPE;
      const onto = ontoMap[name.toUpperCase()];

      // 타입 분류
      const dataType = /bigint|decimal|int|double|float/i.test(ctype) ? 'number' : 'text';

      // 라벨: Ontology 설명 > DB COMMENT > 컬럼명
      const label = (onto && onto.description) ? onto.description : (r.COLUMN_COMMENT || name);

      // 카테고리
      let category = catMap[name] || 'other';
      if (!catMap[name]) {
        if (name.startsWith('ZQTY')) category = 'quantity';
        else if (name.startsWith('ZAMT')) category = 'amount';
      }

      columns.push({ name, label, type: dataType, db_type: ctype, category });
    }

    res.json({ columns });
  } catch (err) {
    console.error('[Builder] columns error:', err.message);
    res.status(500).json({ error: '컬럼 목록 조회 실패: ' + err.message });
  }
});

// GET /api/builder/values/:columnName - 특정 컬럼의 고유값 목록 (필터 조건 자동완성용)
app.get('/api/builder/values/:columnName', async (req, res) => {
  const { columnName } = req.params;
  try {
    // 화이트리스트 검증
    const [check] = await pool.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='company_board' AND TABLE_NAME='bw_profitability_data' AND COLUMN_NAME = ?
    `, [columnName]);
    if (check.length === 0) {
      return res.status(404).json({ error: `존재하지 않는 컬럼: ${columnName}` });
    }

    const [rows] = await pool.query(`
      SELECT DISTINCT \`${columnName}\` AS val, COUNT(*) AS cnt
      FROM bw_profitability_data
      WHERE \`${columnName}\` IS NOT NULL AND \`${columnName}\` != ''
      GROUP BY \`${columnName}\`
      ORDER BY cnt DESC
      LIMIT 200
    `);

    const values = rows.map(r => ({
      value: typeof r.val === 'bigint' ? Number(r.val) : r.val,
      count: Number(r.cnt),
    }));

    res.json({ column: columnName, values, total: values.length });
  } catch (err) {
    console.error('[Builder] values error:', err.message);
    res.status(500).json({ error: '값 조회 실패: ' + err.message });
  }
});

// POST /api/builder/query - 쿼리 빌더 실행
app.post('/api/builder/query', async (req, res) => {
  const { fields, conditions, group_by, order_by, order_dir, limit: limitStr, prompt } = req.body;

  if (!fields || fields.length === 0) {
    return res.status(400).json({ error: '조회할 필드를 하나 이상 선택해주세요.' });
  }

  const safeLimit = Math.min(parseInt(limitStr) || 1000, 5000);

  try {
    // 화이트리스트: DB 실제 컬럼명 검증
    const [validColRows] = await pool.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='company_board' AND TABLE_NAME='bw_profitability_data'
    `);
    const validCols = new Set(validColRows.map(r => r.COLUMN_NAME));

    // SELECT 절
    const selectParts = [];
    for (const f of fields) {
      const col = f.column;
      if (!validCols.has(col)) return res.status(400).json({ error: `유효하지 않은 컬럼: ${col}` });
      const agg = f.aggregate;
      const alias = f.alias || col;
      if (agg && ['SUM','COUNT','AVG','MAX','MIN'].includes(agg.toUpperCase())) {
        selectParts.push(`${agg.toUpperCase()}(\`${col}\`) AS \`${alias}\``);
      } else {
        selectParts.push(`\`${col}\` AS \`${alias}\``);
      }
    }

    // WHERE 절
    const whereParts = [];
    const params = [];
    if (conditions && conditions.length > 0) {
      for (let i = 0; i < conditions.length; i++) {
        const cond = conditions[i];
        const col = cond.column;
        if (!col || !validCols.has(col)) continue;

        const op = cond.operator || '=';
        const val = cond.value || '';
        const logic = (cond.logic || 'AND').toUpperCase();

        let clause;
        if (op === '=' || op === '!=' || op === '>' || op === '>=' || op === '<' || op === '<=') {
          clause = `\`${col}\` ${op} ?`;
          params.push(val);
        } else if (op === 'LIKE') {
          clause = `\`${col}\` LIKE ?`;
          params.push(`%${val}%`);
        } else if (op === 'NOT LIKE') {
          clause = `\`${col}\` NOT LIKE ?`;
          params.push(`%${val}%`);
        } else if (op === 'IN') {
          const inVals = String(val).split(',').map(v => v.trim()).filter(v => v);
          if (inVals.length === 0) continue;
          clause = `\`${col}\` IN (${inVals.map(() => '?').join(',')})`;
          params.push(...inVals);
        } else if (op === 'IS NULL') {
          clause = `\`${col}\` IS NULL`;
        } else if (op === 'IS NOT NULL') {
          clause = `\`${col}\` IS NOT NULL`;
        } else if (op === 'BETWEEN') {
          const bVals = String(val).split(',').map(v => v.trim());
          if (bVals.length !== 2) continue;
          clause = `\`${col}\` BETWEEN ? AND ?`;
          params.push(bVals[0], bVals[1]);
        } else {
          clause = `\`${col}\` = ?`;
          params.push(val);
        }

        if (i === 0) {
          whereParts.push(clause);
        } else {
          whereParts.push(`${logic === 'OR' ? 'OR' : 'AND'} ${clause}`);
        }
      }
    }

    // GROUP BY 절
    const groupParts = [];
    if (group_by && group_by.length > 0) {
      for (const g of group_by) {
        if (validCols.has(g)) groupParts.push(`\`${g}\``);
      }
    }

    // ORDER BY 절
    let orderClause = '';
    if (order_by) {
      const dir = (order_dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
      orderClause = `ORDER BY \`${order_by}\` ${dir}`;
    }

    // SQL 조합
    let sql = `SELECT ${selectParts.join(', ')} FROM bw_profitability_data`;
    if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(' ')}`;
    if (groupParts.length > 0) sql += ` GROUP BY ${groupParts.join(', ')}`;
    if (orderClause) sql += ` ${orderClause}`;
    sql += ` LIMIT ${safeLimit}`;

    let finalParams = params;

    // 추가 프롬프트가 있으면 GPT로 SQL 보완
    if (prompt && prompt.trim()) {
      try {
        // GPT에게는 ? 바인딩을 실제 값으로 치환한 SQL을 전달
        let resolvedSql = sql;
        let paramIdx = 0;
        resolvedSql = resolvedSql.replace(/\?/g, () => {
          const v = params[paramIdx++];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        const gptPrompt = `[테이블 스키마]\n${TABLE_SCHEMA}\n\n[기본 SQL]\n${resolvedSql}\n\n[추가 요청]\n${prompt}\n\n위 기본 SQL을 기반으로 추가 요청을 반영한 완성된 SELECT 문을 작성해주세요.\n반드시 위 스키마에 존재하는 컬럼명만 사용하세요. 존재하지 않는 컬럼(예: SALES, REVENUE 등)을 절대 만들지 마세요.\nWHERE 조건의 값은 반드시 리터럴 값으로 직접 작성하세요 (? 파라미터 바인딩 사용 금지).\nSELECT 문만 작성하고 JSON 형식이 아닌 순수 SQL만 반환하세요.`;
        const completion = await openai.chat.completions.create({
          model: 'gpt-5-mini',
          messages: [
            { role: 'system', content: '당신은 SQL 전문가입니다. 주어진 기본 SQL을 기반으로 추가 요청을 반영한 SELECT 문만 작성하세요.\n중요 규칙:\n1. 반드시 제공된 테이블 스키마에 존재하는 컬럼명만 사용하세요.\n2. "매출"은 ZAMT001(총매출), "순매출"은 ZAMT003 등 스키마의 한국어 설명을 참고하여 올바른 컬럼을 매핑하세요.\n3. 존재하지 않는 컬럼명을 임의로 생성하지 마세요.\n4. SELECT 문 이외의 DML(INSERT, UPDATE, DELETE) 및 DDL(DROP, ALTER, CREATE, TRUNCATE)은 절대 생성하지 마세요.' },
            { role: 'user', content: gptPrompt },
          ],
          temperature: 0.1,
        });
        let gptSql = completion.choices[0].message.content.trim();
        // 코드 블록 제거
        gptSql = gptSql.replace(/```sql\s*/gi, '').replace(/```\s*/g, '').trim();
        // 안전성 검증
        const forbidden = ['INSERT','UPDATE','DELETE','DROP','ALTER','TRUNCATE','CREATE'];
        const isSafe = !forbidden.some(w => new RegExp('\\b' + w + '\\b', 'i').test(gptSql));
        if (isSafe && /^SELECT/i.test(gptSql)) {
          sql = gptSql;
          finalParams = []; // GPT SQL은 파라미터 바인딩 없이 실행
        }
      } catch (gptErr) {
        console.error('[Builder] GPT prompt enhancement failed:', gptErr.message);
      }
    }

    // SQL 실행
    const [rows] = finalParams.length > 0
      ? await pool.query(sql, finalParams)
      : await pool.query(sql);

    const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
    const clean = rows.map(row => {
      const r = {};
      for (const [k, v] of Object.entries(row)) {
        r[k] = typeof v === 'bigint' ? Number(v) : v;
      }
      return r;
    });

    // 차트 자동 판별
    const chart = builderSuggestChart(cols, clean.length);

    res.json({ success: true, sql, columns: cols, rows: clean, row_count: clean.length, chart });
  } catch (err) {
    console.error('[Builder] query error:', err.message);
    res.status(500).json({ error: `DB 오류: ${err.message}`, sql: '' });
  }
});

// 차트 자동 판별 헬퍼
function builderSuggestChart(cols, rowCount) {
  if (rowCount === 0 || cols.length < 2) return { chart_type: 'table_only' };
  const labelCol = cols[0];
  const dataCols = cols.slice(1);
  if (rowCount <= 6 && dataCols.length === 1) return { chart_type: 'pie', label_column: labelCol, data_columns: dataCols };
  if (rowCount <= 30) return { chart_type: 'bar', label_column: labelCol, data_columns: dataCols };
  return { chart_type: 'table_only' };
}

// ============================================================
// 데이터 업로드 API
// ============================================================

// 엑셀 컬럼명 → DB 컬럼명 매핑 (SAP BW 원천 엑셀의 특수 컬럼명 처리)
const EXCEL_TO_DB_COL_MAP = {
  '/BIC/ZDISTCHAN': 'ZDISTCHAN',
  '/BIC/ZORG_TEAM': 'ZORG_TEAM',
  '/BIC/ZJPCODE': 'ZJPCODE',
  '/BIC/ZBRAND': 'ZBRAND1',
  '/BIC/ZSBRAND': 'ZBRAND2',
  '/BIC/ZKUNN2': 'ZKUNN2',
  '/BIC/ZBOXUNIT': 'ZUNITBOX',
  '/BIC/ZBAGUNIT': 'ZUNITBAG',
  '/BIC/ZUNIT': 'ZUNITKGEA',
  '/BIC/ZQTY_BOX': 'ZQTYBOX',
  '/BIC/ZQTY_BAG': 'ZQTYBAG',
  '/BIC/ZQTY_KE': 'ZQTYKGEA',
  'MATERIAL_NM': 'MATERIAL_DESC',
};

// POST /api/data-upload/preview - 엑셀 파일 업로드 후 프리뷰 (컬럼 매핑 분석)
// 최적화: xlsx는 sheetRows로 헤더만, xlsb는 1회 전체 로드 후 메모리에서 처리
app.post('/api/data-upload/preview', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });
  const filePath = path.join(UPLOAD_DIR, req.file.filename);
  try {
    const XLSXRaw = await import('xlsx');
    const XLSX = XLSXRaw.default || XLSXRaw;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isXlsb = ext === '.xlsb';

    console.time('[Data Upload] preview-readFile');

    let sheetName, korHeaders, engHeaders, sampleDataRows, totalDataRows;

    if (isXlsb) {
      // xlsb는 sheetRows 최적화가 안 먹으므로 1회만 전체 로드
      const wb = XLSX.readFile(filePath, { type: 'file' });
      sheetName = wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      // 전체 데이터를 JSON으로 변환하여 실제 비어있지 않은 행만 카운트
      const allData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      korHeaders = allData[0] || [];
      engHeaders = allData[1] || [];
      const allDataRows = allData.slice(2);
      // 빈 행 필터링: 하나라도 실제 값이 있는 행만 카운트
      const isRowNonEmpty = (row) => {
        if (!Array.isArray(row)) return false;
        return row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
      };
      totalDataRows = allDataRows.filter(isRowNonEmpty).length;
      sampleDataRows = allDataRows.filter(isRowNonEmpty).slice(0, 5);
      console.log(`[Data Upload] xlsb 빈 행 필터링: sheet_to_json ${allDataRows.length}행 → 실제 데이터 ${totalDataRows}행`);
    } else {
      // xlsx/xls/csv → 전체 로드하여 빈 행 필터링 적용
      const wbMeta = XLSX.readFile(filePath, { type: 'file', bookSheets: true });
      sheetName = wbMeta.SheetNames[0];
      const wbFull = XLSX.readFile(filePath, { type: 'file' });
      const wsFull = wbFull.Sheets[sheetName];
      const allData = XLSX.utils.sheet_to_json(wsFull, { header: 1, defval: null });
      korHeaders = allData[0] || [];
      engHeaders = allData[1] || [];
      const allDataRows = allData.slice(2);
      // 빈 행 필터링: 하나라도 실제 값이 있는 행만 카운트
      const isRowNonEmpty = (row) => {
        if (!Array.isArray(row)) return false;
        return row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
      };
      totalDataRows = allDataRows.filter(isRowNonEmpty).length;
      sampleDataRows = allDataRows.filter(isRowNonEmpty).slice(0, 5);
      console.log(`[Data Upload] 빈 행 필터링: sheet_to_json ${allDataRows.length}행 → 실제 데이터 ${totalDataRows}행`);
    }

    console.timeEnd('[Data Upload] preview-readFile');

    // DB 실제 컬럼 목록 조회
    const [dbColsRaw] = await pool.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='company_board' AND TABLE_NAME='bw_profitability_data'
      ORDER BY ORDINAL_POSITION
    `);
    const dbColSet = new Set(dbColsRaw.map(r => r.COLUMN_NAME.toUpperCase()));

    // 컬럼 매핑 분석
    const mapped = [];
    const excluded = [];

    for (let i = 0; i < engHeaders.length; i++) {
      const rawCol = engHeaders[i];
      if (!rawCol) { excluded.push({ index: i, korName: korHeaders[i] || `(열${i+1})`, engName: '(빈 컬럼명)', reason: '영문 컬럼명 없음' }); continue; }
      const rawUpper = String(rawCol).trim().toUpperCase();
      const mappedName = EXCEL_TO_DB_COL_MAP[rawCol] || EXCEL_TO_DB_COL_MAP[rawUpper] || rawUpper;
      if (dbColSet.has(mappedName.toUpperCase()) && mappedName.toUpperCase() !== 'SEQ') {
        mapped.push({ index: i, korName: korHeaders[i] || '', engName: rawCol, dbColumn: mappedName });
      } else {
        excluded.push({ index: i, korName: korHeaders[i] || '', engName: rawCol, reason: dbColSet.has('SEQ') && mappedName.toUpperCase() === 'SEQ' ? 'PK 자동생성 컬럼' : 'DB 테이블에 존재하지 않는 컬럼' });
      }
    }

    // 프리뷰 데이터 (미리보기 행)
    const previewRows = sampleDataRows.slice(0, 5).map(row => {
      const obj = {};
      mapped.forEach(m => { obj[m.dbColumn] = row[m.index] ?? null; });
      return obj;
    });

    console.log(`[Data Upload] Preview 완료: ${req.file.originalname}, ${totalDataRows}행, 매핑 ${mapped.length}/${engHeaders.length}컬럼`);

    res.json({
      fileName: req.file.originalname,
      filePath: req.file.filename,
      sheetName,
      totalRows: totalDataRows,
      totalExcelCols: engHeaders.length,
      mappedCols: mapped,
      excludedCols: excluded,
      mappedCount: mapped.length,
      excludedCount: excluded.length,
      previewRows,
      previewColumns: mapped.map(m => m.dbColumn),
    });
  } catch (err) {
    console.error('[Data Upload] Preview error:', err.message, err.stack);
    res.status(500).json({ error: '파일 분석 실패: ' + err.message });
  }
});

// POST /api/data-upload/apply - 실제 DB 적재 (배치 INSERT 최적화)
// 성능: 단건 INSERT → 멀티 VALUES 배치 INSERT (100행씩), 10만행 기준 약 50~100배 빠름
app.post('/api/data-upload/apply', async (req, res) => {
  const { filePath, mappedCols } = req.body;
  if (!filePath || !mappedCols || mappedCols.length === 0) {
    return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
  }
  const fullPath = path.join(UPLOAD_DIR, filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(400).json({ error: '업로드된 파일을 찾을 수 없습니다. 다시 업로드해주세요.' });
  }

  try {
    const XLSXRaw = await import('xlsx');
    const XLSX = XLSXRaw.default || XLSXRaw;

    console.time('[Data Upload] apply-readFile');
    const wb = XLSX.readFile(fullPath, { type: 'file' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allData = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    console.timeEnd('[Data Upload] apply-readFile');
    // 빈 행 필터링: 매핑된 컬럼 중 하나라도 실제 값이 있는 행만 INSERT 대상
    const rawDataRows = allData.slice(2);
    const dataRows = rawDataRows.filter(row => {
      if (!Array.isArray(row)) return false;
      return mappedCols.some(m => {
        const v = row[m.index];
        return v !== null && v !== undefined && String(v).trim() !== '';
      });
    });
    console.log(`[Data Upload] Apply 빈 행 필터링: ${rawDataRows.length}행 → 실제 데이터 ${dataRows.length}행`);

    const dbColumns = mappedCols.map(m => m.dbColumn);
    const colList = dbColumns.map(c => '`' + c + '`').join(', ');
    const singleRowPlaceholder = '(' + dbColumns.map(() => '?').join(',') + ')';

    const conn = await pool.getConnection();
    let inserted = 0;
    const errors = [];
    const BATCH_SIZE = 200; // 한번에 200행씩 멀티 VALUES INSERT

    console.time('[Data Upload] apply-insert');
    // 배치 단위로 트랜잭션 분할 (대용량 시 단일 트랜잭션은 메모리 폭발 위험)
    for (let i = 0; i < dataRows.length; i += BATCH_SIZE) {
      const batch = dataRows.slice(i, Math.min(i + BATCH_SIZE, dataRows.length));
      const valuePlaceholders = [];
      const flatValues = [];
      const batchErrors = [];

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j];
        const rowValues = mappedCols.map(m => {
          const v = row[m.index];
          if (v === null || v === undefined || v === '') return null;
          return v;
        });
        valuePlaceholders.push(singleRowPlaceholder);
        flatValues.push(...rowValues);
      }

      // 멀티 VALUES INSERT: INSERT INTO t (c1,c2) VALUES (?,?),(?,?),(?,?)...
      const batchSQL = `INSERT INTO bw_profitability_data (${colList}) VALUES ${valuePlaceholders.join(',')}`;
      try {
        await conn.query(batchSQL, flatValues);
        inserted += batch.length;
      } catch (batchErr) {
        // 배치 실패 시 → 개별 INSERT로 폴백하여 실패 행 특정
        for (let j = 0; j < batch.length; j++) {
          const row = batch[j];
          const rowIdx = i + j + 3;
          const rowValues = mappedCols.map(m => {
            const v = row[m.index];
            if (v === null || v === undefined || v === '') return null;
            return v;
          });
          try {
            await conn.query(
              `INSERT INTO bw_profitability_data (${colList}) VALUES ${singleRowPlaceholder}`,
              rowValues
            );
            inserted++;
          } catch (rowErr) {
            if (errors.length < 50) {
              errors.push({ row: rowIdx, error: rowErr.message.substring(0, 200) });
            }
          }
        }
      }

      // 5000행마다 진행 로그
      if ((i + BATCH_SIZE) % 5000 < BATCH_SIZE) {
        console.log(`[Data Upload] 진행: ${Math.min(i + BATCH_SIZE, dataRows.length)}/${dataRows.length}행 (${inserted} 성공)`);
      }
    }
    console.timeEnd('[Data Upload] apply-insert');

    conn.release();

    // 적재 후 총 행 수 조회
    const [countResult] = await pool.query('SELECT COUNT(*) AS cnt FROM bw_profitability_data');
    const totalDbRows = countResult[0].cnt;

    // 임시 파일 삭제
    try { fs.unlinkSync(fullPath); } catch(e) {}

    console.log(`[Data Upload] 적재 완료: ${inserted}/${dataRows.length}행, 에러 ${errors.length}건`);

    res.json({
      success: true,
      totalExcelRows: dataRows.length,
      insertedRows: inserted,
      failedRows: dataRows.length - inserted,
      errors,
      totalDbRows: Number(totalDbRows),
      mappedColumns: dbColumns,
    });
  } catch (err) {
    console.error('[Data Upload] Apply error:', err.message, err.stack);
    res.status(500).json({ error: 'DB 적재 실패: ' + err.message });
  }
});

// report.html 페이지 서빙
app.get('/report', (req, res) => {
  res.sendFile(path.join(import.meta.dirname, 'public', 'report.html'));
});

// ============================================================
app.get('/{*splat}', (req, res) => {
  // API 경로는 SPA fallback에서 제외 (404 반환)
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found', path: req.path });
  }
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
