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
import session from 'express-session';
import expressMySQLSession from 'express-mysql-session';
import crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';
import { Agent as UndiciAgent, setGlobalDispatcher as setUndiciGlobalDispatcher } from 'undici';

// ════════════════════════════════════════════════════════════════════
// [2026-07-21 hotfix] undici 글로벌 dispatcher 헤더/바디 타임아웃 확장
// --------------------------------------------------------------------
// Node 20 의 글로벌 fetch(undici) 기본값은 headersTimeout=300s(5분),
// bodyTimeout=300s. 분석질문 파이프라인(LLM 다단계 호출)이 5분 이상 걸릴 수
// 있어, self-fetch(runNlqJobInBackground → POST /api/nlq) 가 5분 넘어가면
// 'fetch failed' 로 abort 되고 이 실패가 클라이언트 UI 에 시스템 오류로
// 노출되던 문제를 해결. Express requestTimeout(600s) 과 정렬.
// ════════════════════════════════════════════════════════════════════
try {
  const UNDICI_TIMEOUT_MS = parseInt(process.env.UNDICI_TIMEOUT_MS || '600000', 10); // 10분
  setUndiciGlobalDispatcher(new UndiciAgent({
    headersTimeout: UNDICI_TIMEOUT_MS,
    bodyTimeout: UNDICI_TIMEOUT_MS,
    connectTimeout: 30000,
  }));
  console.log(`[Boot] undici global dispatcher: headersTimeout=${UNDICI_TIMEOUT_MS}ms, bodyTimeout=${UNDICI_TIMEOUT_MS}ms`);
} catch (e) {
  console.warn('[Boot] undici dispatcher 설정 실패 (기본값 유지):', e.message);
}
import {
  buildRagIndex,
  searchRelevantMeta,
  ragResultToPromptContext,
  addToIndex,
  removeFromIndex,
  getRagStats,
  _detectTypesInQuery,
} from './rag.mjs';
// [2026-06-29] 요청 단위 단계별 로그 — /api/builder/* timeout 추적용
//   - 로그 파일: /data/analytics/logs/nlq-server.log (운영) / ./logs/nlq-server.log (샌드박스)
//   - 모든 /api/* 요청에 requestId 부여 (Nginx X-Request-Id 헤더 우선)
import { requestIdMiddleware, createReqLogger, reqLogger, LOG_FILE_PATH } from './lib/reqLogger.mjs';
// Phase 1: 후속 대화 의도 분류기 + 6개 신규 핸들러 (PR #201)
//   - 8 intent (data_query/analysis/metric_lookup/ontology_lookup/troubleshooting/sql_explain/domain_explain/general_chat)
//   - 3-tier 분류 (휴리스틱 → LLM → 라디오 fallback)
//   - 라우팅: 본 파일 L3564 부근 /api/nlq 진입점에서 직접 호출
import {
  INTENT_LABELS,
  classifyConversationalIntent,
  logConversationalIntent,
  determineSuggestedMode,
  handleMetricLookup,
  handleOntologyLookup,
  handleTroubleshooting,
  handleSqlExplain,
  handleDomainExplain,
  handleGeneralChat,
} from './conversational-intent.mjs';
// [PR #257] 학습 SQL CALMONTH 시간 리터럴 재바인딩 / 저장 시 자리표시자 파라미터화
//   - 배경: sql_feedback 에 저장된 학습 SQL 은 검증 당시의 CALMONTH 리터럴이 박제됨.
//     "당월" 같은 상대 표현 질의를 다음 달에 재사용하면 과거 월 데이터가 반환되는 회귀.
//   - 축 A) rebaseCalmonthForLearnedSql: 학습 SQL 재사용 직전 CALMONTH 값을 현재
//     latestMonth / prevMonth 로 동적 재바인딩 (질의 명시 년월은 존중).
//   - 축 B) parameterizeCalmonthForSave: 피드백 저장 시 CALMONTH 리터럴을
//     :LATEST_MONTH / :PREV_MONTH 자리표시자로 치환 (미래 지향적 저장).
import {
  rebaseCalmonthForLearnedSql,
  parameterizeCalmonthForSave,
} from './lib/calmonth-rebase.mjs';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// 모든 /api/* 요청에 requestId 부여 (가장 앞단에 배치 — 다른 미들웨어보다 먼저)
app.use('/api', requestIdMiddleware);
console.log(`[Boot] nlq-server 요청 단위 로그 파일: ${LOG_FILE_PATH}`);

// ============================================================
// [2026-06-16] 비밀번호 SHA-256 해싱 헬퍼
// ------------------------------------------------------------
// 사용자 요청:
//   - users.password 컬럼에 평문 저장 금지
//   - 그룹웨어 bulk INSERT/UPDATE, 사용자 수정 API, 로그인 검증 모두 동일 정책
//   - 동일 입력 → 동일 해시 (deterministic, salt 없음 — 운영 DB 일괄 마이그레이션 필요)
//   - 인코딩 UTF-8 통일
//   - SHA-256 결과: 64자 16진수 소문자
//
// 정책:
//   1) hashPassword(plain): UTF-8 → SHA-256 → hex lowercase
//   2) isSha256Hex(s): 이미 해시된 값인지 판별 (64자 16진수)
//      - 멱등성 보장: 이미 해시된 값을 다시 해시하지 않도록 보호
//      - bulk API 가 외부에서 해시된 값을 직접 보내는 케이스도 통과
//   3) toStoredPassword(input): 저장용 정규화
//      - 빈 문자열/null → null 반환 (호출측에서 처리)
//      - 이미 SHA-256 해시 형식 → 그대로 반환
//      - 평문 → SHA-256 해싱 후 반환
// ============================================================
function hashPassword(plain) {
  return crypto.createHash('sha256').update(String(plain), 'utf8').digest('hex');
}
function isSha256Hex(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/i.test(s);
}
function toStoredPassword(input) {
  if (input === undefined || input === null) return null;
  const v = String(input).trim();
  if (v === '') return null;
  // 이미 SHA-256 해시 형식이면 그대로 (멱등성)
  if (isSha256Hex(v)) return v.toLowerCase();
  return hashPassword(v);
}

// ============================================================
// [2026-06-15] Request-scoped 로그 캡처 + requestId 미들웨어
// ------------------------------------------------------------
// 목적: 자연어 질의 오류 발생 시, 그 요청 처리 중에 찍힌 console.log/error
//       라인들을 응답 본문에 함께 실어줘서 화면 "오류 상세" 영역에서
//       module-profit.log 를 따로 안 봐도 원인 추적 가능하게 함.
//
// 동작 개요:
//   1) NLQ 같은 진단 대상 라우트는 captureLogsMiddleware 를 통과시켜
//      각 요청마다 고유 requestId 발급 + AsyncLocalStorage 컨텍스트 진입
//   2) 컨텍스트 안의 console.log/info/warn/error 호출은 모두
//      해당 요청의 링버퍼(최근 200줄)에 저장 + 기존 콘솔 출력(PM2 로그)은 그대로 유지
//   3) 라우트 핸들러에서 응답 직전에 ctx.logLines / ctx.requestId 를 꺼내
//      error_detail.requestId / error_detail.logLines 로 클라이언트에 전달
//   4) 모든 요청의 로그는 메모리 LRU(최근 200건) 에 보관 →
//      클라이언트가 504 같은 비-JSON 응답을 받았을 때
//      `/api/nlq/error-log/:requestId` 로 사후 조회 가능
//
// [2026-07-03] 자연어질의 파일 로그 통합 (nlq-server.log 미러링)
//   - 기존에는 /api/builder/* (createReqLogger) 만 pino 파일에 남았고
//     /api/nlq 는 captureLogsMiddleware 만 사용해 메모리+PM2 out 로그만 남음
//     → 운영자가 nlq-server.log 를 봐도 자연어질의 오류를 찾을 수 없었음
//   - 해결: captureLogsMiddleware 안에서 pino (reqLogger) 로도 동일 requestId 로
//     아래 이벤트들을 파일에 기록:
//       * request_received (진입)
//       * console line 마다 (LOG/INFO/WARN/ERROR, 짧게 축약)
//       * stage 변경마다 (setRequestStage)
//       * request_finished / request_aborted (종료)
//   - 이로써 비주얼쿼리빌더와 동일하게 `grep '"requestId":"xxx"' nlq-server.log`
//     한 줄로 자연어질의 요청의 전체 흐름을 추적 가능
// ============================================================
const REQ_LOG_RING_SIZE = parseInt(process.env.NLQ_REQ_LOG_RING_SIZE || '200', 10);
const REQ_LOG_LRU_SIZE = parseInt(process.env.NLQ_REQ_LOG_LRU_SIZE || '200', 10);
const requestLogStorage = new AsyncLocalStorage();
// 최근 처리된 요청들의 로그를 보관 (Map = 삽입 순서 유지 → LRU 구현)
const requestLogLRU = new Map();

function generateRequestId() {
  // ex) 20260615-141523-abc1d2 (정렬가능 + 가독성)
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = crypto.randomBytes(3).toString('hex');
  return `req-${ts}-${rand}`;
}

function rememberRequestLog(requestId, ctxObj) {
  if (!requestId || !ctxObj) return;
  if (requestLogLRU.has(requestId)) requestLogLRU.delete(requestId); // 갱신
  requestLogLRU.set(requestId, ctxObj);
  // LRU 초과 시 가장 오래된 것 제거
  while (requestLogLRU.size > REQ_LOG_LRU_SIZE) {
    const firstKey = requestLogLRU.keys().next().value;
    requestLogLRU.delete(firstKey);
  }
}

/** 현재 요청 컨텍스트 (없으면 null) */
function getRequestCtx() {
  return requestLogStorage.getStore() || null;
}

/** 현재 요청 컨텍스트의 logLines (사본) — 라우트 핸들러에서 응답 생성용 */
function getCurrentLogLines() {
  const ctx = getRequestCtx();
  if (!ctx) return [];
  return ctx.logLines.slice();
}

/** 현재 요청 컨텍스트의 requestId */
function getCurrentRequestId() {
  return getRequestCtx()?.requestId || null;
}

/** 현재 요청 컨텍스트에 stage 기록 (가장 최근 stage 가 응답에 노출됨)
 *  + [2026-07-03] pino 파일(nlq-server.log)에도 동일 requestId 로 기록
 *    → 운영자가 파일 로그로 자연어질의 요청 흐름을 추적 가능
 */
function setRequestStage(stage) {
  const ctx = getRequestCtx();
  if (!ctx) return;
  ctx.lastStage = stage;
  try {
    reqLogger.info({
      stage,
      elapsed_ms: Date.now() - (ctx.startedAt || Date.now()),
      requestId: ctx.requestId,
      api: ctx.url || null,
      userId: ctx.userId || null,
    });
  } catch (_) { /* 로그 실패는 요청 처리에 영향 주지 않음 */ }
}

// 원본 console 메서드 보관 (한 번만 wrap)
const _origConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};
function _fmtArg(a) {
  if (a instanceof Error) return `${a.message}\n${a.stack || ''}`;
  if (typeof a === 'object') {
    try { return JSON.stringify(a); } catch { return String(a); }
  }
  return String(a);
}
function _captureLine(level, args) {
  const ctx = getRequestCtx();
  if (!ctx) return;
  const msg = args.map(_fmtArg).join(' ');
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  ctx.logLines.push(line);
  // 링버퍼 — 200줄 초과 시 앞쪽 제거
  if (ctx.logLines.length > REQ_LOG_RING_SIZE) {
    ctx.logLines.splice(0, ctx.logLines.length - REQ_LOG_RING_SIZE);
  }
  // [2026-07-03] pino 파일에도 미러링 (nlq-server.log)
  //   - 자연어질의 API 의 console.log/error 를 파일 로그에 requestId 로 남김
  //   - 라인 길이 1000자 제한 (초당 수백 줄 방어)
  try {
    const truncated = msg.length > 1000 ? (msg.slice(0, 1000) + '…') : msg;
    const payload = {
      requestId: ctx.requestId,
      api: ctx.url || null,
      userId: ctx.userId || null,
      console: true,
      msg: truncated,
    };
    if (level === 'ERROR') reqLogger.error(payload);
    else if (level === 'WARN') reqLogger.warn(payload);
    else reqLogger.info(payload);
  } catch (_) { /* 로그 실패는 요청 처리에 영향 주지 않음 */ }
}
console.log = (...args) => { _captureLine('LOG', args); _origConsole.log(...args); };
console.info = (...args) => { _captureLine('INFO', args); _origConsole.info(...args); };
console.warn = (...args) => { _captureLine('WARN', args); _origConsole.warn(...args); };
console.error = (...args) => { _captureLine('ERROR', args); _origConsole.error(...args); };

/**
 * requestId 부여 + 로그 캡처 컨텍스트 진입 미들웨어
 * — NLQ 같은 진단 대상 라우트에서만 사용 (전역 적용하지 않음)
 */
function captureLogsMiddleware(req, res, next) {
  const requestId = (req.headers['x-request-id'] && String(req.headers['x-request-id']).trim()) || generateRequestId();
  const ctx = {
    requestId,
    startedAt: Date.now(),
    logLines: [],
    lastStage: null,
    method: req.method,
    url: req.originalUrl || req.url,
    userId: req.session?.user?.id || null,
    userRole: req.session?.user?.role || null,
  };
  // 응답 헤더로 노출 (CORS 환경에서도 브라우저가 읽을 수 있도록 expose)
  res.setHeader('X-Request-Id', requestId);

  // [2026-07-03] pino 파일에도 요청 진입 기록 (nlq-server.log)
  //   - 자연어질의 오류를 nlq-server.log 에서 조회 가능하도록 통합
  try {
    reqLogger.info({
      stage: 'request_received',
      requestId,
      api: ctx.url,
      method: ctx.method,
      userId: ctx.userId,
      userRole: ctx.userRole,
    });
  } catch (_) {}

  // 응답 완료 시 LRU 에 기록
  res.on('finish', () => {
    ctx.finishedAt = Date.now();
    ctx.statusCode = res.statusCode;
    rememberRequestLog(requestId, ctx);
    // [2026-07-03] 파일 로그에도 종료 이벤트
    try {
      const payload = {
        stage: 'request_finished',
        requestId,
        api: ctx.url,
        statusCode: ctx.statusCode,
        elapsed_ms: ctx.finishedAt - ctx.startedAt,
        lastStage: ctx.lastStage,
        userId: ctx.userId,
      };
      if (ctx.statusCode >= 500) reqLogger.error(payload);
      else if (ctx.statusCode >= 400) reqLogger.warn(payload);
      else reqLogger.info(payload);
    } catch (_) {}
  });
  res.on('close', () => {
    if (!ctx.finishedAt) {
      // 클라이언트가 끊었거나 nginx 가 504 로 끊은 경우 — 끊긴 시점까지의 로그는 남김
      ctx.finishedAt = Date.now();
      ctx.statusCode = res.statusCode || 0;
      ctx.aborted = true;
      rememberRequestLog(requestId, ctx);
      // [2026-07-03] 파일 로그: 중단(abort) 이벤트 — 504 원인 추적용 핵심
      try {
        reqLogger.warn({
          stage: 'request_aborted',
          requestId,
          api: ctx.url,
          statusCode: ctx.statusCode,
          elapsed_ms: ctx.finishedAt - ctx.startedAt,
          lastStage: ctx.lastStage,
          userId: ctx.userId,
          reason: 'client_or_gateway_closed_before_finish',
        });
      } catch (_) {}
    }
  });
  requestLogStorage.run(ctx, () => next());
}

/**
 * 사용자에게 보낼 errorDetail 객체 생성
 * - 관리자(role === 'admin') 만 stack, logLines 등 민감 정보 노출
 * - 일반 사용자는 stage / errorType / message / requestId 까지만
 */
function buildErrorDetail({ req, stage, errorType, err, extra }) {
  const isAdmin = req?.session?.user?.role === 'admin';
  const requestId = getCurrentRequestId();
  const message = err?.sqlMessage || err?.message || (err ? String(err) : '');
  const code = err?.code || err?.errno || err?.status || null;
  const detail = {
    requestId,
    stage: stage || getRequestCtx()?.lastStage || 'unknown',
    errorType: errorType || classifyErrorType(err, stage),
    message,
    code: code || null,
    timestamp: new Date().toISOString(),
    isAdmin,
  };
  if (extra && typeof extra === 'object') Object.assign(detail, extra);
  if (isAdmin) {
    // 관리자에게만 상세 로그 제공
    detail.stack = err?.stack ? String(err.stack).split('\n').slice(0, 8).join('\n') : null;
    detail.logLines = getCurrentLogLines();
    detail.logHint = `tail -f /home/user/.pm2/logs/nlq-server-out-0.log | grep ${requestId}`;
  } else {
    // 일반 사용자에게는 로그 라인 수만 노출 (관리자 문의 시 인용 가능)
    detail.logLineCount = getCurrentLogLines().length;
  }
  return detail;
}

/**
 * 오류를 단계/유형별로 분류
 *   sql_generation : LLM 이 SQL 생성에 실패 (JSON 파싱, validateSqlPreExecution 등)
 *   db_execution   : MariaDB 실행 단계 오류 (ER_xxx, ECONNREFUSED 등)
 *   llm_response   : OpenAI API 자체 오류 (429, 5xx, 응답 형식 깨짐)
 *   timeout        : 타임아웃 (AbortError, ETIMEDOUT 등)
 *   system         : 기타 시스템 오류
 */
function classifyErrorType(err, stage) {
  if (!err && !stage) return 'system';
  const msg = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || err?.errno || '').toLowerCase();
  const sql = String(err?.sqlMessage || '').toLowerCase();
  // timeout
  if (err?.name === 'AbortError' || code === 'etimedout' || code === 'esockettimedout' || msg.includes('timeout') || msg.includes('timed out')) {
    return 'timeout';
  }
  // DB execution
  if (sql || code.startsWith('er_') || code === 'econnrefused' || code === 'epipe' || code === 'protocol_connection_lost') {
    return 'db_execution';
  }
  // LLM (OpenAI)
  if (err?.constructor?.name === 'APIError' || err?.constructor?.name === 'OpenAIError' || msg.includes('openai') || (err?.status && Number(err.status) >= 500 && msg.includes('api'))) {
    return 'llm_response';
  }
  // SQL generation (LLM 이 JSON 깨거나 validateSqlPreExecution 실패)
  if (msg.includes('json') || msg.includes('parse') || msg.includes('sql 검증') || msg.includes('validatesqlpreexecution')) {
    return 'sql_generation';
  }
  // stage 힌트 활용
  if (stage) {
    if (stage.includes('sql_gen') || stage.includes('llm_parse')) return 'sql_generation';
    if (stage.includes('db_') || stage.includes('execute')) return 'db_execution';
    if (stage.includes('llm') || stage.includes('openai') || stage.includes('analysis_path')) return 'llm_response';
    if (stage.includes('timeout')) return 'timeout';
  }
  return 'system';
}

// ============================================================
// 세션 설정 (MariaDB 영구 저장소 — PM2 재시작 시에도 세션 유지)
// ============================================================
const MySQLStore = expressMySQLSession(session);
const sessionStoreOptions = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'company',
  password: process.env.DB_PASSWORD || 'company1234!',
  database: process.env.DB_NAME || 'company_board',
  charset: 'utf8mb4',
  clearExpired: true,
  checkExpirationInterval: 15 * 60 * 1000, // 15분마다 만료 세션 정리
  expiration: 24 * 60 * 60 * 1000, // 24시간
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
};
const sessionStore = new MySQLStore(sessionStoreOptions);
app.use(session({
  key: 'nlq_session',
  secret: process.env.SESSION_SECRET || 'kleannara-nlq-fallback-secret-2026',
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24시간
  }
}));

// ============================================================
// 그룹웨어 연동 API Key 설정
// ============================================================
const GW_API_KEY = process.env.GW_API_KEY || 'gw-kleannara-2026-secure-api-key';

/**
 * 그룹웨어 API Key 인증 미들웨어
 * X-API-KEY 헤더 또는 Authorization: Bearer 토큰으로 인증
 */
function verifyApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!apiKey || apiKey !== GW_API_KEY) {
    return res.status(401).json({ success: false, error: 'API Key가 유효하지 않습니다.', code: 'INVALID_API_KEY' });
  }
  next();
}

// ============================================================
// 인증 라우트 (로그인 페이지 / API) — static 미들웨어보다 먼저 등록
// ============================================================

// 로그인 페이지 서빙
app.get('/login', (req, res) => {
  if (req.session && req.session.user) return res.redirect('/');
  res.sendFile(path.join(import.meta.dirname, 'public', 'login.html'));
});

// 로그인 API (DB 조회 방식)
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '아이디와 비밀번호를 입력하세요.' });
  }
  try {
    const [rows] = await pool.query(
      `SELECT u.user_id, u.password, u.name, u.role_id, u.is_active, COALESCE(r.role_code, 'user') AS role_code
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.user_id = ?`,
      [username]
    );
    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    const user = rows[0];
    if (!user.is_active) {
      return res.status(401).json({ success: false, message: '비활성화된 계정입니다. 관리자에게 문의하세요.' });
    }
    // [2026-06-16] 비밀번호 SHA-256 비교
    //  - DB의 users.password 는 SHA-256 해시(64자 hex)로 저장됨
    //  - 사용자가 입력한 평문을 SHA-256 해싱 후 DB 값과 비교
    //  - 하위호환: DB에 평문이 아직 남아있는 경우(마이그레이션 누락 등)에도
    //    평문 == 평문 매칭으로 로그인 허용 → 다음 로그인 시 자동 해시 마이그레이션
    const hashedInput = hashPassword(password);
    const dbPwd = String(user.password || '');
    let passwordOk = false;
    if (dbPwd === hashedInput) {
      passwordOk = true;
    } else if (!isSha256Hex(dbPwd) && dbPwd === password) {
      // 레거시 평문 매칭 → 즉시 해시로 업그레이드 (best-effort, 실패해도 로그인은 진행)
      passwordOk = true;
      try {
        await pool.query('UPDATE users SET password=? WHERE user_id=?', [hashedInput, user.user_id]);
        console.log(`[Login] 레거시 평문 비번 → SHA-256 자동 업그레이드 완료: user_id=${user.user_id}`);
      } catch (upErr) {
        console.error('[Login] 평문 → SHA-256 자동 업그레이드 실패:', upErr.message);
      }
    }
    if (!passwordOk) {
      return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
    }
    // 도메인 결정: users.domain_code 에만 의존 (조직도 자동매핑 제거)
    // - admin: DB 값 그대로 사용 (null이면 전체 영역)
    // - 일반 사용자: DB 값 그대로 사용 (null이면 프론트에서 도메인 선택 모달 노출)
    let domainCode = null;
    try {
      const [uRow] = await pool.query('SELECT domain_code FROM users WHERE user_id=?', [user.user_id]);
      domainCode = uRow[0]?.domain_code || null;
    } catch(e) { console.error('[Login] domain 조회 실패:', e.message); }

    req.session.user = {
      id: user.user_id, name: user.name, role: user.role_code,
      domain_code: domainCode,
      // ★ active_domain은 domain_code와 동일하게 설정 (null이면 null 유지 → 프론트 모달이 뜨게 함)
      active_domain: domainCode,
      loginAt: new Date().toISOString(),
    };
    return res.json({ success: true, user: user.user_id, name: user.name, role: user.role_code, domain_code: domainCode });
  } catch (err) {
    console.error('[Login] DB 조회 오류:', err.message);
    return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// ============================================================
// SSO EncData 로그인 (그룹웨어 연동)
// ============================================================
// SSO 설정 (환경변수로 변경 가능)
const SSO_VALIDATE_URL = process.env.SSO_VALIDATE_URL || 'https://sso.kleannara.com/rest/security/encValidateProduct';
const SSO_PRODUCT_ID   = process.env.SSO_PRODUCT_ID   || 'PRO_000644';

/**
 * POST /api/login/sendEncData
 * 그룹웨어에서 form submit으로 encData를 전송하면
 * SSO 서버에 검증 → 성공 시 세션 생성 → 메인페이지 이동
 */
app.post('/api/login/sendEncData', async (req, res) => {
  const encData = req.body?.encData;

  // encData 누락 체크
  if (!encData || !String(encData).trim()) {
    return res.status(200).type('html').send(buildSsoErrorHtml('encData가 전달되지 않았습니다.'));
  }

  try {
    console.log(`[SSO] encData 수신, 길이=${encData.length}`);

    // SSO 서버에 검증 요청
    const ssoRes = await fetch(SSO_VALIDATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId: SSO_PRODUCT_ID, encData }),
      signal: AbortSignal.timeout(10000), // 10초 타임아웃
    });

    if (!ssoRes.ok) {
      console.error(`[SSO] SSO 서버 응답 오류: ${ssoRes.status}`);
      return res.status(200).type('html').send(buildSsoErrorHtml('SSO 서버 연결에 실패했습니다.'));
    }

    const ssoData = await ssoRes.json();
    console.log(`[SSO] SSO 응답:`, JSON.stringify(ssoData));

    // returnCode 체크 (숫자 0 또는 문자열 "0" 모두 허용)
    const returnCode = ssoData?.head?.returnCode;
    if (String(returnCode) !== '0') {
      const msg = ssoData?.head?.returnDesc || ssoData?.head?.returnMessage || 'SSO 검증 실패';
      console.warn(`[SSO] 검증 실패: returnCode=${returnCode}, ${msg}`);
      return res.status(200).type('html').send(buildSsoErrorHtml(msg));
    }

    // 사용자 ID 추출 (sproId 우선, userId 폴백)
    const userId = ssoData?.body?.sproId || ssoData?.body?.userId;
    if (!userId) {
      console.warn('[SSO] sproId/userId 누락');
      return res.status(200).type('html').send(buildSsoErrorHtml('SSO 사용자 정보를 가져올 수 없습니다.'));
    }

    // users 테이블에서 해당 사용자 조회 (없으면 자동 생성)
    let [userRows] = await pool.query(
      `SELECT u.user_id, u.name, u.role_id, u.is_active, COALESCE(r.role_code, 'user') AS role_code
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.user_id = ?`, [userId]);
    if (userRows.length === 0) {
      // SSO 사용자 자동 생성 (RBAC: role_id 설정)
      let defaultRoleId = null;
      try {
        const [rr] = await pool.query("SELECT id FROM roles WHERE role_code='user' LIMIT 1");
        if (rr.length > 0) defaultRoleId = rr[0].id;
      } catch(e) {}
      await pool.query(
        'INSERT INTO users (user_id, name, role_id, is_active, sso_yn) VALUES (?, ?, ?, 1, 1)',
        [userId, ssoData?.body?.sproId || userId, defaultRoleId]
      );
      console.log(`[SSO] 신규 사용자 자동 생성: ${userId}`);
      [userRows] = await pool.query(
        `SELECT u.user_id, u.name, u.role_id, u.is_active, COALESCE(r.role_code, 'user') AS role_code
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.user_id = ?`, [userId]);
    }
    const ssoUser = userRows[0];
    if (!ssoUser.is_active) {
      console.warn(`[SSO] 비활성화된 계정: ${userId}`);
      return res.status(200).type('html').send(buildSsoErrorHtml('비활성화된 계정입니다. 관리자에게 문의하세요.'));
    }

    // 도메인 결정: users.domain_code 에만 의존 (조직도 자동매핑 제거)
    // null이면 프론트에서 도메인 선택 모달이 뜨고, 사용자가 선택하면 /api/me/domain 으로 저장됨
    let domainCode = null;
    try {
      const [uDom] = await pool.query('SELECT domain_code FROM users WHERE user_id=?', [userId]);
      domainCode = uDom[0]?.domain_code || null;
    } catch(e) { console.error('[SSO] domain 조회 실패:', e.message); }

    // 세션 생성 (SSO 로그인 성공)
    req.session.user = {
      id: userId,
      name: ssoUser.name,
      role: ssoUser.role_code,
      domain_code: domainCode,
      // ★ active_domain은 domain_code와 동일하게 설정 (null이면 null 유지 → 프론트 모달)
      active_domain: domainCode,
      loginAt: new Date().toISOString(),
      sso: true,
      tenantId: ssoData?.body?.tenantId || null,
    };

    console.log(`[SSO] ✅ 로그인 성공: ${userId} (${ssoUser.name})`);

    // 성공 HTML 반환 → 메인페이지로 이동
    return res.status(200).type('html').send(buildSsoSuccessHtml(userId));

  } catch (err) {
    console.error(`[SSO] 오류:`, err.message);
    const msg = err.name === 'TimeoutError'
      ? 'SSO 서버 응답 시간이 초과되었습니다.'
      : 'SSO 처리 중 오류가 발생했습니다.';
    return res.status(200).type('html').send(buildSsoErrorHtml(msg));
  }
});

/** SSO 성공 HTML — 세션 설정 후 메인페이지로 이동 */
function buildSsoSuccessHtml(sproId) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 수익성분석 - SSO 로그인</title>
  <style>
    body{font-family:'Noto Sans KR',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,#1e3a8a,#3b82f6,#60a5fa);}
    .card{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,.15);max-width:400px;width:90%;}
    .spinner{width:40px;height:40px;border:4px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 20px;}
    @keyframes spin{to{transform:rotate(360deg)}}
    h2{font-size:18px;color:#111827;margin-bottom:8px;}
    p{font-size:14px;color:#6b7280;}
  </style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>${sproId}님, 환영합니다!</h2>
    <p>AI 수익성분석 화면으로 이동 중...</p>
  </div>
  <script>
    // 세션은 서버에서 이미 생성됨 → 바로 메인으로 이동
    setTimeout(function(){ window.location.href = '/'; }, 800);
  </script>
</body>
</html>`;
}

/** SSO 실패 HTML — 에러 메시지 + 로그인 페이지 이동 */
function buildSsoErrorHtml(message) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI 수익성분석 - SSO 오류</title>
  <style>
    body{font-family:'Noto Sans KR',sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:linear-gradient(135deg,#1e3a8a,#3b82f6,#60a5fa);}
    .card{background:#fff;border-radius:16px;padding:40px;text-align:center;box-shadow:0 20px 40px rgba(0,0,0,.15);max-width:420px;width:90%;}
    .icon{width:56px;height:56px;background:#fef2f2;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;}
    h2{font-size:18px;color:#111827;margin-bottom:8px;}
    .msg{font-size:14px;color:#dc2626;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:20px;}
    .info{font-size:13px;color:#9ca3af;margin-bottom:16px;}
    .btn{display:inline-block;padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;text-decoration:none;font-family:inherit;}
    .btn:hover{background:#2563eb;}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">⚠️</div>
    <h2>SSO 로그인 실패</h2>
    <div class="msg">${message.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    <p class="info"><span id="countdown">3</span>초 후 로그인 페이지로 이동합니다...</p>
    <a href="/login" class="btn">로그인 페이지로 바로 이동</a>
  </div>
  <script>
    var sec = 3;
    var el = document.getElementById('countdown');
    var timer = setInterval(function(){
      sec--;
      el.textContent = sec;
      if(sec <= 0){ clearInterval(timer); window.location.href = '/login'; }
    }, 1000);
  </script>
</body>
</html>`;
}

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// ============================================================
// ☠️ [DEPRECATED] 조직도 기반 도메인 자동 매핑 제거
// ============================================================
// 기존: users.domain_code가 NULL이면 user_group_info / domain_group_mapping / group_info 를
//       조회해 조직도 기준으로 도메인 자동 매핑
// 변경: 조직도 자동 매핑 로직 완전 제거.
//       users.domain_code 에만 의존하며, NULL이면 사용자가 프론트에서 직접
//       PS / HL / MGMT 중 하나를 선택하고, 선택값은 /api/me/domain 으로
//       users.domain_code 에 영구저장 됨.
// 관련 테이블: user_group_info / domain_group_mapping / group_info 는 도메인
//       결정 목적으로는 이제 조회하지 않음 (다른 용도(조직도 경로 표시 등)
//       은 buildOrgPath() 에서 계속 사용).

/**
 * 사용자의 조직도 경로를 문자열로 구성 (예: "깨끗한나라 > CEO > COO > 페이퍼솔루션사업부 > PS기획팀")
 */
async function buildOrgPath(groupId) {
  const path = [];
  let currentId = groupId;
  const visited = new Set();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const [rows] = await pool.query(
      'SELECT group_id, group_name, parent_group_id FROM group_info WHERE group_id = ? LIMIT 1',
      [currentId]
    );
    if (rows.length === 0) break;
    path.unshift(rows[0].group_name);
    currentId = rows[0].parent_group_id;
  }
  return path.join(' > ');
}

// 세션 확인 API (도메인/권한 정보 포함)
app.get('/api/me', async (req, res) => {
  if (req.session && req.session.user) {
    const u = req.session.user;

    // DB에서 최신 role, domain_code 조회 → 세션 동기화 (권한관리에서 변경 즉시 반영)
    let roleCode = u.role || 'user';
    let latestDomainCode = u.domain_code;
    try {
      const [freshRow] = await pool.query(
        `SELECT u.domain_code, COALESCE(r.role_code, 'user') AS role_code
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.user_id = ?`, [u.id]
      );
      if (freshRow.length > 0) {
        roleCode = freshRow[0].role_code || 'user';
        latestDomainCode = freshRow[0].domain_code || null;
        // 세션 동기화 (다음 요청부터 즉시 반영)
        u.role = roleCode;
        u.domain_code = latestDomainCode;
        // active_domain이 아직 설정되지 않은 경우에만 domain_code로 초기화
        if (!u.active_domain && latestDomainCode) {
          u.active_domain = latestDomainCode;
        }
      }
    } catch (e) { console.error('[/api/me] DB 동기화 실패:', e.message); }

    // RBAC: 사용자의 허용 메뉴 목록 조회 (폴백 내장)
    let allowedMenus = [];
    try {
      allowedMenus = await getUserAllowedMenus(u.id);
    } catch (e) {
      console.error('[RBAC] /api/me 메뉴 조회 실패:', e.message);
      allowedMenus = getDefaultMenusByRole(roleCode);
    }
    if (!allowedMenus || allowedMenus.length === 0) {
      allowedMenus = getDefaultMenusByRole(roleCode);
    }

    // 업무영역 권한 목록 조회 (admin은 활성 area 전체 자동)
    let businessAreas = [];
    try {
      businessAreas = await getUserBusinessAreas(u.id, roleCode);
    } catch (e) {
      console.error('[BA] /api/me 업무영역 조회 실패:', e.message);
      businessAreas = ['PROFITABILITY']; // 최소 접근권 보장
    }

    return res.json({
      loggedIn: true,
      user: u.id,
      name: u.name,
      role: roleCode,
      domain_code: latestDomainCode || null,
      active_domain: u.active_domain || latestDomainCode || null,
      menus: allowedMenus,
      business_areas: businessAreas,
    });
  }
  return res.json({ loggedIn: false });
});

// 도메인 전환 API (모든 사용자가 분석 영역 전환 가능)
// ★ 세션 active_domain 변경 + users.domain_code 에도 영구저장 (최초 선택 후 재접속 시 자동 진입)
app.post('/api/me/domain', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: '로그인 필요' });
  // [2026-07-30] 사용자 입력에서 '통합' 등 표시명이 들어와도 내부 코드(MGMT)로 정규화
  const domain_code = resolveDomainAlias(req.body.domain_code);
  if (!domain_code) return res.status(400).json({ error: 'domain_code 필수' });

  // 유효성 검증: domain_master에 존재하고 활성인 코드만 허용
  try {
    const [valid] = await pool.query(
      'SELECT domain_code FROM domain_master WHERE domain_code = ? AND is_active = 1',
      [domain_code]
    );
    if (valid.length === 0) {
      return res.status(400).json({ error: '유효하지 않은 domain_code 입니다.' });
    }
  } catch (e) {
    console.error('[/api/me/domain] domain_master 검증 실패:', e.message);
  }

  // 1) 세션 업데이트
  req.session.user.active_domain = domain_code;
  req.session.user.domain_code = domain_code;

  // 2) ★ users.domain_code 에 영구저장 (다음 로그인부터 자동 진입)
  try {
    await pool.query(
      'UPDATE users SET domain_code = ? WHERE user_id = ?',
      [domain_code, req.session.user.id]
    );
    console.log(`[Domain] 사용자 선택 저장: ${req.session.user.id} → ${domain_code}`);
  } catch (e) {
    console.error('[/api/me/domain] users.domain_code 저장 실패:', e.message);
    // 세션은 이미 업데이트되었으므로 사용자에게는 성공 응답 (다음 로그인 시 다시 모달이 뜬 뿐)
  }

  res.json({ success: true, active_domain: domain_code, domain_code });
});

// ────────────────────────────────────────────────────────────────
// [2026-07-30] 도메인 표시명 (display_code) 공통 헬퍼
//   요구사항: 사용자에게 노출되는 화면에서는 MGMT 를 '통합' 으로 표시하되
//   내부 domain_code (DB / API / 세션 / 권한 / SQL) 는 그대로 유지.
//   화면마다 개별 치환하지 않고 이 헬퍼 하나로 통일.
// ────────────────────────────────────────────────────────────────
const DOMAIN_DISPLAY_CODE_MAP = {
  MGMT: '통합',
  // 필요 시 여기에만 추가. PS/HL 은 코드 그대로 표시.
};
function domainDisplayCode(domainCode) {
  if (!domainCode) return domainCode;
  return DOMAIN_DISPLAY_CODE_MAP[domainCode] || domainCode;
}
// 사용자 입력에서 표시명을 내부 코드로 되돌리는 역매핑
//   (사용자가 자연어 질의에 "통합" 이라고 써도 MGMT 로 인식되도록)
const DOMAIN_DISPLAY_TO_CODE_MAP = {};
for (const [code, disp] of Object.entries(DOMAIN_DISPLAY_CODE_MAP)) {
  DOMAIN_DISPLAY_TO_CODE_MAP[disp.toUpperCase()] = code;
}
function resolveDomainAlias(input) {
  if (!input) return input;
  const key = String(input).trim().toUpperCase();
  return DOMAIN_DISPLAY_TO_CODE_MAP[key] || input;
}

// 도메인 목록 API
//   응답에 display_code 를 함께 실어 프런트가 표시용으로 사용.
app.get('/api/domains', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT domain_code, domain_name, sort_order FROM domain_master WHERE is_active = 1 ORDER BY sort_order');
    const enriched = rows.map(r => ({
      ...r,
      display_code: domainDisplayCode(r.domain_code),   // 예: MGMT → '통합', PS → 'PS'
    }));
    res.json(enriched);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 관리자 전용 미들웨어
function requireAdmin(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  if (req.session.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  next();
}

// 현재 세션의 active_domain 가져오기
// active_domain(사용자가 명시적으로 선택한 도메인)을 최우선 사용
// active_domain이 없으면 DB domain_code 조회 → 여전히 없으면 null 반환
// (기본 'PS' 폴백 제거 — 조직도 자동매핑 제거 정책에 따라 프론트 모달이 떨 때까지 대기)
async function getActiveDomain(req) {
  const u = req.session?.user;
  if (!u) return null;
  // 사용자가 명시적으로 선택한 active_domain이 있으면 우선 사용
  if (u.active_domain) return u.active_domain;
  // DB에서 최신 domain_code 반영 (권한관리에서 변경 시 즉시 적용)
  try {
    const [row] = await pool.query('SELECT domain_code FROM users WHERE user_id = ?', [u.id]);
    if (row.length > 0) {
      const dbDomain = row[0].domain_code || null;
      u.domain_code = dbDomain;
      if (dbDomain) {
        u.active_domain = dbDomain;
        return dbDomain;
      }
    }
  } catch(e) { /* 실패 시 세션 값 사용 */ }
  // ★ 조직도 자동매핑 제거: 도메인이 설정되지 않은 상태면 null 반환 → 프론트가 모달로 선택 요구
  return null;
}

// ============================================================
// 인증 미들웨어 — 로그인하지 않으면 /login으로 리다이렉트
// ============================================================
app.use(async (req, res, next) => {
  // 인증이 필요 없는 경로
  const publicPaths = ['/login', '/login.html', '/api/login', '/api/login/sendEncData', '/api/logout', '/api/me', '/api/history/retention'];
  if (publicPaths.some(p => req.path === p)) return next();
  // 그룹웨어 연동 API (/api/users/*) — API Key 인증은 각 라우트에서 별도 처리
  if (req.path.startsWith('/api/users')) return next();
  // 정적 리소스 (css/js/font/icon 등)는 통과
  if (/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map)$/i.test(req.path)) return next();
  // CDN 등 외부 스크립트 요청은 해당 없음 (express에서 처리 안 함)

  if (req.session && req.session.user) {
    // RBAC: 메뉴 권한 체크 — HTML 페이지 요청 시 허용 여부 확인
    const menuPages = ['/builder.html', '/report', '/learning.html',
                       '/permission.html', '/batch.html', '/upload.html'];
    const checkPath = req.path === '/index.html' ? '/' : req.path;
    if (menuPages.includes(checkPath)) {
      try {
        const allowed = await isMenuAllowed(req.session.user.id, checkPath);
        if (!allowed) {
          // HTML 요청이면 접근 차단 페이지 또는 메인으로 리다이렉트
          return res.redirect('/?denied=1');
        }
      } catch (e) {
        console.error('[RBAC] 접근 권한 체크 실패:', e.message);
        // 체크 실패 시 기존 admin 방식으로 폴백
        const adminOnlyPages = ['/learning.html', '/upload.html', '/batch.html', '/permission.html'];
        if (adminOnlyPages.includes(req.path) && req.session.user.role !== 'admin') {
          return res.redirect('/');
        }
      }
    }
    return next();
  }

  // API 요청이면 401
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  // 페이지 요청이면 리다이렉트
  return res.redirect('/login');
});

// 정적 파일 서빙 (인증 미들웨어 뒤에 배치)
app.use(express.static(path.join(import.meta.dirname, 'public')));

// ============================================================
// 그룹웨어 연동 — 사용자 관리 API (API Key 인증 필수)
// ============================================================
// 모든 /api/users 라우트에 API Key 인증 적용
// 그룹웨어 → 우리 서비스 API 호출 → 우리 DB에 사용자 동기화

/**
 * GET /api/users — 전체 사용자 조회 (pagination 지원)
 * Base URL: https://analytics.kleannara.com
 * Query:
 *   - page (기본 1)
 *   - limit (기본 50, 최대 9999) — 빈값/미지정이면 기본 50
 *   - is_active (0|1) — 빈값/미지정이면 활성+비활성 전체 반환
 *   - role (role_code 예: 'admin','user') — 빈값/미지정이면 권한 무관 전체 반환
 *   - group_name, group_id, search — 빈값/미지정이면 무시
 *
 * 응답의 `role` 필드는 roles 테이블의 role_code (LEFT JOIN). 권한 미지정 사용자는 null.
 */
app.get('/api/users', verifyApiKey, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    // ★ limit 상한 500 → 9999 (전체 유저 일괄 조회 지원)
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 9999);
    const offset = (page - 1) * limit;

    // 필터 조건 동적 빌드 — 빈 문자열("")과 undefined 모두 "필터 없음"으로 처리
    const isBlank = (v) => v === undefined || v === null || String(v).trim() === '';
    const whereParts = [];
    const params = [];

    // is_active: 빈값이면 활성/비활성 모두 반환
    if (!isBlank(req.query.is_active)) {
      const v = parseInt(req.query.is_active);
      if (v === 0 || v === 1) {
        whereParts.push('u.is_active = ?');
        params.push(v);
      }
    }
    // role: 빈값이면 권한 무관 전체 반환
    if (!isBlank(req.query.role)) {
      whereParts.push('u.role_id = (SELECT id FROM roles WHERE role_code = ? LIMIT 1)');
      params.push(String(req.query.role).trim());
    }
    if (!isBlank(req.query.group_name)) {
      whereParts.push('u.group_name = ?');
      params.push(String(req.query.group_name).trim());
    }
    if (!isBlank(req.query.group_id)) {
      whereParts.push('u.group_id = ?');
      params.push(String(req.query.group_id).trim());
    }
    if (!isBlank(req.query.search)) {
      whereParts.push('(u.user_id LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
      const kw = `%${String(req.query.search).trim()}%`;
      params.push(kw, kw, kw);
    }

    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    // 총 건수 (COUNT)
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM users u ${whereClause}`, params);
    const total = countRows[0].total;

    // 데이터 조회 (password 제외, role_id → role_code 로 변환하여 'role' 별칭 반환)
    const [rows] = await pool.query(
      `SELECT u.id, u.user_id, u.name, u.email, u.group_name, u.group_id, u.parent_group_id, u.tenant_id,
              u.phone, u.position,
              (SELECT r.role_code FROM roles r WHERE r.id = u.role_id LIMIT 1) AS role,
              u.is_active, u.sso_yn, u.created_at, u.updated_at
       FROM users u ${whereClause} ORDER BY u.id ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('[Users API] 전체 조회 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/users/:userId — 개별 사용자 조회
 * Base URL: https://analytics.kleannara.com
 */
app.get('/api/users/:userId', verifyApiKey, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.user_id, u.name, u.email, u.group_name, u.group_id, u.parent_group_id, u.tenant_id,
              u.phone, u.position,
              (SELECT r.role_code FROM roles r WHERE r.id = u.role_id LIMIT 1) AS role,
              u.is_active, u.sso_yn, u.created_at, u.updated_at
       FROM users u WHERE u.user_id = ?`,
      [req.params.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ success: false, error: '사용자를 찾을 수 없습니다.', userId: req.params.userId });
    }
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    console.error('[Users API] 개별 조회 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/users/bulk — Bulk 사용자 생성
 * Body: { users: [{ userId, name, password?, email?, groupName?, groupId?, parentGroupId?, tenantId?, phone?, position?, role? }] }
 * - password: 그룹웨어에서 전달되면 users.password 에 저장 (평문, 기존 로그인 키와 동일 동작)
 * - password 생략 시 기본값 'kleannara1!' 로 설정
 */
app.post('/api/users/bulk', verifyApiKey, async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ success: false, error: 'users 배열이 필요합니다.' });
  }
  if (users.length > 1000) {
    return res.status(400).json({ success: false, error: '한 번에 최대 1000명까지 처리 가능합니다.' });
  }

  const results = [];
  let successCount = 0, failCount = 0;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const u of users) {
      try {
        if (!u.userId || !u.name) {
          results.push({ userId: u.userId || '(없음)', status: 'fail', message: 'userId와 name은 필수입니다.' });
          failCount++;
          continue;
        }

        // 중복 체크
        const [existing] = await conn.query('SELECT id, is_active FROM users WHERE user_id = ?', [u.userId]);
        if (existing.length > 0) {
          // 이미 존재하지만 비활성화 상태 → 재활성화
          if (!existing[0].is_active) {
            // role_id 결정: 외부에서 role 지정 시 roles 테이블에서 매핑
            let reactivateRoleId = null;
            if (u.role) {
              try {
                const [rr] = await conn.query('SELECT id FROM roles WHERE role_code=?', [u.role]);
                if (rr.length > 0) reactivateRoleId = rr[0].id;
              } catch(e) {}
            }
            if (!reactivateRoleId) {
              try {
                const [rr] = await conn.query("SELECT id FROM roles WHERE role_code='user' LIMIT 1");
                if (rr.length > 0) reactivateRoleId = rr[0].id;
              } catch(e) {}
            }
            // ★ password가 전달되면 함께 업데이트 (재활성화 시 패스워드 재설정 하는 일반적 패턴)
            // [2026-06-16] 평문 → SHA-256 해싱 후 저장 (toStoredPassword 가 멱등성 보장)
            if (u.password && String(u.password).trim()) {
              const hashedReactivatePwd = toStoredPassword(u.password);
              await conn.query(
                `UPDATE users SET name=?, password=?, email=?, group_name=?, group_id=?, parent_group_id=?, tenant_id=?, phone=?, position=?, role_id=?, is_active=1, sso_yn=1, updated_at=NOW() WHERE user_id=?`,
                [u.name, hashedReactivatePwd, u.email || null, u.groupName || null, u.groupId || null, u.parentGroupId || null, u.tenantId || null, u.phone || null, u.position || null, reactivateRoleId, u.userId]
              );
            } else {
              await conn.query(
                `UPDATE users SET name=?, email=?, group_name=?, group_id=?, parent_group_id=?, tenant_id=?, phone=?, position=?, role_id=?, is_active=1, sso_yn=1, updated_at=NOW() WHERE user_id=?`,
                [u.name, u.email || null, u.groupName || null, u.groupId || null, u.parentGroupId || null, u.tenantId || null, u.phone || null, u.position || null, reactivateRoleId, u.userId]
              );
            }
            results.push({ userId: u.userId, status: 'success', message: 'reactivated (기존 비활성 계정 재활성화)' });
            successCount++;
          } else {
            results.push({ userId: u.userId, status: 'fail', message: 'already exists (이미 활성 계정 존재)' });
            failCount++;
          }
          continue;
        }

        // role_id 결정
        let newRoleId = null;
        if (u.role) {
          try {
            const [rr] = await conn.query('SELECT id FROM roles WHERE role_code=?', [u.role]);
            if (rr.length > 0) newRoleId = rr[0].id;
          } catch(e) {}
        }
        if (!newRoleId) {
          try {
            const [rr] = await conn.query("SELECT id FROM roles WHERE role_code='user' LIMIT 1");
            if (rr.length > 0) newRoleId = rr[0].id;
          } catch(e) {}
        }
        // ★ password 처리: 전달값이 있으면 사용, 없으면 기본값 사용
        // [2026-06-16] 평문 → SHA-256 해싱 후 저장 (UTF-8 / 64자 hex)
        //   - 그룹웨어가 'kleannara12#' 같은 평문을 보내도 DB 에는 SHA-256 해시만 저장
        //   - 외부에서 이미 SHA-256 해시 형태로 보낸 경우 toStoredPassword 가 그대로 통과 (멱등성)
        const rawPassword = (u.password && String(u.password).trim()) ? String(u.password).trim() : 'kleannara1!';
        const newPassword = toStoredPassword(rawPassword);
        await conn.query(
          `INSERT INTO users (user_id, name, password, email, group_name, group_id, parent_group_id, tenant_id, phone, position, role_id, is_active, sso_yn) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,1)`,
          [u.userId, u.name, newPassword, u.email || null, u.groupName || null, u.groupId || null, u.parentGroupId || null, u.tenantId || null, u.phone || null, u.position || null, newRoleId]
        );
        results.push({ userId: u.userId, status: 'success', message: 'created' });
        successCount++;
      } catch (rowErr) {
        results.push({ userId: u.userId || '(없음)', status: 'fail', message: rowErr.message });
        failCount++;
      }
    }

    await conn.commit();
    console.log(`[Users API] Bulk 생성 완료: 성공 ${successCount}, 실패 ${failCount}`);

    res.json({
      success: true,
      totalCount: users.length,
      successCount,
      failCount,
      results,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Users API] Bulk 생성 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * PUT /api/users/bulk — Bulk 사용자 수정
 * Body: { users: [{ userId, name?, password?, email?, groupName?, groupId?, parentGroupId?, tenantId?, phone?, position?, role?, is_active? }] }
 * - is_active: 1 → 비활성 사용자 복구, 0 → 비활성화 (DELETE /api/users/bulk와 동일 효과)
 * - password: 전달되면 users.password 갱신 (비어 문자열 '' 는 무시)
 */
app.put('/api/users/bulk', verifyApiKey, async (req, res) => {
  const { users } = req.body;
  if (!Array.isArray(users) || users.length === 0) {
    return res.status(400).json({ success: false, error: 'users 배열이 필요합니다.' });
  }
  if (users.length > 1000) {
    return res.status(400).json({ success: false, error: '한 번에 최대 1000명까지 처리 가능합니다.' });
  }

  const results = [];
  let successCount = 0, failCount = 0;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const u of users) {
      try {
        if (!u.userId) {
          results.push({ userId: '(없음)', status: 'fail', message: 'userId는 필수입니다.' });
          failCount++;
          continue;
        }

        // 존재 확인
        const [existing] = await conn.query('SELECT id FROM users WHERE user_id = ?', [u.userId]);
        if (existing.length === 0) {
          results.push({ userId: u.userId, status: 'fail', message: 'not found (사용자를 찾을 수 없습니다)' });
          failCount++;
          continue;
        }

        // 동적 UPDATE 빌드 (전달된 필드만 수정)
        const updates = [];
        const vals = [];
        if (u.name !== undefined)       { updates.push('name=?');       vals.push(u.name); }
        if (u.email !== undefined)      { updates.push('email=?');      vals.push(u.email); }
        if (u.groupName !== undefined)      { updates.push('group_name=?');      vals.push(u.groupName); }
        if (u.groupId !== undefined)        { updates.push('group_id=?');        vals.push(u.groupId); }
        if (u.parentGroupId !== undefined)  { updates.push('parent_group_id=?'); vals.push(u.parentGroupId); }
        if (u.tenantId !== undefined)       { updates.push('tenant_id=?');       vals.push(u.tenantId); }
        if (u.phone !== undefined)      { updates.push('phone=?');      vals.push(u.phone); }
        if (u.position !== undefined)   { updates.push('position=?');   vals.push(u.position); }
        // ★ password: 전달되고 비어 문자열이 아니면 갱신
        // [2026-06-16] 평문 → SHA-256 해싱 후 저장 (toStoredPassword 가 멱등성 보장)
        if (u.password !== undefined && u.password !== null && String(u.password).trim() !== '') {
          updates.push('password=?'); vals.push(toStoredPassword(u.password));
        }
        if (u.role !== undefined) {
          // role 문자열 → role_id로 변환
          try {
            const [rr] = await conn.query('SELECT id FROM roles WHERE role_code=?', [u.role]);
            if (rr.length > 0) { updates.push('role_id=?'); vals.push(rr[0].id); }
          } catch(e) {}
        }
        // is_active: 비활성 사용자 복구(1) 또는 비활성화(0) — 0/1/'0'/'1' 모두 허용
        if (u.is_active !== undefined && u.is_active !== null && u.is_active !== '') {
          const v = Number(u.is_active);
          if (v === 0 || v === 1) {
            updates.push('is_active=?');
            vals.push(v);
          }
        }

        if (updates.length === 0) {
          results.push({ userId: u.userId, status: 'fail', message: '수정할 필드가 없습니다.' });
          failCount++;
          continue;
        }

        vals.push(u.userId);
        await conn.query(`UPDATE users SET ${updates.join(', ')}, updated_at=NOW() WHERE user_id=?`, vals);
        results.push({ userId: u.userId, status: 'success', message: 'updated' });
        successCount++;
      } catch (rowErr) {
        results.push({ userId: u.userId || '(없음)', status: 'fail', message: rowErr.message });
        failCount++;
      }
    }

    await conn.commit();
    console.log(`[Users API] Bulk 수정 완료: 성공 ${successCount}, 실패 ${failCount}`);

    res.json({
      success: true,
      totalCount: users.length,
      successCount,
      failCount,
      results,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Users API] Bulk 수정 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

/**
 * DELETE /api/users/bulk — Bulk 사용자 비활성화 (소프트 삭제)
 * Body: { userIds: ["user001", "user002", ...] }
 * 실제 DELETE가 아닌 is_active = 0 처리 (안전)
 */
app.delete('/api/users/bulk', verifyApiKey, async (req, res) => {
  const { userIds } = req.body;
  if (!Array.isArray(userIds) || userIds.length === 0) {
    return res.status(400).json({ success: false, error: 'userIds 배열이 필요합니다.' });
  }
  if (userIds.length > 1000) {
    return res.status(400).json({ success: false, error: '한 번에 최대 1000명까지 처리 가능합니다.' });
  }

  const results = [];
  let successCount = 0, failCount = 0;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    for (const uid of userIds) {
      try {
        if (!uid) {
          results.push({ userId: '(없음)', status: 'fail', message: 'userId가 비어있습니다.' });
          failCount++;
          continue;
        }

        const [existing] = await conn.query('SELECT id, is_active FROM users WHERE user_id = ?', [uid]);
        if (existing.length === 0) {
          results.push({ userId: uid, status: 'fail', message: 'not found (사용자를 찾을 수 없습니다)' });
          failCount++;
          continue;
        }
        if (!existing[0].is_active) {
          results.push({ userId: uid, status: 'success', message: 'already inactive (이미 비활성화 상태)' });
          successCount++;
          continue;
        }

        await conn.query('UPDATE users SET is_active = 0, updated_at = NOW() WHERE user_id = ?', [uid]);
        results.push({ userId: uid, status: 'success', message: 'deactivated' });
        successCount++;
      } catch (rowErr) {
        results.push({ userId: uid || '(없음)', status: 'fail', message: rowErr.message });
        failCount++;
      }
    }

    await conn.commit();
    console.log(`[Users API] Bulk 비활성화 완료: 성공 ${successCount}, 실패 ${failCount}`);

    res.json({
      success: true,
      totalCount: userIds.length,
      successCount,
      failCount,
      results,
    });
  } catch (err) {
    await conn.rollback();
    console.error('[Users API] Bulk 비활성화 오류:', err.message);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    conn.release();
  }
});

// ============================================================
// File Upload (multer) - 엑셀/PPT 등 공용
// ============================================================
const UPLOAD_DIR = path.join(import.meta.dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 300 * 1024 * 1024 },  // 300MB
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
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
});

// AI 모델명 (환경변수로 변경 가능)
// GenSpark 프록시 지원 모델: gpt-5.5(추천), claude-sonnet-4-6, gpt-5.4-mini, claude-haiku-4-6
const GPT_MODEL = process.env.GPT_MODEL || 'gpt-5.5';

console.log(`[NLQ] AI 설정: model=${GPT_MODEL}, baseURL=${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}`);

// ============================================================
// MariaDB 커넥션 풀
// ============================================================
// [2026-07-22 PR #247] connectTimeout 을 명시적으로 설정.
//   - mysql2 기본값은 10s. 네트워크가 잠깐 불안정할 때 즉시 실패하므로 20s 로 상향.
//   - 이는 "커넥션 획득" 타임아웃일 뿐, 실제 쿼리 실행시간과는 무관.
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'company',
  password: process.env.DB_PASSWORD || 'company1234!',
  database: process.env.DB_NAME || 'company_board',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '5'),
  queueLimit: 0,
  connectTimeout: parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '20000', 10),
});

// ============================================================
// [2026-07-22 PR #247 / PR #250] NLQ (자연어질의) DB 쿼리 실행 타임아웃
// ------------------------------------------------------------
//   - 배경 (PR #247): aggregate(현황집계) 경로에서 실측 78s 걸리는 SQL 이
//     nginx 60s idle timeout 에 걸려 HTTP 504 로 잘리는 문제.
//     → MariaDB `SET STATEMENT max_statement_time` 로 서버단에서 강제 종료.
//   - 배경 (PR #250, 2026-07-22 재개정):
//     "2026년 3월~6월 월별 SKU 매출" 질의가 mysql2 driver 의 client-side
//     `Query inactivity timeout (90004ms)` 로 잘려서 HTTP 200 으로 반환됨.
//     → (1) 기본 한도를 90s → 120s 로 상향,
//       (2) mysql2 driver timeout 을 max_statement_time 보다 약간 크게
//          잡아 서버단 ER_STATEMENT_TIMEOUT(1969) 이 먼저 발화되도록 함
//          (에러 메시지가 더 명확 + errno 1969 로 안전하게 판정),
//       (3) 실제 타임아웃 시 HTTP 504 + error_type=db_query_timeout 반환.
//   - 계층 위계 (안쪽 → 바깥쪽, 안쪽이 항상 더 짧아야 함):
//       ①  NLQ DB max_stmt_time 120s      ← 여기 (NLQ_DB_QUERY_TIMEOUT_MS)
//       ①' mysql2 driver timeout ≈ 138s   ← (①) × 1.15 (드라이버가 나중에 발화)
//       ②  프론트 fetch(aggregate) 300s   ← index.html runAnalysisAsync
//       ③  Nginx proxy_read       240s+  ← 운영 nginx.conf (DEPLOYMENT.md)
//       ④  Express request        600s   ← SERVER_TIMEOUT_MS
//       ⑤  Undici headers/body    600s   ← UNDICI_TIMEOUT_MS
//   - 환경변수 NLQ_DB_QUERY_TIMEOUT_MS 로 운영 중 재조정 가능.
//   - 참고: 빌더용(BUILDER_DB_QUERY_TIMEOUT_MS=100000) 과는 별도.
// ============================================================
const NLQ_DB_QUERY_TIMEOUT_MS = parseInt(process.env.NLQ_DB_QUERY_TIMEOUT_MS || '120000', 10);
const NLQ_DB_QUERY_TIMEOUT_SEC = Math.max(1, Math.ceil(NLQ_DB_QUERY_TIMEOUT_MS / 1000));
console.log(`[Boot] NLQ DB query timeout: ${NLQ_DB_QUERY_TIMEOUT_MS}ms (max_statement_time=${NLQ_DB_QUERY_TIMEOUT_SEC}s)`);

// ------------------------------------------------------------
// Helper: NLQ 경로에서 사용자 SQL 을 실행할 때 서버단 statement timeout 을
// 강제로 씌워서 실행. 반환값은 mysql2 의 [rows, fields] 그대로.
// - MariaDB 10.1+ / MySQL 5.7+ 문법: `SET STATEMENT max_statement_time=<sec> FOR <sql>`
// - 타임아웃 발생 시 ER_STATEMENT_TIMEOUT(1969) 또는
//   PROTOCOL_SEQUENCE_TIMEOUT 이 던져지므로 호출 측에서 감지 가능.
// - 세미콜론 절단 방지: SQL 끝의 세미콜론/공백 제거 후 감싼다.
//
// [PR #250] mysql2 driver 의 `timeout` 옵션은 소켓 idle 기준 client-side 타이머라
//   서버단 max_statement_time 과 동일값이면 드라이버가 먼저 발화하여
//   "Query inactivity timeout" 이라는 애매한 메시지를 던지는 경우가 있음.
//   → driverTimeoutMs = round(tMs * 1.15) + 5000 로 여유를 주어
//     서버단 ER_STATEMENT_TIMEOUT(1969) 이 먼저 발화되게 한다.
// ------------------------------------------------------------
async function nlqPoolQueryWithTimeout(sql, params, timeoutMs) {
  const tMs = Math.max(1000, parseInt(timeoutMs || NLQ_DB_QUERY_TIMEOUT_MS, 10));
  const tSec = Math.max(1, Math.ceil(tMs / 1000));
  // mysql2 driver 는 서버단 max_statement_time 보다 약간 느긋하게 → 서버단이 먼저 발화
  const driverTimeoutMs = Math.ceil(tMs * 1.15) + 5000;
  const cleanSql = String(sql || '').replace(/;\s*$/g, '').trim();
  const wrappedSql = `SET STATEMENT max_statement_time=${tSec} FOR ${cleanSql}`;
  if (Array.isArray(params) && params.length > 0) {
    return await pool.query({ sql: wrappedSql, timeout: driverTimeoutMs }, params);
  }
  return await pool.query({ sql: wrappedSql, timeout: driverTimeoutMs });
}

// Helper: mysql2/MariaDB 의 쿼리 timeout 에러 여부 판정
// [2026-08-03] 판정 범위 확장 — 프론트/게이트웨이가 DB 조회 시간 초과로 인식해야 하는 모든 케이스:
//   - MariaDB max_statement_time 초과 (errno 1969)
//   - "Query execution was interrupted" (max_statement_time 도달 시 실제 메시지)
//   - mysql2 driver 의 client-side "Query inactivity timeout"
//   - 명시적 "DB query timeout"
//   - AbortError / ETIMEDOUT / ESOCKETTIMEDOUT (self-fetch 등에서 발생)
function isDbQueryTimeoutError(err) {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  const errno = Number(err.errno || 0);
  const msg = String(err.sqlMessage || err.message || '');
  return (
    code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
    code === 'ER_STATEMENT_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    code === 'ESOCKETTIMEDOUT' ||
    err?.name === 'AbortError' ||
    errno === 1969 ||
    /max_statement_time|query\s+execution\s+was\s+interrupted|statement\s+timeout|query\s+timeout|query\s+inactivity\s+timeout|db\s+query\s+timeout/i.test(msg)
  );
}

// ============================================================
// [2026-08-03] QUERY_SCOPE_TIMEOUT 공통 처리
// ------------------------------------------------------------
// 배경: aggregate / analysis 두 경로에서 DB 조회 시간 초과 응답을 서로 다르게 만들다 보니
//   - analysis 경로는 error_detail 이 없어서 프론트가 red 시스템 오류 UI 로 렌더링
//   - 문구도 aggregate("DB 조회 시간이 초과되었습니다") 와 analysis("DB 조회 한도 120초를 초과") 가 서로 다름
//   - HTTP 504 async job → 프론트 pollData.status='failed' 분기에서 errorType='system' 으로 폴백
// 이를 해결하기 위해 공통 상수/헬퍼로 통일한다.
//
// - QUERY_SCOPE_TIMEOUT_MESSAGE : 사용자에게 노출되는 표준 문구 (변경 금지)
// - QUERY_SCOPE_TIMEOUT_CODE    : 서버 errorCode / 프론트 매칭 상수
// - LEGACY_DB_QUERY_TIMEOUT_CODE: 기존 이력/모니터링 호환용 (프론트가 계속 인식해야 하는 값)
// - buildQueryScopeTimeoutResponse(): 공통 응답 페이로드 생성
// - buildQueryScopeTimeoutErrorDetail(): 프론트가 pollData.status='failed' 로 받았을 때 사용
// ============================================================
const QUERY_SCOPE_TIMEOUT_MESSAGE =
  '데이터 양이 너무 많아 조회 시간이 초과되었습니다. 질문의 기간, 대상 또는 조회 범위를 줄여 다시 질문해 주세요.';
const QUERY_SCOPE_TIMEOUT_CODE = 'QUERY_SCOPE_TIMEOUT';
// 프론트 index.html 3313 라인 및 renderHistoryList/hard_fail_count 집계 SQL 이
// 계속 'db_query_timeout' 문자열을 참조하므로, 하위 호환용 error_type 값은 유지한다.
const LEGACY_DB_QUERY_TIMEOUT_CODE = 'db_query_timeout';

function buildQueryScopeTimeoutErrorDetail({ req, err, extra = {} }) {
  const requestId = (typeof getCurrentRequestId === 'function' ? getCurrentRequestId() : null)
    || req?.requestId || null;
  return {
    requestId,
    stage: 'db_query_timeout',
    errorType: LEGACY_DB_QUERY_TIMEOUT_CODE,      // 프론트 3313 라인 매칭 대상 (하위 호환)
    errorCode: QUERY_SCOPE_TIMEOUT_CODE,          // 신규 표준 코드
    code: QUERY_SCOPE_TIMEOUT_CODE,
    message: QUERY_SCOPE_TIMEOUT_MESSAGE,
    // 내부 진단 정보(로그 추적용)는 error_detail 하위에만 포함 — 프론트 중립 UI 에서는 렌더하지 않음
    diagnostic: {
      originalMessage: String(err?.sqlMessage || err?.message || '') || null,
      errno: err?.errno || null,
      code: err?.code || null,
      elapsedMs: extra.dbElapsedMs || null,
      limitMs: extra.dbTimeoutLimitMs || NLQ_DB_QUERY_TIMEOUT_MS,
      failedSql: extra.failedSql || null,
    },
    timestamp: new Date().toISOString(),
  };
}

function buildQueryScopeTimeoutResponse({ req, err, sql, extra = {} }) {
  const errorDetail = buildQueryScopeTimeoutErrorDetail({ req, err, extra });
  return {
    httpStatus: 504,
    body: {
      success: false,
      sql: sql || null,
      rows: [],
      rowCount: 0,
      answer: QUERY_SCOPE_TIMEOUT_MESSAGE,
      explanation: null,
      // 프론트가 참조하는 모든 필드 — 신규/기존 필드를 함께 실어 어느 분기로 진입해도 인식되게 함
      requestId: errorDetail.requestId,
      errorCode: QUERY_SCOPE_TIMEOUT_CODE,
      error_code: QUERY_SCOPE_TIMEOUT_CODE,        // snake_case (기존 aggregate 호환)
      error_type: LEGACY_DB_QUERY_TIMEOUT_CODE,    // 프론트 3313 라인 매칭 (하위 호환)
      errorType: LEGACY_DB_QUERY_TIMEOUT_CODE,
      error_user_friendly: true,
      error_detail: errorDetail,                   // pollData.status='failed' 경로가 사용
      // analysis 경로 호환 필드
      isAnalysisAnswer: !!extra.isAnalysisAnswer,
      answerType: LEGACY_DB_QUERY_TIMEOUT_CODE,
      analysis: extra.isAnalysisAnswer ? QUERY_SCOPE_TIMEOUT_MESSAGE : null,
    },
  };
}

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
CO_AREA_NM   | VARCHAR(100)  | 관리회계 영역명
PROFIT_CTR   | VARCHAR(20)   | 손익 센터 (10자리, 선행0 포함. 예: 0000002000=제지사업부, 0000001000=생활용품사업부)
PROFIT_CTR_NM| VARCHAR(100)  | 손익센터명
DIVISION     | VARCHAR(5)    | 사업부/제품군 코드 (반드시 이 코드로 필터: 10=PS(페이퍼솔루션), 20=HL(홈앤라이프))
DIVISION_NM  | VARCHAR(100)  | 사업부/제품군명 (⚠️ 배포 환경별로 값이 다를 수 있어 필터에 사용 금지 — 반드시 DIVISION 코드 사용)
PLANT        | VARCHAR(10)   | 플랜트 코드 (예: P100, P200, P300, P400, P500)
PLANT_NM     | VARCHAR(100)  | 플랜트명
DISTR_CHAN   | VARCHAR(5)    | 유통 경로 코드 (예: 10=내수, 20=로컬, 30=수출)
DISTR_CHAN_NM| VARCHAR(100)  | 유통경로명
BIC_ZDISTCHAN    | VARCHAR(5)  | 내수/수출구분자(사업장)
BIC_ZORG_TEAM    | VARCHAR(10) | 영업팀(사업장그룹) 코드
SALES_OFF    | VARCHAR(10)   | 사업장 코드
SALES_OFF_NM | VARCHAR(100)  | 사업장명

-- 자재/제품 --
MATL_TYPE    | VARCHAR(10)   | 자재유형 코드 (예: FERT, HAWA)
MATL_TYPE_NM | VARCHAR(100)  | 자재유형명
MATL_GROUP   | VARCHAR(10)   | 자재 그룹 코드
MATL_GROUP_NM| VARCHAR(100)  | 자재 그룹명
PRODH1       | VARCHAR(10)   | 제품계층 구조레벨1 코드 (예: 350=생리대, 310=미용티슈, 330=물티슈, 300=두루마리)
PRODH1_NM    | VARCHAR(100)  | 제품군 (제품군 대)
PRODH2       | VARCHAR(10)   | 제품계층 구조레벨2 코드
PRODH2_NM    | VARCHAR(100)  | 지종 (제품군 중)
PRODH3       | VARCHAR(15)   | 제품계층 구조레벨3 코드
PRODH3_NM    | VARCHAR(100)  | 품목군 (제품군 소)
PRODH4       | VARCHAR(20)   | 제품계층 구조레벨4 코드
PRODH4_NM    | VARCHAR(100)  | 스펙, 사이즈, 크기, 지폭
BIC_ZJPCODE      | VARCHAR(10)   | 지종/제품구분 코드 (예: SN, FT, WT)
BIC_ZJPCODE_NM   | VARCHAR(100) | 지종/제품구분명
BIC_ZBRAND       | VARCHAR(10)   | 브랜드1 코드 (예: BRH006, BRH002)
BIC_ZBRAND_NM    | VARCHAR(100) | 브랜드 1 명
BIC_ZSBRAND      | VARCHAR(10)   | 브랜드2 코드
BIC_ZSBRAND_NM   | VARCHAR(100) | 브랜드 2 명

-- 거래처 --
BILL_TYPE    | VARCHAR(10)   | 대금청구유형 코드
BILL_TYPE_NM | VARCHAR(100)  | 대금청구유형 명
INCOTERMS    | VARCHAR(5)    | 인도 조건 코드
INCOTERMS_NM | VARCHAR(100)  | 인도 조건 명
CUST_GROUP   | VARCHAR(5)    | 고객 그룹 코드
CUST_GROUP_NM| VARCHAR(100)  | 고객그룹 명
CUST_GRP1    | VARCHAR(5)    | 고객 그룹1 코드
CUST_GRP1_NM | VARCHAR(100)  | 고객그룹1 명
ZZKVGR7      | VARCHAR(5)    | 고객 그룹7 코드
ZZKVGR7_NM   | VARCHAR(100)  | 고객그룹7 명
COUNTRY      | VARCHAR(5)    | 국가 코드 (예: KR)
COUNTRY_NM   | VARCHAR(100)  | 국가 명
BIC_ZKUNN2       | VARCHAR(20)   | 영업사원 코드
BIC_ZKUNN2_NM    | VARCHAR(100) | 영업사원 명
CUSTOMER     | VARCHAR(20)   | 고객 코드
CUSTOMER_NM  | VARCHAR(100)  | 고객 명 (⚠️ WHERE 조건 시 REPLACE(CUSTOMER_NM,' ','') LIKE '%공백제거값%' 형태 필수)
MATERIAL     | VARCHAR(30)   | 자재 코드 (예: FRT-NEE0004A)
MATERIAL_NM  | VARCHAR(100)  | 자재 명 (예: 깨끗한나라 2겹 화장지 45m 18롤)
                              ⚠️ DB 저장값에 공백 포함 — WHERE 조건 시 반드시
                                 REPLACE(MATERIAL_NM,' ','') LIKE '%공백제거값%' 형태로 작성

-- 수량 단위 --
BIC_ZBOXUNIT     | VARCHAR(5)    | BOX단위
BIC_ZBAGUNIT     | VARCHAR(5)    | BAG단위
BIC_ZUNIT        | VARCHAR(5)    | 기준수량단위(KG/EA)
CURRENCY     | VARCHAR(5)    | 통화 (예: KRW)

-- 수량 --
BIC_ZQTY_BOX     | DECIMAL(18,3) | 수량(BOX)
BIC_ZQTY_BAG     | BIGINT        | 수량(BAG)
BIC_ZQTY_KE      | DECIMAL(18,3) | 수량(KG/EA)

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
// [2026-06-30 제거됨] METRIC_DICTIONARY 하드코딩 상수
// ------------------------------------------------------------
// 기존: 산식을 코드에 박아둔 정적 사전 (2026-04-28 NLQ 서버 최초 생성 당시,
//       metric 테이블 자체가 존재하지 않아서 GPT 산식 창작 방지용으로 도입)
// 문제: 학습관리(metric 테이블)에서 산식을 수정해도 옛 산식이 LLM 프롬프트에
//       계속 같이 전달되어 GPT 가 옛 산식과 새 산식 사이에서 혼동을 일으킴
// 해결: buildMetricDictionaryFromDB(domainCode) 로 DB 기반 동적 사전 생성
//       → 학습관리 metric.formula 수정 시 즉시 NLQ 에 반영됨
// 호환성: 출력 포맷은 동일 ("계산 지표 사전 (Metric Dictionary):" 헤더 유지)
// ============================================================

// ============================================================
// RAG 상태 관리
// ============================================================
let ragReady = false;  // RAG 인덱스 빌드 완료 여부

// ============================================================
// 데이터 기간 컨텍스트 (당월/전월 동적 계산)
// ============================================================
/**
 * DB에서 최신 데이터 기간(CALMONTH) 조회 → 당월/전월 기준 계산
 * "당월"은 오늘 날짜가 아니라 마감 완료되어 적재된 최신 월을 의미
 */
async function getDataDateContext() {
  try {
    const [rows] = await pool.query(
      'SELECT MAX(CALMONTH) AS latest FROM bw_profitability_data'
    );
    const latest = rows[0]?.latest || '202604';
    const y = parseInt(latest.substring(0, 4));
    const m = parseInt(latest.substring(4, 6));
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prevMonth = `${prevY}${String(prevM).padStart(2, '0')}`;
    const latestLabel = `${y}년 ${m}월`;
    const prevLabel = `${prevY}년 ${prevM}월`;
    console.log(`[DateCtx] 최신 데이터: ${latest} → 당월=${latestLabel}, 전월=${prevLabel}`);
    return { latestMonth: latest, prevMonth, latestLabel, prevLabel };
  } catch (e) {
    console.error('[DateCtx] 데이터 기간 조회 실패:', e.message);
    return { latestMonth: '202604', prevMonth: '202603', latestLabel: '2026년 4월', prevLabel: '2026년 3월' };
  }
}

// ============================================================
// [2026-07-31] extractPeriodInfoFromSql — 최종 실행된 SQL 의 CALMONTH 조건을
//   파싱하여 사용자 화면 상단 '분석 대상 상세 결과' 옆에 표시할 실제 조회 기간
//   ({ from, to, label }) 로 산출한다.
//
//   설계 원칙 (사용자 요구):
//   - 사용자 질문 원문이 아닌 "실제 SQL 에 적용된 확정 기간"만 표시
//     → learned SQL rebase, GPT 자동주입, AnalysisPlan 자동채움 모두 SQL 텍스트에 최종
//        CALMONTH 가 남으므로 여기서 재구성이 안전함.
//   - 다양한 CALMONTH 표기 형태를 모두 지원:
//       (a) CALMONTH = 'YYYYMM'
//       (b) CALMONTH BETWEEN 'YYYYMM' AND 'YYYYMM'
//       (c) CALMONTH IN ('YYYYMM','YYYYMM',...)
//       (d) CALMONTH LIKE 'YYYY%'   / LEFT(CALMONTH,4)='YYYY'
//       (e) CALMONTH >= 'YYYYMM' AND CALMONTH <= 'YYYYMM' (범위 조합)
//   - 매칭 실패 시 null 반환 → 프론트가 '기간 정보 없음' 을 임의 추정하지 않고
//     기간 영역을 아예 숨김 처리.
//
//   반환 형태 예시:
//     { from:'202606', to:'202606', label:'2026년 6월' }
//     { from:'202501', to:'202606', label:'2025년 1월~2026년 6월' }
//     { from:'202601', to:'202612', label:'2026년' }
//     { from:'202601', to:'202606', label:'2026년 상반기(1월~6월)' }
//     { from:'202607', to:'202612', label:'2026년 하반기(7월~12월)' }
// ============================================================
function formatYmKorean(ym) {
  if (!ym || !/^\d{6}$/.test(ym)) return '';
  const y = ym.substring(0, 4);
  const m = parseInt(ym.substring(4, 6), 10);
  return `${y}년 ${m}월`;
}
function buildPeriodLabelKorean(from, to) {
  if (!from) return '';
  if (!to || from === to) return formatYmKorean(from);
  const yf = from.substring(0, 4);
  const mf = parseInt(from.substring(4, 6), 10);
  const yt = to.substring(0, 4);
  const mt = parseInt(to.substring(4, 6), 10);
  // 완전한 한 해: 202601 ~ 202612
  if (yf === yt && mf === 1 && mt === 12) return `${yf}년`;
  // 상반기 / 하반기
  if (yf === yt && mf === 1 && mt === 6) return `${yf}년 상반기(1월~6월)`;
  if (yf === yt && mf === 7 && mt === 12) return `${yf}년 하반기(7월~12월)`;
  // 분기 (Q1~Q4)
  if (yf === yt) {
    if (mf === 1 && mt === 3)  return `${yf}년 1분기(1월~3월)`;
    if (mf === 4 && mt === 6)  return `${yf}년 2분기(4월~6월)`;
    if (mf === 7 && mt === 9)  return `${yf}년 3분기(7월~9월)`;
    if (mf === 10 && mt === 12) return `${yf}년 4분기(10월~12월)`;
  }
  // 일반 범위
  return `${formatYmKorean(from)}~${formatYmKorean(to)}`;
}
function extractPeriodInfoFromSql(sql) {
  if (!sql || typeof sql !== 'string') return null;
  // CALMONTH 는 대소문자 무관, 컬럼 앞에 별칭(alias.CALMONTH)이 붙어 있어도 매칭 가능하도록.
  const S = sql;
  // (b) BETWEEN — 가장 먼저 확인 (더 구체적)
  //     CALMONTH BETWEEN 'YYYYMM' AND 'YYYYMM'
  const mBetween = S.match(/CALMONTH\s+BETWEEN\s+['"](\d{6})['"]\s+AND\s+['"](\d{6})['"]/i);
  if (mBetween) {
    const [ , a, b ] = mBetween;
    const from = a <= b ? a : b;
    const to   = a <= b ? b : a;
    return { from, to, label: buildPeriodLabelKorean(from, to) };
  }
  // (e) >= AND <= 조합 (같은 SQL 내에 두 조건이 모두 있을 때)
  const mGe = S.match(/CALMONTH\s*>=\s*['"](\d{6})['"]/i);
  const mLe = S.match(/CALMONTH\s*<=\s*['"](\d{6})['"]/i);
  if (mGe && mLe) {
    const a = mGe[1], b = mLe[1];
    const from = a <= b ? a : b;
    const to   = a <= b ? b : a;
    return { from, to, label: buildPeriodLabelKorean(from, to) };
  }
  // (c) IN — 여러 개월 나열 → 최소/최대 로 범위 요약
  const mIn = S.match(/CALMONTH\s+IN\s*\(([^)]+)\)/i);
  if (mIn) {
    const nums = (mIn[1].match(/\d{6}/g) || []).sort();
    if (nums.length > 0) {
      const from = nums[0];
      const to = nums[nums.length - 1];
      return { from, to, label: buildPeriodLabelKorean(from, to) };
    }
  }
  // (d) LIKE 'YYYY%'  또는  LEFT(CALMONTH,4)='YYYY'
  const mLike = S.match(/CALMONTH\s+LIKE\s+['"](\d{4})[%_]['"]/i)
             || S.match(/LEFT\s*\(\s*CALMONTH\s*,\s*4\s*\)\s*=\s*['"](\d{4})['"]/i);
  if (mLike) {
    const y = mLike[1];
    return { from: y + '01', to: y + '12', label: `${y}년` };
  }
  // (a) 등호 — 가장 단순한 케이스 (뒤로 배치: BETWEEN 안쪽에 =가 없다는 걸 위에서 걸러야 함)
  const mEq = S.match(/CALMONTH\s*=\s*['"](\d{6})['"]/i);
  if (mEq) {
    const ym = mEq[1];
    return { from: ym, to: ym, label: formatYmKorean(ym) };
  }
  return null;
}

// ============================================================
// System Prompt (RAG 기반 동적 생성)
// ============================================================
// 핵심 규칙만 포함한 경량 기본 프롬프트 (RAG 컨텍스트가 동적으로 추가됨)
const BASE_SYSTEM_PROMPT = `당신은 수익성 분석 데이터베이스 전문가입니다.
사용자의 자연어 질문을 MariaDB SQL로 변환합니다.

[★★★★★ 사업부 필터 절대 규칙 (Division Filter Rule) — 최상위 우선순위 ★★★★★]

🚨 사업부 필터는 **반드시 DIVISION 코드** 를 사용하세요. DIVISION_NM 은 절대 사용 금지!

■ 고정 매핑 규칙:
  - "PS" / "ps" / "PS사업부" / "PS 사업부" / "페이퍼솔루션" / "페이퍼솔루션 사업부" → DIVISION = '10'
  - "HL" / "hl" / "HL사업부" / "HL 사업부" / "홈앤라이프" / "홈앤라이프 사업부"    → DIVISION = '20'

■ 절대 금지 패턴 (사용 시 자동 교정 후처리 대상):
  ✗ DIVISION_NM = 'HL'
  ✗ DIVISION_NM = 'PS'
  ✗ DIVISION_NM = '홈앤라이프'
  ✗ DIVISION_NM = '페이퍼솔루션'
  ✗ DIVISION_NM LIKE '%HL%'
  ✗ DIVISION_NM LIKE '%PS%'
  ✗ DIVISION_NM LIKE '%홈앤라이프%'
  ✗ DIVISION_NM LIKE '%페이퍼솔루션%'

■ 정답 패턴:
  ✓ WHERE DIVISION = '10'  ← "PS", "페이퍼솔루션", "페이퍼솔루션 사업부"
  ✓ WHERE DIVISION = '20'  ← "HL", "홈앤라이프", "홈앤라이프 사업부"

■ 이유:
  DIVISION_NM 은 배포 환경/시점에 따라 저장 값이 다를 수 있음 (예: 'HL' vs '홈앤라이프').
  DIVISION 코드는 절대 변경되지 않는 표준값이므로 필터 조건은 반드시 코드로 작성.

■ SELECT/GROUP BY 목적으로는 DIVISION_NM 을 사용해도 됨 (표시용).
  단, WHERE 조건에서는 사용 금지.

[★★★★★ 자재명/고객명 공백 무시 검색 규칙 (Name Search Rule) — 최상위 우선순위 ★★★★★]

🚨 MATERIAL_NM (자재명), CUSTOMER_NM (고객명) 컬럼을 WHERE 조건으로 사용할 때는
   **반드시 REPLACE(컬럼, ' ', '') 로 공백을 제거한 뒤 비교** 하세요.

■ 이유:
  DB 저장 값은 공백을 포함하는 경우가 많지만 (예: "깨끗한나라 순수소프티 100매"),
  사용자는 공백 없이 입력하는 경우가 흔합니다 (예: "순수소프티100매").
  일반 LIKE 로는 매칭이 실패하므로 양쪽 모두 공백을 제거한 기준으로 비교해야 함.

■ 정답 패턴 (반드시 사용):
  ✓ WHERE REPLACE(MATERIAL_NM, ' ', '') LIKE '%순수소프티100매%'
  ✓ WHERE REPLACE(CUSTOMER_NM, ' ', '') LIKE '%메디프렌즈%'
  ✓ WHERE REPLACE(MATERIAL_NM, ' ', '') = '깨끗한나라순수소프티100매'
  ✓ WHERE REPLACE(x.MATERIAL_NM, ' ', '') LIKE '%값%'   (alias 도 동일)

■ 절대 금지 패턴 (자동 교정 후처리 대상):
  ✗ WHERE MATERIAL_NM LIKE '%순수소프티100매%'    ← DB 값에 공백 있으면 0건
  ✗ WHERE CUSTOMER_NM LIKE '%메디프렌즈%'         ← 동일
  ✗ WHERE MATERIAL_NM = '순수소프티 100매'        ← 사용자 입력에 공백 위치 다르면 0건

■ 리터럴 값 정규화:
  사용자 입력의 공백은 **모두 제거한 값을 리터럴로** 넣으세요.
  예) 사용자: "순수소프티 100매" → 리터럴: '순수소프티100매'
       사용자: "메디 프렌즈"     → 리터럴: '메디프렌즈'

■ 적용 범위:
  - MATERIAL_NM, CUSTOMER_NM 두 컬럼에만 적용 (다른 _NM 컬럼은 대상 아님)
  - =, <>, !=, LIKE, NOT LIKE 모두 동일 규칙
  - SELECT / GROUP BY / ORDER BY 목적으로는 원본 컬럼 그대로 사용 (표시용은 REPLACE 감쌈 불필요)

[★★★ 최우선 규칙 — 컬럼명 사용 (절대 위반 금지) ★★★]

■ 허용되는 컬럼명 — 아래 목록에 있는 컬럼만 SQL에 사용할 수 있습니다:
SEQ, CALYEAR, CALMONTH, CALDAY, CO_AREA, CO_AREA_NM, PROFIT_CTR, PROFIT_CTR_NM,
DIVISION, DIVISION_NM, PLANT, PLANT_NM, DISTR_CHAN, DISTR_CHAN_NM, BIC_ZDISTCHAN,
BIC_ZORG_TEAM, SALES_OFF, SALES_OFF_NM, MATL_TYPE, MATL_TYPE_NM, MATL_GROUP, MATL_GROUP_NM,
PRODH1, PRODH1_NM, PRODH2, PRODH2_NM, PRODH3, PRODH3_NM, PRODH4, PRODH4_NM,
BIC_ZJPCODE, BIC_ZJPCODE_NM, BIC_ZBRAND, BIC_ZBRAND_NM, BIC_ZSBRAND, BIC_ZSBRAND_NM,
BILL_TYPE, BILL_TYPE_NM, INCOTERMS, INCOTERMS_NM, CUST_GROUP, CUST_GROUP_NM,
CUST_GRP1, CUST_GRP1_NM, ZZKVGR7, ZZKVGR7_NM, COUNTRY, COUNTRY_NM, BIC_ZKUNN2, BIC_ZKUNN2_NM,
CUSTOMER, CUSTOMER_NM, MATERIAL, MATERIAL_NM,
BIC_ZBOXUNIT, BIC_ZBAGUNIT, BIC_ZUNIT, CURRENCY,
BIC_ZQTY_BOX, BIC_ZQTY_BAG, BIC_ZQTY_KE,
ZAMT001, ZAMT002, ZAMT003, ZAMT004, ZAMT005, ZAMT006, ZAMT007, ZAMT008,
ZAMT009, ZAMT010, ZAMT011, ZAMT012, ZAMT013, ZAMT014, ZAMT015, ZAMT016,
ZAMT017, ZAMT018, ZAMT019, ZAMT020, ZAMT021, ZAMT022, ZAMT023, ZAMT024,
ZAMT025, ZAMT026, ZAMT027, ZAMT028, ZAMT029, ZAMT030, ZAMT031, ZAMT032,
ZAMT033, ZAMT034, ZAMT035, ZAMT036, ZAMT037, ZAMT038, ZAMT039, ZAMT040,
ZAMT041, ZAMT042, ZAMT043, ZAMT044, ZAMT045, ZAMT046, ZAMT047, ZAMT048,
ZAMT049, ZAMT050, ZAMT051, ZAMT052, ZAMT053, ZAMT054, ZAMT055, ZAMT056,
ZAMT057, ZAMT058, ZAMT059, ZAMT060, ZAMT061, ZAMT062, ZAMT063, ZAMT064

■ 컬럼명 선택 우선순위:
1순위: 동의어 매칭 결과 중 [Ontology 컬럼 매핑]이 있으면 해당 컬럼을 최우선 사용 (Metric보다 항상 우선!)
  - Ontology로 매핑된 단어는 절대 Metric 산식으로 재해석하지 마세요!
  - 예) "CAM" → Ontology의 CO_AREA_NM(관리회계 영역명) → GROUP BY / WHERE에 사용
2순위: 동의어 매칭 결과 중 [Metric 산식]이 있으면 해당 산식 사용 (단순 컬럼보다 우선!)
3순위: 동의어 매칭이 없으면 위 허용 목록 + TABLE_SCHEMA 설명을 보고 가장 적합한 컬럼을 판단하여 사용

★ Metric 산식 우선 규칙: 학습관리의 Metric에 계산 산식(formula)이 정의된 지표는 반드시 해당 산식을 사용하세요.
  - 산식은 **항상 학습관리에 등록된 원본 그대로**(아래 [동의어 매칭 결과]의 "반드시 사용할 SQL 표현식" 절) 사용하세요.
  - **절대 산식을 직접 창작/변형하지 마세요.** 예시 산식을 외워서 기억으로 작성하는 것도 금지입니다.
  - **컬럼별 SUM 분배 금지**: 산식이 row-level (예: ZAMT001-ZAMT002+ZAMT004) 형태로 제공되면,
    'SUM(ZAMT001)-SUM(ZAMT002)+SUM(ZAMT004)' 처럼 컬럼마다 SUM()을 붙여 분배하지 마세요.
    반드시 산식 **전체**를 'SUM(산식)' 한 번으로 감싸세요. (자세한 wrap 규칙은 아래 "[Metric 산식 → SQL 표현식 변환 규칙]" 참조)
★ Ontology/Metric 분리 규칙: 동일 단어가 Ontology 동의어와 Metric 동의어 양쪽에 매칭될 수 있는 경우 Ontology를 우선합니다.
  - Ontology = 차원/분류 컬럼 (GROUP BY, WHERE, SELECT에서 분류 기준으로 사용)
  - Metric = 계산 지표/산식 (SELECT에서 집계값으로 사용)

■ 절대 금지 — 컬럼명 창작/조합:
- 위 허용 목록에 없는 컬럼명을 절대 만들지 마세요
- 컬럼명 일부를 합치거나 변형하지 마세요
- 설명에 나오는 단어(BOX, BAG, KG, EA 등)를 컬럼명에 붙이지 마세요
- 언더스코어(_) 위치, 대소문자를 정확히 지켜서 위 목록에 있는 그대로만 사용하세요

■ 자주 틀리는 컬럼명 예시 (왼쪽 ✗ 금지 → 오른쪽 ✓ 정답):
  ★ 2026-06 재네이밍 — 아래 16개 컬럼은 BIC_ 프리픽스가 필수!
  ZDISTCHAN ✗ → BIC_ZDISTCHAN ✓
  ZORG_TEAM ✗ → BIC_ZORG_TEAM ✓
  ZJPCODE ✗ → BIC_ZJPCODE ✓ / ZJPCODE_NM ✗ → BIC_ZJPCODE_NM ✓
  ZBRAND ✗ → BIC_ZBRAND ✓ / ZBRAND_NM ✗ → BIC_ZBRAND_NM ✓
  ZSBRAND ✗ → BIC_ZSBRAND ✓ / ZSBRAND_NM ✗ → BIC_ZSBRAND_NM ✓
  ZKUNN2 ✗ → BIC_ZKUNN2 ✓ / ZKUNN2_NM ✗ → BIC_ZKUNN2_NM ✓
  ZBOXUNIT ✗ → BIC_ZBOXUNIT ✓ / ZBAGUNIT ✗ → BIC_ZBAGUNIT ✓ / ZUNIT ✗ → BIC_ZUNIT ✓
  ZQTYBOX ✗ → BIC_ZQTY_BOX ✓ (수량 BOX)
  ZQTYBAG ✗ → BIC_ZQTY_BAG ✓ (수량 BAG)
  ZQTYKE ✗ → BIC_ZQTY_KE ✓ (수량 KG/EA)
  ZQTY_BOX ✗ → BIC_ZQTY_BOX ✓
  ZQTY_BAG ✗ → BIC_ZQTY_BAG ✓
  ZQTY_KE ✗ → BIC_ZQTY_KE ✓
  ZQTYKGEA ✗ → BIC_ZQTY_KE ✓ (KG/EA 수량은 BIC_ZQTY_KE임!)
  ZQTY_KGEA ✗ → BIC_ZQTY_KE ✓
  ZQTY_KG ✗ → BIC_ZQTY_KE ✓
  ZQTY_EA ✗ → BIC_ZQTY_KE ✓
  ZSALES ✗ → ZAMT001 ✓ (총매출)
  ZREVENUE ✗ → ZAMT001 ✓
  DISTR_CHAN_NAME ✗ → DISTR_CHAN_NM ✓
  SALES_OFFICE ✗ → SALES_OFF ✓

■ 내수/수출 비교 질문 처리법:
- "내수", "수출", "유통경로" → DISTR_CHAN 또는 DISTR_CHAN_NM 컬럼 사용
- DISTR_CHAN 값: 10=내수, 20=로칼, 30=직수출
- 내수 vs 수출 매출 비교 → GROUP BY DISTR_CHAN_NM + SUM(ZAMT001) 사용

[핵심 규칙]
1. SELECT 문만 생성 (INSERT/UPDATE/DELETE/DROP 절대 금지)
2. 테이블은 bw_profitability_data 하나만 사용
3. 계산 지표는 반드시 아래 제공된 메트릭/컬럼 정보만 사용 (새로운 수식 창작 금지)
4. **LIMIT 사용 규칙 — 매우 중요! (2026-07-22 개정)**
   - **원칙: LIMIT 을 붙이지 마세요.** 조건에 해당하는 전체 결과를 그대로 반환해야 합니다.
     (화면에서는 프론트가 페이징 처리하므로 SQL 단에서 임의로 자르면 안 됩니다.)
   - **예외 — 사용자가 아래처럼 건수를 명시적으로 요청한 경우에만 LIMIT 사용:**
     · "TOP 10", "상위 5", "매출 상위 3개", "제일 큰 20개" → LIMIT 10 / 5 / 3 / 20
     · "10개만", "5건만", "20행만 보여줘" → LIMIT 10 / 5 / 20
     · "미리보기", "샘플" (건수 명시 없으면 LIMIT 20 정도 허용)
     · 월별 TOP N (partition 별 순위) 은 백엔드가 CTE + ROW_NUMBER 로 재작성하므로 SQL에는 LIMIT 붙이지 마세요.
   - **일반 조회에는 절대 LIMIT 을 붙이지 마세요.** "2026년 3월부터 6월까지 월별 SKU 매출"
     처럼 기간·차원만 명시된 질의는 조건을 만족하는 모든 행을 반환해야 합니다.
     그런 질의에 LIMIT 1000 / LIMIT 5000 등을 임의로 붙이면 사용자가 잘못된 부분 결과를 보게 됩니다.
5. **금액/수치 표시 (2026-07-22 개정, PR #250) — 매우 중요!**
   - **SQL 에서는 FORMAT() 을 절대 사용하지 마세요.** 숫자를 그대로 SUM(...) AS 별칭 형태로 반환합니다.
     · ✗ 금지: FORMAT(SUM(ZAMT003), 0) AS '매출 합계(원)'
     · ✓ 권장: SUM(ZAMT003) AS '매출 합계(원)'
   - **이유:** FORMAT() 은 (a) 집계 결과를 VARCHAR 로 변환하여 옵티마이저가 인덱스/파이프라인 최적화를 못 하게 하고,
     (b) 결과 크기(row × column)에 비례해 CPU 를 소모하며, (c) 프론트가 다시 파싱해야 정렬/필터가 가능합니다.
     → 천 단위 콤마·소수점 자릿수 포맷은 **프론트엔드가 화면 렌더링 단계에서 처리**합니다. SQL 은 raw number 만 반환.
   - **ORDER BY 는 언제나 원식 그대로 사용:** ORDER BY SUM(ZAMT***) DESC (별칭이나 FORMAT 사용 금지)
6. **비율/율(%) 표시 (2026-07-22 개정)**
   - FORMAT/ROUND 없이 원식만: SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100 AS '영업이익률(%)'
   - 소수 자릿수·콤마는 프론트가 처리. SQL 은 순수 계산식만 반환.
   - ORDER BY 는 원식 사용 (별칭 사용 금지).
7. GROUP BY 시 반드시 집계 함수 사용
8. 컬럼 alias는 한글, 사용자가 이해하기 쉬운 의미 있는 이름 사용
9. 정렬: 금액 DESC, 코드 ASC
10. NULL 값 처리: 데이터가 없는 컬럼은 NULL 그대로 표시 (COALESCE/IFNULL로 '미상','Unknown' 등 문자열 치환 금지). 단, 금액/수량 집계에서 NULL→0 변환은 허용
11. _NM 명칭 컬럼 활용: 코드 컬럼 옆에 대응하는 _NM 컬럼이 있으면 함께 SELECT (CASE WHEN 불필요)
12. **코드매핑 컬럼 GROUP BY 규칙 (2026-07-22 개정, PR #250) — 매우 중요!**
    - 코드컬럼과 _NM(명칭) 컬럼이 모두 있는 경우 **반드시 코드컬럼으로 GROUP BY** 하고 명칭은 MAX() 로 함께 노출:
      · ✓ 권장: GROUP BY MATERIAL + SELECT 절에 MATERIAL, MAX(MATERIAL_NM) AS '자재명'
      · ✗ 금지: GROUP BY MATERIAL_NM 단독 (VARCHAR 그룹핑은 코드보다 훨씬 느리고 인덱스 미사용)
    - 특히 SKU/자재 관련 질문: **MATERIAL(코드) 기준 집계** 후 MAX(MATERIAL_NM) 로 자재명 표시.
      MATERIAL_NM 은 사실상 MATERIAL 에 1:1 대응이므로 MAX()/MIN()/ANY_VALUE() 모두 동일 결과.
    - 동일 원칙 적용 대상: CUSTOMER↔CUSTOMER_NM, PROFIT_CTR↔PROFIT_CTR_NM, DIVISION↔DIVISION_NM,
      SALES_ORG↔SALES_ORG_NM, DISTR_CHAN↔DISTR_CHAN_NM 등.
    - 예시 SQL (권장 패턴):
      SELECT CALMONTH AS '연월',
             MATERIAL AS 'SKU코드',
             MAX(MATERIAL_NM) AS 'SKU명',
             SUM(ZAMT003) AS '매출 합계(원)'
      FROM bw_profitability_data
      WHERE DIVISION='10' AND CALMONTH BETWEEN '202603' AND '202606'
      GROUP BY CALMONTH, MATERIAL
      ORDER BY CALMONTH ASC, SUM(ZAMT003) DESC
13. 명칭으로 질문 시 코드값으로 WHERE
14. PROFIT_CTR: 10자리 선행0 (예: '0000002000')
15. 자재명: MATERIAL_NM (자재 명 컬럼). GROUP BY 는 MATERIAL(코드) 기준 + MAX(MATERIAL_NM) 로 명칭 노출 (규칙 12 참조).
16. 브랜드: BIC_ZBRAND (브랜드1), BIC_ZSBRAND (브랜드2)
17. **학습 데이터 우선**: 아래 RAG 컨텍스트에 유사 질문의 검증된 SQL이 있으면 그 패턴을 최우선 참고
18. **알 수 없는 용어 처리 (매우 중요!)**: 사용자의 질문에 포함된 핵심 용어(업무 명칭, 지표명, 분류명 등)가 아래 조건을 **모두** 만족하지 못하면, SQL을 생성하지 말고 반드시 안내 메시지만 응답하세요:
  - 동의어 매칭 결과에 해당 용어가 없음
  - RAG 컨텍스트(관련 컬럼 정보, 관련 계산 지표)에 해당 용어와 명확히 대응하는 항목이 없음
  - 허용 컬럼 목록의 컬럼명/설명과도 일치하지 않음
  → 이 경우 응답 형식: "'{용어}'에 대한 정보가 등록되어 있지 않습니다. 관리자에게 문의하여 학습관리에 해당 용어를 등록해 주세요."
  → 절대 용어를 임의로 추측/해석하여 SQL을 생성하지 마세요! 틀린 SQL보다 모른다고 답하는 것이 훨씬 좋습니다.

[날짜/기간 필터링 규칙 - 매우 중요!]
- **ZYEAR, ZMONTH, FISC_YEAR, FISC_PERIOD, YEAR, MONTH 등의 컬럼은 존재하지 않습니다! 절대 사용 금지!**
- 연도/월 필터: CALMONTH 컬럼 사용 (VARCHAR, YYYYMM 형식). 예: "2024년 5월" → WHERE CALMONTH = '202405'
- 연도만 필터: CALMONTH LIKE '2024%' 또는 LEFT(CALMONTH,4) = '2024'
- 일자 필터: CALDAY 컬럼 사용 (VARCHAR, YYYYMMDD 형식). 예: "2024년 5월 1일" → WHERE CALDAY = '20240501'
- 월 범위 필터: CALMONTH BETWEEN '202401' AND '202412'
- 일별 추이: GROUP BY CALDAY, ORDER BY CALDAY ASC
- 월별 추이: GROUP BY CALMONTH, ORDER BY CALMONTH ASC
- 현재 데이터의 최신 마감월은 CALMONTH='__LATEST_MONTH__' (__LATEST_LABEL__) 입니다
- "이번달", "당월", "현재월", "최근월" → 마감 완료 최신월인 __LATEST_LABEL__ (CALMONTH='__LATEST_MONTH__')로 해석
- "전월", "지난달" → __PREV_LABEL__ (CALMONTH='__PREV_MONTH__')로 해석
- ★★★ 사용자가 기간/월을 명시하지 않은 질문은 반드시 당월(마감 최신월) 기준으로만 조회! WHERE CALMONTH = '__LATEST_MONTH__' 추가 필수! ★★★
- 단, 사용자가 특정 년월을 명시한 경우(예: "2026년 3월")에는 해당 월을 우선 적용
- 월별/일별 추이 질문은 WHERE 없이 전체 조회 가능

[★★★ 당월/전월/이번달 기간 표시 규칙 — 매우 중요! ★★★]
사용자가 "이번달", "당월", "전월", "전월대비" 같은 상대적 기간 표현을 사용하면:
1. SQL 컬럼 별칭(alias)에 반드시 실제 년월을 함께 표시하세요:
   - "당월" 또는 "이번달" → "당월(__LATEST_LABEL__) 총매출 합계(원)"
   - "전월" → "전월(__PREV_LABEL__) 총매출 합계(원)"
   - "전월대비 증감" → "전월대비 증감액(원)" 또는 "전월대비 증감률(%)"
2. answer 답변 문장에도 실제 년월을 함께 표기:
   - ✗ "전월 대비 매출 증가 1위는..."
   - ✓ "전월(__PREV_LABEL__) 대비 당월(__LATEST_LABEL__) 매출 증가 1위는..."
3. 이 규칙은 SQL 컬럼 alias, answer 답변, explanation 모두에 적용됩니다.

[★★★ 기간 미지정 질문의 기본 조회 범위 — 매우 중요! ★★★]
사용자가 기간을 명시하지 않은 일반 질문(예: "제품별 매출 TOP 5", "손익센터별 총매출 합계")은:
- 반드시 WHERE CALMONTH = '__LATEST_MONTH__' 조건을 추가하여 마감 최신월 데이터만 조회
- 전체 기간 합산이 아님! 기준월 1개월 데이터만 조회!
- 단, "월별 추이", "기간별", "전체", "모든 월" 등 복수 기간을 암시하는 질문은 예외

[★★★ 한국어 회계기간 표현 해석 규칙 — 매우 중요! ★★★]
사용자가 아래와 같은 한국식 기간 표현을 쓰면 반드시 아래 매핑대로 CALMONTH BETWEEN 조건을 생성하세요.
YYYY 는 문맥의 연도(사용자가 "2026년 상반기"라 하면 2026, 연도가 없으면 현재 년도).
- "YYYY년 상반기"                → WHERE CALMONTH BETWEEN 'YYYY01' AND 'YYYY06'
- "YYYY년 하반기"                → WHERE CALMONTH BETWEEN 'YYYY07' AND 'YYYY12'
- "YYYY년 1분기" / "YYYY년 Q1"   → WHERE CALMONTH BETWEEN 'YYYY01' AND 'YYYY03'
- "YYYY년 2분기" / "YYYY년 Q2"   → WHERE CALMONTH BETWEEN 'YYYY04' AND 'YYYY06'
- "YYYY년 3분기" / "YYYY년 Q3"   → WHERE CALMONTH BETWEEN 'YYYY07' AND 'YYYY09'
- "YYYY년 4분기" / "YYYY년 Q4"   → WHERE CALMONTH BETWEEN 'YYYY10' AND 'YYYY12'
- "YYYY년 전체" / "YYYY년"       → WHERE CALMONTH BETWEEN 'YYYY01' AND 'YYYY12'  (또는 CALMONTH LIKE 'YYYY%')
- "최근 N개월" / "지난 N개월"     → CALMONTH BETWEEN <N-1개월 전> AND '__LATEST_MONTH__'
- "YYYY년 M월 ~ YYYY년 N월"      → WHERE CALMONTH BETWEEN 'YYYYMM' AND 'YYYYMM'
★ 이런 표현은 "기간을 명시하지 않은 질문"이 아닙니다. 절대 당월(__LATEST_MONTH__)로 축소하지 마세요.
★ 답변/컬럼 alias에도 실제 기간 범위를 명시: 예) "2026년 상반기(2026년 1월~6월) 총매출 합계(원)".

[컬럼 최소화 원칙 - 매우 중요!]
- **질문에서 요청한 항목만 SELECT 하세요. 관련 있어 보이더라도 질문에 없는 항목은 절대 추가하지 마세요.**
- 예: "판매수량 합계"라고 하면 → BOX 수량(BIC_ZQTY_BOX) 하나만 사용. BAG수량, EA수량은 질문에 없으므로 포함 금지.
- 예: "총매출 합계"라고 하면 → SUM(ZAMT001) 하나만 사용. 순매출, 영업이익 등은 추가하지 마세요.
- 사용자가 "수량" 이라고만 하면 기본 단위는 BOX(BIC_ZQTY_BOX). BAG/EA는 사용자가 명시적으로 요청할 때만 포함.
- 사용자가 "모든 수량" 또는 "BOX, BAG, EA 수량"처럼 여러 단위를 명시한 경우에만 복수 수량 컬럼 사용.

[★★★ Metric 산식 → SQL 표현식 변환 규칙 — 매우 중요! (2026-06-30) ★★★]
학습관리에 등록된 Metric 산식(formula)을 SELECT 절에 넣을 때는 **다음 규칙을 정확히 따르세요**.
산식의 "row-level / column-level" 구분:
  - **row-level (원시 컬럼만 있음)**: 산식 안에 SUM/AVG/COUNT/MAX/MIN 같은 집계 함수가 전혀 없는 경우.
      예) ZAMT001-ZAMT002 ,  ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+...+ZAMT033)
  - **column-level (집계 함수 포함)**: 산식 안에 이미 SUM/AVG 등이 포함되어 있는 경우.
      예) SUM(ZAMT001)/NULLIF(SUM(ZQTY_BOX),0) ,  SUM(ZAMT035)/NULLIF(SUM(ZAMT003),0)*100

★ row-level 산식을 SELECT(또는 ORDER BY/HAVING)에 넣을 때:
  ① **무조건 산식 전체를 SUM() 한 번으로 감싸세요.**
     - 산식: ZAMT001-ZAMT002+ZAMT004-(ZAMT006+...+ZAMT033)
     - ✓ 정답: SUM(ZAMT001-ZAMT002+ZAMT004-(ZAMT006+...+ZAMT033))
     - ✗ 금지: SUM(ZAMT001)-SUM(ZAMT002)+SUM(ZAMT004)-(SUM(ZAMT006)+...+SUM(ZAMT033))  (컬럼별 SUM 분배 금지)
     - ✗ 금지: ZAMT001-ZAMT002+...  (SUM 없이 그대로 노출 금지 — 단일 행 집계 불가)
  ② **조건부 합계가 필요한 경우(WHERE로 거를 수 없는 행 단위 분기)**: SUM(CASE WHEN <조건> THEN <산식> ELSE 0 END) 으로 감싸세요.
     - 예) 도메인별 매출총이익 분리 합계가 필요할 때:
       SUM(CASE WHEN DIVISION='20' THEN ZAMT001-ZAMT002+ZAMT004-(ZAMT006+...) ELSE 0 END)
  ③ ORDER BY, HAVING 등에서도 위와 동일한 SUM(산식) 표현을 그대로 복사해 사용하세요. (FORMAT() 은 사용 금지 — 규칙 5 참조)
  ④ 비율/평균을 계산할 때 (예: 매출총이익률 = 매출총이익 / 순매출 * 100):
     - 분자/분모가 각각 row-level 산식이면 각각을 SUM()으로 감싸세요:
       SUM(<매출총이익 산식>) / NULLIF(SUM(<순매출 산식>), 0) * 100

★ column-level 산식(이미 SUM이 들어있는 산식)을 사용할 때:
  - 산식을 **그대로** 복사해 사용. 추가로 SUM()을 또 감싸지 마세요(중첩 금지).
  - 예) 산식 SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100 → 그대로 SELECT에 넣음.

★ 절대 금지:
  - 학습관리에 없는 metric_code를 단독으로 SUM()해서 단순 합산하지 마세요.
    예) 매출총이익 산식이 row-level로 등록돼 있는데 SUM(ZAMT035) 한 줄로 답하기 → ✗ 금지.
  - 다른 metric의 산식을 **추측/기억**으로 작성하지 마세요. 반드시 동의어 매칭 결과의 "반드시 사용할 SQL 표현식"을 그대로 복사하세요.

[★★★ 동의어 정확매칭 우선 — 매우 중요! (PR #140) ★★★]
- 사용자가 "매출" 같은 짧은 단어로 질의했고, 동의어 매칭 결과에 그 단어가 **하나의 컬럼/Metric에 정확매칭** 되어 있으면:
  → **그 정확매칭 결과만** SELECT 에 사용하세요. **유사한 다른 컬럼은 절대 추가하지 마세요.**
  ✗ 금지: "매출" → ZAMT003(순매출) + ZAMT001(총매출) + ZAMT004(기타매출) + ZAMT005(매출원가) + ZAMT035(매출총이익) 전부 SELECT
  ✓ 정답: "매출" → 동의어가 ZAMT003 에만 등록되어 있으면 ZAMT003 의 Metric 산식만 SELECT
- 사용자가 명시적으로 다중 지표를 요청한 경우에만 관련 지표를 확장 노출하세요. 다중 지표 요청의 명시적 신호:
  ① "관련 지표 전체", "주요 지표 전체", "전체 지표"
  ② "수익성 분석", "수익성 진단", "손익 분석", "원가 분석" 등 도메인 분석형 표현
  ③ "매출/원가/이익", "매출과 원가와 이익" 등 슬래시/콤마/그리고로 명시적으로 여러 지표를 나열
  ④ "같이 보여줘", "함께 조회", "한꺼번에" 등 다중 노출 표현
- 위 신호가 없는 단순 조회형 질의("SKU별 매출 TOP5", "월별 매출 추이")는 반드시 정확매칭 결과만 SELECT 하세요.

[컬럼 별칭(alias) 작성 규칙 — ★★★ 매우 중요 ★★★]
- **SELECT 절의 모든 컬럼**(차원/명칭/코드/집계 포함)에 **반드시 한국어 AS 별칭**을 붙이세요. 영문 원본 컬럼명을 별칭 없이 결과셋에 노출하는 것을 금지합니다.
- 별칭은 작은따옴표(') 또는 백틱(\`)으로 감싸세요.
- 별칭에는 단위를 괄호로 명시: 예) '판매수량 합계(BOX)', '총매출(원)', '영업이익률(%)'
- 집계 함수를 사용한 경우 "합계", "평균", "최대" 등을 별칭에 포함
- 코드/명칭 컬럼도 의미 있는 한국어 별칭 필수:
  ✗ 금지: SELECT MATERIAL, MATERIAL_NM, SUM(ZAMT001) AS '총매출 합계(원)'
  ✓ 정답: SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', SUM(ZAMT001) AS '총매출 합계(원)'
         (GROUP BY MATERIAL — 코드 기준 그룹핑 + 명칭은 MAX() 로 노출: 규칙 12 참조)
- 별칭에 적절한 단어가 떠오르지 않으면 DB COMMENT/학습관리 동의어 의미를 추론하여 한국어로 부여하세요 (예: PROFIT_CTR → '손익센터', CALMONTH → '연월', DISTR_CHAN_NM → '유통경로명').
- 예시 (전형적인 형태):
  SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명',
         SUM(BIC_ZQTY_BOX) AS '판매수량 합계(BOX)',
         SUM(ZAMT001) AS '총매출 합계(원)'
  FROM bw_profitability_data ... GROUP BY MATERIAL   -- 코드 기준 GROUP BY (규칙 12)

[★ 동일 키워드가 여러 컬럼에 매칭된 경우 — 매우 중요!]
- 사용자가 입력한 단어가 여러 컬럼에 매핑되어 있는 경우가 있습니다:
  • 동의어 다중 등록: "지급수수료" → ZAMT040(지급수수료(변동)) + ZAMT044(지급수수료(고정))
  • 동의어 + description 부분 일치: "소모품비" → ZAMT049(소모품비, 동의어매칭) + ZAMT019(수선/소모품비, description 부분포함)
  • 변동/고정 분리: "급여" → ZAMT037(급여(변동)) + ZAMT043(급여(고정))
- 이 경우 임의로 하나만 선택하면 안 되며, **매칭된 활성 컬럼을 모두 SELECT에 개별 컬럼으로 포함**해야 합니다.
- 각 컬럼의 AS 별칭은 **반드시 해당 컬럼의 description(학습관리 등록 설명)을 그대로 사용**하세요.
  사용자가 입력한 키워드("소모품비")를 별칭의 기준으로 쓰지 마세요. 각 컬럼의 등록 description이 기준입니다.

  ✗ 금지: SELECT SUM(ZAMT049) AS '소모품비 합계(원)'  → ZAMT019 누락
  ✗ 금지: SELECT SUM(ZAMT049)+SUM(ZAMT019) AS '소모품비 합계(원)'  → 통합 별칭 금지
  ✓ 정답: SELECT
            SUM(ZAMT049) AS '소모품비 합계(원)',          -- ZAMT049의 description "소모품비"
            SUM(ZAMT019) AS '수선/소모품비 합계(원)'      -- ZAMT019의 description "수선/소모품비"

  ✗ 금지: SELECT SUM(ZAMT040)+SUM(ZAMT044) AS '지급수수료 합계(원)'
  ✓ 정답: SELECT
            SUM(ZAMT040) AS '지급수수료(변동) 합계(원)',
            SUM(ZAMT044) AS '지급수수료(고정) 합계(원)'

- 동의어 매칭 컨텍스트의 "[중요] N개 컬럼에 매칭됨" 안내를 그대로 따르세요.

[분석형 질문 판별 - 매우 중요!]
사용자의 질문이 단순 데이터 조회가 아니라 **분석, 요약, 시사점, 인사이트, 해석, 평가, 제언, 비교분석, 원인, 이유, 추천** 등을 요청하는 경우:
- "analysisRequired": true 로 설정하세요
- 이 경우에도 반드시 SQL은 생성하세요 (분석에 필요한 핵심 지표들을 폭넓게 조회)
- 분석형 질문의 SQL은 주요 지표(총매출, 순매출, 매출총이익률, 재료비, 마케팅비 등)를 포괄적으로 포함하세요
- 예: "시사점을 요약해줘" → analysisRequired: true, SQL은 주요 KPI 전체 조회

분석형 질문의 예:
- "~를 분석해줘", "시사점을 요약해줘", "인사이트를 알려줘"
- "왜 ~인지 설명해줘", "원인이 뭐야", "이유를 분석해줘"
- "~에 대해 평가해줘", "개선점을 제시해줘", "추천해줘"
- "어떤 의미야", "해석해줘", "트렌드를 분석해줘"

단순 조회형 질문의 예 (analysisRequired: false):
- "총매출 합계 보여줘", "제품군별 매출", "상위 10개 품목"

🚨🚨🚨 [SQL 작성 절대 규칙 — MariaDB 문법 준수] 🚨🚨🚨
1. WHERE 절에는 절대 집계함수(SUM/AVG/COUNT/MAX/MIN)를 쓰지 마세요!
   ❌ 금지: WHERE SUM(ZAMT001) > 1000  → "Invalid use of group function" 에러 발생
   ✅ 올바름: SELECT ... GROUP BY ... HAVING SUM(ZAMT001) > 1000

2. GROUP BY 없이 집계함수와 일반 컬럼을 SELECT에 같이 쓰지 마세요!
   ❌ 금지: SELECT MATERIAL, SUM(ZAMT001) FROM ... (GROUP BY 없음)
   ✅ 올바름: SELECT MATERIAL, SUM(ZAMT001) FROM ... GROUP BY MATERIAL
   ✅ 또는: SELECT SUM(ZAMT001) FROM ...  (GROUP BY 없이 집계만)

3. 분석형 질문(인사이트/시사점/요약 등)의 SQL 작성 방법:
   - 단일 행에 여러 KPI를 한 번에 집계 (GROUP BY 없음, 일반 컬럼도 없음)
   ✅ 권장 형태:
   SELECT
     SUM(ZAMT001) AS '총매출',
     SUM(ZAMT003) AS '순매출',
     SUM(ZAMT005) AS '매출원가',
     ...
   FROM bw_profitability_data
   WHERE CALMONTH='202604'   -- WHERE에는 일반 컬럼 조건만!
   - 차원별로 보고 싶으면 GROUP BY 명시:
   SELECT PRODUCT_GROUP AS '제품군', SUM(ZAMT001) AS '매출'
   FROM bw_profitability_data
   WHERE CALMONTH='202604'
   GROUP BY PRODUCT_GROUP

4. **FORMAT() 사용 금지 (2026-07-22 PR #250 개정)**
   ❌ 금지: FORMAT(SUM(ZAMT001), 0)   → SQL 성능 저하 + VARCHAR 반환
   ✅ 올바름: SUM(ZAMT001) AS '별칭'   ← raw 숫자 반환, 프론트가 콤마 포맷
   (규칙 5 참조 — 천 단위 콤마·소수 자릿수는 화면 렌더링에서 처리)

응답 형식 (반드시 JSON):
{
  "sql": "SELECT ...",
  "answer": "사용자에게 보여줄 친절한 한줄 답변 (비개발자가 이해할 수 있는 말)",
  "explanation": "이 쿼리의 기술적 설명 (SQL 탭에서만 표시됨)",
  "chartType": "bar|line|pie|table",
  "chartConfig": {
    "labelColumn": "라벨컬럼alias",
    "dataColumns": ["데이터컬럼alias"],
    "title": "차트 제목"
  },
  "analysisRequired": false
}

[answer 작성 규칙 — 매우 중요!]
- answer는 일반 사용자(비개발자)가 바로 이해할 수 있는 친절한 답변이어야 합니다.
- SQL이나 컬럼명, 기술 용어를 절대 포함하지 마세요.
- 질문에 대한 핵심 결과를 자연스러운 한국어 문장으로 요약하세요.
- "당월", "전월", "이번달" 등 상대적 기간 표현 사용 시 반드시 실제 년월을 함께 표기하세요.
- 예시:
  - "__LATEST_LABEL__ 기준 브랜드별 판매수량을 내림차순으로 조회했습니다."
  - "전월(__PREV_LABEL__) 대비 당월(__LATEST_LABEL__) 매출 증가 1위는 OO제품입니다."
  - "__LATEST_LABEL__ 총매출은 약 152억원입니다."
- explanation은 개발자/분석가용 기술 설명으로, SQL 탭에서만 보입니다.

chartType 기준: bar(카테고리 비교), line(시계열), pie(비율), table(상세 데이터)
`;

/**
 * 동의어 직접 매칭 (DB 조회 기반)
/**
 * Metric 산식 → 최종 SQL 표현식 변환 (★ 비-재귀, 산식 그대로 사용)
 *
 * [정책 변경 — 2026-06-15]
 * 사용자가 학습관리에서 등록한 산식 문자열을 그대로 SQL에 적용한다.
 * 산식 안에 포함된 다른 metric_code(예: ZAMT047)는 또 다른 Metric으로 재해석하지 않고
 * DB 원시 컬럼으로만 취급한다. (재귀 확장 금지)
 *
 * - aggregation == 'CALC': formula 가 이미 SUM(...) 등을 포함한 완성된 SQL 표현식 →
 *     그대로 반환 (호출 측에서 필요 시 괄호로 감쌈)
 * - aggregation == 'SUM' (또는 기타): formula 가 단순 컬럼이거나 산술식이면 그대로 반환.
 *     호출 측에서 단일 컬럼인지 판단하여 SUM(col)로 감싸거나 (...) 처리 가능.
 *
 * 즉, 이 함수는 "산식 안의 다른 metric_code를 다시 풀어주지" 않는다.
 * "영업이익" 산식 안의 ZAMT047 은 다른 Metric으로 풀리지 않고 그대로 ZAMT047로 남는다.
 *
 * @param {string} formula - 학습관리에 등록된 원본 산식 문자열
 * @param {Object} _metricMap - (미사용 — API 호환을 위해 시그니처는 유지)
 * @param {Set<string>} _visited - (미사용)
 * @param {number} _depth - (미사용)
 * @returns {string} 등록된 산식 그대로 (재귀 확장 없음)
 */
function expandMetricFormula(formula, _metricMap, _visited = new Set(), _depth = 0) {
  if (!formula || typeof formula !== 'string') return formula || '';
  // ★ 재귀 확장 제거: 학습관리에 등록된 산식을 변형 없이 그대로 반환
  return formula;
}

/**
 * 산식이 직접 참조하는 metric_code 수집 (★ 비-재귀)
 *
 * [정책 변경 — 2026-06-15]
 * 산식 안의 토큰들은 더 이상 "다른 Metric"으로 풀리지 않고 raw DB 컬럼으로 취급되므로,
 * RAG에서 "Metric 대체 컬럼"으로 제외해야 할 대상은 **자기 자신의 metric_code 뿐**이다.
 * 산식 내부의 ZAMT### 같은 토큰은 raw 컬럼이므로 RAG 컨텍스트에서 정상적으로 노출되어야 한다.
 *
 * 따라서 이 함수는 더 이상 산식 내부를 재귀적으로 따라가지 않고 빈 Set을 반환한다.
 * (호출 측에서 자기 metric_code 는 별도로 add 한다.)
 *
 * @returns {Set<string>} 빈 Set
 */
function collectReferencedMetricCodes(_formula, _metricMap, _visited = new Set()) {
  // ★ 비-재귀화: 산식 내부의 토큰은 모두 raw DB 컬럼으로 간주 → 추가 수집하지 않음
  return new Set();
}

/**
 * 도메인별 전체 Metric 맵 로드
 * - matchSynonymsDirectly에서 재귀 확장 시 참조용
 * - { metric_code: { formula, aggregation, description } } 형태
 */
async function loadMetricMap(domainCode) {
  const dc = domainCode || 'PS';
  const map = {};
  try {
    const [rows] = await pool.query(
      `SELECT metric_code, aggregation, formula, description FROM metric WHERE domain_code = ?`, [dc]
    );
    for (const r of rows) {
      map[r.metric_code] = {
        formula: r.formula || '',
        aggregation: r.aggregation || 'SUM',
        description: r.description || '',
      };
    }
  } catch (e) {
    console.error('[Metric] loadMetricMap 실패:', e.message);
  }
  return map;
}

/**
 * 도메인별 Metric Dictionary 동적 생성 (DB metric 테이블 기반)
 *
 * [목적 — 2026-06-30 기능 개선]
 *   기존: server.mjs 에 하드코딩되어 있던 METRIC_DICTIONARY 상수가
 *         사용자가 학습관리에서 산식을 변경해도 옛 산식을 LLM 에 전달하여
 *         GPT 가 옛 산식과 새 산식 사이에서 혼동하는 사고가 발생했음.
 *   변경: DB metric 테이블의 최신 산식을 도메인별로 읽어와
 *         LLM 시스템 프롬프트에 동적으로 주입하는 사전 문자열을 만든다.
 *
 * 출력 형식 (LLM 호환성 유지 — 기존 METRIC_DICTIONARY 와 동일 포맷):
 *   계산 지표 사전 (Metric Dictionary):
 *   - {description} = {aggregation_applied_formula}
 *   ...
 *
 * 집계 함수 적용 규칙:
 *   - aggregation = 'CALC' → formula 그대로 (이미 SUM/CASE 등 포함된 산식)
 *   - aggregation = 'SUM'/'AVG'/'COUNT'/'MAX'/'MIN' → 산식이 이미 SUM 등 포함하면 그대로,
 *     없으면 해당 집계로 감싸기
 *   - 그 외 → formula 그대로
 *
 * @param {string} domainCode - 'PS'|'HL'|'MGMT' 등 (없으면 PS)
 * @returns {Promise<string>} LLM 프롬프트에 합칠 "계산 지표 사전" 문자열
 *   (등록된 metric 이 0건이면 빈 문자열 반환 — 프롬프트에 빈 헤더 안 들어감)
 */
async function buildMetricDictionaryFromDB(domainCode) {
  const dc = domainCode || 'PS';
  try {
    const [rows] = await pool.query(
      `SELECT metric_code, aggregation, formula, description
       FROM metric
       WHERE domain_code = ? AND formula IS NOT NULL AND formula != ''
       ORDER BY metric_code`,
      [dc]
    );
    if (!rows || rows.length === 0) return '';

    const lines = ['계산 지표 사전 (Metric Dictionary — DB metric 테이블 기반, 도메인=' + dc + '):'];
    for (const r of rows) {
      const desc = (r.description || r.metric_code).split(',')[0].trim();
      const formula = (r.formula || '').trim();
      if (!desc || !formula) continue;
      const agg = (r.aggregation || '').toUpperCase();
      const hasAggInside = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(formula);

      let sqlExpr;
      if (agg === 'CALC' || hasAggInside) {
        sqlExpr = formula;
      } else if (agg === 'SUM' || agg === 'AVG' || agg === 'COUNT' || agg === 'MAX' || agg === 'MIN') {
        sqlExpr = `${agg}(${formula})`;
      } else {
        sqlExpr = formula;
      }
      lines.push(`- ${desc} (${r.metric_code}) = ${sqlExpr}`);
    }
    if (lines.length === 1) return '';   // 헤더만 있고 항목 0건이면 빈 문자열
    return lines.join('\n') + '\n';
  } catch (e) {
    console.error('[Metric] buildMetricDictionaryFromDB 실패:', e.message);
    return '';
  }
}

/**
 * 동의어 직접 매칭 (RAG 보완)
 * - RAG 임베딩 유사도 검색의 한계 보완
 * - 사용자 질문에 포함된 동의어를 DB에서 직접 찾아 컬럼 매핑 정보 반환
 * - ★ 도메인별 분리: 선택된 도메인의 Ontology/Metric만 참조 (PS/HL/MGMT 혼용 금지)
 * - ★ 우선순위: Ontology 정확매칭 > Metric 정확매칭 > 컬럼/지표명 직접매칭 > 설명 매칭
 * @param {string} query - 사용자 질문
 * @param {string} domainCode - 현재 선택된 도메인 코드 (PS/HL/MGMT)
 * @returns {Promise<Array<{synonym: string, column_name: string, description: string, data_type: string, source: string}>>}
 */

/**
 * 사용자가 명시적으로 "관련 지표 확장"을 요청했는지 감지
 * - "매출 관련 지표 전체", "수익성 분석", "매출/원가/이익" 같은 패턴 감지
 * - true 인 경우에만 description 부분매칭(3-B) 으로 후보 컬럼을 확장
 * - false 면 동의어 정확매칭으로 찾은 컬럼만 사용 (불필요한 컬럼 폭주 방지)
 *
 * 정책:
 *   ① 일반 질의 "SKU별 매출 TOP5" → false (정확매칭 컬럼만)
 *   ② "매출 관련 지표 전체", "매출 관련", "관련 지표" → true
 *   ③ "수익성 분석", "수익성 진단" → true
 *   ④ "매출/원가/이익", "매출과 원가" 같이 슬래시/콤마/그리고로 명시 나열 → true
 *   ⑤ 분석형 키워드(분석/요약/시사점/인사이트)는 그 자체로는 확장 트리거 아님
 *      (단, "수익성 분석" 처럼 도메인 전체 키워드와 결합되면 true)
 */
function detectExpansionIntent(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.replace(/\s+/g, '');

  // 1) 명시적 "관련 지표 / 전체 지표" 요청
  const explicitMulti = [
    '관련지표', '관련항목', '연관지표', '관련된지표', '관련된항목',
    '전체지표', '모든지표', '주요지표', '핵심지표',
    '지표전체', '지표모두', '지표일체',
  ];
  if (explicitMulti.some(kw => q.includes(kw))) return true;

  // 2) 도메인 분석 키워드 (수익성 분석, 손익 분석 등)
  const domainAnalysis = [
    '수익성분석', '수익성진단', '수익성평가',
    '손익분석', '손익진단', '손익평가',
    '원가분석', '원가구조', '비용분석',
  ];
  if (domainAnalysis.some(kw => q.includes(kw))) return true;

  // 3) 슬래시/콤마/그리고로 명시 나열된 다중 지표 요청
  //    예: "매출/원가/이익", "매출, 원가, 이익", "매출과 원가와 이익"
  //    단, "TOP5"의 콤마 같은 noise 방지를 위해 한글 명사 패턴만 검사
  if (/[가-힣]{1,8}\/[가-힣]{1,8}/.test(query)) return true;  // 슬래시 나열
  // "A와 B와 C" 또는 "A과 B과 C" 패턴 (한글 명사 2개 이상 연결)
  if (/[가-힣]+(과|와)\s*[가-힣]+(과|와)\s*[가-힣]+/.test(query)) return true;

  // 4) "같이 보여줘", "함께 조회", "한꺼번에" 같은 명시적 다중 노출 표현
  const togetherExpr = ['같이보여', '함께보여', '함께조회', '같이조회', '한꺼번에', '동시에보여'];
  if (togetherExpr.some(kw => q.includes(kw))) return true;

  return false;
}

async function matchSynonymsDirectly(query, domainCode) {
  const matched = [];
  let filtered = [];
  const dc = domainCode || 'PS';
  // ★ 도메인 전체 Metric 맵 로드 (재귀 확장용)
  const metricMap = await loadMetricMap(dc);
  const queryUpper = query.toUpperCase();

  // ★★★ [원가/비용 그룹 라우팅 가드] ★★★
  //   사용자가 "원가 항목/원가항목/원가 중/원가에서/원가 관련/원가성/원가별/원가와/원가는..."
  //   같은 포괄 표현으로 질문한 경우, "원가" 그룹의 모든 컬럼을 대상으로 UNION ALL SUM 해야 함.
  //   → 이 경우 "매출원가/상품원가/제조원가" 같은 특정 지표성 동의어가 잘못 매칭되면 안 됨.
  //
  //   [정책]
  //   - typeDetection.isGroupQuery === true 이고 matchedText 가 순수 "원가"/"비용" (또는 공백 포함) 이면
  //     → matched synonym 이 그 span 안에 포함되면 스킵.
  //   - 그러나 사용자가 "매출원가" 라고 명시적으로 쓴 경우 (matchedText 는 여전히 "원가" 부분이지만
  //     동의어 "매출원가" 는 typeSpan 밖에서 시작함) → 매칭 유지.
  //   - 즉, 동의어 매칭 span 이 typeSpan 에 완전 포함될 때만 스킵.
  const typeDetection = _detectTypesInQuery(query);
  const typeSpans = typeDetection.isGroupQuery ? (typeDetection.matchedSpans || []) : [];
  if (typeSpans.length > 0) {
    console.log(`[Synonym Guard] 원가/비용 포괄 표현 감지: [${typeSpans.map(s => s.matchedText).join(', ')}] → 이 span 안의 짧은 동의어 매칭은 스킵`);
  }
  // 동의어 매칭 span 이 typeSpan 안에 완전 포함되는지 검사
  //   syn 예: "원가" 동의어가 있고, query = "원가 항목 중..." → typeSpan = "원가 항목"(0-6)
  //           동의어 매칭 "원가"(0-2) 는 typeSpan 안 → 스킵.
  //           동의어 "매출원가"(0-4) 는 query 에 없음 → 스킵 대상 아님.
  //   syn 예: query = "매출원가와 원가 항목 둘 다" → typeSpan = "원가 항목"(6-11)
  //           동의어 "매출원가"(0-4) 는 typeSpan 밖 → 유지.
  //           동의어 "원가"(query 에 두 번 등장) 중 span (6-8) 은 typeSpan 안 → 스킵,
  //             but (2-4) 는 typeSpan 밖 → 유지 (사용자 의도상 "매출원가"는 특정 지표).
  //   그런데 짧은 동의어 "원가" 가 매출원가 안의 "원가"(2-4)를 매칭시키면 그것도 잘못이므로,
  //   이 짧은 동의어 매칭은 typeSpan 밖에서만 유지되도록 하면 됨 (기존 longest-match-wins 정책이
  //   "매출원가" 동의어가 있다면 "원가" 를 스킵하지만, "매출원가" 동의어가 등록돼있지 않을 수도 있음).
  const isInsideTypeSpan = (qStart, qEnd) => {
    return typeSpans.some(ts => ts.start <= qStart && qEnd <= ts.end);
  };

  try {
    // =========================================================
    // 1단계: Ontology 동의어 정확 매칭 (최우선순위, domain_code 필터)
    // =========================================================
    const [ontSyns] = await pool.query(
      `SELECT s.synonym_text, c.column_name, c.description, c.data_type
       FROM ontology_synonym s
       JOIN ontology_column c ON s.column_id = c.id
       WHERE c.domain_code = ? AND c.is_active = 1`, [dc]
    );
    // ★ 사용자 질문에서 매칭된 동의어 키워드 추적 (다른 컬럼의 description 매칭에 활용)
    //   예: "소모품비" 키워드로 ZAMT049 동의어 매칭 → "소모품비"를 키워드로 기록
    //   → 3단계에서 ZAMT019의 description "수선/소모품비"에 "소모품비"가 포함되면 같은 그룹으로 매칭
    //
    // ★★★ 2026-06 Longest-Match Wins (PR #140) ★★★
    // - 사용자 질의 "SKU별 총매출 TOP5" 에서 "총매출"(ZAMT001) 과 "매출"(ZAMT003) 두 동의어가 모두
    //   query.includes(...) 로 매칭되면 의도(ZAMT001만)와 다르게 ZAMT003 도 끌려옴.
    // - 정책: 더 긴 동의어가 매칭된 위치에 포함된 짧은 동의어 매칭은 제거 (longest match wins).
    //   단, 두 동의어의 occurrence position 이 겹치지 않으면 둘 다 유효 (사용자가 두 단어를 모두 사용한 의도).
    const matchedKeywords = new Set();
    const ontMatchCandidates = [];  // {row, lcStart, lcEnd, qStart, qEnd, matchedText, useUpper}
    for (const row of ontSyns) {
      const syn = row.synonym_text;
      if (!syn) continue;
      let qStart = -1, useUpper = false, matchedText = syn;
      if (query.includes(syn)) {
        qStart = query.indexOf(syn);
        matchedText = syn;
      } else if (queryUpper.includes(syn.toUpperCase())) {
        qStart = queryUpper.indexOf(syn.toUpperCase());
        useUpper = true;
        matchedText = query.substring(qStart, qStart + syn.length);
      }
      if (qStart < 0) continue;
      ontMatchCandidates.push({
        row,
        qStart,
        qEnd: qStart + syn.length,
        synLen: syn.length,
        matchedText,
        useUpper,
      });
    }
    // 길이 내림차순 정렬 → 긴 매칭을 먼저 채택
    ontMatchCandidates.sort((a, b) => b.synLen - a.synLen);
    const claimedSpans = [];  // [qStart, qEnd] 점유 구간 목록
    for (const cand of ontMatchCandidates) {
      // 이미 더 긴 동의어가 점유한 구간 안에 완전히 포함되면 스킵
      const contained = claimedSpans.some(([s, e]) => s <= cand.qStart && cand.qEnd <= e);
      if (contained) {
        console.log(`[Synonym] longest-match-wins: "${cand.row.synonym_text}"→${cand.row.column_name} 스킵 (더 긴 동의어에 포함됨)`);
        continue;
      }
      // ★ 원가/비용 그룹 라우팅 가드: typeSpan 안에 완전 포함된 동의어 매칭은 스킵
      //   예: query="원가 항목 중..." 에서 typeSpan="원가 항목"(0-6),
      //       동의어 "원가"(qStart=0, qEnd=2) → typeSpan 안 → 스킵 (그룹 조회로 처리됨)
      //   예: query="매출원가 알려줘" 에서 typeSpans=[] → 이 가드 스킵 없음, 정상 매칭
      //   예: query="매출원가와 원가 항목" 에서 typeSpan="원가 항목"(6-11),
      //       동의어 "원가" 는 qStart=2(매출원가 안) → typeSpan 밖 → 유지
      //       (단, "매출원가" 동의어가 있다면 longest-match-wins 로 이미 우선 매칭됨)
      if (isInsideTypeSpan(cand.qStart, cand.qEnd)) {
        console.log(`[Synonym Guard] typeSpan-inside: "${cand.row.synonym_text}"→${cand.row.column_name} 스킵 (원가/비용 그룹 라우팅)`);
        continue;
      }
      claimedSpans.push([cand.qStart, cand.qEnd]);
      matched.push({
        synonym: cand.row.synonym_text,
        matchedKeyword: cand.row.synonym_text,
        column_name: cand.row.column_name,
        description: cand.row.description || '',
        data_type: cand.row.data_type || '',
        source: 'ontology',
        priority: 3,
      });
      matchedKeywords.add(cand.row.synonym_text);
    }

    // =========================================================
    // 2단계: Metric 동의어 정확 매칭 (domain_code 필터)
    //   ★ longest-match-wins: 더 긴 동의어가 점유한 구간에 포함되는 짧은 동의어는 제외
    //     Ontology 1단계에서 이미 점유한 구간도 같이 고려.
    // =========================================================
    const [metSyns] = await pool.query(
      `SELECT s.synonym_text, m.metric_code, m.aggregation, m.formula, m.description
       FROM metric_synonym s
       JOIN metric m ON s.metric_id = m.id
       WHERE m.domain_code = ?`, [dc]
    );
    // 2단계 longest-match-wins 적용 (Ontology 1단계 점유 구간과 통합)
    const metMatchCandidates = [];
    for (const row of metSyns) {
      const syn = row.synonym_text;
      if (!syn) continue;
      let qStart = -1;
      if (query.includes(syn)) qStart = query.indexOf(syn);
      else if (queryUpper.includes(syn.toUpperCase())) qStart = queryUpper.indexOf(syn.toUpperCase());
      if (qStart < 0) continue;
      metMatchCandidates.push({ row, qStart, qEnd: qStart + syn.length, synLen: syn.length });
    }
    metMatchCandidates.sort((a, b) => b.synLen - a.synLen);
    for (const cand of metMatchCandidates) {
      const row = cand.row;
      // 같은 또는 더 긴 동의어가 이미 점유한 구간인지 검사
      // (Ontology 1단계 claimedSpans 와 통합)
      const contained = claimedSpans.some(([s, e]) => s <= cand.qStart && cand.qEnd <= e);
      const sameSpan = claimedSpans.some(([s, e]) => s === cand.qStart && e === cand.qEnd);
      // Metric 우선 정책: 동일 구간(sameSpan)이면 Metric 도 채택 — Ontology 는 5단계에서 제거됨
      // 그러나 strict contained(짧은 동의어가 더 긴 동의어에 포함) 인 경우는 스킵
      if (contained && !sameSpan) {
        console.log(`[Metric] longest-match-wins: "${row.synonym_text}"→${row.metric_code} 스킵 (더 긴 동의어에 포함됨)`);
        continue;
      }
      // ★ 원가/비용 그룹 라우팅 가드 (Ontology 1단계와 동일 로직)
      if (isInsideTypeSpan(cand.qStart, cand.qEnd)) {
        console.log(`[Metric Guard] typeSpan-inside: "${row.synonym_text}"→${row.metric_code} 스킵 (원가/비용 그룹 라우팅)`);
        continue;
      }
      if (!sameSpan) claimedSpans.push([cand.qStart, cand.qEnd]);

      // ★ 산식 내 다른 metric_code 참조를 재귀적으로 확장
      const expandedFormula = expandMetricFormula(
        row.formula,
        metricMap,
        new Set([row.metric_code]),
        0
      );
      if (expandedFormula !== row.formula) {
        console.log(`[Metric] 산식 재귀 확장: ${row.metric_code} "${row.formula}" → "${expandedFormula}"`);
      }
      let columnName;
      const aggUpper = (row.aggregation || '').toUpperCase();
      const hasSumInside = /\bSUM\s*\(/i.test(expandedFormula);
      if (aggUpper === 'CALC' || hasSumInside) {
        columnName = `CALC(${expandedFormula})`;
      } else {
        columnName = `SUM(${expandedFormula})`;
      }
      const referencedCodes = collectReferencedMetricCodes(row.formula, metricMap, new Set([row.metric_code]));
      referencedCodes.add(row.metric_code);
      matched.push({
        synonym: row.synonym_text,
        matchedKeyword: row.synonym_text,
        column_name: columnName,
        description: row.description || row.metric_code,
        data_type: 'metric',
        source: 'metric',
        priority: 1,
        metric_code: row.metric_code,
        referenced_codes: [...referencedCodes],
      });
    }

    // =========================================================
    // 3단계: Ontology 컬럼 설명(description) 매칭 (domain_code 필터)
    //   3-A. description 전체가 질문에 포함되는 경우 (기존 로직)
    //   3-B. ★ 1단계에서 매칭된 동의어 키워드가 다른 컬럼의 description에도 포함되는 경우
    //        예: "소모품비"가 ZAMT049 동의어로 매칭 → ZAMT019 description "수선/소모품비"에도 포함
    //        → 두 컬럼을 동일 키워드 그룹으로 묶어 모두 SELECT에 포함
    //
    //   ★★★ 2026-06 정확매칭 우선 정책 (PR #140) ★★★
    //   - 3-B 는 짧고 보편적인 키워드(예: "매출")가 description 부분일치로
    //     9개 이상의 컬럼을 끌어들이는 폭주 현상을 일으킴.
    //   - 따라서 다음 두 조건 중 하나일 때만 3-B 를 활성화:
    //     ① 사용자가 명시적 확장 의도를 표현한 경우 (detectExpansionIntent === true)
    //     ② 동의어 키워드가 정확매칭으로 끌어들인 컬럼이 1건도 없는 경우
    //        (즉, "매출" 동의어가 정확매칭으로 ZAMT003 을 이미 잡았으면 3-B 스킵)
    //   - 또한 description 의 keyword 위치/경계 조건을 강화 (단순 includes 가 아닌
    //     "다른 한글 토큰으로 둘러싸인 채 등장" 의 정상 형태소 매칭에 가깝게).
    // =========================================================
    const expansionIntent = detectExpansionIntent(query);
    // 이미 정확매칭(1단계 또는 2단계)된 키워드 집합
    const exactMatchedKeywords = new Set(matchedKeywords);

    const [ontCols] = await pool.query(
      `SELECT column_name, description, data_type FROM ontology_column WHERE description IS NOT NULL AND description != '' AND domain_code = ? AND is_active = 1`, [dc]
    );
    for (const row of ontCols) {
      // 3-A: description 전체가 질문에 포함
      if (row.description.length >= 2 && (query.includes(row.description) || queryUpper.includes(row.description.toUpperCase()))) {
        if (!matched.some(m => m.column_name === row.column_name)) {
          matched.push({
            synonym: row.description,
            matchedKeyword: row.description,
            column_name: row.column_name,
            description: row.description,
            data_type: row.data_type || '',
            source: 'ontology_desc',
            priority: 4,  // Ontology 설명 매칭 (가장 낮음)
          });
        }
        continue;  // 이미 매칭됐으면 3-B 검사 불필요
      }
      // 3-B: 1단계에서 매칭된 동의어 키워드가 이 컬럼의 description에 부분 포함되는지 검사
      //   → ★ 사용자가 명시적 확장 의도를 표현한 경우에만 활성화
      //   → ★ 그렇지 않으면 정확매칭 키워드로 description 부분매칭 스킵
      if (!matched.some(m => m.column_name === row.column_name)) {
        for (const kw of matchedKeywords) {
          if (kw.length < 2) continue;
          if (!row.description.includes(kw)) continue;

          // ── 게이트 1: 사용자가 명시적 확장 의도(전체/관련/수익성분석/슬래시나열)를 표시했는가?
          //             아니라면, 이 키워드가 이미 정확매칭으로 컬럼을 잡았다면 3-B 폭주 방지
          if (!expansionIntent && exactMatchedKeywords.has(kw)) {
            // 정확매칭이 있는 키워드는 description 부분매칭을 스킵
            // (예: "매출"이 ZAMT003 동의어로 정확매칭됨 → "총매출", "매출원가" 등 description 부분포함 컬럼 무시)
            continue;
          }

          // ── 게이트 2: description 이 keyword 정확매칭 (description == kw) 인 경우만 허용
          //             ※ 이미 3-A 에서 처리됨. 여기서는 부분포함이지만 expansionIntent 가 true 인 경우만 진입
          //             → 즉, 게이트 1을 통과한 경우 (확장 의도가 true 이거나 키워드가 정확매칭 안 된 경우) 만 추가

          matched.push({
            synonym: row.description,
            matchedKeyword: kw,  // ★ 같은 키워드로 매칭 → 동일 그룹화
            column_name: row.column_name,
            description: row.description,
            data_type: row.data_type || '',
            source: 'ontology_desc_partial',
            priority: 4,
          });
          console.log(`[Synonym] description 부분매칭: "${kw}" → ${row.column_name} (description: "${row.description}", expansionIntent=${expansionIntent})`);
          break;  // 한 키워드로 매칭되면 더 검사 안 함
        }
      }
    }
    if (matchedKeywords.size > 0 && !expansionIntent) {
      console.log(`[Synonym] 정확매칭 우선 모드: 정확매칭 키워드 [${[...matchedKeywords].join(', ')}] 로는 description 부분매칭(3-B) 스킵 — 명시적 확장 키워드("전체"/"관련 지표"/"수익성 분석"/"A/B/C") 없음`);
    } else if (expansionIntent) {
      console.log(`[Synonym] 확장 의도 감지: description 부분매칭(3-B) 활성화`);
    }

    // =========================================================
    // 4단계: Metric 설명(description) 매칭 (domain_code 필터)
    //   예: "마케팅비" → metric.description = "마케팅비합계" → MARKETING_COST
    // =========================================================
    const [metDescs] = await pool.query(
      `SELECT metric_code, aggregation, formula, description FROM metric WHERE domain_code = ? AND description IS NOT NULL AND description != ''`, [dc]
    );
    for (const row of metDescs) {
      // metric.description이 질문에 포함되었거나, 질문이 description을 포함하면 매칭
      const desc = row.description;
      if (desc.length >= 2 && (query.includes(desc) || queryUpper.includes(desc.toUpperCase()))) {
        if (!matched.some(m => m.source === 'metric' && m.description === desc)) {
          // ★ 산식 내 다른 metric_code 참조를 재귀적으로 확장
          const expandedFormula = expandMetricFormula(
            row.formula,
            metricMap,
            new Set([row.metric_code]),  // 자기 자신 즉시 재참조 방지
            0
          );
          if (expandedFormula !== row.formula) {
            console.log(`[Metric] 산식 재귀 확장(desc): ${row.metric_code} "${row.formula}" → "${expandedFormula}"`);
          }
          let columnName;
          const aggUpper = (row.aggregation || '').toUpperCase();
          const hasSumInside = /\bSUM\s*\(/i.test(expandedFormula);
          if (aggUpper === 'CALC' || hasSumInside) {
            columnName = `CALC(${expandedFormula})`;
          } else {
            columnName = `SUM(${expandedFormula})`;
          }
          // ★ 산식에 참여한 모든 metric_code 수집
          const referencedCodes = collectReferencedMetricCodes(row.formula, metricMap, new Set([row.metric_code]));
          referencedCodes.add(row.metric_code);
          matched.push({
            synonym: desc,
            matchedKeyword: desc,
            column_name: columnName,
            description: desc,
            data_type: 'metric',
            source: 'metric_desc',
            priority: 2,  // Metric 설명 매칭 (Metric 동의어 다음)
            metric_code: row.metric_code,
            referenced_codes: [...referencedCodes],
          });
        }
      }
    }

    // =========================================================
    // 5단계: 충돌 해결 — Metric 매칭이 있으면 같은 단어의 Ontology 매칭 제거
    //   정책: Metric > Ontology (사용자 정의 산식 우선)
    //   - 사용자가 자연어로 지표명을 질의했을 때, 해당 지표가 Metric에 등록되어 있으면
    //     반드시 Metric 산식을 사용해야 함 (Ontology 단일 컬럼으로 대체 금지)
    //   - Metric에 해당 지표가 없는 경우에만 Ontology 컬럼 매칭 사용
    // =========================================================
    const metricSynonyms = new Set(
      matched.filter(m => m.source === 'metric' || m.source === 'metric_desc')
             .map(m => (m.matchedKeyword || m.synonym).toUpperCase())
    );
    filtered = matched.filter(m => {
      // Ontology 매칭인데 동일 단어가 Metric에서도 매칭된 경우 → Metric 우선, Ontology 제거
      if ((m.source === 'ontology' || m.source === 'ontology_desc' || m.source === 'ontology_desc_partial')
          && metricSynonyms.has((m.matchedKeyword || m.synonym).toUpperCase())) {
        console.log(`[Synonym] Metric 우선: "${m.matchedKeyword || m.synonym}" ontology(${m.column_name}) 제거 → Metric 산식 사용`);
        return false;
      }
      return true;
    });

    // 우선순위 정렬: Metric 동의어(1) > Metric 설명(2) > Ontology 동의어(3) > Ontology 설명(4)
    filtered.sort((a, b) => (a.priority || 99) - (b.priority || 99));

    if (filtered.length > 0) {
      console.log(`[Synonym] 직접 매칭 ${filtered.length}건 (도메인: ${dc}): ${filtered.map(m => `"${m.synonym}"→${m.column_name} [${m.source}]`).join(', ')}`);
    }
  } catch (e) {
    console.error('[Synonym] 직접 매칭 실패:', e.message);
  }
  return filtered;
}

/**
 * RAG 기반 시스템 프롬프트 생성
 * - 질문과 관련된 메타데이터만 검색하여 프롬프트에 주입
 * - 전체 덤프(프롬프트 스터핑) 대신 필요한 컨텍스트만 포함
 * - 동의어 직접 매칭 결과를 최우선으로 주입
 * @param {string} query - 사용자 질문
 * @returns {Promise<{prompt: string, ragContext: Object}>}
 */
async function buildRAGSystemPrompt(query, domainCode) {
  let ragContext = null;
  let contextText = '';

  // ★ 동의어 직접 매칭 (RAG 보완 - 최우선 적용, domain 기반)
  const synonymMatches = await matchSynonymsDirectly(query, domainCode);
  let synonymContext = '';
  if (synonymMatches.length > 0) {
    // Metric 산식 매칭과 Ontology 컬럼 매칭 분리
    //   ★ ontology_desc_partial: 사용자 키워드가 다른 컬럼의 description에 부분 포함된 매칭
    //     (예: "소모품비"로 ZAMT049 동의어 매칭 + ZAMT019 description "수선/소모품비"에 포함)
    const metricMatches = synonymMatches.filter(m => m.source === 'metric' || m.source === 'metric_desc');
    const columnMatches = synonymMatches.filter(m => m.source === 'ontology' || m.source === 'ontology_desc' || m.source === 'ontology_desc_partial');
    
    synonymContext = '\n[★ 동의어 매칭 결과 - 최우선 적용! 아래 매핑을 반드시 SQL에 사용하세요]\n';
    
    if (metricMatches.length > 0) {
      synonymContext += '\n🚨🚨🚨 [Metric 산식 — 아래 산식을 SQL에 그대로(괄호 포함) 사용! 단순 컬럼이나 다른 형태로 변형 절대 금지!] 🚨🚨🚨\n';
      // 산식에 참여한 모든 metric_code 수집 (LLM에게 단순 컬럼 사용 금지 안내용)
      const allRefCodes = new Set();
      for (const m of metricMatches) {
        if (Array.isArray(m.referenced_codes)) {
          for (const c of m.referenced_codes) allRefCodes.add(c);
        }
      }
      // ★ [2026-06-30] row-level / column-level 산식 판별 + wrap 가이드
      //   - row-level: 산식 안에 SUM/AVG/COUNT/MAX/MIN 가 전혀 없음 → 전체를 SUM(...)으로 감싸야 함
      //   - column-level: 산식 안에 이미 집계 함수 포함 → 그대로 사용 (중첩 금지)
      let hasRowLevelMetric = false;
      let hasColumnLevelMetric = false;
      for (const m of metricMatches) {
        // column_name이 "CALC(...)" 또는 "SUM(...)" 형태이므로 괄호 내부만 추출하여 LLM에게 권장
        const formulaMatch = m.column_name.match(/^(\w+)\((.+)\)$/);
        const innerFormula = formulaMatch ? formulaMatch[2] : m.column_name;
        const aggInside = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(innerFormula);
        const isRowLevel = !aggInside;
        if (isRowLevel) hasRowLevelMetric = true; else hasColumnLevelMetric = true;
        // 권장 SQL 표현식: row-level이면 SUM(전체)로 감싸고, column-level이면 그대로
        const sqlExpr = isRowLevel ? `SUM(${innerFormula})` : innerFormula;
        synonymContext += `- "${m.synonym}" (metric_code: ${m.metric_code || '?'}) [${isRowLevel ? 'row-level' : 'column-level'}]\n`;
        synonymContext += `  ▶ 원본 산식 (학습관리 등록값): ${innerFormula}\n`;
        synonymContext += `  ▶ 반드시 사용할 SQL 표현식: ${sqlExpr}\n`;
        if (isRowLevel) {
          synonymContext += `  ▶ 조건부 합계가 필요하면: SUM(CASE WHEN <조건> THEN ${innerFormula} ELSE 0 END)\n`;
        }
        synonymContext += `  ▶ ORDER BY, HAVING 등에도 동일하게 위 SQL 표현식을 그대로 복사해 사용하세요 (FORMAT() 금지 — 규칙 5).\n`;
      }
      if (allRefCodes.size > 0) {
        synonymContext += `\n⛔ 절대 사용 금지 컬럼 (위 산식의 구성 요소 또는 매칭된 metric_code):\n`;
        synonymContext += `   ${[...allRefCodes].join(', ')}\n`;
        synonymContext += `   → 이 코드들을 SUM(코드) 또는 SUM(코드)±SUM(코드) 형태로 단순 합산하면 안 됩니다.\n`;
        synonymContext += `   → 반드시 위에 제시된 SQL 표현식 전체를 그대로 SELECT 절에 넣으세요.\n`;
      }
      if (hasRowLevelMetric) {
        synonymContext += `\n[row-level 산식 사용 예시 — 매우 중요!]\n`;
        synonymContext += `  원본 산식이 "ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)" 로 제공되면:\n`;
        synonymContext += `  ✓ 정답: SELECT SUM(ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008)) AS '매출총이익 합계(원)'   -- FORMAT() 없이 raw 숫자\n`;
        synonymContext += `         (산식 전체를 SUM() 한 번으로 감싸기)\n`;
        synonymContext += `  ✗ 금지: SUM(ZAMT001)-SUM(ZAMT002)+SUM(ZAMT004)-(SUM(ZAMT006)+SUM(ZAMT007)+SUM(ZAMT008))\n`;
        synonymContext += `         (컬럼마다 SUM()을 분배하면 안 됩니다! 산식 안에 새 컬럼이나 분기가 들어갈 수 있어 결과가 달라질 수 있습니다.)\n`;
        synonymContext += `  ✗ 금지: SUM(ZAMT035)  (학습관리에 row-level로 등록되어 있으므로 단독 컬럼 합산은 금지)\n`;
        synonymContext += `  ✗ 금지: ZAMT001-ZAMT002+...  (SUM 없이 그대로 노출하면 GROUP BY 없이는 단일 행이 안 됨)\n`;
        synonymContext += `  → 조건부가 필요하면: SUM(CASE WHEN DIVISION='20' THEN ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+ZAMT008) ELSE 0 END)\n`;
      }
      if (hasColumnLevelMetric) {
        synonymContext += `\n[column-level 산식 사용 예시]\n`;
        synonymContext += `  원본 산식이 이미 "SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100" 처럼 SUM()을 포함하면:\n`;
        synonymContext += `  ✓ 정답: 그대로 복사 → SELECT SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100 AS '영업이익률(%)'   -- FORMAT/ROUND 없이 raw 숫자, 프론트가 자릿수 처리\n`;
        synonymContext += `  ✗ 금지: 한 번 더 SUM() 감싸기 (중첩 집계 금지) — SUM(SUM(ZAMT055)/...) ✗\n`;
      }
    }
    if (columnMatches.length > 0) {
      synonymContext += '\n🔷 [Ontology 컬럼 매핑 — 이 단어들은 Metric이 아닌 Ontology 컬럼입니다!]\n';

      // ★ 동일 사용자 키워드(matchedKeyword)에 여러 컬럼이 매칭된 경우 그룹핑
      //   - matchedKeyword: 사용자가 질문에서 실제로 사용한 단어 (예: "소모품비", "지급수수료")
      //   - 케이스1: "지급수수료" → ZAMT040(지급수수료(변동)), ZAMT044(지급수수료(고정)) 동의어 매칭
      //   - 케이스2: "소모품비" → ZAMT049(소모품비) 동의어 + ZAMT019(수선/소모품비) description 부분 매칭
      //   AI가 어떤 컬럼을 골라야 할지 몰라 회피하는 문제 해결: "모두 SELECT에 포함" 지시
      const synonymGroups = new Map();
      for (const m of columnMatches) {
        const key = m.matchedKeyword || m.synonym;  // 호환성: matchedKeyword 없으면 synonym 사용
        if (!synonymGroups.has(key)) synonymGroups.set(key, []);
        synonymGroups.get(key).push(m);
      }
      // 그룹 내 중복 컬럼 제거 (동일 컬럼이 ontology + ontology_desc_partial 두 source로 들어올 수 있음)
      for (const [key, group] of synonymGroups) {
        const seen = new Set();
        const dedup = [];
        for (const m of group) {
          if (!seen.has(m.column_name)) {
            seen.add(m.column_name);
            dedup.push(m);
          }
        }
        synonymGroups.set(key, dedup);
      }

      for (const [keyword, group] of synonymGroups) {
        if (group.length === 1) {
          // 단일 매칭: 기존 방식
          const m = group[0];
          synonymContext += `- 사용자가 말한 "${keyword}" → 컬럼: ${m.column_name} (${m.data_type}) - ${m.description}\n`;
          synonymContext += `  🚫 "${keyword}"을(를) Metric 산식이나 금액 지표로 해석하지 마세요! 이것은 Ontology 컬럼(차원/분류)입니다.\n`;
        } else {
          // ★★★ 다중 매칭: 모든 컬럼을 SELECT에 포함 + 각각 description으로 별칭 ★★★
          const isAmountType = group.some(m => /int|decimal|numeric|float|double/i.test(m.data_type || ''));
          synonymContext += `\n🔥🔥🔥 [중요] 사용자 키워드 "${keyword}"는 ${group.length}개 컬럼에 매칭됨 — **반드시 모두 SELECT에 포함하세요!** 🔥🔥🔥\n`;
          for (const m of group) {
            const matchType = m.source === 'ontology_desc_partial' ? '설명 부분일치' : (m.source === 'ontology_desc' ? '설명 정확일치' : '동의어 등록');
            synonymContext += `  • ${m.column_name} (${m.data_type}) — 설명: ${m.description} [${matchType}]\n`;
          }
          if (isAmountType) {
            synonymContext += `  ▶ SELECT 절 작성 규칙 (금액 컬럼):\n`;
            for (const m of group) {
              const safeAlias = (m.description || m.column_name).replace(/"/g, '');
              synonymContext += `     SUM(${m.column_name}) AS '${safeAlias} 합계(원)'\n`;
            }
            synonymContext += `  ⚠️ 하나만 선택하거나, 합산해서 하나의 컬럼으로 묶지 마세요!\n`;
            synonymContext += `  ⚠️ 각 컬럼을 **개별 컬럼**으로 SELECT 절에 나열하고, 각각 위 description을 AS 별칭으로 그대로 사용하세요!\n`;
            synonymContext += `  ⚠️ AI가 임의로 "${keyword} 합계" 같은 통합 별칭을 만들지 말 것!\n`;
            synonymContext += `  ⚠️ 사용자가 입력한 "${keyword}"가 아니라 각 컬럼의 **설명(description)**을 별칭의 기준으로 사용!\n`;
          } else {
            synonymContext += `  ▶ SELECT 절에 위 컬럼들을 모두 포함하고, 각각 description을 AS 별칭으로 사용하세요.\n`;
          }
          synonymContext += `  🚫 "${keyword}"을(를) Metric 산식이나 단일 컬럼으로 해석하지 마세요!\n`;
        }
      }
    }
    synonymContext += '\n위 매핑된 컬럼/산식을 SQL의 SELECT, WHERE, GROUP BY 등에 반드시 사용하세요.\n';
    synonymContext += '🚨 Metric 산식이 있는 항목은 해당 산식을 SQL에 그대로 포함하세요. 단순 컬럼(예: ZAMT035)으로 대체하면 0원 결과가 나옵니다!\n';
    if (columnMatches.length > 0 && metricMatches.length === 0) {
      synonymContext += '⚠️ 이 질문에서는 Metric 산식이 매칭되지 않았습니다. Ontology 컬럼 기준의 GROUP BY/WHERE 조회를 수행하세요.\n';
    }
  }

  // ★ Metric 산식이 매칭된 컬럼 목록 수집 (RAG 컨텍스트에서 해당 단순 컬럼 제거용)
  //   matchSynonymsDirectly에서 이미 수집한 referenced_codes를 그대로 활용
  //   (예: ZAMT035 매칭 시 → ZAMT035, ZAMT003, ZAMT034, ZAMT026, ZAMT005 전부 차단)
  const metricReplacedColumns = new Set();
  for (const m of synonymMatches.filter(x => x.source === 'metric' || x.source === 'metric_desc')) {
    if (Array.isArray(m.referenced_codes)) {
      for (const c of m.referenced_codes) metricReplacedColumns.add(c);
    } else if (m.metric_code) {
      metricReplacedColumns.add(m.metric_code);
    }
  }
  if (metricReplacedColumns.size > 0) {
    console.log(`[RAG] Metric 산식 대체 컬럼 (RAG에서 제외): ${[...metricReplacedColumns].join(', ')}`);
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
        domainCode: domainCode,  // ★ RAG 검색 단계에서 도메인 필터링
      });
      // ★★★ 도메인 필터링: RAG 검색 결과에서 다른 도메인의 ontology/metric 제거
      if (ragContext.ontology) {
        const beforeOnt = ragContext.ontology.length;
        ragContext.ontology = ragContext.ontology.filter(s => {
          const chunkDomain = s.metadata?.domain_code;
          return !chunkDomain || chunkDomain === domainCode;
        });
        const afterOnt = ragContext.ontology.length;
        if (beforeOnt !== afterOnt) {
          console.log(`[RAG] 도메인 필터(ontology): ${beforeOnt} → ${afterOnt}개 (도메인: ${domainCode})`);
        }
      }
      if (ragContext.metric) {
        const beforeMet = ragContext.metric.length;
        ragContext.metric = ragContext.metric.filter(s => {
          const chunkDomain = s.metadata?.domain_code;
          return !chunkDomain || chunkDomain === domainCode;
        });
        const afterMet = ragContext.metric.length;
        if (beforeMet !== afterMet) {
          console.log(`[RAG] 도메인 필터(metric): ${beforeMet} → ${afterMet}개 (도메인: ${domainCode})`);
        }
      }

      // ★ Metric 산식이 있는 컬럼은 RAG 스키마에서 제거 (GPT가 단순 컬럼 선택하는 것 방지)
      if (metricReplacedColumns.size > 0 && ragContext.schema) {
        const before = ragContext.schema.length;
        ragContext.schema = ragContext.schema.filter(s => {
          const col = s.metadata?.column_name;
          return !col || !metricReplacedColumns.has(col);
        });
        if (ragContext.ontology) {
          ragContext.ontology = ragContext.ontology.filter(s => {
            const col = s.metadata?.column_name;
            return !col || !metricReplacedColumns.has(col);
          });
        }
        const after = ragContext.schema.length;
        if (before !== after) {
          console.log(`[RAG] Metric 대체 컬럼 필터링: schema ${before} → ${after}개`);
        }
      }
      contextText = ragResultToPromptContext(ragContext);
      console.log(`[RAG] 프롬프트 컨텍스트 길이: ${contextText.length}자`);
    } catch (e) {
      console.error('[RAG] 검색 실패, 폴백 프롬프트 사용:', e.message);
      contextText = await buildFallbackContext(domainCode);
    }
  } else {
    // RAG 미준비 시 폴백 (기존 방식과 동일하게 전체 로드)
    console.warn('[RAG] 인덱스 미준비, 폴백 프롬프트 사용');
    contextText = await buildFallbackContext(domainCode);
  }

  // ★★★ 도메인 컨텍스트 주입 — LLM이 현재 분석 도메인을 정확히 인지하도록
  //  ※ 내부 코드(MGMT) 유지 + 사용자 표시명(통합) 병기: 사용자가 어떤 표현을 써도 LLM 이 매핑 가능하도록.
  const _dispM = domainDisplayCode('MGMT');
  const domainNames = {
    PS: '생활용품사업부(PS)',
    HL: '홈앤라이프사업부(HL)',
    MGMT: `경영관리(${_dispM}, 내부코드=MGMT)`,
  };
  const domainCtx = `\n[★★★ 현재 분석 도메인: ${domainNames[domainCode] || domainCode} ★★★]
- 현재 선택된 도메인은 "${domainCode}" 입니다.
- 아래 제공된 동의어 매칭, RAG 컨텍스트, Ontology/Metric 정보는 모두 ${domainCode} 도메인 전용입니다.
- 다른 도메인(${Object.keys(domainNames).filter(d => d !== domainCode).join('/')})의 Ontology/Metric 정보를 사용하거나 참조하지 마세요.
- 동의어 매칭에서 특정 단어가 Ontology 컬럼으로 매핑된 경우, 해당 단어를 Metric 산식으로 재해석하지 마세요.
`;

  // RAG 모드에서는 검색된 메타데이터만 사용 (전체 스키마/메트릭 덤프 제거)
  // → GPT가 질문과 무관한 컬럼을 보고 불필요한 컬럼을 추가하는 문제 방지
  let prompt;
  if (ragReady && ragContext) {
    // RAG 활성: 기본 규칙 + 도메인 컨텍스트 + 동의어 매칭 + RAG 검색 컨텍스트
    prompt = BASE_SYSTEM_PROMPT
      + domainCtx
      + synonymContext
      + '\n\n--- RAG 검색 컨텍스트 (이 질문과 관련된 메타데이터만 포함됨) ---\n' + contextText;
  } else {
    // 폴백: 기존 방식 (전체 스키마 + 메트릭 + 폴백 컨텍스트)
    // [2026-06-30] METRIC_DICTIONARY 하드코딩 상수 제거 → DB metric 테이블에서 동적 생성
    //   학습관리에서 산식 수정 시 즉시 LLM 프롬프트에 반영되도록 함.
    const dynamicMetricDict = await buildMetricDictionaryFromDB(domainCode);
    prompt = BASE_SYSTEM_PROMPT + domainCtx + synonymContext + '\n' + TABLE_SCHEMA + '\n' + dynamicMetricDict
      + '\n\n--- 컨텍스트 ---\n' + contextText;
  }

  // ★ 당월/전월 날짜 컨텍스트 동적 주입 — 플레이스홀더를 실제 년월로 교체
  const dateCtx = await getDataDateContext();
  prompt = prompt
    .replace(/__LATEST_LABEL__/g, dateCtx.latestLabel)
    .replace(/__PREV_LABEL__/g, dateCtx.prevLabel)
    .replace(/__LATEST_MONTH__/g, dateCtx.latestMonth)
    .replace(/__PREV_MONTH__/g, dateCtx.prevMonth);

  return { prompt, ragContext, dateContext: dateCtx };
}

/**
 * RAG 미준비 시 폴백: 기존 프롬프트 스터핑 방식
 */
async function buildFallbackContext(domainCode) {
  const dc = domainCode || 'PS';
  let ctx = '';
  try {
    const [rows] = await pool.query(
      `SELECT column_name, column_name_nm, code_value, display_name
       FROM code_mapping WHERE is_active = 1 AND (domain_code = ? OR domain_code IS NULL) ORDER BY column_name, code_value`, [dc]
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
      `SELECT query_text, corrected_sql, feedback_type FROM sql_feedback WHERE is_active = 1 AND (domain_code = ? OR domain_code IS NULL) ORDER BY created_at DESC LIMIT 20`, [dc]
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
// Helper: SQL 후처리 (FORMAT 인자 누락 보정만 수행)
//
// ★★★ [2026-06-15 정책 — 사용자 요청] ★★★
// "치환되게 하지마! 내가 산식에 쓴 것만 그대로 sql쿼리로 표현해"
//
// - 이전: 등록된 모든 metric_code 에 대해 SQL 안의 SUM(metric_code) / 단독 토큰을
//         산식으로 치환했음.
// - 문제: 사용자가 "영업이익" 산식에 SUM(ZAMT047) 을 명시적으로 써 두었는데,
//         ZAMT047 도 별도 metric 으로 등록되어 있다 보니, 영업이익 SQL 안의
//         SUM(ZAMT047) 부분이 다시 ZAMT047 의 산식(SUM(ZAMT048)+...+SUM(ZAMT054))
//         으로 치환되어 들어가는 부작용 발생.
// - 정책: Metric 자동 치환을 전면 비활성화한다.
//         · LLM 프롬프트에는 matchSynonymsDirectly 가 이미 metric 산식을 전달함
//           (column_name = "CALC(<사용자 산식 그대로>)" 형태).
//         · 따라서 GPT 가 생성한 SQL 안에는 이미 사용자 산식이 그대로 들어가 있고,
//           이 단계에서 추가 치환을 하면 안 된다.
//         · 학습 데이터 경로(matchedSql) 도 사용자가 직접 작성/검증한 SQL 이므로
//           건드리지 않는다.
// - 남기는 후처리: FORMAT() 인자 누락 보정 (운영 안전장치).
// - 남기는 후처리: 율(%) 별칭에 FORMAT 미적용 시 자동 감싸기.
// ============================================================

/**
 * SQL 문자열 내에서 AS 별칭이 '(%)' 또는 '%'로 끝나는 ROUND(...) 표현식을
 * 자동으로 FORMAT(ROUND(...), N) 형태로 감싼다. (운영 안전장치)
 *
 * 처리 예:
 *   ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 1) AS '영업이익률(%)'
 *   → FORMAT(ROUND(SUM(A)/NULLIF(SUM(B),0)*100, 1), 1) AS '영업이익률(%)'
 *
 * 처리하지 않는 케이스:
 *   - 별칭이 (%) / % 로 끝나지 않는 표현식 (금액/수량 등)
 *   - 이미 FORMAT(...) 으로 감싼 경우
 *   - ROUND 가 아닌 표현식 (LLM 이 다른 형태를 쓴 경우는 그대로 둔다 — 리스크 최소화)
 */
function wrapPercentRoundWithFormat(sql) {
  if (!sql || typeof sql !== 'string') return sql;

  // 큰따옴표/작은따옴표/백틱을 지원하는 별칭 리터럴 정규식
  // AS 는 대소문자 무시, 공백 개수도 유연하게.
  // 별칭 마지막 문자가 %  또는 %) 로 끝나는지 검사.
  // 매치 대상: ROUND ... AS '별칭%'  (백트래킹 최소화를 위해 좁은 패턴)
  const percentAliasRe = /\bROUND\s*\(/gi;

  let out = '';
  let idx = 0;
  while (idx < sql.length) {
    percentAliasRe.lastIndex = idx;
    const m = percentAliasRe.exec(sql);
    if (!m) {
      out += sql.slice(idx);
      break;
    }

    const roundStart = m.index;
    const openParen = roundStart + m[0].length - 1; // '(' 위치
    // 괄호 매칭으로 ROUND(...) 의 닫는 괄호 위치 찾기
    let depth = 1;
    let p = openParen + 1;
    let inStr = null;
    while (p < sql.length && depth > 0) {
      const ch = sql[p];
      if (inStr) {
        if (ch === '\\') { p += 2; continue; }
        if (ch === inStr) inStr = null;
      } else if (ch === "'" || ch === '"' || ch === '`') {
        inStr = ch;
      } else if (ch === '(') depth++;
      else if (ch === ')') depth--;
      if (depth === 0) break;
      p++;
    }
    if (depth !== 0) {
      // 매칭 실패 (SQL 이 이상함) — 이 매치 스킵
      out += sql.slice(idx, roundStart + m[0].length);
      idx = roundStart + m[0].length;
      continue;
    }
    const roundEnd = p; // ')' 위치
    const roundExpr = sql.slice(roundStart, roundEnd + 1); // "ROUND(...)"
    const roundInner = sql.slice(openParen + 1, roundEnd); // ROUND 인자 내부

    // ROUND 인자에서 top-level 콤마로 소수 자릿수 추출
    let d2 = 0, hasComma = false, digits = '0';
    for (let i = 0; i < roundInner.length; i++) {
      const ch = roundInner[i];
      if (ch === '(') d2++;
      else if (ch === ')') d2--;
      else if (ch === ',' && d2 === 0) {
        hasComma = true;
        digits = roundInner.slice(i + 1).trim();
        break;
      }
    }
    if (!hasComma) digits = '0';
    // digits 가 순수 정수인지 확인 (아니면 안전하게 1 사용)
    if (!/^-?\d+$/.test(digits)) digits = '1';

    // 이 ROUND 다음에 오는 AS 별칭이 %/(%) 로 끝나는지 확인
    // 뒤이어 공백 + (AS)? + 공백 + 따옴표별칭  형태를 훑는다
    let tail = roundEnd + 1;
    // 공백 스킵
    while (tail < sql.length && /\s/.test(sql[tail])) tail++;
    // 'AS' 옵션
    if (tail + 1 < sql.length && sql.slice(tail, tail + 2).toUpperCase() === 'AS' && /\s/.test(sql[tail + 2] || '')) {
      tail += 2;
      while (tail < sql.length && /\s/.test(sql[tail])) tail++;
    }
    // 따옴표 별칭 (', ", `)
    const quoteCh = sql[tail];
    let isPercentAlias = false;
    let aliasEnd = -1;
    if (quoteCh === "'" || quoteCh === '"' || quoteCh === '`') {
      // 닫는 따옴표 찾기
      let q = tail + 1;
      while (q < sql.length) {
        if (sql[q] === '\\') { q += 2; continue; }
        if (sql[q] === quoteCh) { aliasEnd = q; break; }
        q++;
      }
      if (aliasEnd > 0) {
        const aliasBody = sql.slice(tail + 1, aliasEnd);
        // % 또는 (%) 로 끝나는가?
        if (/(%|\(%\))\s*$/.test(aliasBody)) isPercentAlias = true;
      }
    }

    // 이미 FORMAT( 으로 감싸져 있는지 확인 (ROUND 앞 문자열 검사)
    // ROUND 바로 앞에 "FORMAT(" 이 있으면 스킵 (이중 감싸기 방지)
    let before = roundStart - 1;
    while (before >= 0 && /\s/.test(sql[before])) before--;
    const alreadyWrapped = before >= 0 && sql[before] === '(' &&
      /FORMAT\s*$/i.test(sql.slice(Math.max(0, before - 8), before));

    if (isPercentAlias && !alreadyWrapped) {
      // 감싸기
      const wrapped = `FORMAT(${roundExpr}, ${digits})`;
      console.log(`[NLQ] 율(%) FORMAT 자동 감싸기: ${roundExpr.slice(0, 60)}... → FORMAT(..., ${digits})`);
      out += sql.slice(idx, roundStart) + wrapped;
      idx = roundEnd + 1;
    } else {
      // 그대로 두기 (다음 ROUND 매치 계속)
      out += sql.slice(idx, roundEnd + 1);
      idx = roundEnd + 1;
    }
  }
  return out;
}

async function applyMetricFormulaReplacement(inputSql, _domainCode) {
  if (!inputSql) return inputSql;
  try {
    let result = inputSql;

    // FORMAT() 인자 누락 같은 명백한 오류 SQL 사전 차단
    // 예: FORMAT(SUM(ZAMT035))  → 두 번째 인자 없음 → 운영에서 "Incorrect parameter count" 에러
    const badFormat = /\bFORMAT\s*\([^()]*\)/gi;
    result = result.replace(badFormat, (m) => {
      // 괄호 안의 콤마 개수가 0이면 인자 1개뿐 → 기본 자리수 0 추가
      const inner = m.slice(m.indexOf('(') + 1, m.lastIndexOf(')'));
      // 콤마가 괄호 밖에 있으면 인자 2개 이상으로 간주 (안전한 검사)
      let depth = 0, hasTopLevelComma = false;
      for (const ch of inner) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === 0) { hasTopLevelComma = true; break; }
      }
      if (!hasTopLevelComma) {
        console.log(`[NLQ] FORMAT() 인자 누락 보정: ${m} → FORMAT(${inner}, 0)`);
        return `FORMAT(${inner}, 0)`;
      }
      return m;
    });

    // ------------------------------------------------------------
    // 율(%) 별칭에 FORMAT 미적용 시 자동 보정 (안전장치)
    //   예) ROUND(SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100, 1) AS '영업이익률(%)'
    //       → FORMAT(ROUND(SUM(ZAMT055)/NULLIF(SUM(ZAMT003),0)*100, 1), 1) AS '영업이익률(%)'
    //   - AS 별칭이 '(%)' 또는 '%'로 끝나는 표현식만 대상.
    //   - 이미 FORMAT 으로 감싼 표현식은 건드리지 않음.
    //   - ROUND 의 소수 자릿수 인자를 그대로 FORMAT 의 두 번째 인자로 사용.
    // ------------------------------------------------------------
    result = wrapPercentRoundWithFormat(result);

    return result;
  } catch (e) {
    console.error('[NLQ] Metric 자동 치환 실패 (무시):', e.message);
    return inputSql;
  }
}

// ============================================================
// Helper: 도메인 자동 WHERE 조건 주입
// - PS 도메인 → AND DIVISION = '10'
// - HL 도메인 → AND DIVISION = '20'
// - MGMT/기타 → no-op (전체 조회)
// - 적용 대상: bw_profitability_data 테이블을 참조하는 SQL
// - 중복 방지: SQL 어딘가에 이미 DIVISION 비교 조건이 있으면 추가하지 않음
// ============================================================

// ============================================================
// Helper: 분석형 질문 사전 판별 (백엔드 1차 분류)
// - LLM 호출 전에 키워드로 빠르게 분석형 여부 판단
// - 분석형이면 SQL 생성 단계 자체를 건너뛰고 안전한 분석 전용 경로로 라우팅
// ============================================================
function isAnalysisQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.replace(/\s+/g, '');
  // 분석/요약/시사점/인사이트/해석/평가/제언/추천/원인/이유/의미/트렌드 등
  const analysisKeywords = [
    '분석', '인사이트', '시사점', '요약해', '요약', '해석', '평가', '제언', '추천',
    '왜', '원인', '이유', '의미', '트렌드', '개선', '비교분석', '리포트', '보고서',
    '코멘트', '진단', '평가해', '설명해줘', '알려줘', '말해줘',
  ];
  return analysisKeywords.some(kw => q.includes(kw));
}

// ============================================================
// Helper: 분석질문 모드에서 사용자 질문 의도 분류
// - concept: 개념/용어 설명 요청 (예: "SKU가 뭐야?", "KPI란?") → DB 조회 없이 정의만
// - data_analysis: 특정 데이터 조회/분석 요청 (예: "지급수수료 분석해줘", "SKU별 매출 TOP5")
// - interpretation: 원인/시사점/해석/제언 요청 (예: "왜 낮아졌어?", "전월대비 분석")
// 1차: 휴리스틱(빠름) → 분류 실패 시 LLM 폴백
// ============================================================
function classifyAnalysisIntentHeuristic(query) {
  if (!query || typeof query !== 'string') return null;
  const q = query.replace(/\s+/g, '');

  // 1) 개념 질문 패턴 — "X가 뭐야/뭔가/무엇/의미/정의/란?"
  //    단, "X가 뭐길래 그렇게 낮아?" 같은 해석성은 제외 (뒤에 원인성 키워드 있으면 제외)
  const conceptPatterns = [
    /(이|가|은|는)?\s*(뭐|뭐야|뭔가요|뭔지|무엇|무엇인가|무엇인지|무슨\s*뜻|어떤\s*뜻|어떤\s*의미)\?*$/,
    /(이|가|은|는)?\s*뭐(예|에)요\?*$/,
    /란\s*\?*$/,
    /이란\s*(무엇|뭐|어떤)/,
    /의\s*(정의|개념|의미|뜻)/,
    /^(.+?)(이|가|은|는|란)?\s*(무엇|뭐)/,
    /설명해\s*줘$/,  // "X 설명해줘" - 단독이면 개념 설명
    /알려줘$/,        // 데이터 키워드 없는 단독 "알려줘"는 아래에서 후처리
  ];

  // 2) 해석/원인 분석 패턴
  const interpretationPatterns = [
    /왜/, /원인/, /이유/, /때문/,
    /낮아졌|높아졌|감소했|증가했|줄었|늘었|악화|개선/,
    /전월\s*대비/, /전년\s*대비/, /전기\s*대비/, /YoY|MoM/i,
    /시사점/, /인사이트/, /제언/, /추천/, /개선\s*방안/,
    /해석/, /평가/, /진단/, /코멘트/, /의미/,
    /어떻게\s*보(이|여)/, /어떤\s*의미/,
  ];

  // 3) 데이터 분석 패턴 (특정 데이터 요청 동사가 있어야 함)
  const dataAnalysisPatterns = [
    /분석해/, /비교해/, /보여줘/, /조회/, /구해/, /계산/,
    /TOP\s*\d+/i, /상위\s*\d+/, /하위\s*\d+/, /순위/,
    /별\s*(매출|이익|원가|금액|합계|비중)/,
    /합계|총액|평균|최대|최소/,
    /얼마|몇\s*원|몇\s*개/,
    // "YYYY년 N월 ... 알려줘/보여줘" 류 — 명백한 데이터 요청
    /\d{4}\s*년.*\d{1,2}\s*월.*(알려줘|보여줘|조회|구해|계산)/,
    /\d{1,2}\s*월.*(알려줘|보여줘|조회|구해|계산)/,
  ];

  const hasInterpretation = interpretationPatterns.some(p => p.test(q));
  if (hasInterpretation) return 'interpretation';

  const hasDataAnalysis = dataAnalysisPatterns.some(p => p.test(q));
  if (hasDataAnalysis) return 'data_analysis';

  // 개념 질문 패턴 검사 (해석/분석 키워드가 없을 때만)
  const hasConcept = conceptPatterns.some(p => p.test(q));
  if (hasConcept) {
    // "지급수수료 알려줘"처럼 데이터 컬럼명 + 알려줘는 data_analysis 쪽
    // (휴리스틱으로는 컬럼명 모르므로) 명백한 개념 의문문만 concept으로 분류
    if (/(뭐|뭐야|뭐예요|뭔가|무엇|무슨\s*뜻|어떤\s*뜻|의\s*정의|의\s*개념|의\s*의미|의\s*뜻|이란|란\?)/.test(q)) {
      return 'concept';
    }
    // "X 설명해줘"는 명확하지 않으니 LLM 폴백
    return null;
  }

  return null;  // 분류 실패 → LLM 폴백
}

async function classifyAnalysisIntent(query, openaiClient, model) {
  // 1차: 휴리스틱
  const heuristic = classifyAnalysisIntentHeuristic(query);
  if (heuristic) {
    console.log(`[NLQ] 의도 분류(휴리스틱): ${heuristic} ("${query}")`);
    return heuristic;
  }

  // 2차: LLM 분류 (휴리스틱 실패 시)
  try {
    const completion = await openaiClient.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `당신은 사용자 질문 의도 분류기입니다. 사용자 질문을 다음 3가지 중 하나로 분류하세요.

[분류 기준]
1. concept: 용어/개념의 정의나 설명을 묻는 질문 (DB 데이터 불필요)
   - 예: "SKU가 뭐야?", "KPI란 무엇인가요?", "매출총이익의 개념을 설명해줘"

2. data_analysis: 실제 데이터를 조회하거나 항목별로 분석을 요청하는 질문
   - 예: "지급수수료 분석해줘", "SKU별 매출 TOP5 알려줘", "올해 4월 매출 보여줘"

3. interpretation: 원인, 시사점, 변화의 해석, 제언을 요청하는 질문
   - 예: "왜 낮아졌어?", "전월 대비 분석해줘", "수익성 어떻게 보여?", "개선 방안이 뭐야?"

[응답 형식]
반드시 JSON 한 줄로만 응답: {"intent": "concept|data_analysis|interpretation", "reason": "한 줄 이유"}`,
        },
        { role: 'user', content: query },
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: 'json_object' },
    });
    const raw = completion.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);
    const intent = parsed.intent;
    if (['concept', 'data_analysis', 'interpretation'].includes(intent)) {
      console.log(`[NLQ] 의도 분류(LLM): ${intent} — ${parsed.reason} ("${query}")`);
      return intent;
    }
  } catch (err) {
    console.warn(`[NLQ] 의도 분류 LLM 실패, interpretation 폴백:`, err.message);
  }

  // 폴백: interpretation (기존 동작)
  return 'interpretation';
}

// ============================================================
// Helper: 질의에서 기준연월 추출 (분석형 질문용)
// - "2026년 4월", "2026-04", "4월", "당월", "전월", "이번달", "지난달" 등 지원
// - 추출 실패 시 latestMonth(데이터의 최신 월) 사용
// ============================================================
function extractCalmonthFromQuery(query, dateCtx) {
  if (!query) return dateCtx.latestMonth;
  // YYYY년 M월 / YYYY년 MM월
  let m = query.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
  if (m) {
    return `${m[1]}${String(parseInt(m[2])).padStart(2, '0')}`;
  }
  // YYYY-MM / YYYY.MM
  m = query.match(/(\d{4})[-\.](\d{1,2})/);
  if (m) {
    return `${m[1]}${String(parseInt(m[2])).padStart(2, '0')}`;
  }
  // "당월", "이번달", "이달" → 최신
  if (/(당월|이번\s*달|이달|최근달)/.test(query)) return dateCtx.latestMonth;
  // "전월", "지난달" → 전월
  if (/(전월|지난\s*달|작년동월|작년\s*동월)/.test(query)) return dateCtx.prevMonth;
  // 단순 "N월" 만 있는 경우 → 데이터 최신 연도 기준
  m = query.match(/(\d{1,2})\s*월/);
  if (m) {
    const y = dateCtx.latestMonth.substring(0, 4);
    return `${y}${String(parseInt(m[1])).padStart(2, '0')}`;
  }
  // 못 찾으면 최신
  return dateCtx.latestMonth;
}

// ============================================================
// Helper: 분석형 질문용 안전 KPI 조회 SQL 자동 생성
// - LLM을 거치지 않고 백엔드가 직접 SQL 빌드 → 문법 오류 0% 보장
// - 도메인의 모든 metric을 재귀 확장된 산식으로 SELECT (단일 행)
// - WHERE는 기준연월만 (안전한 일반 컬럼 조건)
// - GROUP BY 없음 → "Invalid use of group function" 절대 발생 안 함
// ============================================================
async function buildAnalysisSQL(domainCode, calmonth) {
  const dc = domainCode || 'PS';
  const metricMap = await loadMetricMap(dc);

  // 핵심 KPI 우선순위 (도메인 PS 기준 일반적 분석 항목)
  // 운영 데이터에 없는 코드는 자동 스킵됨
  const corePriorityCodes = [
    'ZAMT001', // 총매출
    'ZAMT002', // 매출할인
    'ZAMT003', // 순매출 (계산형)
    'ZAMT004', // 매출에누리
    'ZAMT005', // 매출원가-제품 (계산형)
    'ZAMT025', // 매출원가-기타항목
    'ZAMT026', // 매출원가-기타 (계산형)
    'ZAMT034', // 매출원가계 (계산형)
    'ZAMT035', // 매출총이익 (계산형)
  ];

  const selectExprs = [];
  const aliasUsed = new Set();

  // 1) 우선 코어 KPI
  for (const code of corePriorityCodes) {
    const m = metricMap[code];
    if (!m || !m.formula) continue;
    const expanded = expandMetricFormula(m.formula, metricMap, new Set([code]), 0);
    if (!expanded) continue;
    const safeExpr = expanded.includes('SUM(') || expanded.includes('sum(') ? `(${expanded})` : `SUM(${expanded})`;
    // alias: description 우선, 없으면 metric_code
    let alias = (m.description || code).replace(/['"`\\]/g, '').substring(0, 40);
    if (aliasUsed.has(alias)) alias = `${alias}_${code}`;
    aliasUsed.add(alias);
    selectExprs.push(`FORMAT(${safeExpr}, 0) AS '${alias}'`);
  }

  // 2) 나머지 metric 도 추가 (있으면)
  for (const [code, m] of Object.entries(metricMap)) {
    if (corePriorityCodes.includes(code)) continue;
    if (!m || !m.formula) continue;
    if (selectExprs.length >= 25) break; // 너무 많아지지 않게 제한
    const expanded = expandMetricFormula(m.formula, metricMap, new Set([code]), 0);
    if (!expanded) continue;
    const safeExpr = expanded.includes('SUM(') || expanded.includes('sum(') ? `(${expanded})` : `SUM(${expanded})`;
    let alias = (m.description || code).replace(/['"`\\]/g, '').substring(0, 40);
    if (aliasUsed.has(alias)) alias = `${alias}_${code}`;
    aliasUsed.add(alias);
    selectExprs.push(`FORMAT(${safeExpr}, 0) AS '${alias}'`);
  }

  if (selectExprs.length === 0) {
    // metric이 하나도 없으면 raw 컬럼이라도 조회
    selectExprs.push(`FORMAT(SUM(ZAMT001), 0) AS '총매출'`);
  }

  // WHERE 절: 기준연월 (CALMONTH는 'YYYYMM' 문자열)
  const cm = calmonth || '';
  const whereClause = cm ? `WHERE CALMONTH = '${cm}'` : '';

  const sql = `SELECT
  ${selectExprs.join(',\n  ')}
FROM bw_profitability_data
${whereClause}`;

  return sql;
}

// ============================================================
// Helper: 분석형 질문용 "원인 분석 상세 SQL" 다중 생성 (LLM 기반)
// ------------------------------------------------------------
// 목적:
//   고정 KPI 한 행짜리 합계 데이터만으로는 "특정 품목 매출이 왜 갑자기
//   증가했어?" 같은 원인 질문에 답할 수 없음.
//   이 함수는 사용자 질문 + 직전 SQL 컨텍스트 + 도메인 컬럼 카탈로그를
//   LLM에 전달해, 원인 판단에 필요한 1~5개의 보조 SELECT 쿼리를 만든다.
//
// 안전장치:
//   - 반드시 SELECT 만 허용 (다른 동사 발견 시 거부)
//   - LIMIT 누락 시 자동으로 LIMIT 200 추가
//   - validateSqlPreExecution() 통과해야 함
//   - applyDomainFilter() 로 도메인 필터 자동 주입
// ============================================================
async function generateAnalysisSqls(query, domainCode, dateCtx, conversationContext) {
  const dc = domainCode || 'PS';

  // ── 0) 학습관리(Metric) 산식 카탈로그 로드
  //   ★ 핵심: 영업이익/매출총이익/매출원가 등 "지표성 컬럼"은 raw DB 컬럼(ZAMT055 등)을
  //   직접 SUM 하면 안 되고, 학습관리에서 사용자가 등록한 metric의 산식을 사용해야 함.
  //   예: 영업이익 산식이 "ZAMT035 - ZAMT036 - 마케팅비합계"로 등록되어 있으면
  //   SUM(ZAMT055)가 아니라 그 산식대로 SQL을 만들어야 한다.
  //   여기서 metric을 재귀적으로 확장한 "최종 SQL 표현식"까지 만들어 LLM에 제공한다.
  let metricCatalog = '';
  const metricSqlMap = {};   // description(한글) → 최종 SQL 표현식
  try {
    const metricMap = await loadMetricMap(dc);                    // { metric_code: { aggregation, formula, description } }
    const metricLines = [];
    for (const [code, meta] of Object.entries(metricMap)) {
      if (!meta || !meta.description) continue;
      // 산식을 재귀 확장 (다른 metric_code 참조까지 풀어 raw 컬럼 수준의 식으로)
      const expanded = expandMetricFormula(meta.formula, metricMap, new Set([code]), 0);
      // 집계 함수 적용된 최종 SQL 표현식
      let sqlExpr;
      if (meta.aggregation === 'CALC') {
        // formula 자체가 이미 SUM(...) 형태를 포함한 산식
        sqlExpr = expanded;
      } else if (meta.aggregation === 'SUM') {
        sqlExpr = `SUM(${expanded})`;
      } else if (meta.aggregation === 'AVG' || meta.aggregation === 'COUNT' || meta.aggregation === 'MAX' || meta.aggregation === 'MIN') {
        sqlExpr = `${meta.aggregation}(${expanded})`;
      } else {
        sqlExpr = expanded;
      }
      metricLines.push(`- ${meta.description} (코드 ${code}): \`${sqlExpr}\``);
      metricSqlMap[meta.description] = sqlExpr;
    }
    if (metricLines.length > 0) {
      metricCatalog = metricLines.join('\n');
    }
  } catch (e) {
    console.warn('[analysisSqls] Metric 카탈로그 로드 실패:', e.message);
  }

  // ── 1) 실제 테이블의 컬럼 목록을 INFORMATION_SCHEMA에서 직접 추출
  //   - LLM이 SAP BW 일반 명명규칙(/BIC/Z* 등)으로 추측한 잘못된 컬럼명을 만들지 못하도록
  //     "DB에 실제로 존재하는 컬럼만" 보여주는 게 핵심.
  //   - description은 ontology_column 또는 COLUMN_COMMENT 어느 쪽이든 우선 사용.
  let columnCatalog = '';
  try {
    const [actualCols] = await pool.query(
      `SELECT COLUMN_NAME, COLUMN_COMMENT, DATA_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'bw_profitability_data'
        ORDER BY ORDINAL_POSITION`
    );
    // ontology_column.description으로 보완 (있을 때만)
    const ontoDesc = {};
    try {
      const [ontoRows] = await pool.query(
        `SELECT column_name, description
           FROM ontology_column
          WHERE domain_code = ? AND is_active = 1`,
        [dc]
      );
      for (const r of ontoRows) {
        if (r.description) ontoDesc[r.column_name.toUpperCase()] = r.description;
      }
    } catch (_) { /* ignore */ }

    columnCatalog = actualCols
      .map(c => {
        const desc = ontoDesc[c.COLUMN_NAME.toUpperCase()] || c.COLUMN_COMMENT || '';
        return `- ${c.COLUMN_NAME}${desc ? ` (${desc})` : ''} [${c.DATA_TYPE}]`;
      })
      .join('\n');
  } catch (e) {
    console.warn('[analysisSqls] 컬럼 카탈로그 로드 실패:', e.message);
  }

  // ── 1-1) ★ 도메인 동의어 확정 매핑 (사용자 질의를 활성 도메인 기준으로 해석)
  //   현황집계·분석계획 경로와 동일하게 matchSynonymsDirectly 를 호출해
  //   "거래처/고객" 같은 도메인 의존 용어를 확정된 컬럼으로 강제 매핑합니다.
  //   특정 컬럼(CUSTOMER 등) 하드코딩 지시를 대체.
  let synonymDirective2 = '';
  try {
    const synonymMatches = await matchSynonymsDirectly(query || '', dc);
    if (Array.isArray(synonymMatches) && synonymMatches.length > 0) {
      const columnMatches = synonymMatches.filter(m => m.source === 'ontology' || m.source === 'ontology_desc' || m.source === 'ontology_desc_partial');
      if (columnMatches.length > 0) {
        const groups = new Map();
        for (const m of columnMatches) {
          const key = m.matchedKeyword || m.synonym;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(m);
        }
        for (const [k, g] of groups) {
          const seen = new Set();
          const dedup = [];
          for (const m of g) {
            if (!seen.has(m.column_name)) { seen.add(m.column_name); dedup.push(m); }
          }
          groups.set(k, dedup);
        }
        const lines = [];
        lines.push('[★ 도메인 동의어 확정 매핑 — 최우선 적용! 사용자 용어를 아래 컬럼으로 해석하세요]');
        lines.push(`활성 도메인: ${dc}`);
        for (const [keyword, group] of groups) {
          if (group.length === 1) {
            const m = group[0];
            lines.push(`- "${keyword}" → ${m.column_name}${m.description ? ` (${m.description})` : ''}`);
          } else {
            lines.push(`- "${keyword}" → ${group.map(m => m.column_name).join(', ')}`);
          }
        }
        lines.push('▶ 다른 도메인의 관례 컬럼명(예: CUSTOMER 등)으로 임의 대체하지 마세요.');
        synonymDirective2 = '\n' + lines.join('\n') + '\n';
      }
    }
  } catch (e) {
    console.warn('[analysisSqls] matchSynonymsDirectly 실패:', e.message);
  }

  // ── 2) 직전 턴 SQL (있으면 가장 최근 SELECT문 1개)
  let prevSqlBlock = '';
  if (Array.isArray(conversationContext) && conversationContext.length > 0) {
    const lastWithSql = [...conversationContext].reverse().find(c => c && c.sql);
    if (lastWithSql && lastWithSql.sql) {
      prevSqlBlock = `\n[직전 턴 SQL — 사용자가 방금 본 결과 테이블의 출처]\n${lastWithSql.sql}\n`;
    }
  }

  // ── 3) 기준 연월
  const cm = dateCtx.latestMonth || '';
  const prevCm = dateCtx.prevMonth || '';
  const cmLabel = cm ? `${cm.substring(0,4)}년 ${parseInt(cm.substring(4,6))}월` : '';
  const prevLabel = prevCm ? `${prevCm.substring(0,4)}년 ${parseInt(prevCm.substring(4,6))}월` : '';

  const systemPrompt = `당신은 수익성 분석 데이터 엔지니어입니다.
사용자의 분석/원인 질문에 답하기 위해 필요한 보조 SELECT 쿼리들을 생성하세요.

[테이블]
bw_profitability_data (단일 테이블)

[기간 컨텍스트]
- 당월: ${cmLabel} (CALMONTH='${cm}')
- 전월: ${prevLabel} (CALMONTH='${prevCm}')
${synonymDirective2}
[★★★★★ 학습관리에 등록된 지표(Metric) 산식 — 지표성 컬럼은 반드시 이 산식 사용 ★★★★★]
${metricCatalog || '(등록된 metric 없음)'}

[★ 지표 사용 절대 규칙 — 가장 중요]
- 위 목록에 있는 지표(영업이익, 매출총이익, 순매출, 매출원가 계, 판매관리비, 마케팅비합계 등)를 답변·SQL에 쓸 때는
  **반드시 위에 적힌 SQL 표현식을 그대로 사용**하세요. 사용자가 학습관리 화면에서 등록·수정한 산식이며,
  여기서 벗어나면 사용자가 의도한 정의와 다른 잘못된 결과가 됩니다.
- 예: 영업이익이 \`SUM(ZAMT035) - SUM(ZAMT036) - (SUM(ZAMT047)+...)\` 처럼 산식으로 등록되어 있다면
  절대로 \`SUM(ZAMT055)\`만 쓰지 말고 등록된 산식 그대로 사용. (학습관리 우선)
- 위 목록에 영업이익 산식이 \`SUM(ZAMT055)\` 단일 컬럼으로 등록되어 있다면 그건 그대로 사용해도 됨.
  **단, 등록된 산식을 임의로 변경/축약/추측하지 마세요.**
- 위 목록에 없는 지표(예: "수익률", "기여도" 등)는 raw 컬럼이 아니라 위에 등록된 지표끼리 조합해서 만드세요.

[★★★ 사용 가능한 실제 컬럼 — 아래 목록에 없는 컬럼명은 절대 사용하지 마세요 ★★★]
${columnCatalog || '(카탈로그 없음)'}

[★ 컬럼명 절대 규칙]
- 위 목록에 적힌 컬럼명 외에는 어떤 컬럼도 만들어내지 마세요.
- 특히 'BIC_*', '/BIC/*' 같은 SAP BW 일반 명명규칙은 **이 DB에 존재하지 않습니다**. 사용 금지.
- 수량은 ZQTY_BOX / ZQTY_BAG / ZQTY_KE 중 적합한 것을 선택. (BIC_ZQTY* 아님)
- 브랜드는 ZBRAND / ZBRAND_NM (BIC_ZBRAND 아님).
- **거래처/고객/영업사원 등 도메인별로 달라지는 축은 활성 도메인(${dc})의 ontology_synonym·ontology_column 매핑을 기준으로 하세요. 특정 컬럼(CUSTOMER, ZKUNN2 등)으로 하드코딩 금지 — 반드시 위 [사용 가능한 실제 컬럼] 목록에 나와 있는 도메인별 실제 컬럼을 사용하세요.**
- 유통경로는 DISTR_CHAN / DISTR_CHAN_NM (BIC_ZDISTCHAN 아님).
- 컬럼이 위 목록에 정확히 존재하는지 한 번 더 확인한 뒤 SQL을 작성하세요.

[당신의 임무]
사용자 질문이 가리키는 **구체 대상**(특정 품목명, 거래처, 손익센터, 채널, 플랜트 등)을
질문 텍스트와 직전 SQL에서 추출하여, 그 대상의 원인을 다각도로 진단할 수
**최대 3개의 보조 SELECT 쿼리**를 만드세요. (적을수록 좋음)

[필수 규칙]
1. 모든 쿼리는 SELECT만 사용 (DML/DDL 금지). 단일 테이블 bw_profitability_data 만 사용.
2. 각 쿼리는 한 가지 분석 관점에 집중 (전월/당월 비교, 단가/수량 분해, 거래처별 기여, 신규/반복 여부 등).
3. **반드시 사용자 질문의 구체 대상을 WHERE 조건으로 좁힐 것** (예: MATERIAL_NM LIKE '%Blanq-Bright%', CUSTOMER_NM LIKE '%메디프렌즈%').
   - 대상 이름이 모호하면 LIKE 부분 매칭 사용.
   - 대상이 '항상 ~ 낮다/높다' 같은 추세 질문이면 최근 3~6개월 CALMONTH로 확장 가능 (CALMONTH >= '20YYMM').
4. 집계 함수와 일반 컬럼이 함께 있을 땐 반드시 GROUP BY 추가.
4-1. **★★★ 코드·명칭 쌍 GROUP BY 원칙 (매우 중요) ★★★**
   차원에 코드 컬럼과 명(_NM/_NAME) 컬럼이 함께 있는 경우:
   - **반드시 코드 컬럼으로만 GROUP BY**, 명 컬럼은 MAX() 로 SELECT 표시용.
   - 대표 쌍: MATERIAL/MATERIAL_NM, PLANT/PLANT_NM, PROFIT_CTR/PROFIT_CTR_NM,
     ZZKVGR7/ZZKVGR7_NM, ZBRAND/ZBRAND_NM, DISTR_CHAN/DISTR_CHAN_NM, ZKUNN2/ZKUNN2_NM 등.
   - ✓ 정답: SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', SUM(...) AS '매출총이익' ... GROUP BY MATERIAL
   - ✗ 금지: GROUP BY MATERIAL_NM (명 컬럼만) — 서로 다른 코드가 같은 명이면 합쳐지고, 코드가 같아도 명 표기가 다르면 분리됨.
   - ✗ 금지: GROUP BY MATERIAL, MATERIAL_NM 함께 (동일 코드의 명 변경/표기차로 그룹 분리 위험).
   - 예외: 사용자가 명시적으로 "동일 명칭끼리 합쳐줘" 라고 요청한 경우에만 명 기준 GROUP BY 허용.
5. **금액 지표는 반드시 위 [Metric 산식]에 적힌 표현식을 그대로 사용**. raw ZAMT 컬럼을 임의로 SUM하지 말 것.
   단가/평균 등 등록되지 않은 비율은 (등록된 금액 산식) / NULLIF(SUM(수량),0) 형태로.
6. 결과가 많아질 가능성이 있으면 LIMIT 50 정도로 제한, ORDER BY 명시.
7. 컬럼 alias는 한글로 (예: AS '당월순매출', AS '영업이익').
8. CALMONTH 비교는 문자열 '${cm}' / '${prevCm}' 사용.
9. **분석에 도움 안 되는 일반 KPI 합계 쿼리는 만들지 말 것** — 이미 별도로 조회됨.
10. **한 쿼리 실행 시간이 길어지지 않도록 WHERE 조건을 충분히 좁히고 LIMIT 도 작게(예: 20~50).**

[출력 형식 — 반드시 JSON 한 객체]
{
  "queries": [
    { "label": "이 쿼리가 답하는 분석 관점 (한 문장)", "sql": "SELECT ..." },
    ...
  ]
}
queries 가 0~3개. 적절한 대상이 안 잡히면 빈 배열 가능.`;

  let raw;
  try {
    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `[사용자 질문]\n${query}${prevSqlBlock}` },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    raw = completion.choices[0].message.content;
  } catch (e) {
    console.warn('[analysisSqls] LLM 호출 실패:', e.message);
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn('[analysisSqls] JSON 파싱 실패:', e.message, raw?.slice(0, 200));
    return [];
  }

  const candidates = Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [];
  const safe = [];

  for (const q of candidates) {
    let sql = (q && q.sql || '').trim();
    const label = (q && q.label || '').trim() || '보조 쿼리';
    if (!sql) continue;

    // 마지막 세미콜론 제거 (LIMIT 추가/필터 주입 안전성)
    sql = sql.replace(/;\s*$/, '');

    // ── 위험 키워드 차단 (SELECT 외 동사)
    if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|REVOKE|MERGE|CALL|EXEC|EXECUTE)\b/i.test(sql)) {
      console.warn('[analysisSqls] 위험 키워드 차단:', label);
      continue;
    }
    // ── 첫 토큰이 SELECT인지
    if (!/^\s*SELECT\b/i.test(sql)) {
      console.warn('[analysisSqls] SELECT 시작 아님:', label);
      continue;
    }
    // ── 대상 테이블 사용 확인
    if (!/\bbw_profitability_data\b/i.test(sql)) {
      console.warn('[analysisSqls] bw_profitability_data 미참조:', label);
      continue;
    }
    // ── 사전 검증
    const v = validateSqlPreExecution(sql);
    if (!v.valid) {
      console.warn('[analysisSqls] 사전검증 실패:', label, '-', v.reason);
      continue;
    }
    // ── 도메인 필터 자동 주입
    sql = applyDomainFilter(sql, dc);
    // ── LIMIT 미포함 시 추가
    if (!/\bLIMIT\b/i.test(sql)) sql += ' LIMIT 200';

    safe.push({ label, sql });
  }

  return safe;
}

// ============================================================
// Helper: 분석 보조 SQL들을 병렬 실행 (실패는 스킵, 응답 시간 단축)
// - 실패한 쿼리는 결과 배열에서 제외하여 LLM이 잘못된 오류 메시지를
//   근거로 답변하지 않도록 함 (단, 콘솔 경고는 유지)
// - 쿼리당 5초 타임아웃 (전체가 너무 오래 걸리지 않도록 안전장치)
// ============================================================
async function runAnalysisSqls(safeQueries) {
  if (safeQueries.length === 0) return [];

  // 쿼리당 타임아웃 5초
  const QUERY_TIMEOUT_MS = 5000;

  const tasks = safeQueries.map(async (q) => {
    const t0 = Date.now();
    try {
      const queryPromise = pool.query(q.sql);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`쿼리 타임아웃 (${QUERY_TIMEOUT_MS}ms)`)), QUERY_TIMEOUT_MS)
      );
      const result = await Promise.race([queryPromise, timeoutPromise]);
      const rows = filterDummyRows(result[0]);
      return {
        label: q.label,
        sql: q.sql,
        rowCount: rows.length,
        rows: rows.slice(0, 30),  // LLM 프롬프트 입력 상한
        execMs: Date.now() - t0,
      };
    } catch (e) {
      console.warn('[analysisSqls] 실행 실패 → 결과에서 제외:', q.label, '-', e.message);
      // ★ 실패한 쿼리는 null 반환 → 필터링 후 LLM에 전달 안 함
      return null;
    }
  });

  const settled = await Promise.all(tasks);
  return settled.filter(r => r !== null);
}

// ============================================================
// ═══════════════════════════════════════════════════════════════
// ★★★ AnalysisPlan 파이프라인 (2026-07 신규) ★★★
// ═══════════════════════════════════════════════════════════════
// 목적:
//   - "분석질문" 모드의 응답 정확도를 위해 사용자 질문 문장을
//     키워드로 분기하지 않고, LLM이 전체 문맥으로 필요한 분석 작업을
//     스스로 계획하고, 백엔드가 그 계획을 실제 데이터로 실행한 뒤,
//     결과 검증까지 마친 뒤 최종 답변을 생성.
//
// 흐름:
//   1) generateAnalysisPlan(query, ...)
//      → LLM이 AnalysisPlan JSON 생성
//        · requiresDataExecution (설명 vs 실제 결과)
//        · dimensions, metrics, filters, operations, expectedResults
//   2) executeAnalysisPlan(plan)
//      → dimensions+metrics 로 base SQL 자동 생성 → 실행
//      → operations 순차 적용 (CORRELATION, TOP_N, COMPARE_PERIODS 등은
//        후처리 함수로 계산)
//   3) validateAnalysisResults(plan, execResult)
//      → expectedResults 항목별로 실제 값이 채워졌는지 검증
//      → 실패 시 LLM에게 사유를 알려주고 plan 수정 요청 (최대 1회 재시도)
//   4) generateFinalAnalysisAnswer(plan, execResult)
//      → 제한된 컨텍스트(실제 결과만)로 최종 답변 생성
// ============================================================

// ────────────────────────────────────────────────────────────
// [1] generateAnalysisPlan — LLM이 사용자 질문을 문맥 전체로 판단하여
//     실행 계획을 생성. 특정 키워드에 의존하지 않고 목적을 추론.
// ────────────────────────────────────────────────────────────
async function generateAnalysisPlan(query, activeDomain, dateCtx, conversationContext, options = {}) {
  const dc = activeDomain || 'PS';

  // ── metric 카탈로그 (설명 + 산식)
  let metricCatalog = '';
  let metricSqlMap = {};
  try {
    const metricMap = await loadMetricMap(dc);
    const lines = [];
    for (const [code, meta] of Object.entries(metricMap)) {
      if (!meta || !meta.description) continue;
      const expanded = expandMetricFormula(meta.formula, metricMap, new Set([code]), 0);
      let sqlExpr;
      if (meta.aggregation === 'CALC') sqlExpr = expanded;
      else if (meta.aggregation === 'SUM') sqlExpr = `SUM(${expanded})`;
      else if (['AVG','COUNT','MAX','MIN'].includes(meta.aggregation)) sqlExpr = `${meta.aggregation}(${expanded})`;
      else sqlExpr = expanded;
      lines.push(`- "${meta.description}" (code=${code}): ${sqlExpr}`);
      metricSqlMap[meta.description] = sqlExpr;
    }
    metricCatalog = lines.join('\n');
  } catch (e) {
    console.warn('[AnalysisPlan] metric 카탈로그 로드 실패:', e.message);
  }

  // ── 컬럼 카탈로그
  let columnCatalog = '';
  try {
    const [actualCols] = await pool.query(
      `SELECT COLUMN_NAME, COLUMN_COMMENT
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME='bw_profitability_data'
        ORDER BY ORDINAL_POSITION`
    );
    const ontoDesc = {};
    try {
      const [ontoRows] = await pool.query(
        `SELECT column_name, description FROM ontology_column WHERE domain_code=? AND is_active=1`, [dc]
      );
      for (const r of ontoRows) if (r.description) ontoDesc[r.column_name.toUpperCase()] = r.description;
    } catch(_) {}
    columnCatalog = actualCols
      .map(c => `- ${c.COLUMN_NAME}${(ontoDesc[c.COLUMN_NAME.toUpperCase()] || c.COLUMN_COMMENT) ? ` (${ontoDesc[c.COLUMN_NAME.toUpperCase()] || c.COLUMN_COMMENT})` : ''}`)
      .join('\n');
  } catch (e) {
    console.warn('[AnalysisPlan] 컬럼 카탈로그 로드 실패:', e.message);
  }

  // ── ★ 도메인 동의어 리졸버 (분석질문 경로에도 현황집계와 동일하게 적용)
  //   현황집계 buildRAGSystemPrompt 와 동일하게 matchSynonymsDirectly 를 호출해
  //   사용자 질의의 용어를 활성 도메인(HL/PS)의 ontology_synonym·metric 으로 확정 매핑합니다.
  //   여기서 확정된 code/name 컬럼을 LLM 이 그대로 plan.dimensions[].columns[] 에 담도록 강제하여,
  //   SQL 생성 단계(buildAggregationSqlFromPlan)가 도메인 컬럼(HL: ZZKVGR7 / PS: CUSTOMER 등)을
  //   그대로 사용하도록 합니다. — "거래처=CUSTOMER" 같은 하드코딩 예시 금지.
  let synonymDirective = '';
  try {
    const synonymMatches = await matchSynonymsDirectly(query, dc);
    if (Array.isArray(synonymMatches) && synonymMatches.length > 0) {
      const metricMatches = synonymMatches.filter(m => m.source === 'metric' || m.source === 'metric_desc');
      const columnMatches = synonymMatches.filter(m => m.source === 'ontology' || m.source === 'ontology_desc' || m.source === 'ontology_desc_partial');

      const lines = [];
      lines.push('[★★★ 도메인 동의어 확정 매핑 — 최우선 적용! 아래 매핑을 반드시 dimensions/filters/metrics 에 사용하세요 ★★★]');
      lines.push(`활성 도메인: ${dc}`);

      if (columnMatches.length > 0) {
        // matchedKeyword 로 그룹핑 (같은 사용자 키워드에 여러 컬럼 매핑되는 경우)
        const groups = new Map();
        for (const m of columnMatches) {
          const key = m.matchedKeyword || m.synonym;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(m);
        }
        // 중복 컬럼 제거
        for (const [k, g] of groups) {
          const seen = new Set();
          const dedup = [];
          for (const m of g) {
            if (!seen.has(m.column_name)) { seen.add(m.column_name); dedup.push(m); }
          }
          groups.set(k, dedup);
        }
        lines.push('');
        lines.push('🔷 [Ontology 컬럼 매핑 — dimension/filter 로 사용]');
        for (const [keyword, group] of groups) {
          if (group.length === 1) {
            const m = group[0];
            lines.push(`- 사용자가 말한 "${keyword}" → 컬럼: ${m.column_name}${m.description ? ` (${m.description})` : ''}`);
          } else {
            lines.push(`- 사용자가 말한 "${keyword}" → ${group.length}개 컬럼:`);
            for (const m of group) {
              lines.push(`    · ${m.column_name}${m.description ? ` (${m.description})` : ''}`);
            }
          }
        }
        lines.push('');
        lines.push('▶ 위 매핑에서 "코드 컬럼"과 그에 대응하는 "명(이름) 컬럼"이 함께 등장하면,');
        lines.push('  두 컬럼을 한 dimension 의 columns 배열에 함께 묶으세요.');
        lines.push('  (예: columns=["<코드컬럼>", "<명컬럼>"])');
        lines.push('▶ 이 매핑에 없는 다른 이름의 컬럼(예: 다른 도메인 관례명)으로 임의 대체하지 마세요.');
        lines.push('▶ 활성 도메인이 다르면 같은 한글 용어라도 컬럼명이 달라집니다. 반드시 위 매핑을 그대로 사용.');
      }

      if (metricMatches.length > 0) {
        lines.push('');
        lines.push('🚨 [Metric 산식 매핑 — metrics[].formula 로 사용]');
        for (const m of metricMatches) {
          const formulaMatch = (m.column_name || '').match(/^(\w+)\((.+)\)$/);
          const innerFormula = formulaMatch ? formulaMatch[2] : m.column_name;
          const aggInside = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(innerFormula || '');
          const sqlExpr = aggInside ? innerFormula : `SUM(${innerFormula})`;
          lines.push(`- 사용자가 말한 "${m.synonym}" → formula: ${sqlExpr}`);
        }
        lines.push('▶ 위 산식은 학습관리 등록값입니다. 임의 변경 금지.');
      }

      synonymDirective = '\n' + lines.join('\n') + '\n';
      try {
        console.log(`[AnalysisPlan] domain=${dc} synonym matches: columns=${columnMatches.length}, metrics=${metricMatches.length}`);
      } catch(_) {}
    } else {
      console.log(`[AnalysisPlan] domain=${dc} synonym matches: (none)`);
    }
  } catch (e) {
    console.warn('[AnalysisPlan] matchSynonymsDirectly 호출 실패:', e.message);
  }

  const cm = dateCtx.latestMonth || '';
  const prevCm = dateCtx.prevMonth || '';
  const cmLabel = cm ? `${cm.substring(0,4)}년 ${parseInt(cm.substring(4,6))}월` : '';
  const prevLabel = prevCm ? `${prevCm.substring(0,4)}년 ${parseInt(prevCm.substring(4,6))}월` : '';

  // 대화 컨텍스트 (직전 턴 SQL/답변 참조)
  let convCtx = '';
  if (Array.isArray(conversationContext) && conversationContext.length > 0) {
    const last = [...conversationContext].reverse().find(c => c && (c.sql || c.explanation));
    if (last) {
      convCtx = `\n[직전 턴 참조]\n${last.sql ? `- 직전 SQL: ${String(last.sql).substring(0, 300)}` : ''}${last.explanation ? `\n- 직전 답변 요지: ${String(last.explanation).substring(0, 200)}` : ''}`;
    }
  }

  // 재시도 시 이전 시도의 실패 사유 + 실제 컬럼별 값 유무 진단
  let retryHint = '';
  if (options.retryReason) {
    retryHint = `\n\n[★ 이전 시도 실패 — 이 사유를 반영해 계획 수정]\n${options.retryReason}\n이전 계획: ${JSON.stringify(options.previousPlan || {}, null, 2).substring(0, 800)}`;

    // 재시도 시에만 활성 도메인 + 활성 기간에서 ZAMT 컬럼들의 실제 값 유무를 진단해 프롬프트에 첨부
    //  → 값이 모두 0/NULL 인 컬럼은 어느 것인지 LLM이 알 수 있어야 대체 공식 선택 가능
    try {
      const div = dc === 'PS' ? '10' : (dc === 'HL' ? '20' : null);
      const cmForDiag = (options.previousPlan?.period?.from) || cm;
      if (div && cmForDiag) {
        const zamtCols = [];
        for (let i = 1; i <= 55; i++) zamtCols.push('ZAMT' + String(i).padStart(3, '0'));
        const selectParts = zamtCols.map(c => `SUM(${c}) AS \`${c}\``).join(', ');
        const [diagRows] = await pool.query(
          `SELECT ${selectParts} FROM bw_profitability_data WHERE CALMONTH=? AND DIVISION=?`,
          [cmForDiag, div]
        );
        if (diagRows && diagRows[0]) {
          const dataStatus = [];
          const emptyCols = [];
          const nonEmptyCols = [];
          for (const c of zamtCols) {
            const v = Number(diagRows[0][c]);
            if (!Number.isFinite(v) || v === 0) emptyCols.push(c);
            else nonEmptyCols.push(c);
          }
          dataStatus.push(`- 값이 있는 raw 컬럼 (SUM≠0): ${nonEmptyCols.join(', ') || '(없음)'}`);
          dataStatus.push(`- 값이 없는 raw 컬럼 (SUM=0): ${emptyCols.join(', ') || '(없음)'}`);
          retryHint += `\n\n[★ 활성 도메인(${dc}) · 기간(${cmForDiag}) 에서 실제 데이터 값 유무]\n${dataStatus.join('\n')}\n※ 값이 없는 컬럼을 formula 에 넣으면 결과가 0 이 됩니다. 반드시 값이 있는 컬럼 중심으로 formula 재설계.`;
        }
      }
    } catch (e) {
      console.warn('[AnalysisPlan] 재시도 진단 조회 실패:', e.message);
    }
  }

  const systemPrompt = `당신은 사용자 자연어 질문을 실행 가능한 AnalysisPlan(JSON)으로 변환하는 분석 계획 수립기입니다.
사용자 문장의 특정 단어("분석해줘", "계산해줘", "상관관계" 등)에 의존하지 말고
전체 문맥을 이해해 사용자가 실제로 알고 싶은 것이 무엇인지 판단하세요.

[출력할 AnalysisPlan JSON 구조]
{
  "requiresDataExecution": true | false,   // 실제 DB 계산 필요 여부
  "userGoal": "사용자가 알고 싶은 것 (한 문장, 한국어)",
  "answerMode": "RESULT_BASED" | "CONCEPT_EXPLANATION",
  "domain": { "value": "PS|HL", "source": "USER_QUERY|UI_FILTER" },
  "period": { "from": "YYYYMM", "to": "YYYYMM", "source": "USER_QUERY|UI_FILTER" },
  "dimensions": [                          // GROUP BY 축 — columns[0]=코드(GROUP BY), columns[1..]=명(MAX 표시)
    { "name": "표시명(한글)", "columns": ["COL_CODE","COL_NAME"] }
    // 명시적 명 기준 그룹핑 필요 시: { "name": "...", "columns": [...], "groupByAll": true }
  ],
  "metrics": [                             // SELECT 지표
    { "name": "표시명(한글)", "formula": "SUM(...)/NULLIF(SUM(...),0)" }
  ],
  "filters": [                             // 추가 WHERE 조건
    { "column": "COL", "op": "=|LIKE|IN|>=", "value": "..." }
  ],
  "operations": [                          // 실행할 후처리 (여러 개 가능, 순서 중요)
    { "type": "GROUP_BY", "dimensions": ["표시명"] },
    { "type": "CALCULATE_METRICS", "metrics": ["표시명"] },
    { "type": "SORT", "by": "표시명", "order": "DESC|ASC" },
    { "type": "TOP_N", "n": 10, "by": "표시명(정렬 지표)", "partitionBy": "표시명(그룹축, 선택)" },
    { "type": "PEARSON_CORRELATION", "xMetric": "표시명X", "yMetric": "표시명Y" },
    { "type": "COMPARE_PERIODS", "current": "YYYYMM", "prior": "YYYYMM", "metrics": [...] },
    { "type": "CONTRIBUTION_ANALYSIS", "totalMetric": "...", "byDimension": "..." },
    { "type": "TREND_ANALYSIS", "metric": "...", "months": 3 }
  ],
  "expectedResults": [                     // 최종 답변에 반드시 있어야 할 값 (검증용)
    "validRowCount", "excludedRowCount",
    "correlationCoefficient", "topRankRows",
    "currentValue", "priorValue", "changePct",
    "resultInterpretation"                 // 결과 해석 텍스트
  ],
  "notes": "판단 근거를 짧게 한국어로 (사용자 목적 요약 등)"
}

[판단 지침 — 매우 중요]
1. requiresDataExecution 판단은 오직 "사용자가 최종적으로 실제 데이터상의 결론을 요구하는가" 로.
   - "영업이익률은 어떻게 계산해?" → false (개념/산식 설명만)
   - "거래처별 영업이익률을 계산해서 결과 보여줘" → true
   - "지급수수료 높은 거래처일수록 영업이익률 낮은 편이야?" → true (거래처별 계산 + 상관관계 필요)
   ※ 특정 동사 포함 여부가 아니라 문맥으로 판단.

2. 사용자가 요청한 지표가 [학습관리 등록 지표 목록]에 있으면 그 산식을 그대로 사용.
   목록에 없으면 [사용 가능 컬럼]에서 raw 컬럼 조합으로 산식 작성.
   지급수수료 원단위처럼 사용자가 산식을 직접 명시했다면 그 산식 그대로 사용.

2-1. **★ 지표 개념 vs raw 컬럼 이름 구분 (매우 중요)**
   사용자가 개념(예: "영업이익", "매출총이익")을 언급했지만 학습관리에 그 개념이 등록되어 있지 않고
   같은 이름의 raw 컬럼(예: ZAMT055="영업이익")만 존재하는 경우:
   - 그 raw 컬럼이 해당 도메인에서 실제로 사용되는지 확신할 수 없다면 SUM(ZAMT055) 단독 사용은 위험.
   - 학습관리에 등록된 관련 지표들의 산식을 조합해 개념을 재구성하는 것을 우선 고려.
     예) PS 도메인에서 "영업이익" 미등록이지만 "매출총이익" 등록 → "영업이익 ≈ 매출총이익 - 판관비 합"으로 대체.
   - 사용자가 산식을 직접 명시(예: "영업이익/순매출")한 경우, 그 좌변("영업이익")도 학습관리·raw 상태를
     모두 검토해 실제로 값이 존재하는 방향으로 formula 를 선택하세요.
   - 즉 사용자의 "말"이 아니라 실제 그 도메인에서 값이 나오는 방향으로 formula 선택.

2-2. **★ 재시도 시 variance=0 (분산 0) 진단 대응**
   이전 시도에서 상관계수가 null 이고 variance=0 (특히 특정 축의 원본 컬럼이 모두 0) 이라는 진단이 있으면:
   - 그 축의 metric formula 를 반드시 다른 조합으로 교체하세요. 같은 formula 재사용 금지.
   - 우선순위: (a) 학습관리 등록된 관련 지표 조합, (b) 도메인에서 실제 값이 있는 raw 컬럼 조합.
   - 예) x축이 ZAMT055 (모두 0) 라면 → 매출총이익 학습관리 산식 - 판관비류 컬럼들(ZAMT038,039,040,041,045 등) 조합.

3. 한 질문이 여러 분석을 요구할 수 있음 (예: "TOP5 매출 거래처와 그들의 영업이익률 상관관계") →
   operations 를 여러 개 조합.

3-0. **★★★ 월별/카테고리별 TOP N — 반드시 partitionBy 지정 ★★★**
   사용자가 "월별 TOP N", "각 월 별 TOP N", "달별 상위 N개",
   "카테고리별 TOP N", "부문별 TOP N" 처럼 **그룹 축마다 각각 상위 N 개** 를
   요구하면 반드시 TOP_N 에 partitionBy 를 지정하세요.

   - dimensions 에는 그룹축 (예: 달력연월) 과 상위를 뽑을 축 (예: 자재코드+자재명) 을 모두 포함
   - TOP_N.partitionBy 에 그룹축의 표시명(dimension.name) 을 지정
   - TOP_N.by 에는 정렬 기준 metric 표시명을 지정
   - operations 에 별도 SORT 를 넣지 말고 TOP_N.by / TOP_N.order 로 처리 권장
   - 결과는 partition × N 개 행이 반환됨 (예: 3~6월 4개월 × TOP5 = 20 행)

   예) "2026년 3월부터 6월까지 월별 SKU 매출 TOP5"
   {
     "period": { "from": "202603", "to": "202606", "source": "USER_QUERY" },
     "dimensions": [
       { "name": "달력연월", "columns": ["CALMONTH"] },
       { "name": "자재",     "columns": ["MATERIAL","MATERIAL_NM"] }
     ],
     "metrics": [ { "name": "순매출", "formula": "SUM(...)" } ],
     "operations": [
       { "type":"GROUP_BY", "dimensions":["달력연월","자재"] },
       { "type":"CALCULATE_METRICS", "metrics":["순매출"] },
       { "type":"TOP_N", "n": 5, "by":"순매출", "order":"DESC", "partitionBy":"달력연월" }
     ]
   }

   ✗ 금지 패턴: partitionBy 없이 { "type":"TOP_N", "n":5 } 만 두는 것.
     → 이 경우 전체에서 상위 5 개만 뽑히므로 대부분 특정 한 달에서만
        결과가 나오고 다른 달은 완전히 사라집니다. 명백한 버그.

   partitionBy 를 쓰는 판단 기준: **"각 ○○별로 TOP N"** 처럼 그룹축이
   질의에 명시된 경우. 단일 축 TOP N ("올해 매출 TOP10 거래처") 은
   partitionBy 없이 그대로.

3-1. **★ 파생 지표(비율/원단위)의 재료 metric도 반드시 함께 포함 (매우 중요)**
   비율·원단위 등 파생 지표 (예: 영업이익률 = 영업이익/순매출, 지급수수료 원단위 = 지급수수료/판매중량)는
   사용자에게 결과표로 보여줄 때 파생값만 있으면 검증이 어렵습니다.
   → **분자·분모에 해당하는 재료 지표(raw metric)도 metrics 배열에 함께 반드시 포함**하세요.

   예1) 사용자: "거래처별 영업이익률과 지급수수료(변동) 원단위의 상관관계"
     ✗ 나쁨: metrics = [영업이익률, 지급수수료(변동) 원단위]  ← 파생값만 있어서 사용자가 계산 근거 확인 불가
     ✓ 좋음: metrics = [순매출, 영업이익, 영업이익률, 지급수수료(변동), 판매중량, 지급수수료(변동) 원단위]
             ← 사용자가 표에서 분자·분모·파생값을 모두 확인 가능

   예2) 사용자: "품목별 매출액과 판매수량의 상관관계"
     이미 raw 지표만 사용 중 → 추가할 재료 없음. 그대로 metrics = [매출액, 판매수량].

   원칙: metric.formula 에 "SUM(A)/NULLIF(SUM(B),0)" 같은 나눗셈이 있으면,
   분자 SUM(A) 와 분모 SUM(B) 를 각각 별도 metric 으로도 추가하세요.
   재료 metric 이름은 학습관리 등록명(예: "영업이익", "순매출") 을 우선 사용, 없으면 명확한 한글명 부여.
   operations 의 CALCULATE_METRICS.metrics 에도 이 재료 metric 들을 함께 포함.

   ※ 단, 분자/분모가 학습관리에도 raw 컬럼에도 명확히 대응하는 개념이 아닌 경우(예: 매우 복잡한 조합식)에는
     무리하게 재료 metric 을 만들지 말고 파생 지표만 두어도 됩니다.

4. dimensions 는 최소한만. 사용자가 "○○별"이라 하면 **위 [도메인 동의어 확정 매핑]** 에서 그 용어에 매핑된 컬럼을 사용하세요.
   - 코드 컬럼과 명(이름) 컬럼이 함께 매핑돼 있으면 두 컬럼을 한 dimension 의 columns 배열에 묶습니다.
   - **★★★ columns 배열의 순서는 반드시 [코드 컬럼, 명 컬럼] 순서 ★★★**
     · columns[0] = 코드 컬럼 (예: MATERIAL, ZZKVGR7, PLANT, PROFIT_CTR) — **GROUP BY 기준**
     · columns[1..] = 명 컬럼 (예: MATERIAL_NM, ZZKVGR7_NM) — **MAX() 로 표시용만**
     · SQL 빌더가 columns[0] 만 GROUP BY 하고 나머지는 MAX() 로 감쌉니다. 이 순서를 반드시 지키세요.
   - 예: 도메인 매핑이 "거래처 → ZZKVGR7, ZZKVGR7_NM" 이면 columns=["ZZKVGR7","ZZKVGR7_NM"].
     자재/SKU 라면 columns=["MATERIAL","MATERIAL_NM"] (코드가 먼저).
     다른 도메인이면 같은 "거래처"라도 다른 컬럼일 수 있습니다. **절대 특정 컬럼명(CUSTOMER 등)으로 하드코딩하지 마세요** — 반드시 위 매핑에서 뽑아 쓰세요.
   - **명 컬럼(_NM/_NAME 계열)만 단독으로 columns 에 넣지 마세요.** 이유:
     · 서로 다른 코드가 같은 명이면 하나로 합쳐지고,
     · 동일 코드의 명이 변경/표기차이 나면 여러 그룹으로 분리되며,
     · 공백·대소문자·NULL 로 결과가 달라져 현황집계와 정합성이 깨집니다.
   - 매핑이 없는 용어라면 [사용 가능 실제 컬럼] 에서 가장 명백히 일치하는 컬럼을 선택.
   - **예외**: 사용자가 명시적으로 "동일한 명칭끼리 합쳐줘" 같이 명 기준 그룹핑을 요청한 경우에만
     dimension 에 "groupByAll": true 를 추가해 두면 SQL 빌더가 명 컬럼도 GROUP BY 에 포함합니다.

5. period 는 사용자가 명시한 기간 → USER_QUERY.
   명시하지 않으면 UI 기간(당월: ${cmLabel} / CALMONTH='${cm}') 사용 → UI_FILTER.

5-1. **★★★ 한국어 회계기간 표현 해석 규칙 — 매우 중요! ★★★**
   사용자가 아래와 같은 한국식 기간 표현을 쓰면 반드시 아래 매핑대로 from/to 를 채우세요 (source='USER_QUERY').
   YYYY 는 문맥의 연도(사용자가 "2026년 상반기"라 하면 2026, 연도가 없으면 현재 년도).
   - "YYYY년 상반기"           → from='YYYY01', to='YYYY06'   (1~6월)
   - "YYYY년 하반기"           → from='YYYY07', to='YYYY12'   (7~12월)
   - "YYYY년 1분기" / "YYYY년 Q1" → from='YYYY01', to='YYYY03'
   - "YYYY년 2분기" / "YYYY년 Q2" → from='YYYY04', to='YYYY06'
   - "YYYY년 3분기" / "YYYY년 Q3" → from='YYYY07', to='YYYY09'
   - "YYYY년 4분기" / "YYYY년 Q4" → from='YYYY10', to='YYYY12'
   - "YYYY년 전체" / "YYYY년"    → from='YYYY01', to='YYYY12'
   - "최근 N개월" / "지난 N개월"  → to=당월(${cm}), from=당월에서 N-1개월 전
   - "YYYY년 M월 ~ YYYY년 N월"   → from='YYYYMM'(시작), to='YYYYMM'(끝)
   ★ 이런 범위 표현은 "기간을 명시하지 않은 질문"이 아닙니다. 절대 UI_FILTER 폴백하지 말고 위 매핑대로 채우세요.
   ★ 범위 기간(from ≠ to)에서 답변 문장의 "분석 대상 기간" 문구에는 반드시 "YYYY년 M월 ~ YYYY년 N월 (X개월)" 형태로 표기하세요.

6. expectedResults 는 답변에 반드시 담아야 할 결과 항목만. 상관분석이면 상관계수·유효/제외 건수 필수.

7. answerMode:
   - requiresDataExecution=true → RESULT_BASED
   - false → CONCEPT_EXPLANATION

8. **결과 요청인데 SQL 실행이 불가능한 경우가 아니라면 requiresDataExecution=true 를 유지**하세요.
   설명만 하고 종료하기 위해 false 를 쓰지 마세요.

[기간 컨텍스트]
- 당월: ${cmLabel} (CALMONTH='${cm}')
- 전월: ${prevLabel} (CALMONTH='${prevCm}')
- 활성 도메인 (UI 필터): ${dc}
${synonymDirective}
[★ 학습관리 등록 지표 (지표성 컬럼은 반드시 이 산식 사용)]
${metricCatalog || '(없음)'}

[★ 사용 가능 실제 컬럼 — 이 목록에 없는 컬럼명 만들지 말 것]
${columnCatalog || '(없음)'}
${convCtx}${retryHint}

[출력 형식]
반드시 위 JSON 스키마만 하나 반환. 다른 설명·마크다운·코드블록 금지.`;

  let raw;
  let firstFinishReason = null;
  try {
    const completion = await openai.chat.completions.create({
      model: GPT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      temperature: 0.1,  // 계획 생성은 결정적으로
      response_format: { type: 'json_object' },
      max_tokens: 8000,   // [2026-07-21] 4000→8000: 상반기/범위 케이스는 metrics·operations 가
                          //   많아 4000 토큰에서 잘리며 JSON 파싱 실패 → 전체 파이프라인 실패로 이어짐
    });
    raw = completion.choices[0].message.content;
    firstFinishReason = completion.choices[0].finish_reason;
    if (firstFinishReason === 'length') {
      console.warn('[AnalysisPlan] 1차 응답 finish_reason=length (max_tokens 로 잘림 가능) — 재요청 예정');
    }
  } catch (e) {
    console.error('[AnalysisPlan] LLM 호출 실패:', e.message);
    throw new Error(`AnalysisPlan 생성 실패: ${e.message}`);
  }

  let plan;
  const needsRetry = (r) => {
    if (r === 'length') return true;   // 잘린 경우 무조건 재시도
    return false;
  };

  const tryParse = () => {
    try { return { ok: true, value: JSON.parse(raw) }; }
    catch (e) { return { ok: false, error: e }; }
  };

  let parsed = tryParse();
  if (!parsed.ok || needsRetry(firstFinishReason)) {
    // 파싱 실패 또는 truncation 감지 시 재요청 (최대 12000 토큰까지 확장)
    console.warn('[AnalysisPlan] JSON 파싱 실패/truncation → 1회 재요청:',
      `finish_reason=${firstFinishReason}, preview=`, String(raw || '').slice(0, 200));
    try {
      const retry = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          { role: 'system', content: systemPrompt + '\n\n[재요청] 앞서 반환한 JSON 이 파싱되지 않았거나 잘렸습니다. 반드시 완결된 유효한 JSON 하나만 반환하세요. metrics/operations 배열을 필요한 만큼만 간결하게 작성해 응답 크기를 줄이세요.' },
          { role: 'user', content: query },
        ],
        temperature: 0.05,
        response_format: { type: 'json_object' },
        max_tokens: 12000,  // [2026-07-21] 재시도는 더 크게
      });
      raw = retry.choices[0].message.content;
      const retryFinish = retry.choices[0].finish_reason;
      if (retryFinish === 'length') {
        console.error('[AnalysisPlan] 재요청도 finish_reason=length — JSON 잘림 재발');
      }
      parsed = tryParse();
      if (!parsed.ok) {
        console.error('[AnalysisPlan] JSON 파싱 재시도도 실패:', String(raw || '').slice(0, 300));
        throw new Error('AnalysisPlan JSON 파싱 실패');
      }
    } catch (e2) {
      if (parsed.ok) {
        // 재요청 자체는 실패했지만 1차 응답이 완결 JSON 이었다면 그것을 사용
        console.warn('[AnalysisPlan] 재요청 LLM 실패했지만 1차 응답 JSON 사용:', e2.message);
      } else {
        throw new Error('AnalysisPlan JSON 파싱 실패');
      }
    }
  }
  plan = parsed.value;

  // metric formula 를 실제 SQL 표현식으로 재확인 (LLM이 학습관리 산식을 잘 옮겼는지)
  // — 사용자 산식이 명시된 경우는 존중, 이름만 참조한 경우는 metricSqlMap 으로 교체
  if (Array.isArray(plan.metrics)) {
    for (const m of plan.metrics) {
      if (!m.formula && m.name && metricSqlMap[m.name]) {
        m.formula = metricSqlMap[m.name];
      }
    }
  }

  // 도메인·기간 기본값 채움
  plan.domain = plan.domain || { value: dc, source: 'UI_FILTER' };
  if (!plan.domain.value) plan.domain.value = dc;
  plan.period = plan.period || { from: cm, to: cm, source: 'UI_FILTER' };
  if (!plan.period.from) plan.period.from = cm;
  if (!plan.period.to) plan.period.to = plan.period.from;

  return plan;
}

// ────────────────────────────────────────────────────────────
// [2-a] buildAggregationSqlFromPlan — plan의 dimensions/metrics/filters
//        로 GROUP BY SELECT 자동 생성 (LLM이 SQL 문법을 직접 작성하지 않도록)
// ────────────────────────────────────────────────────────────
function buildAggregationSqlFromPlan(plan, calmonth, calmonthTo) {
  const dims = Array.isArray(plan.dimensions) ? plan.dimensions : [];
  const mets = Array.isArray(plan.metrics) ? plan.metrics : [];
  const filters = Array.isArray(plan.filters) ? plan.filters : [];

  const selectParts = [];
  const groupByParts = [];

  // dimensions
  // ★ [2026-07-30] 코드·명칭 쌍 GROUP BY 원칙 (현황집계 규칙 12 와 동일)
  //   dimension 의 columns[] 에 코드/명 두 컬럼이 함께 오면:
  //     - 첫 컬럼(코드로 간주) 만 GROUP BY.
  //     - 나머지(명으로 간주) 는 MAX(col) AS col 로 표시용으로만 노출.
  //   이유:
  //     - MATERIAL_NM 같은 VARCHAR 명 컬럼을 GROUP BY 하면
  //       ① 서로 다른 코드가 같은 명이면 하나로 합쳐지고
  //       ② 동일 코드의 명 변경/표기차/공백/NULL 로 여러 그룹 분리되며
  //       ③ 인덱스 미사용으로 성능이 나쁨.
  //     - 현황집계는 프롬프트 규칙 12 로 이걸 강제하지만, 분석질문은
  //       plan.dimensions[].columns[] 를 그대로 사용하는 구조라 SQL 빌더에서 강제해야 함.
  //   명 컬럼 판별: 이름이 _NM, _NAME, NAME_KO, _KOR 등으로 끝나거나 (대소문자 무관),
  //                또는 columns 배열에서 두 번째 이후 위치에 오는 것.
  //   예외: dimension.groupByAll === true 또는 columns.length === 1 이면 기존 동작.
  const isNameLikeColumn = (col) => {
    const u = String(col || '').toUpperCase();
    return /(_NM|_NAME|_KO|_KOR|_KR|NAME_KO|_TEXT|_TXT|_DESC)$/.test(u);
  };
  const dimAliasByName = {};
  const dimCodeColByName = {};   // dimension.name → 코드 컬럼 (partitionBy lookup 용)
  for (const d of dims) {
    if (!Array.isArray(d.columns) || d.columns.length === 0) continue;
    const cols = d.columns.filter(c => c && typeof c === 'string');
    if (cols.length === 0) continue;

    // 1) 코드 컬럼 후보 선택
    //    a) 명시적으로 groupByAll=true 인 경우 → 모두 GROUP BY (기존 동작)
    //    b) columns.length === 1 → 그 컬럼 GROUP BY
    //    c) 두 개 이상: "명 아닌" 첫 컬럼 = 코드로 간주. 없으면 첫 컬럼 사용.
    const forceAll = d.groupByAll === true;
    let codeCol;
    if (forceAll || cols.length === 1) {
      codeCol = cols[0];
    } else {
      codeCol = cols.find(c => !isNameLikeColumn(c)) || cols[0];
    }

    if (forceAll) {
      // 사용자가 "명칭끼리 합쳐줘" 등 명시적 요청 시 등: 모든 컬럼 GROUP BY
      for (const col of cols) {
        selectParts.push(`\`${col}\``);
        groupByParts.push(`\`${col}\``);
      }
    } else {
      // 코드 컬럼: SELECT + GROUP BY
      selectParts.push(`\`${codeCol}\``);
      groupByParts.push(`\`${codeCol}\``);
      // 나머지(명 컬럼 포함): MAX() 로 표시
      for (const col of cols) {
        if (col === codeCol) continue;
        selectParts.push(`MAX(\`${col}\`) AS \`${col}\``);
      }
    }

    // 대표 alias: 코드 컬럼 (partitionBy lookup 에 사용)
    dimAliasByName[d.name] = codeCol;
    dimCodeColByName[d.name] = codeCol;
  }

  // metrics — alias 는 한글 name, SQL 은 산식 그대로 (metricSqlMap 로 이미 산식 채워짐)
  const metricAliasByName = {};
  for (const m of mets) {
    if (!m.formula) continue;
    const alias = m.name || `metric_${Object.keys(metricAliasByName).length + 1}`;
    selectParts.push(`(${m.formula}) AS \`${alias}\``);
    metricAliasByName[alias] = m.formula;
  }

  // CALMONTH 필터: 범위(calmonthTo 지정 & from!=to) → BETWEEN, 아니면 등호
  const cmFrom = String(calmonth || '').replace(/[^0-9]/g, '');
  const cmTo = String(calmonthTo || '').replace(/[^0-9]/g, '');
  let calmonthWhere;
  if (cmFrom && cmTo && cmFrom !== cmTo) {
    // BETWEEN은 순서 무관하도록 오름차순 정렬
    const [lo, hi] = cmFrom <= cmTo ? [cmFrom, cmTo] : [cmTo, cmFrom];
    calmonthWhere = `CALMONTH BETWEEN '${lo}' AND '${hi}'`;
  } else {
    calmonthWhere = `CALMONTH='${cmFrom || cmTo}'`;
  }
  const whereParts = [calmonthWhere];
  for (const f of filters) {
    if (!f.column || !f.op) continue;
    const col = String(f.column).replace(/[^A-Za-z0-9_]/g, '');
    if (!col) continue;
    const opUp = String(f.op).toUpperCase();
    if (opUp === 'IN' && Array.isArray(f.value)) {
      const escaped = f.value.map(v => `'${String(v).replace(/'/g, "''")}'`).join(',');
      whereParts.push(`\`${col}\` IN (${escaped})`);
    } else if (['=', '!=', '>', '<', '>=', '<=', 'LIKE'].includes(opUp)) {
      const v = String(f.value ?? '').replace(/'/g, "''");
      whereParts.push(`\`${col}\` ${opUp} '${v}'`);
    }
  }

  const selectClause = selectParts.length > 0 ? selectParts.join(', ') : '1';
  const whereClause = whereParts.join(' AND ');
  const groupByClause = groupByParts.length > 0 ? ` GROUP BY ${groupByParts.join(', ')}` : '';

  // ────────────────────────────────────────────────────────
  // [2026-07-21] TOP_N.partitionBy 감지 → CTE + ROW_NUMBER 로 재작성
  //
  // 배경(버그): "3~6월 월별 SKU 매출 TOP5" 같은 질의에서
  //   ① base SQL 이 `LIMIT 5000` 로 잘려 특정 월 데이터가 사라지고
  //   ② 애플리케이션 후처리 TOP_N 이 partition 개념 없이 전체 rows 에서
  //      slice(0,n) 만 하여 3월 상위 5개만 나오고 4·5·6월은 결과에 없었음.
  //
  // 해결: plan.operations 에 { type:'TOP_N', n:5, partitionBy:'달력연월', by:'순매출' }
  //       가 오면 DB 단에서 CTE + ROW_NUMBER 로 월별 순위를 계산하고
  //       상위 N 개만 반환. 애플리케이션 slice 는 우회 (아래 runPostOperations 참조).
  //
  // 규칙:
  //   - partitionBy 는 plan.dimensions[i].name (한글 표시명) 이어야 함.
  //     → dimAliasByName 으로 실제 컬럼명 lookup
  //   - orderBy 는 topOp.by 또는 별도 SORT op 의 by (없으면 첫 metric alias)
  //   - orderDir 은 topOp.order / SORT.order (기본 DESC)
  //   - LIMIT 은 partition 후처리로 이미 축소되므로 최종 SELECT 에는 붙이지 않음
  // ────────────────────────────────────────────────────────
  const operations = Array.isArray(plan.operations) ? plan.operations : [];
  const topOp = operations.find(o => String(o?.type || '').toUpperCase() === 'TOP_N');
  const sortOp = operations.find(o => String(o?.type || '').toUpperCase() === 'SORT');

  let partitionColSql = null;      // 예: `CALMONTH`
  let orderColAlias = null;        // 예: `순매출`
  let topN = null;
  let orderDirSql = 'DESC';

  if (topOp && groupByParts.length > 0) {
    const nRaw = parseInt(topOp.n, 10);
    if (Number.isFinite(nRaw) && nRaw > 0) topN = Math.min(nRaw, 1000);

    // partitionBy: plan dimension name → 실제 컬럼명 lookup
    const partitionName = topOp.partitionBy || topOp.partition_by;
    if (partitionName && dimAliasByName[partitionName]) {
      partitionColSql = `\`${dimAliasByName[partitionName]}\``;
    }

    // orderBy: topOp.by 또는 SORT.by → metric alias 이거나 컬럼 alias
    const byName = topOp.by || (sortOp && sortOp.by) || null;
    if (byName && (metricAliasByName[byName] || dimAliasByName[byName])) {
      orderColAlias = `\`${byName}\``;
    } else if (byName) {
      // alias map 에 없어도 metric name 후보로 사용 (백틱 감쌈)
      orderColAlias = `\`${String(byName).replace(/`/g, '')}\``;
    } else {
      // fallback: 첫 metric alias
      const firstMetric = Object.keys(metricAliasByName)[0];
      if (firstMetric) orderColAlias = `\`${firstMetric}\``;
    }

    const dirRaw = String(topOp.order || (sortOp && sortOp.order) || 'DESC').toUpperCase();
    orderDirSql = dirRaw === 'ASC' ? 'ASC' : 'DESC';
  }

  const useCte = topN !== null && partitionColSql && orderColAlias;

  if (useCte) {
    // partition + ROW_NUMBER 로 재작성. base 는 LIMIT 없이 전체 집계.
    // 최종 결과는 partition_col ASC, 순위 ASC 로 안정 정렬.
    const rankAlias = '순위';
    const cteSql =
      `WITH _base AS (` +
        `SELECT ${selectClause} FROM bw_profitability_data WHERE ${whereClause}${groupByClause}` +
      `), ` +
      `_ranked AS (` +
        `SELECT _base.*, ` +
        `ROW_NUMBER() OVER (PARTITION BY ${partitionColSql} ORDER BY ${orderColAlias} ${orderDirSql}) AS \`${rankAlias}\` ` +
        `FROM _base` +
      `) ` +
      `SELECT * FROM _ranked WHERE \`${rankAlias}\` <= ${topN} ` +
      `ORDER BY ${partitionColSql} ASC, \`${rankAlias}\` ASC`;

    return {
      sql: cteSql,
      dimAliasByName,
      metricAliasByName,
      rankInfo: {
        partitionCol: partitionColSql.replace(/`/g, ''),
        rankAlias,
        n: topN,
        orderBy: orderColAlias.replace(/`/g, ''),
        orderDir: orderDirSql,
      },
    };
  }

  // ────────────────────────────────────────────────────────
  // 일반 경로: LIMIT 안전상한 (dimension 있으면 50000, 없으면 1).
  // [2026-07-21] 5000 → 50000 상향: 장기간 · 다차원 집계 시 임의 절단 방지.
  //   최종 사용자에게 노출되는 결과는 후처리 TOP_N / summary 슬라이스로
  //   축소되므로 base SQL 을 조금 더 관대하게 열어둠.
  // ────────────────────────────────────────────────────────
  const limit = groupByParts.length > 0 ? 50000 : 1;

  const sql = `SELECT ${selectClause} FROM bw_profitability_data WHERE ${whereClause}${groupByClause} LIMIT ${limit}`;

  return { sql, dimAliasByName, metricAliasByName };
}

// ────────────────────────────────────────────────────────────
// [2-b] Post-op 실행기 — CORRELATION, TOP_N, COMPARE_PERIODS 등 후처리
// ────────────────────────────────────────────────────────────
function pearsonCorrelation(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; }
  const mx = sumX / n, my = sumY / n;
  let num = 0, dxx = 0, dyy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy;
    dxx += dx * dx;
    dyy += dy * dy;
  }
  const denom = Math.sqrt(dxx * dyy);
  if (denom === 0) return null;
  return num / denom;
}

function interpretCorrelation(r) {
  const abs = Math.abs(r);
  const dir = r >= 0 ? '양(+)의' : '음(-)의';
  let strength;
  if (abs < 0.1) strength = '거의 없음';
  else if (abs < 0.3) strength = '약한';
  else if (abs < 0.5) strength = '뚜렷한';
  else if (abs < 0.7) strength = '중간 정도의';
  else if (abs < 0.9) strength = '강한';
  else strength = '매우 강한';
  return `${dir} ${strength} 상관관계`;
}

function runPostOperations(plan, baseRows) {
  const results = {
    baseRows: baseRows,
    baseRowCount: baseRows.length,
    computed: {},   // { operationType: { ... } }
    diagnostics: [],
  };

  if (!Array.isArray(plan.operations)) return results;

  let workingRows = [...baseRows];

  for (const op of plan.operations) {
    if (!op || !op.type) continue;
    const type = String(op.type).toUpperCase();

    try {
      if (type === 'GROUP_BY' || type === 'CALCULATE_METRICS') {
        // 이미 base SQL 에서 처리됨
        continue;
      }

      if (type === 'SORT') {
        const byKey = op.by;
        const order = String(op.order || 'DESC').toUpperCase() === 'ASC' ? 1 : -1;
        workingRows.sort((a, b) => {
          const va = Number(a[byKey]); const vb = Number(b[byKey]);
          if (Number.isNaN(va) || Number.isNaN(vb)) return 0;
          return (va - vb) * order;
        });
        continue;
      }

      if (type === 'TOP_N') {
        const n = Math.max(1, Math.min(1000, parseInt(op.n) || 10));
        // [2026-07-21] partitionBy 지정 시 DB 단(CTE + ROW_NUMBER)에서 이미
        //   partition 별 상위 N 개만 반환됨 → 여기서 slice(0,n) 를 하면
        //   첫 partition 만 잘려나오므로 우회. rows 는 partition × N 그대로 유지.
        const isPartitioned = !!(op.partitionBy || op.partition_by);
        if (isPartitioned) {
          results.computed.topN = {
            n,
            rows: workingRows,
            partitioned: true,
            partitionBy: op.partitionBy || op.partition_by,
          };
        } else {
          workingRows = workingRows.slice(0, n);
          results.computed.topN = { n, rows: workingRows, partitioned: false };
        }
        continue;
      }

      if (type === 'PEARSON_CORRELATION' || type === 'CORRELATION') {
        const xKey = op.xMetric;
        const yKey = op.yMetric;
        if (!xKey || !yKey) { results.diagnostics.push(`CORRELATION: xMetric/yMetric 누락`); continue; }
        const pairs = [];
        let excluded = 0;
        for (const r of baseRows) {
          const x = Number(r[xKey]); const y = Number(r[yKey]);
          if (!Number.isFinite(x) || !Number.isFinite(y)) { excluded++; continue; }
          pairs.push([x, y]);
        }
        if (pairs.length < 3) {
          results.diagnostics.push(`CORRELATION: 유효 데이터 ${pairs.length}건으로 상관계수 계산 불가 (최소 3건 필요)`);
          results.computed.correlation = {
            xMetric: xKey, yMetric: yKey,
            validCount: pairs.length,
            excludedCount: excluded,
            coefficient: null,
            interpretation: '유효 데이터 부족으로 상관계수 산출 불가',
          };
          continue;
        }
        const xs = pairs.map(p => p[0]);
        const ys = pairs.map(p => p[1]);
        const r = pearsonCorrelation(xs, ys);

        // ── 진단 통계: variance=0 (분산 0) 인 경우 어떤 축이 상수인지 알려줌
        //    → 재시도 LLM 이 formula 자체를 수정할 수 있도록 힌트 제공
        const axisStats = (arr, name) => {
          const min = Math.min(...arr);
          const max = Math.max(...arr);
          const uniq = new Set(arr.map(v => v.toFixed(6))).size;
          const allZero = arr.every(v => v === 0);
          return { name, min, max, uniqueValues: uniq, allZero, constant: uniq <= 1 };
        };
        const xStats = axisStats(xs, xKey);
        const yStats = axisStats(ys, yKey);

        const varianceDiag = [];
        if (xStats.constant) varianceDiag.push(`x축 '${xKey}' 은(는) 전 행이 동일값 (${xStats.allZero ? '모두 0' : `상수=${xStats.min}`}) → 분산 0 → 상관계수 산출 불가`);
        if (yStats.constant) varianceDiag.push(`y축 '${yKey}' 은(는) 전 행이 동일값 (${yStats.allZero ? '모두 0' : `상수=${yStats.min}`}) → 분산 0 → 상관계수 산출 불가`);

        if (r === null && varianceDiag.length > 0) {
          results.diagnostics.push(`CORRELATION variance=0 상세: ${varianceDiag.join(' / ')}`);
          // 대체 공식 후보를 명시적으로 넣어 재시도 LLM 이 즉시 반영하게 함
          const hint = [];
          if (xStats.allZero) hint.push(`x축(${xKey}) formula 재검토 필요 — 원본 컬럼이 비어있을 수 있음`);
          if (yStats.allZero) hint.push(`y축(${yKey}) formula 재검토 필요 — 원본 컬럼이 비어있을 수 있음`);
          if (hint.length) results.diagnostics.push(`CORRELATION 재시도 힌트: ${hint.join(' / ')}`);
        }

        results.computed.correlation = {
          xMetric: xKey, yMetric: yKey,
          validCount: pairs.length,
          excludedCount: excluded,
          coefficient: r,
          interpretation: r === null ? '분산이 0이라 상관계수 산출 불가' : interpretCorrelation(r),
          xStats, yStats,
          varianceZero: r === null,
        };
        continue;
      }

      if (type === 'COMPARE_PERIODS') {
        // 이 op 는 별도 SQL 로 prior 기간을 조회해야 함 → execute 단계에서 처리
        results.diagnostics.push(`COMPARE_PERIODS 는 execute 단계에서 별도 SQL 실행`);
        continue;
      }

      if (type === 'CONTRIBUTION_ANALYSIS') {
        const totalKey = op.totalMetric;
        if (!totalKey) { results.diagnostics.push('CONTRIBUTION: totalMetric 누락'); continue; }
        let total = 0;
        for (const r of baseRows) {
          const v = Number(r[totalKey]);
          if (Number.isFinite(v)) total += v;
        }
        const withPct = baseRows.map(r => {
          const v = Number(r[totalKey]);
          const pct = (Number.isFinite(v) && total !== 0) ? (v / total * 100) : null;
          return { ...r, __contributionPct: pct };
        }).sort((a, b) => (Number(b[totalKey]) || 0) - (Number(a[totalKey]) || 0));
        results.computed.contribution = { total, rows: withPct.slice(0, 20) };
        continue;
      }

      if (type === 'TREND_ANALYSIS') {
        // trend 는 별도 SQL 필요 → execute 단계에서 처리
        results.diagnostics.push('TREND_ANALYSIS 는 execute 단계에서 별도 SQL 실행');
        continue;
      }

      results.diagnostics.push(`알 수 없는 operation type: ${type}`);
    } catch (e) {
      results.diagnostics.push(`operation ${type} 실행 중 오류: ${e.message}`);
    }
  }

  results.workingRows = workingRows;
  return results;
}

// ────────────────────────────────────────────────────────────
// [2-c] executeAnalysisPlan — plan 을 실제 DB 로 실행
// ────────────────────────────────────────────────────────────
async function executeAnalysisPlan(plan, activeDomain) {
  const domain = (plan.domain && plan.domain.value) || activeDomain || 'PS';
  const calmonth = (plan.period && plan.period.from) || '';
  const calmonthTo = (plan.period && plan.period.to) || calmonth;

  const execRecord = {
    baseSql: null,
    baseRowCount: 0,
    baseExecMs: 0,
    baseError: null,
    priorSql: null,
    priorRows: [],
    priorError: null,
    postOps: null,
    diagnostics: [],
  };

  // ── base SQL 생성 및 실행
  const built = buildAggregationSqlFromPlan(plan, calmonth, calmonthTo);
  let baseSql = applyDomainFilter(built.sql, domain);
  execRecord.baseSql = baseSql;

  // 사전검증
  const v = validateSqlPreExecution(baseSql);
  if (!v.valid) {
    execRecord.baseError = `SQL 사전 검증 실패: ${v.reason}`;
    execRecord.diagnostics.push(execRecord.baseError);
    return execRecord;
  }

  // [2026-07-22 PR #247] analysis 파이프라인의 base SQL 실행에도 서버단
  //   statement timeout(NLQ_DB_QUERY_TIMEOUT_MS, 기본 90s) 을 강제로 부여.
  //   - aggregate 경로와 동일 정책: nginx proxy_read_timeout 보다 먼저 끊고
  //     명시적 오류 정보(execRecord.baseError, timeout 여부)를 위로 전파.
  //   - 실패 시 execRecord.baseTimedOut 플래그로 상위 호출자가 구분 가능.
  const t0 = Date.now();
  let baseRows = [];
  try {
    const [r] = await nlqPoolQueryWithTimeout(baseSql, null, NLQ_DB_QUERY_TIMEOUT_MS);
    baseRows = filterDummyRows(r);
    execRecord.baseRowCount = baseRows.length;
  } catch (e) {
    execRecord.baseError = e.message;
    execRecord.baseTimedOut = isDbQueryTimeoutError(e);
    execRecord.baseExecMs = Date.now() - t0;
    execRecord.diagnostics.push(
      execRecord.baseTimedOut
        ? `base SQL 타임아웃 (${Math.round(execRecord.baseExecMs / 1000)}초, 한도 ${NLQ_DB_QUERY_TIMEOUT_SEC}초): ${e.message}`
        : `base SQL 실행 실패: ${e.message}`
    );
    return execRecord;
  }
  execRecord.baseExecMs = Date.now() - t0;

  // ── COMPARE_PERIODS 있으면 prior 기간도 실행
  const cmpOp = (plan.operations || []).find(o => String(o.type).toUpperCase() === 'COMPARE_PERIODS');
  if (cmpOp && cmpOp.prior) {
    const priorPlan = { ...plan, period: { ...plan.period, from: cmpOp.prior, to: cmpOp.prior } };
    const priorBuilt = buildAggregationSqlFromPlan(priorPlan, cmpOp.prior);
    const priorSql = applyDomainFilter(priorBuilt.sql, domain);
    execRecord.priorSql = priorSql;
    try {
      // [2026-07-22 PR #247] prior 기간 SQL 도 동일 statement timeout 적용
      const [pr] = await nlqPoolQueryWithTimeout(priorSql, null, NLQ_DB_QUERY_TIMEOUT_MS);
      execRecord.priorRows = filterDummyRows(pr);
    } catch (e) {
      execRecord.priorError = e.message;
      execRecord.priorTimedOut = isDbQueryTimeoutError(e);
      execRecord.diagnostics.push(`prior SQL 실행 실패: ${e.message}`);
    }
  }

  // ── 후처리 (SORT, TOP_N, CORRELATION, CONTRIBUTION)
  execRecord.postOps = runPostOperations(plan, baseRows);
  execRecord.diagnostics = execRecord.diagnostics.concat(execRecord.postOps.diagnostics || []);

  return execRecord;
}

// ────────────────────────────────────────────────────────────
// [3] validateAnalysisResults — expectedResults 대비 실제 실행 결과 검증
// ────────────────────────────────────────────────────────────
function validateAnalysisResults(plan, execRecord) {
  const missing = [];
  const notes = [];
  const expected = Array.isArray(plan.expectedResults) ? plan.expectedResults : [];

  if (execRecord.baseError) {
    return { ok: false, missing: ['baseExecution'], notes: [`base SQL 실행 실패: ${execRecord.baseError}`] };
  }

  const post = execRecord.postOps || {};
  const computed = post.computed || {};

  for (const key of expected) {
    const k = String(key).toLowerCase();

    if (k.includes('correlation') && k.includes('coeff')) {
      if (!computed.correlation || computed.correlation.coefficient === null || computed.correlation.coefficient === undefined) {
        missing.push('correlationCoefficient');
      }
      continue;
    }
    if (k.includes('validcount') || k.includes('validrow') || k.includes('validcustomer')) {
      if (!computed.correlation || typeof computed.correlation.validCount !== 'number') {
        // base 결과 행수로 대체 확인
        if (execRecord.baseRowCount === 0) missing.push('validRowCount');
      }
      continue;
    }
    if (k.includes('excluded')) {
      if (!computed.correlation || typeof computed.correlation.excludedCount !== 'number') {
        // 기본은 0으로 간주하므로 누락 아님
      }
      continue;
    }
    if (k.includes('top') || k.includes('rank')) {
      if (!computed.topN && execRecord.baseRowCount === 0) missing.push('topRankRows');
      continue;
    }
    if (k.includes('current') || k.includes('prior') || k.includes('change') || k.includes('growth')) {
      if (execRecord.baseRowCount === 0) missing.push('periodComparisonValues');
      continue;
    }
    if (k.includes('interpretation')) {
      // 해석 텍스트는 최종답변 LLM 이 생성 — 여기선 검증하지 않음
      continue;
    }
    // 기타: base 결과 존재 여부
    if (execRecord.baseRowCount === 0 && !computed.correlation) {
      missing.push(String(key));
    }
  }

  // 근본 조건: 실제 결과가 아무것도 없으면 실패
  if (execRecord.baseRowCount === 0 && Object.keys(computed).length === 0) {
    return { ok: false, missing: missing.length ? missing : ['anyResult'], notes: ['실행 결과가 완전히 비어있음 (기간·필터 확인 필요)'] };
  }

  return { ok: missing.length === 0, missing, notes };
}

// ────────────────────────────────────────────────────────────
// [4-a] inferAnalysisUnit — plan.dimensions 에서 분석 단위·수량사 자동 추론
//   dimensions 이름/컬럼을 힌트로 사용해
//     - unitLabel: "거래처" / "품목" / "플랜트" / "기간" / "고객" / "제품군" ...
//     - unitCounter: "개" / "개월" / "년" / "건" ...
//     - unitLabelPhrase: "분석 대상 거래처" / "분석 대상 기간" ...
//   을 산출. 이는 최종 답변 LLM 이 "유효 건수/제외 건수" 같은 generic 표현
//   대신 분석 단위에 맞는 자연스러운 문구를 쓰도록 하는 힌트.
// ────────────────────────────────────────────────────────────
function inferAnalysisUnit(plan) {
  const dims = Array.isArray(plan.dimensions) ? plan.dimensions : [];

  // 기본값: 원천 데이터 (dimensions 가 없거나 애매할 때)
  let unitLabel = '데이터';
  let unitCounter = '건';
  let unitLabelPhrase = '분석 대상 데이터';

  if (dims.length === 0) {
    return { unitLabel, unitCounter, unitLabelPhrase, source: 'default_no_dimensions' };
  }

  // dimensions[0] 이 분석의 주 단위 — 이름·컬럼을 힌트로 사용
  const primary = dims[0] || {};
  const dimName = String(primary.name || '').toLowerCase();
  const cols = (primary.columns || []).map(c => String(c).toUpperCase());
  const colsJoined = cols.join(' ');

  // 컬럼 기반 판별 (가장 신뢰도 높음)
  //   CUSTOMER / CUSTOMER_NM → 거래처 (개)
  //   MATERIAL / MATERIAL_NM → 품목 (개)
  //   PLANT / WERKS         → 플랜트 (개)
  //   CALMONTH              → 기간 (개월)
  //   FISCPER / FISCYEAR    → 회계기간 (개)
  //   PRODH*                → 제품군 (개)
  //   CUSTGRP               → 고객그룹 (개)
  //   DIVISION              → 사업부 (개)
  const colHints = [
    { match: /CUSTOMER/,  unit: '거래처',   counter: '개' },
    { match: /MATERIAL/,  unit: '품목',     counter: '개' },
    { match: /^PLANT|WERKS/, unit: '플랜트', counter: '개' },
    { match: /CALMONTH/,  unit: '기간',     counter: '개월' },
    { match: /FISCPER|FISCYEAR/, unit: '회계기간', counter: '개' },
    { match: /PRODH/,     unit: '제품군',   counter: '개' },
    { match: /CUSTGRP/,   unit: '고객그룹', counter: '개' },
    { match: /DIVISION/,  unit: '사업부',   counter: '개' },
    { match: /SALESORG/,  unit: '영업조직', counter: '개' },
    { match: /BILL_TYPE|BILLTYPE/, unit: '청구유형', counter: '개' },
  ];
  for (const h of colHints) {
    if (h.match.test(colsJoined)) {
      unitLabel = h.unit; unitCounter = h.counter;
      unitLabelPhrase = `분석 대상 ${h.unit}`;
      return { unitLabel, unitCounter, unitLabelPhrase, source: `column:${cols.find(c => h.match.test(c))}` };
    }
  }

  // 이름 기반 판별 (컬럼에서 못 찾은 경우)
  const nameHints = [
    { keys: ['거래처','고객사','업체'],           unit: '거래처',   counter: '개' },
    { keys: ['품목','자재','제품','sku'],           unit: '품목',     counter: '개' },
    { keys: ['플랜트','공장'],                    unit: '플랜트',   counter: '개' },
    { keys: ['월','기간','달'],                    unit: '기간',     counter: '개월' },
    { keys: ['년','연도','회계연도'],              unit: '기간',     counter: '년' },
    { keys: ['고객그룹'],                          unit: '고객그룹', counter: '개' },
    { keys: ['제품군','상품군'],                   unit: '제품군',   counter: '개' },
    { keys: ['사업부','divisi'],                   unit: '사업부',   counter: '개' },
    { keys: ['영업조직'],                          unit: '영업조직', counter: '개' },
  ];
  for (const h of nameHints) {
    if (h.keys.some(k => dimName.includes(k))) {
      unitLabel = h.unit; unitCounter = h.counter;
      unitLabelPhrase = `분석 대상 ${h.unit}`;
      return { unitLabel, unitCounter, unitLabelPhrase, source: `name:${primary.name}` };
    }
  }

  // 마지막 fallback: 첫 dimension 이름을 그대로 label 로 사용
  if (primary.name) {
    unitLabel = String(primary.name);
    unitCounter = '개';
    unitLabelPhrase = `분석 대상 ${unitLabel}`;
    return { unitLabel, unitCounter, unitLabelPhrase, source: 'name_fallback' };
  }

  return { unitLabel, unitCounter, unitLabelPhrase, source: 'default_fallback' };
}

// ────────────────────────────────────────────────────────────
// [4] generateFinalAnalysisAnswer — 제한된 컨텍스트로 최종 답변 생성
// ────────────────────────────────────────────────────────────
async function generateFinalAnalysisAnswer(query, plan, execRecord) {
  const cm = (plan.period && plan.period.from) || '';
  const cmTo = (plan.period && plan.period.to) || cm;
  const fmtYm = (v) => v ? `${v.substring(0,4)}년 ${parseInt(v.substring(4,6))}월` : '';
  // 범위형 기간(from ≠ to)이면 "YYYY년 M월 ~ YYYY년 N월 (X개월)" 형태로 표기.
  // 단일월이면 "YYYY년 M월" 그대로.
  let cmLabel = fmtYm(cm);
  if (cm && cmTo && cm !== cmTo) {
    const fy = parseInt(cm.substring(0,4)), fm = parseInt(cm.substring(4,6));
    const ty = parseInt(cmTo.substring(0,4)), tm = parseInt(cmTo.substring(4,6));
    const monthSpan = (ty - fy) * 12 + (tm - fm) + 1;
    cmLabel = `${fmtYm(cm)} ~ ${fmtYm(cmTo)} (${monthSpan}개월)`;
  }
  const domainVal = (plan.domain && plan.domain.value) || '';

  // ── 분석 단위·수량사 자동 추론 (예: 거래처/개, 품목/개, 기간/개월)
  const unit = inferAnalysisUnit(plan);

  // 실제 계산 결과만 요약 — 사용자 질문과 무관한 KPI 오버뷰는 포함 안 함
  const summary = {
    userGoal: plan.userGoal || '',
    appliedPeriod: cmLabel,
    appliedDomain: domainVal,
    baseRowCount: execRecord.baseRowCount,
    executionStatus: execRecord.baseError ? 'ERROR' : 'SUCCESS',
    executionError: execRecord.baseError || null,
    // ── 분석 단위 정보 (LLM 이 "유효 건수/제외 건수" 대신 사용할 자연스러운 표현)
    analysisUnit: {
      label: unit.unitLabel,                         // "거래처" / "품목" / "기간" ...
      counter: unit.unitCounter,                     // "개" / "개월" / "년" / "건"
      phrase: unit.unitLabelPhrase,                  // "분석 대상 거래처"
    },
  };

  const computed = (execRecord.postOps && execRecord.postOps.computed) || {};

  // 상관관계
  if (computed.correlation) {
    const validN = computed.correlation.validCount;
    const excludedN = computed.correlation.excludedCount;
    summary.correlation = {
      x: computed.correlation.xMetric,
      y: computed.correlation.yMetric,
      // ── 내부 검증용 (기존 필드 유지)
      validCount: validN,
      excludedCount: excludedN,
      coefficient: computed.correlation.coefficient === null ? null : Number(computed.correlation.coefficient.toFixed(4)),
      interpretation: computed.correlation.interpretation,
      // ── 사용자 친화 필드 (LLM 이 이 값들을 자연어로 사용)
      analyzedTargetPhrase: `${unit.unitLabelPhrase} ${validN}${unit.unitCounter}`,   // "분석 대상 거래처 84개"
      excludedTargetPhrase: excludedN > 0
        ? `제외된 ${unit.unitLabel} ${excludedN}${unit.unitCounter}`
        : null,                                                                        // 0이면 null → 프롬프트에서 생략
      totalCandidateCount: validN + excludedN,       // 전체 후보 수 = 유효 + 제외
    };
  }

  // TOP_N
  if (computed.topN) {
    // [2026-07-21] partition-topN 인 경우 rows 는 이미 partition × N 개로
    //   DB 단에서 구성됨. 여기서 slice(0,n) 을 하면 첫 partition 만 남고
    //   나머지 partition (예: 4월·5월·6월) 이 사라짐 → 전체 유지.
    const isPartitioned = !!computed.topN.partitioned;
    const rowsForSummary = isPartitioned
      ? computed.topN.rows
      : computed.topN.rows.slice(0, computed.topN.n);
    summary.topN = {
      n: computed.topN.n,
      partitioned: isPartitioned,
      partitionBy: computed.topN.partitionBy || null,
      // 사용자 친화 표현: partition 이면 "월별 상위 5개 자재", 아니면 "상위 5개 자재"
      titlePhrase: isPartitioned
        ? `${computed.topN.partitionBy || '그룹'}별 상위 ${computed.topN.n}${unit.unitCounter} ${unit.unitLabel}`
        : `상위 ${computed.topN.n}${unit.unitCounter} ${unit.unitLabel}`,
      rows: rowsForSummary.map(r => {
        const out = {};
        for (const k of Object.keys(r)) {
          const v = r[k];
          out[k] = typeof v === 'bigint' ? Number(v) : v;
        }
        return out;
      }),
    };
  }

  // Contribution
  if (computed.contribution) {
    summary.contribution = {
      total: computed.contribution.total,
      // 사용자 친화 표현
      totalTargetPhrase: `${unit.unitLabelPhrase} 전체`,
      topRows: computed.contribution.rows.slice(0, 10).map(r => {
        const out = {};
        for (const k of Object.keys(r)) {
          const v = r[k];
          out[k] = typeof v === 'bigint' ? Number(v) : v;
        }
        return out;
      }),
    };
  }

  // 기간 비교
  if (execRecord.priorRows && execRecord.priorRows.length > 0) {
    summary.priorPeriodRowCount = execRecord.priorRows.length;
    summary.priorPeriodPhrase = `이전 기간 ${unit.unitLabelPhrase} ${execRecord.priorRows.length}${unit.unitCounter}`;
  }

  // 기본 결과 샘플 (상관관계·TOP_N 없을 때 raw 결과 일부)
  if (!computed.correlation && !computed.topN && !computed.contribution && execRecord.baseRowCount > 0) {
    const baseRows = execRecord.postOps.baseRows || [];
    summary.resultSample = baseRows.slice(0, 20).map(r => {
      const out = {};
      for (const k of Object.keys(r)) {
        const v = r[k];
        out[k] = typeof v === 'bigint' ? Number(v) : v;
      }
      return out;
    });
    summary.resultSampleTotalRows = baseRows.length;
  }

  // 산식 (사용자 질문에서 언급된 지표만)
  const usedFormulas = (plan.metrics || [])
    .filter(m => m && m.name && m.formula)
    .map(m => `- **${m.name}** = \`${m.formula}\``)
    .join('\n');

  const systemPrompt = `당신은 기업 수익성 분석 전문 컨설턴트입니다.
아래는 사용자 질문을 위해 백엔드가 실제 DB에서 계산한 결과입니다.
이 결과 수치만을 근거로 사용자 질문에 답하세요.

[엄수 규칙]
1. **아래 [실제 실행 결과]에 있는 숫자만 인용**하세요. 여기 없는 숫자는 절대 만들지 마세요.
2. "일반적으로", "통상적으로" 같은 일반론 금지. 실제 계산 결과에만 근거.
3. 사용자가 명시적으로 요청하지 않은 KPI(예: 도메인 전체 매출/영업이익)는 답변에 인용하지 마세요.
4. **산식 설명이 목적이 아닙니다** — 결과 수치로 사용자 질문에 답하는 게 목적.
   산식은 결과 해석에 필요한 최소 한도로만 언급.
5. 상관관계 결과가 있으면: **상관계수 값 + 해석 + 분석 대상 수**를 명시 (아래 규칙 11~14 참조).
6. **제외된 대상이 있을 때만** 제외 사유·건수를 언급. 0 이면 언급 자체를 생략.
7. 답변은 마크다운. **YYYY년 M월** 형식의 년월은 반드시 굵게.
8. 500~800자 내외로 결과 중심으로 작성. 완결된 문장으로 종료.
9. 실행 오류가 있으면 사용자에게 짧게 안내하고 원인 확정 어려움을 명시. 임의 결과 만들지 말 것.
10. **variance=0 (분산 0) 로 상관계수가 null 인 경우**:
    - 해당 축의 값이 전 행 동일하다는 사실을 결과로 보고.
    - 상관계수를 임의로 만들지 말 것.
    - "산식 재검토가 필요"하다는 안내를 짧게 첨부.

[숫자 표기 형식 규칙 — 매우 중요]
10-1. **금액·수량 등 진짜 수치는 반드시 천 단위 콤마**로 표기하세요.
    - ✗ 금지: "2026년 1월 -2063050449" / "영업이익 1764315604"
    - ✓ 권장: "**2026년 1월** -2,063,050,449원" / "영업이익 1,764,315,604원"
    - 원화 금액은 뒤에 "원" 을 붙여도 되고 생략해도 됨. 다만 컨텍스트가 애매하면 붙일 것.

10-2. **날짜·연월 코드(CALMONTH, YYYYMM 형태)에는 절대 콤마를 넣지 마세요.**
    - ✗ 금지: "202,601" / "2026,03"
    - ✓ 권장: "**2026년 1월**" (한국어 년월 형식이 최우선)
    - 원본 코드값(예: 202601) 을 그대로 노출해야 한다면 콤마 없이 "202601" 로.

10-3. **비율·이율(0~1 범위 소수 또는 %)은 자연스럽게** 표기.
    - 소수 그대로: 0.0824 (내부용 로그 스타일)
    - 또는 백분율: 8.24% (사용자 친화적, 권장)
    - 같은 답변 안에서 스타일을 일관되게 유지.

10-4. **음수 값은 앞에 마이너스(-) 부호**를 붙이고 콤마는 마이너스 뒤 숫자에 적용.
    - ✓ 예: -2,063,050,449 / -224,513,132

10-5. **결과표에 이미 표기되는 세부 수치**를 답변 텍스트에 재현할 때도 위 규칙을 그대로 적용.

[분석 대상 수 표현 규칙 — 매우 중요]
11. **"유효 건수", "제외 건수" 라는 generic 표현을 절대 쓰지 마세요.**
    반드시 [실제 실행 결과] 의 \`analysisUnit\` 및 각 op 의 \`analyzedTargetPhrase\` 를 그대로 사용.
    - ✗ 금지: "유효 건수: 84건", "제외 건수: 0건", "유효 데이터 84개"
    - ✓ 권장: "분석 대상 거래처: 84개", "상위 5개 거래처", "분석 대상 기간: 12개월"
    수량사는 대상에 맞게: 거래처/품목/플랜트/제품군 → "개", 월 → "개월", 연도 → "년", 원천 데이터 → "건".

12. **excludedCount 가 0 이면 제외 관련 문장·항목을 아예 출력하지 마세요.**
    - ✗ 금지: "제외된 거래처: 0개", "제외 데이터: 없음", "제외 건수 0건"
    - ✓ 기본 출력: 상관계수 값 + 해석 + 분석 대상 수 만.
    필요 시 자연어 한 문장으로 "산식 계산이 가능한 거래처 84개를 모두 분석에 반영했습니다." 정도만 허용.
    "모든 거래처가 포함되었습니다" 같은 범위가 모호한 표현은 금지 — 반드시 "분석 대상 거래처 84개가 모두" 형태로.

13. **excludedCount > 0 인 경우에만** 다음 형식으로 상세 안내:
    "전체 후보 거래처 X개 중 [사유 요약] Y개를 제외하고, 최종 Z개 거래처를 대상으로 분석했습니다."
    (X = totalCandidateCount, Y = excludedCount, Z = validCount).

14. TOP-N / Contribution / 기타 op 도 동일 원칙:
    분석 단위(거래처/품목/기간 등)를 명시하고, 수량사는 맞는 것으로.
    내부 필드명(baseRowCount, validCount, excludedCount, priorPeriodRowCount 등)을
    **그대로 사용자 답변에 노출하지 마세요.** 반드시 \`analyzedTargetPhrase\` /
    \`titlePhrase\` / \`totalTargetPhrase\` / \`priorPeriodPhrase\` 등을 활용.

[답변 구성 및 표 중복 방지 규칙 — 매우 중요]
15. **거래처별/품목별/기간별 계산 결과표는 별도 UI 컴포넌트로 사용자에게 표시됩니다.**
    → 답변 텍스트 안에 이 표를 마크다운 표(| A | B |) 로 다시 그리지 마세요. **표 반복 금지**.
    - ✗ 금지: 답변에 \`| 거래처 | 순매출 | 영업이익 | ... |\` 같은 세부 데이터 표 포함
    - ✓ 권장: 답변은 요약 텍스트만 (상관계수, 해석, 분석 대상 수).
    특정 거래처를 언급하려면 문장으로 서술 (예: "매출액이 가장 큰 거래처는 A입니다").
    단, TOP-N 결과의 순위표는 op 특성상 표시 가치가 있으므로 6행 이하일 때만 허용.

16. **답변은 다음 순서로 구성**:
    (1) 전체 분석 결과 요약 (예: 상관계수 값 + 해석 문장)
    (2) 분석 대상 수 (예: "분석 대상 거래처 84개")
    (3) [\`excludedCount > 0\` 인 경우에만] 제외 사유·건수 안내 (규칙 13 형식)
    (4) 필요 시 짧은 해석 보조 문장 (사용자 이해를 돕는 결론)
    → 상세 계산 결과 표는 별도 UI에서 표시되므로 텍스트에 포함하지 않음.`;

  const userContent = `[사용자 원문 질문]
${query}

[적용된 기간 및 도메인]
- 기간: ${cmLabel}
- 도메인: ${domainVal}

[사용자 질문에서 필요한 지표 산식]
${usedFormulas || '(별도 산식 없음)'}

[실제 실행 결과 — 백엔드가 계산한 값]
${JSON.stringify(summary, null, 2)}

[사용자 목적(계획 단계에서 판단)]
${plan.userGoal || ''}

위 실제 결과만 근거로 사용자 질문에 답변하세요.`;

  const completion = await openai.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 0.3,
    max_tokens: 2500,
  });
  let answer = completion.choices[0].message.content.trim();
  answer = boldYearMonth(answer);
  return { answer, summary };
}

// ────────────────────────────────────────────────────────────
// [5] generateConceptAnswer — 개념/산식 설명 (DB 조회 없음, plan 기반)
// ────────────────────────────────────────────────────────────
async function generateConceptAnswer(query, plan, activeDomain) {
  // 학습관리 산식 카탈로그를 참고할 수 있도록 짧게 전달
  let metricLines = '';
  try {
    const metricMap = await loadMetricMap(activeDomain || 'PS');
    const lines = [];
    for (const [code, meta] of Object.entries(metricMap)) {
      if (!meta || !meta.description) continue;
      const expanded = expandMetricFormula(meta.formula, metricMap, new Set([code]), 0);
      let sqlExpr;
      if (meta.aggregation === 'CALC') sqlExpr = expanded;
      else if (meta.aggregation === 'SUM') sqlExpr = `SUM(${expanded})`;
      else sqlExpr = `${meta.aggregation}(${expanded})`;
      lines.push(`- ${meta.description} = ${sqlExpr}`);
    }
    metricLines = lines.join('\n');
  } catch(_) {}

  const systemPrompt = `당신은 기업 수익성·재무 데이터 도메인 전문가입니다.
사용자가 용어나 개념·산식의 설명을 요청했습니다. **실제 데이터 조회 없이** 정의와 산식만 간결하게 설명하세요.

[규칙]
- 한국어. 200~500자 내외.
- 마크다운. 핵심 용어는 굵게.
- 실제 데이터 수치는 절대 인용하지 마세요 (수치는 없음).
- 사용자가 학습관리에 등록한 산식이 있으면 그 산식을 우선 인용.

[학습관리 등록 산식 (참고용)]
${metricLines || '(없음)'}
`;
  const completion = await openai.chat.completions.create({
    model: GPT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ],
    temperature: 0.2,
    max_tokens: 900,
  });
  let answer = completion.choices[0].message.content.trim();
  answer = boldYearMonth(answer);
  return answer;
}

// ============================================================
// Helper: SQL 사전 검증 (LLM이 생성한 SQL의 명백한 오류 패턴 탐지)
// - LLM이 만들 수 있는 "Invalid use of group function" 같은 실행 시 오류를
//   실행 전에 잡아내어 자동 재요청 또는 친절한 에러 메시지로 전환
// - 검증 통과 시 { valid: true }, 실패 시 { valid: false, reason: '...' }
// ============================================================
function validateSqlPreExecution(sql) {
  if (!sql || typeof sql !== 'string') {
    return { valid: false, reason: 'SQL이 비어있습니다.' };
  }

  const sqlUpper = sql.toUpperCase();

  // 검사 1: WHERE 절에 집계함수 사용 검출
  //   - "WHERE ... SUM(...)" / "WHERE ... AVG(...)" 등은 MariaDB에서 즉시 에러
  //   - HAVING 절은 허용되므로 WHERE..HAVING 구간만 검사
  const whereStart = sqlUpper.search(/\bWHERE\b/);
  if (whereStart >= 0) {
    // WHERE 절의 종료 지점 찾기: GROUP BY / HAVING / ORDER BY / LIMIT / UNION / 끝
    const afterWhere = sql.slice(whereStart);
    const terminatorMatch = afterWhere.match(/\b(GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION)\b/i);
    const whereEnd = terminatorMatch
      ? whereStart + terminatorMatch.index
      : sql.length;
    const whereClause = sql.slice(whereStart, whereEnd);

    // WHERE 절 안에 집계함수가 (서브쿼리 밖에서) 사용되었는지 검사
    // 단, 서브쿼리 안의 집계함수는 정상이므로 제외해야 함
    // 간단한 휴리스틱: 서브쿼리(괄호) 안의 내용은 제거하고 검사
    let stripped = whereClause;
    let prev;
    do {
      prev = stripped;
      // 가장 안쪽 괄호부터 제거 (서브쿼리/함수 호출은 일단 제거)
      stripped = stripped.replace(/\([^()]*\)/g, '');
    } while (stripped !== prev);

    // 이제 stripped에는 서브쿼리/함수 호출이 제거된 WHERE 절만 남음
    // 그런데 SUM(...) 같은 형태도 괄호 안이 제거되면서 "SUM" 토큰만 남음
    // 즉 stripped에 "SUM" "AVG" "COUNT" "MAX" "MIN" 토큰이 보이면 → 그건 WHERE 안 집계함수
    const aggFnPattern = /\b(SUM|AVG|COUNT|MAX|MIN)\b/i;
    if (aggFnPattern.test(stripped)) {
      const matched = stripped.match(aggFnPattern);
      return {
        valid: false,
        reason: `WHERE 절에 집계함수 ${matched[1].toUpperCase()}()가 사용되었습니다. 집계 결과로 필터링하려면 HAVING 절을 사용해야 합니다.`,
      };
    }
  }

  // 검사 2: GROUP BY 없이 집계함수와 일반 컬럼이 SELECT에 함께 있는지 (간이 검사)
  //   - SELECT 절만 추출
  const selectMatch = sql.match(/SELECT\s+([\s\S]*?)\s+FROM\s/i);
  if (selectMatch) {
    const selectClause = selectMatch[1];
    // 집계함수 사용 여부
    const hasAgg = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(selectClause);
    // GROUP BY 존재 여부
    const hasGroupBy = /\bGROUP\s+BY\b/i.test(sql);

    if (hasAgg && !hasGroupBy) {
      // 집계 + 일반 컬럼 혼용 검사:
      //   SELECT 항목을 콤마로 분리하되 괄호 안 콤마는 무시
      const items = [];
      let depth = 0, buf = '';
      for (const ch of selectClause) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) {
          items.push(buf.trim());
          buf = '';
        } else {
          buf += ch;
        }
      }
      if (buf.trim()) items.push(buf.trim());

      // 각 항목이 집계함수를 포함하는지 검사
      let plainColumnCount = 0;
      let aggColumnCount = 0;
      for (const item of items) {
        // AS alias / 그냥 표현 모두 검사 대상은 표현부 자체
        const expr = item.split(/\s+AS\s+/i)[0].trim();
        if (/\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(expr)) {
          aggColumnCount++;
        } else if (expr && expr !== '*') {
          // 상수/표현식은 제외하고 컬럼 참조로 보이는 것만 카운트
          // 예: '문자열', 123, NOW() 등은 제외
          if (!/^['"]/.test(expr) && !/^\d+(\.\d+)?$/.test(expr)) {
            // CASE WHEN, IF 등은 일반 컬럼 아님 → 그냥 패스 (보수적 판단)
            if (!/\b(CASE|IF|COALESCE|IFNULL|NULLIF)\s*[\(\s]/i.test(expr)) {
              plainColumnCount++;
            }
          }
        }
      }

      if (aggColumnCount > 0 && plainColumnCount > 0) {
        return {
          valid: false,
          reason: `GROUP BY 없이 집계함수와 일반 컬럼(${plainColumnCount}개)이 SELECT 절에 혼용되었습니다. GROUP BY 절을 추가하거나 일반 컬럼을 제거해야 합니다.`,
        };
      }
    }
  }

  // 검사 3: HAVING 절이 GROUP BY 없이 사용되는 경우 (드물지만 가능)
  //   - 일부 DB는 허용하나 위험 패턴이므로 통과시킴 (false positive 방지)

  return { valid: true };
}

// ============================================================
// [2026-06-16] Helper: 기존 DIVISION 조건을 SQL 에서 제거 (학습 SQL 재사용 대응)
// ------------------------------------------------------------
// 학습된 SQL 은 검증 당시의 도메인에 박혀있을 수 있음 (예: PS 에서 검증되면 DIVISION='10').
// 사용자가 도메인을 변경하면 (HL/MGMT) 기존 DIVISION 조건이 오작동의 원인이 됨.
// → applyDomainFilter 직전에 이 함수로 기존 DIVISION 조건을 안전하게 제거하고,
//   현재 선택 도메인 기준으로 재주입하도록 함.
//
// 대응 패턴 (대소문자 무시):
//   - DIVISION = '10'           → 삭제
//   - DIVISION = "10"           → 삭제
//   - DIVISION IN ('10','20')   → 삭제
//   - DIVISION <> '10'          → 삭제
//   - DIVISION_NM 같은 다른 컬럼은 단어경계(\b)로 보호되므로 영향 없음
//
// 안전장치:
//   - bw_profitability_data 미참조 SQL 은 그대로 반환
//   - 조건 제거 후 WHERE 만 남거나 AND/OR 가 노출되면 정리
//   - 서브쿼리/JOIN 안의 DIVISION 도 동일하게 제거 (SQL 전체 대상)
// ============================================================
function scrubDivisionFilter(inputSql) {
  if (!inputSql) return inputSql;
  if (!/\bbw_profitability_data\b/i.test(inputSql)) return inputSql;
  if (!/\bDIVISION\b/i.test(inputSql)) return inputSql;

  let s = inputSql;

  // 패턴 1: DIVISION <op> '값' 또는 "값" 또는 숫자
  //   예) DIVISION = '10' / DIVISION <> '20' / DIVISION = 10
  const opValuePattern = /\bDIVISION\s*(?:=|<>|!=|<|>|<=|>=)\s*(?:'[^']*'|"[^"]*"|\d+)/gi;
  // 패턴 2: DIVISION IN ('10','20') 또는 DIVISION NOT IN (...)
  const inPattern = /\bDIVISION\s+(?:NOT\s+)?IN\s*\([^)]*\)/gi;
  // 패턴 3: DIVISION LIKE '...' / DIVISION BETWEEN x AND y
  const likePattern = /\bDIVISION\s+LIKE\s+(?:'[^']*'|"[^"]*")/gi;
  const betweenPattern = /\bDIVISION\s+BETWEEN\s+\S+\s+AND\s+\S+/gi;

  // 각 패턴을 자리표시자로 치환 후, 주변 AND/OR 와 함께 정리
  // → "AND DIVISION = '10'" / "DIVISION = '10' AND" / "(DIVISION = '10')" 등 모두 케어
  const placeholders = [opValuePattern, inPattern, likePattern, betweenPattern];
  for (const p of placeholders) {
    s = s.replace(p, '__DIVCOND__');
  }

  // 주변 정리:
  // (1) "AND __DIVCOND__"  →  ""
  // (2) "__DIVCOND__ AND"  →  ""
  // (3) "OR __DIVCOND__"   →  ""  (드물지만 안전망)
  // (4) "__DIVCOND__ OR"   →  ""
  // (5) "(__DIVCOND__)"    →  ""  (괄호로 단독 감싸진 경우)
  // (6) 그래도 남으면 그냥 제거
  s = s.replace(/\(\s*__DIVCOND__\s*\)/g, '__DIVCOND__'); // 단독 괄호 평탄화
  s = s.replace(/\bAND\s+__DIVCOND__\b/gi, '');
  s = s.replace(/\b__DIVCOND__\s+AND\b/gi, '');
  s = s.replace(/\bOR\s+__DIVCOND__\b/gi, '');
  s = s.replace(/\b__DIVCOND__\s+OR\b/gi, '');
  s = s.replace(/__DIVCOND__/g, '');

  // 빈 WHERE 정리:
  //   WHERE  GROUP BY / ORDER BY / LIMIT / HAVING / UNION / ) / ;  →  WHERE 제거
  s = s.replace(/\bWHERE\s+(?=(GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION|\)|;|$))/gi, '');
  // WHERE AND ... → WHERE ...
  s = s.replace(/\bWHERE\s+AND\b/gi, 'WHERE');
  // WHERE OR ... → WHERE ...
  s = s.replace(/\bWHERE\s+OR\b/gi, 'WHERE');
  // 연속 공백 정리
  s = s.replace(/\s{2,}/g, ' ').trim();

  if (s !== inputSql) {
    console.log('[NLQ] 기존 DIVISION 조건 제거 (scrubDivisionFilter)');
  }
  return s;
}

function applyDomainFilter(inputSql, domainCode) {
  if (!inputSql) return inputSql;
  const dc = (domainCode || '').toUpperCase();
  // PS, HL 외의 도메인(MGMT, null 등)은 강제 필터 적용 안 함
  const divisionMap = { PS: '10', HL: '20' };
  const targetDivision = divisionMap[dc];
  if (!targetDivision) return inputSql;

  // 대상 테이블을 참조하지 않으면 적용 안 함
  if (!/\bbw_profitability_data\b/i.test(inputSql)) return inputSql;

  // 이미 DIVISION 조건이 SQL 어딘가에 있으면 중복 추가 금지
  // (DIVISION_NM 같은 다른 컬럼은 단어경계로 구분되므로 영향 없음)
  // ※ 학습 SQL 재사용 시 도메인 변경 케이스는 호출측에서 scrubDivisionFilter() 로
  //   먼저 기존 조건을 제거한 뒤 이 함수를 호출해야 함.
  if (/\bDIVISION\b\s*(=|<>|!=|<|>|\sIN\b|\sLIKE\b|\sBETWEEN\b)/i.test(inputSql)) {
    return inputSql;
  }

  // WHERE 절이 있는지 검사. 첫 번째 WHERE의 기존 조건을 괄호로 감싸고
  // 앞에 DIVISION = '<val>' AND 를 삽입.
  // WHERE의 종료 지점은 GROUP BY / HAVING / ORDER BY / LIMIT / UNION / 서브쿼리 끝 ')' / 세미콜론 / SQL 끝
  //
  // ★ 괄호/문자열 리터럴을 고려한 안전한 종료 지점 탐색 (2026-07-03 버그픽스):
  //   - 단순 정규식 /\)|;|$/ 은 REPLACE(MATERIAL_NM, ' ', '') 같은 함수 호출 안의 ')' 를
  //     WHERE 종료로 잘못 인식하는 문제가 있음.
  //   - 이를 방지하기 위해 문자열 밖 & 괄호 뎁스 0 에서만 종료 토큰을 인식하도록 수동 스캔.
  const whereEndKeywords = /^(GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION)\b/i;
  function findWhereEnd(rest) {
    let depth = 0;
    let inStr = false;
    let strCh = null;
    for (let i = 0; i < rest.length; i++) {
      const ch = rest[i];
      if (inStr) {
        // 문자열 리터럴 종료 (기본 SQL: '' 이스케이프, 여기선 단순 매칭)
        if (ch === strCh) {
          // 연속 두 개는 이스케이프
          if (rest[i + 1] === strCh) { i++; continue; }
          inStr = false;
          strCh = null;
        }
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') {
        inStr = true; strCh = ch; continue;
      }
      if (ch === '(') { depth++; continue; }
      if (ch === ')') {
        if (depth === 0) return i;   // 서브쿼리 종료 ')'
        depth--; continue;
      }
      if (depth !== 0) continue;
      if (ch === ';') return i;
      // 키워드 검사 (뎁스 0 에서만)
      if (whereEndKeywords.test(rest.slice(i))) return i;
    }
    return -1;
  }
  const whereRegex = /\bWHERE\b\s+/i;
  const whereMatch = whereRegex.exec(inputSql);

  let result;
  if (whereMatch) {
    const before = inputSql.slice(0, whereMatch.index + whereMatch[0].length);
    const rest = inputSql.slice(whereMatch.index + whereMatch[0].length);
    // rest 안에서 WHERE 종료 지점을 찾는다 (괄호/문자열 인식)
    const endIdx = findWhereEnd(rest);
    let cond, tail;
    if (endIdx >= 0) {
      cond = rest.slice(0, endIdx).trim();
      tail = rest.slice(endIdx);
    } else {
      cond = rest.trim();
      tail = '';
    }
    // 빈 WHERE가 들어오는 경우는 거의 없지만 안전 처리
    const wrapped = cond ? `DIVISION = '${targetDivision}' AND (${cond})` : `DIVISION = '${targetDivision}'`;
    // 종료 토큰 앞에 공백 보장
    const sep = tail && !tail.startsWith(' ') && !tail.startsWith(';') && !tail.startsWith(')') ? ' ' : '';
    result = `${before}${wrapped}${sep}${tail}`;
  } else {
    // WHERE가 없으면 FROM bw_profitability_data [별칭?] 뒤에 WHERE 추가
    // 별칭은 SQL 예약어(WHERE/GROUP/HAVING/ORDER/LIMIT/UNION/JOIN/ON 등)가 아니어야 함
    const reservedAfterFrom = /^(?:WHERE|GROUP|HAVING|ORDER|LIMIT|UNION|JOIN|LEFT|RIGHT|INNER|OUTER|CROSS|ON)$/i;
    const fromRegex = /\bFROM\s+bw_profitability_data\b(\s+(?:AS\s+)?([A-Za-z_][A-Za-z0-9_]*))?/i;
    const fromMatch = fromRegex.exec(inputSql);
    if (!fromMatch) return inputSql; // 이상 케이스: 안전하게 원본 반환
    // 캡처된 별칭이 SQL 예약어이면 별칭이 아니라 다음 절이므로 매치 길이를 조정
    let matchLen = fromMatch[0].length;
    if (fromMatch[2] && reservedAfterFrom.test(fromMatch[2])) {
      // 별칭 부분(공백 + 키워드)을 매치에서 제외
      matchLen = fromMatch[0].length - fromMatch[1].length;
    }
    const insertPos = fromMatch.index + matchLen;
    const before = inputSql.slice(0, insertPos);
    const rest = inputSql.slice(insertPos);
    // rest의 첫 토큰이 GROUP/HAVING/ORDER/LIMIT/UNION/세미콜론/끝이면 그 앞에 WHERE 삽입
    // (findWhereEnd 를 재사용 — 괄호/문자열 인식)
    const endIdx = findWhereEnd(rest);
    if (endIdx > 0) {
      const head = rest.slice(0, endIdx);
      const tail = rest.slice(endIdx);
      result = `${before}${head} WHERE DIVISION = '${targetDivision}' ${tail}`;
    } else if (endIdx === 0) {
      // 바로 다음에 절이 오는 경우 (예: FROM bw_profitability_data ORDER BY ...)
      result = `${before} WHERE DIVISION = '${targetDivision}' ${rest}`;
    } else {
      result = `${before} WHERE DIVISION = '${targetDivision}'${rest}`;
    }
  }

  if (result !== inputSql) {
    console.log(`[NLQ] 도메인 필터 자동 주입 (${dc} → DIVISION='${targetDivision}')`);
  }
  return result;
}

// ============================================================
// [★★★ 사업부 명칭 고정 매핑 규칙 (2026-07-03) ★★★]
//   - DB 저장 값이 배포 환경별로 다를 수 있음:
//       'PS'/'HL' (샌드박스)  vs  '페이퍼솔루션'/'홈앤라이프' (운영)
//   - LLM 은 흔히 사용자가 쓴 표현 그대로 DIVISION_NM='HL' 같은 조건을 만드는데,
//     실제 DB DIVISION_NM 이 다른 값이면 결과가 0건이 됨.
//   - 정책: 사업부 필터는 항상 **DIVISION 코드** 로 표준화 (환경 무관하게 정상 동작)
//       PS/페이퍼솔루션/PS사업부 → DIVISION = '10'
//       HL/홈앤라이프/HL사업부   → DIVISION = '20'
// ============================================================

/**
 * 사용자 질의에서 HL/PS 사업부 언급을 감지.
 *   포괄 표현 - 지원되는 별칭:
 *     PS 계열: 'PS', 'ps', 'PS사업부', 'PS 사업부', '페이퍼솔루션', '페이퍼솔루션 사업부'
 *     HL 계열: 'HL', 'hl', 'HL사업부', 'HL 사업부', '홈앤라이프', '홈앤라이프 사업부'
 *
 *   ★ 오탐 방지:
 *     - PS/HL 은 대문자 단독 토큰일 때만 매칭 (한글/영숫자 뒤에 붙은 부분 문자열 제외)
 *       (예: "APS" / "HELP" / "psi" 는 매칭 안 됨)
 *     - '페이퍼솔루션'/'홈앤라이프' 는 한글이므로 앞뒤 한글 아닐 때만 (여기선 완전 별칭)
 *
 * @param {string} query 자연어 질의
 * @returns {{division: '10'|'20'|null, divisionCode: 'PS'|'HL'|null, matchedText: string|null}}
 */
function detectDivisionInQuery(query) {
  if (!query || typeof query !== 'string') {
    return { division: null, divisionCode: null, matchedText: null };
  }

  // 한글 포괄 표현 (가장 명확)
  //   앞: 한글이 아니거나 문자열 시작
  //   뒤: 문장부호/공백/조사/사업부/기타 표현 허용
  const HL_KOR = /(?<![가-힣])홈앤라이프(?:\s*사업부)?(?![가-힣])/;
  const PS_KOR = /(?<![가-힣])페이퍼솔루션(?:\s*사업부)?(?![가-힣])/;

  // 영문 약칭 표현 (오탐 방지)
  //   앞: 한글/영숫자 아님 (문자열 시작 또는 공백/구두점)
  //   뒤: '사업부' 또는 한글/영숫자 아님 (공백/구두점/문장끝)
  //   대소문자 무시 (예: hl, HL, Hl 모두 허용)
  const HL_ENG = /(?<![가-힣A-Za-z0-9])HL(?:\s*사업부)?(?![A-Za-z0-9])/i;
  const PS_ENG = /(?<![가-힣A-Za-z0-9])PS(?:\s*사업부)?(?![A-Za-z0-9])/i;

  let hlMatch = HL_KOR.exec(query) || HL_ENG.exec(query);
  let psMatch = PS_KOR.exec(query) || PS_ENG.exec(query);

  // 둘 다 매칭되면 정책상 "먼저 나온 것" 우선 (일반적으로 사용자가 초점 두는 사업부)
  //   실제로는 두 개가 동시에 등장하는 케이스는 드물지만, 이런 경우 명확한 우선순위 필요.
  if (hlMatch && psMatch) {
    return hlMatch.index < psMatch.index
      ? { division: '20', divisionCode: 'HL', matchedText: hlMatch[0] }
      : { division: '10', divisionCode: 'PS', matchedText: psMatch[0] };
  }
  if (hlMatch) return { division: '20', divisionCode: 'HL', matchedText: hlMatch[0] };
  if (psMatch) return { division: '10', divisionCode: 'PS', matchedText: psMatch[0] };
  return { division: null, divisionCode: null, matchedText: null };
}

/**
 * SQL 후처리: 잘못된 DIVISION_NM 조건을 DIVISION 코드 조건으로 자동 교정.
 *
 *   교정 대상 (LLM 이 흔히 만드는 잘못된 패턴):
 *     - DIVISION_NM = 'HL' / "HL" → DIVISION = '20'
 *     - DIVISION_NM = 'PS' / "PS" → DIVISION = '10'
 *     - DIVISION_NM = '홈앤라이프' / "홈앤라이프" → DIVISION = '20'
 *     - DIVISION_NM = '페이퍼솔루션' / "페이퍼솔루션" → DIVISION = '10'
 *     - DIVISION_NM LIKE '%HL%' → DIVISION = '20'
 *     - DIVISION_NM LIKE '%PS%' → DIVISION = '10'
 *     - DIVISION_NM LIKE '%홈앤라이프%' → DIVISION = '20'
 *     - DIVISION_NM LIKE '%페이퍼솔루션%' → DIVISION = '10'
 *
 *   ★ 다른 DIVISION_NM 값(예: 특정 배포 환경에서 '생활용품' 같은 특수 케이스)은 건드리지 않음.
 *     오직 위 알려진 별칭만 안전하게 교정.
 *
 * @param {string} inputSql
 * @returns {string} 교정된 SQL
 */
function normalizeDivisionFilter(inputSql) {
  if (!inputSql || typeof inputSql !== 'string') return inputSql;
  let s = inputSql;
  const rewrites = [];

  // 1) 등호 매칭: DIVISION_NM = 'X' / "X"
  //    쿼트 안의 값이 아래 별칭이면 DIVISION = '코드' 로 교체
  //    (연산자: = , <> , != , IS  — 여기선 =/IN 만 다룸)
  const EQ_MAP = {
    HL: '20', hl: '20',
    PS: '10', ps: '10',
    '홈앤라이프': '20',
    '페이퍼솔루션': '10',
    '홈앤라이프사업부': '20',
    '페이퍼솔루션사업부': '10',
  };
  for (const [alias, code] of Object.entries(EQ_MAP)) {
    // 따옴표 안에 공백이 들어간 경우도 지원: '홈앤라이프 사업부'
    const aliasSpaced = alias.replace('사업부', ' 사업부');
    for (const a of [alias, aliasSpaced]) {
      // = 매칭
      const eqRe = new RegExp(`\\bDIVISION_NM\\s*=\\s*['"]${escapeRegex(a)}['"]`, 'g');
      s = s.replace(eqRe, (m) => {
        rewrites.push(`${m} → DIVISION = '${code}'`);
        return `DIVISION = '${code}'`;
      });
    }
  }

  // 2) LIKE 매칭: DIVISION_NM LIKE '%X%' 형태
  //    LIKE 는 % 위치가 다양하므로 (앞/뒤/양쪽) 안에 별칭 문자열이 포함되면 교정
  const LIKE_ALIASES = Object.entries(EQ_MAP);
  for (const [alias, code] of LIKE_ALIASES) {
    const likeRe = new RegExp(
      `\\bDIVISION_NM\\s+(?:NOT\\s+)?LIKE\\s+['"][%_]*${escapeRegex(alias)}[%_]*['"]`,
      'gi'
    );
    s = s.replace(likeRe, (m) => {
      // NOT LIKE 는 부정이므로 조심 — 반대 코드로 하면 오작동. 단순히 건드리지 않음.
      if (/\bNOT\s+LIKE\b/i.test(m)) return m;
      rewrites.push(`${m} → DIVISION = '${code}'`);
      return `DIVISION = '${code}'`;
    });
  }

  // 3) IN 매칭: DIVISION_NM IN ('HL','PS',...) → 원소 하나짜리이거나 명확한 케이스만 처리.
  //    복수 IN 은 정책 결정이 애매하므로 여기서는 건드리지 않음 (안전 우선).

  if (rewrites.length > 0) {
    console.log(`[NLQ] DIVISION_NM 조건 자동 교정: ${rewrites.join(' | ')}`);
  }
  return s;
}

// 정규식 특수문자 이스케이프
function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 질의 텍스트 기반 DIVISION 강제 주입 (applyDomainFilter 의 확장).
 *   - MGMT 도메인이라도 질문에 "HL 영업이익" 같은 표현이 있으면 DIVISION='20' 을 강제 주입
 *   - PS/HL 도메인이면서 질문에 반대 사업부가 명시된 경우는 사용자 의도가 명확하므로
 *     질문 언급을 우선 (applyDomainFilter 의 도메인 조건은 scrubDivisionFilter 로 미리 제거된 후 실행되어야 안전)
 *   - 이미 SQL 에 DIVISION 조건이 있으면 건드리지 않음
 *
 * @param {string} inputSql
 * @param {string} query 원본 자연어 질의
 * @returns {string}
 */
function applyDivisionFromQuery(inputSql, query) {
  if (!inputSql || typeof inputSql !== 'string') return inputSql;
  const det = detectDivisionInQuery(query);
  if (!det.division) return inputSql;
  // bw_profitability_data 참조하지 않으면 건드리지 않음
  if (!/\bbw_profitability_data\b/i.test(inputSql)) return inputSql;
  // 이미 DIVISION 조건 있으면 skip (applyDomainFilter 와 동일 정책)
  if (/\bDIVISION\b\s*(=|<>|!=|<|>|\sIN\b|\sLIKE\b|\sBETWEEN\b)/i.test(inputSql)) {
    return inputSql;
  }
  // 없으면 applyDomainFilter 와 동일 로직으로 주입
  // → 임시 도메인 코드를 만들어 applyDomainFilter 를 재사용
  const before = inputSql;
  const injected = applyDomainFilter(inputSql, det.divisionCode);
  if (injected !== before) {
    console.log(`[NLQ] 질의 텍스트 기반 DIVISION 강제 주입: "${det.matchedText}" → DIVISION='${det.division}'`);
  }
  return injected;
}

// ============================================================
// [★★★ 자재명/고객명 공백 무시 검색 규칙 (2026-07-03) ★★★]
//   - DB 저장 값: "깨끗한나라 순수소프티 100매" (공백 포함)
//   - 사용자 입력: "순수소프티100매" (공백 없이)
//     → 일반 LIKE 로는 매칭 실패
//   - 정책: MATERIAL_NM / CUSTOMER_NM 컬럼의 =, LIKE 비교 시
//     양쪽(컬럼값과 검색 리터럴) 모두 공백을 제거한 뒤 비교
//         REPLACE(MATERIAL_NM, ' ', '') LIKE '%공백제거값%'
//   - 다른 컬럼(예: DIVISION_NM)에는 적용 안 함 (안전)
//   - 이미 REPLACE 로 감싸진 조건은 중복 처리하지 않음 (멱등성)
// ============================================================

/**
 * SQL 후처리: MATERIAL_NM / CUSTOMER_NM 을 대상으로 하는
 *   =, <>, !=, LIKE, NOT LIKE 조건을 REPLACE(컬럼, ' ', '') 형태로 변환.
 *
 * 처리 케이스 (case-insensitive, 컬럼명은 별칭 포함):
 *   1) MATERIAL_NM LIKE '%X%'                → REPLACE(MATERIAL_NM,' ','') LIKE '%X_공백제거%'
 *   2) x.MATERIAL_NM LIKE '%X%'              → REPLACE(x.MATERIAL_NM,' ','') LIKE '%X_공백제거%'
 *   3) MATERIAL_NM NOT LIKE '%X%'            → REPLACE(MATERIAL_NM,' ','') NOT LIKE '%X_공백제거%'
 *   4) MATERIAL_NM = 'X'                     → REPLACE(MATERIAL_NM,' ','') = 'X_공백제거'
 *   5) MATERIAL_NM <> 'X' / !=               → REPLACE(MATERIAL_NM,' ','') <> 'X_공백제거'
 *   6) CUSTOMER_NM 도 동일하게 처리
 *
 * 처리하지 않는 케이스 (안전):
 *   - 이미 REPLACE(MATERIAL_NM, ...) 로 감싸진 조건
 *   - IN / IS NULL / IS NOT NULL
 *   - 서브쿼리 참조
 *
 * @param {string} inputSql
 * @returns {string}
 */
function normalizeNameSearchFilter(inputSql) {
  if (!inputSql || typeof inputSql !== 'string') return inputSql;
  let s = inputSql;
  const rewrites = [];

  const TARGET_COLS = ['MATERIAL_NM', 'CUSTOMER_NM'];

  for (const col of TARGET_COLS) {
    // 대상 컬럼 참조: 앞에 옵션 alias("t." 등) 허용, 앞뒤 단어경계 필요.
    //   또한 이미 REPLACE(...) 안에 들어있으면 처리 안 함 (negative lookbehind로 배제)
    //   MySQL/MariaDB 는 함수명 대소문자 무시 → REPLACE/replace 모두 스킵
    //   정규식:
    //     - 앞: "REPLACE(" 나 " REPLACE ( " 로 감싸진 상태가 아니어야 함
    //     - 컬럼: (알파벳_)*.MATERIAL_NM  또는  MATERIAL_NM  (대소문자 무시)
    //     - 뒤 공백 후: LIKE | NOT LIKE | = | <> | != 중 하나
    //     - 그 뒤 리터럴: '...' 또는 "..."
    //   ※ 사용자가 쓴 원본 컬럼명 (대소문자) 은 그대로 유지해 SQL 가독성 보존
    //
    // step 1) LIKE / NOT LIKE
    {
      // group1: 옵션 alias ("x." 등)
      // group2: 실제 매치된 컬럼명 (원본 그대로 보존)
      const likeRe = new RegExp(
        `(?<!\\bREPLACE\\s*\\(\\s*)((?:[A-Za-z_][A-Za-z0-9_]*\\.)?)\\b(${col})\\b` +
        `\\s+(NOT\\s+)?LIKE\\s+(['"])([^'"]*)\\4`,
        'gi'
      );
      s = s.replace(likeRe, (m, alias, colMatched, notWord, quote, val) => {
        const stripped = val.replace(/\s+/g, '');
        const notStr = notWord ? 'NOT ' : '';
        const colRef = `${alias || ''}${colMatched}`;
        rewrites.push(`${m} → REPLACE(${colRef},' ','') ${notStr}LIKE ${quote}${stripped}${quote}`);
        return `REPLACE(${colRef}, ' ', '') ${notStr}LIKE ${quote}${stripped}${quote}`;
      });
    }

    // step 2) =, <>, !=
    {
      const eqRe = new RegExp(
        `(?<!\\bREPLACE\\s*\\(\\s*)((?:[A-Za-z_][A-Za-z0-9_]*\\.)?)\\b(${col})\\b` +
        `\\s*(=|<>|!=)\\s*(['"])([^'"]*)\\4`,
        'gi'
      );
      s = s.replace(eqRe, (m, alias, colMatched, op, quote, val) => {
        const stripped = val.replace(/\s+/g, '');
        const colRef = `${alias || ''}${colMatched}`;
        rewrites.push(`${m} → REPLACE(${colRef},' ','') ${op} ${quote}${stripped}${quote}`);
        return `REPLACE(${colRef}, ' ', '') ${op} ${quote}${stripped}${quote}`;
      });
    }
  }

  if (rewrites.length > 0) {
    console.log(`[NLQ] 자재명/고객명 공백 무시 검색 자동 변환: ${rewrites.join(' | ')}`);
  }
  return s;
}

// ============================================================
// Helper: Dummy 행 제거 (결과 후필터) — 안전망
// - 서버 응답 data 배열에서 어떤 컬럼이든 값이 정확히 'Dummy' (대소문자 무시) 인 행 제거
// - SQL 자동주입이 적용 안 된 경우(서브쿼리/UNION/CTE/JOIN 등)에도 보호
// - 답변 생성용 샘플도 동일하게 거름 → LLM 답변에 Dummy 노출 차단
// ============================================================
function isDummyValue(v) {
  if (v === null || v === undefined) return false;
  // 문자열만 대상으로 — bigint/number/Date 등은 비교 대상이 아님
  if (typeof v !== 'string') return false;
  const s = v.trim().toLowerCase();
  return s === 'dummy';
}
function filterDummyRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const out = rows.filter(r => {
    if (!r || typeof r !== 'object') return true;
    // 어떤 컬럼이라도 'Dummy' 면 행 제외
    for (const k of Object.keys(r)) {
      if (isDummyValue(r[k])) return false;
    }
    return true;
  });
  const removed = rows.length - out.length;
  if (removed > 0) console.log(`[NLQ] Dummy 행 제거: ${removed}건 (${rows.length} → ${out.length})`);
  return out;
}

// ============================================================
// [REMOVED] applyDummyFilter() — SQL 단계 Dummy 제외 조건 자동 주입 제거
// - 과거: PROFIT_CTR_NM/DIVISION_NM/PLANT_NM/MATERIAL_NM 4개 컬럼에
//   하드코딩으로 NOT LIKE '%Dummy%' 조건을 무조건 주입했음
// - 사유: 실제 DB 데이터 조사 결과 4개 컬럼 모두 Dummy 값이 0건이며,
//   하드코딩된 컬럼 선정 근거도 "보수적으로 자주 노출되는 컬럼"이라는
//   주관적 기준이었음. 불필요한 SQL 노이즈를 사용자에게 노출하므로 제거.
// - 안전망 유지: filterDummyRows() 후필터가 모든 컬럼 값을 검사해
//   값이 정확히 'Dummy' 인 행을 응답에서 제거하므로,
//   미래에 어떤 컬럼에 Dummy 데이터가 들어오더라도 자동 차단됨.
// ============================================================
// Helper: 답변 문장의 "YYYY년 M월" 패턴을 **굵게** 처리
// - 입력 예: "최신 마감월인 2026년 5월(CALMONTH='202605')을 기준으로..."
// - 출력 예: "최신 마감월인 **2026년 5월**(CALMONTH='202605')을 기준으로..."
// - 이미 **로 감싸진 경우 중복 방지
// - 마크다운 굵게가 적용되지 않는 영역(코드블록 ```)은 제외
// ============================================================
function boldYearMonth(text) {
  if (!text || typeof text !== 'string') return text;
  // 코드블록(```...```) 영역은 건드리지 않음
  const parts = text.split(/(```[\s\S]*?```)/g);
  const pattern = /(\d{4})\s*년\s*(\d{1,2})\s*월/g;
  const transformed = parts.map((seg, idx) => {
    // 짝수 인덱스만 일반 텍스트 (홀수 인덱스는 코드블록)
    if (idx % 2 === 1) return seg;
    // 이미 **로 감싸진 경우: 라인 단위로 검사
    return seg.replace(pattern, (m, y, mm, offset, str) => {
      // 직전 두 글자가 ** 이면 이미 굵게 감싸진 상태
      const before = str.slice(Math.max(0, offset - 2), offset);
      const after  = str.slice(offset + m.length, offset + m.length + 2);
      if (before === '**' && after === '**') return m;
      return `**${y}년 ${parseInt(mm, 10)}월**`;
    });
  });
  return transformed.join('');
}

// ============================================================
// Helper: SQL 결과셋 컬럼명 → 한국어 라벨 매핑
// 우선순위:
//  1순위) 결과 키에 이미 한글이 포함되어 있으면 그대로 사용 (= GPT가 AS 별칭을 한국어로 지정한 경우)
//  2순위) DB COLUMN_COMMENT (INFORMATION_SCHEMA.COLUMNS)
//  3순위) ontology_column.description (학습관리 등록값, 도메인 필터)
//  최후) 원본 영문 컬럼명 그대로
// SQL에서 FROM/JOIN 으로 참조되는 테이블 후보를 추출하여 매핑 사전 구성
// ============================================================
async function resolveColumnLabels(rows, sql, domainCode) {
  const labels = {};
  if (!rows || rows.length === 0) return labels;
  const keys = Object.keys(rows[0]);
  if (keys.length === 0) return labels;

  // 결과 키에 한글이 포함되어 있는지 판별 (이미 AS 별칭으로 한국어 지정된 경우)
  const hasKorean = (s) => /[\uAC00-\uD7AF]/.test(s);

  // 한글 키는 그대로, 영문 키만 사전 조회 대상으로 수집
  const englishKeys = [];
  for (const k of keys) {
    if (hasKorean(k)) {
      labels[k] = k;
    } else {
      englishKeys.push(k);
    }
  }
  if (englishKeys.length === 0) return labels;

  // SQL에서 참조 테이블명 추출 (FROM / JOIN 뒤의 식별자)
  // 보통 bw_profitability_data 하나지만, 안전하게 다중 테이블 지원
  const tableSet = new Set();
  const tableRegex = /\b(?:FROM|JOIN)\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  let m;
  while ((m = tableRegex.exec(sql || '')) !== null) {
    tableSet.add(m[1]);
  }
  if (tableSet.size === 0) tableSet.add('bw_profitability_data'); // 폴백

  const tables = [...tableSet];

  // 2순위) DB COLUMN_COMMENT 일괄 조회
  const commentMap = {}; // upperColumnName → comment
  try {
    const placeholders = tables.map(() => '?').join(',');
    const colPlaceholders = englishKeys.map(() => '?').join(',');
    const [rowsC] = await pool.query(
      `SELECT COLUMN_NAME, COLUMN_COMMENT
         FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME IN (${placeholders})
          AND COLUMN_NAME IN (${colPlaceholders})`,
      [...tables, ...englishKeys]
    );
    for (const r of rowsC) {
      const cmt = (r.COLUMN_COMMENT || '').trim();
      if (cmt) commentMap[r.COLUMN_NAME.toUpperCase()] = cmt;
    }
  } catch (e) {
    console.error('[NLQ] COLUMN_COMMENT 조회 실패 (무시):', e.message);
  }

  // 3순위) ontology_column.description (도메인 필터)
  const ontoMap = {}; // upperColumnName → description
  try {
    const dc = domainCode || 'PS';
    const colPlaceholders = englishKeys.map(() => '?').join(',');
    const [rowsO] = await pool.query(
      `SELECT column_name, description
         FROM ontology_column
        WHERE domain_code = ?
          AND column_name IN (${colPlaceholders})`,
      [dc, ...englishKeys]
    );
    for (const r of rowsO) {
      const desc = (r.description || '').trim();
      if (desc) ontoMap[r.column_name.toUpperCase()] = desc;
    }
  } catch (e) {
    console.error('[NLQ] ontology_column 조회 실패 (무시):', e.message);
  }

  // 우선순위 적용
  for (const k of englishKeys) {
    const upper = k.toUpperCase();
    labels[k] = commentMap[upper] || ontoMap[upper] || k;
  }

  return labels;
}

// ============================================================
// API: 자연어 질의 실행
// ============================================================
// ============================================================
// [2026-07-30] 직접 SQL 입력 기능 서버측 차단 가드
// ------------------------------------------------------------
// 프론트엔드에서 [SQL] 버튼과 sqlInput 을 비활성화했지만,
// 개발자 도구·curl·mode 값 우회 등으로 사용자가 SQL 원문을 그대로 /api/nlq 에
// 밀어넣을 가능성이 있음. 이를 서버에서도 검증하여 실행하지 않도록 한다.
//
// 감지 규칙 (아래 중 하나라도 매칭되면 사용자 SQL 로 간주하여 400 반환):
//   R1) 예전 프론트가 sql 모드에서 붙였던 접두어 "직접 SQL 실행:" 로 시작
//   R2) SQL DDL/DML 파괴적 명령어로 시작
//       INSERT/UPDATE/DELETE/DROP/ALTER/CREATE/TRUNCATE/REPLACE/MERGE/
//       EXEC/EXECUTE/GRANT/REVOKE/CALL — 자연어에 절대 등장 불가
//   R3) SELECT/WITH 로 시작하되 SQL 실 문법 패턴이 이어지는 경우
//       (예: SELECT ... FROM, SELECT * , SELECT COUNT(...) 등).
//       "SELECT 절에 어떤 컬럼을 쓰면 좋을까?" 같이 뒤에 한글이 붙는 자연어
//       질문(sql_explain intent)은 통과.
// ------------------------------------------------------------
// 자연어 질문 안에 metric·컬럼명이 등장하는 것은 정상이므로 "포함" 이 아닌
// "선두 문형" 만 검사한다.
// ============================================================
function detectDirectSqlQuery(rawQuery) {
  if (!rawQuery) return null;
  let q = String(rawQuery).trim();

  // R1) 프론트 구버전이 붙였던 접두어
  if (/^직접\s*SQL\s*실행\s*[:：]/i.test(q)) {
    return { blocked: true, reason: 'legacy_direct_sql_prefix' };
  }

  // 시작 부분의 SQL 주석 스킵 (-- ... , /* ... */)
  while (true) {
    if (q.startsWith('--')) {
      const nl = q.indexOf('\n');
      if (nl < 0) break;
      q = q.slice(nl + 1).trimStart();
      continue;
    }
    if (q.startsWith('/*')) {
      const end = q.indexOf('*/');
      if (end < 0) break;
      q = q.slice(end + 2).trimStart();
      continue;
    }
    break;
  }

  // R2) 파괴적 DDL/DML 시작 — 자연어에는 등장할 수 없음, 무조건 차단
  const DESTRUCTIVE_HEAD = /^(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|EXEC|EXECUTE|GRANT|REVOKE|CALL|USE|SHOW|DESCRIBE|DESC|EXPLAIN)\b/i;
  if (DESTRUCTIVE_HEAD.test(q)) {
    return { blocked: true, reason: 'destructive_sql_head' };
  }

  // R3) SELECT/WITH 는 실제 SQL 문법이 뒤에 붙어야만 차단
  //   차단: "SELECT *", "SELECT col FROM ...", "SELECT COUNT(*)", "SELECT 1"
  //   통과(자연어): "SELECT 절에 어떤 컬럼을 쓰면 좋을까?", "WITH 절 사용법 알려줘"
  //
  //   차단 패턴:
  //     - SELECT/WITH 뒤 공백 후 * / DISTINCT / TOP / ALL / 숫자 / SQL식별자(a-z_) / ( / `
  //     - 이어서 " FROM "/" JOIN " 이 등장하는 경우 (강한 신호)
  const SQL_SELECT_HEAD_RE = /^(SELECT|WITH)\s+(\*|DISTINCT\b|TOP\b|ALL\b|COUNT\s*\(|SUM\s*\(|AVG\s*\(|MIN\s*\(|MAX\s*\(|`|"|\d+\b|[a-z_][a-z0-9_]*\s*(,|\.|\s+FROM\b|\s+AS\b|\()|\()/i;
  if (SQL_SELECT_HEAD_RE.test(q)) {
    return { blocked: true, reason: 'select_sql_pattern' };
  }
  // 추가 보강: 앞 200자 이내에 " FROM 테이블 " 패턴이 있고 SELECT/WITH 로 시작하면 SQL 로 간주
  if (/^(SELECT|WITH)\b/i.test(q) && /\bFROM\s+[`"a-z_][\w`".]*/i.test(q.slice(0, 400))) {
    return { blocked: true, reason: 'select_from_pattern' };
  }
  return null;
}

app.post('/api/nlq', captureLogsMiddleware, async (req, res) => {
  const { query, conversationContext, session_id, queryMode } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: '질의를 입력하세요.', requestId: getCurrentRequestId() });
  }
  // [2026-07-30] 직접 SQL 입력 차단 — 프론트 우회 방어
  // [2026-07-31] errorType='direct_sql_disabled' 추가 — 프론트에서 '시스템 오류' 대신
  //   회색 중립 안내(모래시계 스타일) UI 로 분기하기 위한 라우팅 키.
  //   메시지 문구도 사용자 요구사항에 맞춰 "현황집계 또는 분석질문" 안내로 통일.
  const sqlBlock = detectDirectSqlQuery(query);
  if (sqlBlock) {
    console.warn(`[SQLModeGuard][${getCurrentRequestId()}] 직접 SQL 실행 요청 차단: reason=${sqlBlock.reason}, userId=${req.session?.user?.id || '-'}, preview=${String(query).slice(0, 80).replace(/\s+/g, ' ')}`);
    return res.status(400).json({
      error: 'SQL 직접 입력은 지원하지 않습니다. 현황집계 또는 분석질문을 선택하여 자연어로 질문해 주세요.',
      code: 'DIRECT_SQL_DISABLED',
      errorType: 'direct_sql_disabled',
      requestId: getCurrentRequestId(),
    });
  }
  setRequestStage('nlq_entry');
  const activeDomain = await getActiveDomain(req);
  // ★ 도메인 미설정 방어: users.domain_code가 NULL이고 세션에도 active_domain이 없으면
  //   프론트엔드에서 분석 영역 선택 모달을 띄우도록 안내 (조직도 자동매핑 제거 정책)
  if (!activeDomain) {
    return res.status(400).json({
      error: `분석 영역이 설정되지 않았습니다. PS / HL / ${domainDisplayCode('MGMT')} 중 하나를 먼저 선택해 주세요.`,
      need_domain_select: true,
    });
  }
  // ★ 질문 유형: 'aggregate'(현황집계: 표+SQL) | 'analysis'(분석질문: 텍스트만)
  //   기본값 'aggregate' — 프론트엔드 라디오에서 명시적으로 선택 (기존 자동 키워드 감지보다 우선)
  const userQueryMode = (queryMode === 'analysis') ? 'analysis' : 'aggregate';

  // ============================================================
  // Phase 1: 후속 대화 의도 자동 분류 + 6개 신규 의도 라우팅 (PR #201)
  // - 라디오는 그대로 유지(data_query/analysis의 기본 모드)
  // - metric_lookup / ontology_lookup / troubleshooting / sql_explain
  //   / domain_explain / general_chat 은 즉시 처리하여 텍스트 응답 반환
  // - data_query / analysis 는 기존 흐름으로 통과 (try 블록으로 진입)
  //
  // ★ 2026-07 (AnalysisPlan 파이프라인 도입):
  //   사용자가 라디오에서 '분석질문'을 명시적으로 선택한 경우
  //   Phase 1 신규 intent 자동분류를 스킵한다.
  //   이유: heuristic 규칙("어떻게 ... 계산"→metric_lookup 등)이
  //   상관분석·비교분석 질문("영업이익률은 영업이익/순매출로 계산하고, 상관관계 알려줘")
  //   같이 산식을 명시한 결과요청까지 오분류하여 AnalysisPlan 파이프라인에
  //   도달하지 못하게 하는 문제가 있음.
  //   → analysis 모드에서는 AnalysisPlan LLM이 문맥 전체로 판단.
  // ============================================================
  let classifiedIntent = null;
  let classificationTier = null;
  let classificationConfidence = null;
  const skipPhase1IntentRouting = (userQueryMode === 'analysis');
  try {
    if (skipPhase1IntentRouting) {
      console.log(`[NLQ:Intent] 분석질문 모드 → Phase 1 자동분류 스킵 (AnalysisPlan 파이프라인이 문맥 전체로 판단)`);
    }
    const cls = skipPhase1IntentRouting
      ? { intent: null, tier: 'skipped_analysis_mode', confidence: 0 }
      : await classifyConversationalIntent(query, conversationContext, userQueryMode, openai, GPT_MODEL);
    classifiedIntent = cls.intent;
    classificationTier = cls.tier;
    classificationConfidence = cls.confidence;

    const intentCommonCtx = {
      query,
      activeDomain,
      conversationContext: conversationContext || [],
      pool,
      openai,
      model: GPT_MODEL,
    };

    // 6개 신규 의도 — 즉시 텍스트 응답 후 종료
    const newIntentHandlers = {
      metric_lookup:   handleMetricLookup,
      ontology_lookup: handleOntologyLookup,
      troubleshooting: handleTroubleshooting,
      sql_explain:     handleSqlExplain,
      domain_explain:  handleDomainExplain,
      general_chat:    handleGeneralChat,
    };

    if (!skipPhase1IntentRouting && newIntentHandlers[classifiedIntent]) {
      const t0 = Date.now();
      const respBody = await newIntentHandlers[classifiedIntent](intentCommonCtx);
      const elapsed = Date.now() - t0;

      // suggestedMode 산출 (라디오 vs 분류 불일치)
      respBody.suggestedMode = determineSuggestedMode(classifiedIntent, userQueryMode);
      respBody.requestId = getCurrentRequestId();
      respBody.classificationTier = classificationTier;
      respBody.classificationConfidence = classificationConfidence;

      // 표준 로깅
      logConversationalIntent({
        requestId: getCurrentRequestId(),
        mode: userQueryMode,
        intent: classifiedIntent,
        intentLabel: INTENT_LABELS[classifiedIntent],
        tier: classificationTier,
        confidence: classificationConfidence,
        domain: activeDomain,
        elapsedMs: elapsed,
        referenced: respBody.referenced,
        suggestedMode: respBody.suggestedMode,
        success: true,
      });

      // 이력 저장 (saveHistory 13개 파라미터 시그니처 준수, SQL은 빈 문자열)
      const userIdForHistory = req.session?.user?.id || null;
      try {
        await saveHistory(
          userIdForHistory,
          query,
          '',                                              // generated_sql
          respBody.explanation || respBody.analysisText || '', // explanation
          'analysis',                                      // chart_type
          null,                                            // chart_config
          [],                                              // result_data
          0,                                               // row_count
          elapsed,                                         // execution_time_ms
          'SUCCESS',                                       // status — ★ 기존 컨벤션('SUCCESS'/'FAILED' 대문자) 준수. 이전엔 'success'(소문자)로 저장되어 이력 복원 시 status 비교 실패 → 빨간 오류 박스 노출 버그가 있었음
          null,                                            // error_message
          session_id || null,                              // session_id
          activeDomain                                     // domain_code
        );
      } catch (histErr) {
        console.error('[NLQ:Intent] saveHistory 실패 (응답에는 영향 없음):', histErr.message);
      }

      // [2026-06-30] Phase 2: 프론트 conversationContext 확장 필드 보강
      //   - domain: 현재 도메인 (PS/HL/MGMT) — troubleshooting 핸들러가 직전 도메인 활용
      //   - rowCount: 신규 intent 핸들러는 항상 0 (데이터 조회 아님)
      //   - elapsedMs: 처리 시간 — 진단/로깅용
      //   - queryMode: 사용자가 선택한 라디오 값 — Phase 2 미스매치 안내에 활용
      if (respBody && typeof respBody === 'object') {
        if (respBody.domain === undefined)     respBody.domain     = activeDomain;
        if (respBody.rowCount === undefined)   respBody.rowCount   = 0;
        if (respBody.elapsedMs === undefined)  respBody.elapsedMs  = elapsed;
        if (respBody.queryMode === undefined)  respBody.queryMode  = userQueryMode;
      }

      return res.json(respBody);
    }

    // data_query / analysis / fallback 은 기존 흐름으로 진행
    // 단, 라디오 모드를 자동 분류 결과로 보정할지 정책: 보수적으로 라디오 우선 유지
    logConversationalIntent({
      requestId: getCurrentRequestId(),
      mode: userQueryMode,
      intent: classifiedIntent,
      intentLabel: INTENT_LABELS[classifiedIntent] || classifiedIntent,
      tier: classificationTier,
      confidence: classificationConfidence,
      domain: activeDomain,
      passThrough: true,
    });
  } catch (clsErr) {
    // 분류 자체가 실패해도 기존 흐름은 정상 진행
    console.error('[NLQ:Intent] 분류 처리 중 오류 (기존 흐름으로 계속 진행):', clsErr.message);
  }
  // ============================================================
  // Phase 1 끝 — 아래는 기존 data_query/analysis 흐름
  // ============================================================

  try {
    console.log(`[NLQ] 질의: ${query}`);

    // 0. 학습 데이터에서 정확 매칭 검색 (corrected 우선, 가장 최근 것 사용)
    let matchedSql = null;
    try {
      const [fbMatch] = await pool.query(
        `SELECT corrected_sql, feedback_type FROM sql_feedback
         WHERE query_text = ? AND is_active = 1 AND (domain_code = ? OR domain_code IS NULL)
         ORDER BY FIELD(feedback_type, 'corrected', 'correct') ASC, created_at DESC
         LIMIT 1`,
        [query.trim(), activeDomain]
      );
      if (fbMatch.length > 0) {
        matchedSql = fbMatch[0].corrected_sql;
        console.log(`[NLQ] 학습 데이터 매칭됨 (${fbMatch[0].feedback_type}): ${matchedSql.substring(0, 80)}...`);
      }
    } catch (e) {
      console.error('[NLQ] 학습 데이터 조회 실패:', e.message);
    }

    let sql, answer = '', explanation, chartType, chartConfig, analysisRequired = false;
    // [PR #252] GPT 가 '이 질문은 심층 분석이 필요하다'고 판단한 원본 값 보존.
    //   - aggregate 라디오 선택 시 analysisRequired 는 강제 false 로 뒤집히지만,
    //     사용자에게 "분석질문을 이용하면 더 좋은 답변을 얻을 수 있습니다" 안내를 노출하기 위해
    //     GPT 원본 판단 결과는 별도로 응답에 실어 보냄.
    //   - 하드코딩/키워드 기반이 아닌, 질문 전체 의미에 대한 GPT 판단을 그대로 사용.
    let suggestAnalysis = false;
    let ragInfo = null;  // RAG 검색 상세 정보
    let dateContext = null;  // 당월/전월 날짜 컨텍스트

    // ============================================================
    // ★ 분석형 질문 사전 분기 (안전 경로)
    // - LLM이 SQL을 만들다 오류 내는 일을 원천 차단
    // - 백엔드가 안전한 KPI 조회 SQL을 직접 빌드 → 실행 → 결과로 LLM 분석 답변만 받음
    // - 표/차트 생성 안 함, 사용자에게는 텍스트 분석만 노출
    // - 학습 데이터 매칭이 있으면 그쪽 우선 (사용자가 검증한 SQL)
    // ★★★ 라우팅 규칙 ★★★
    //   1) 사용자가 라디오에서 '분석질문' 명시적 선택 → 강제 분석 경로 (키워드 무시)
    //   2) 사용자가 '현황집계' 선택 (기본값) → 키워드 자동 감지 우회, 일반(표+SQL) 경로 강제
    //   → "소모품비 알려줘" 같은 단순 조회가 '알려줘' 키워드 때문에 분석 경로로 잘못 빠지는 문제 해결
    // ============================================================
    const isAnalysisMode = (userQueryMode === 'analysis');
    if (isAnalysisMode) {
      console.log(`[NLQ] 사용자 선택: 분석질문 → 분석 경로 라우팅`);
    } else {
      console.log(`[NLQ] 사용자 선택: 현황집계 → 표+SQL 경로 강제 (키워드 자동감지 비활성)`);
    }
    if (!matchedSql && isAnalysisMode) {
      console.log(`[NLQ] 🧠 분석형 질문 처리 → AnalysisPlan 파이프라인`);
      setRequestStage('analysis_plan_generate');
      try {
        // ══════════════════════════════════════════════════════════════
        // ★★★ AnalysisPlan 파이프라인 (신규 · 키워드 하드코딩 제거) ★★★
        //   [1] generateAnalysisPlan  → LLM이 문맥 전체로 실행 계획 수립
        //   [2] concept 경로: requiresDataExecution=false → 설명만 (DB 없음)
        //   [3] result 경로: executeAnalysisPlan → dimensions+metrics 기반 SQL
        //                                        + 후처리 op(상관·TOP·비교 등)
        //   [4] validateAnalysisResults → expectedResults 채움 검증
        //       (누락 시 실패 사유와 함께 plan 1회 재생성)
        //   [5] generateFinalAnalysisAnswer → 실제 결과만 담아 최종 답변
        // ══════════════════════════════════════════════════════════════
        const dc = await getDataDateContext();
        dateContext = dc;

        // ── [1] AnalysisPlan 생성 (1차)
        let plan = await generateAnalysisPlan(query, activeDomain, dc, conversationContext);
        console.log(`[AnalysisPlan] 1차 생성 완료: requiresDataExecution=${plan.requiresDataExecution}, ` +
          `answerMode=${plan.answerMode}, dims=${(plan.dimensions||[]).length}, ` +
          `metrics=${(plan.metrics||[]).length}, ops=${(plan.operations||[]).length}, ` +
          `expected=${(plan.expectedResults||[]).length}`);

        // ── [2] 개념 설명 (실제 데이터 실행 불필요)
        if (plan.requiresDataExecution === false || plan.answerMode === 'CONCEPT_EXPLANATION') {
          setRequestStage('analysis_concept');
          console.log(`[AnalysisPlan] 경로: CONCEPT (DB 실행 없이 개념/산식 설명)`);
          const conceptAnswer = await generateConceptAnswer(query, plan, activeDomain);
          const nlqUserIdConcept = req.session?.user?.id || null;
          saveHistory(
            nlqUserIdConcept, query, null,
            conceptAnswer, 'analysis', {}, [],
            0, 0, 'SUCCESS', null, session_id || null, activeDomain
          ).catch(e => console.error('[History] 저장 실패:', e.message));
          return res.json({
            success: true,
            isAnalysisAnswer: true,
            answerType: 'concept',
            answer: conceptAnswer,
            analysis: conceptAnswer,
            rows: [],
            rowCount: 0,
            sql: null,
            explanation: null,
            chartType: 'analysis',
            chartConfig: {},
            analysisPlan: plan,  // 진단용
          });
        }

        // ── [3] 결과 요청 경로: executeAnalysisPlan
        setRequestStage('analysis_execute');
        let execRecord = await executeAnalysisPlan(plan, activeDomain);
        console.log(`[AnalysisPlan] 1차 실행: baseRows=${execRecord.baseRowCount}, ` +
          `err=${execRecord.baseError || '-'}, ops_diag=${execRecord.diagnostics.length}`);

        // ── [4] 결과 검증 → 실패 시 plan 1회 재생성 후 재실행
        //
        // [2026-08-03] DB 타임아웃(baseTimedOut) 은 AnalysisPlan JSON 오류가 아니라
        //   조회 범위(대량 그룹핑/기간·대상 과다) 문제이므로 재계획 대상에서 제외한다.
        //   이전에는 missing=['baseExecution'] 만 보고 재계획 → 동일 SQL 재실행 → 추가 120초 소진 →
        //   전체 처리시간 265초 후에야 504 반환하는 문제가 있었다.
        //   → 첫 실행이 timeout 이면 즉시 QUERY_SCOPE_TIMEOUT 응답으로 종료.
        let validation = validateAnalysisResults(plan, execRecord);
        console.log(`[AnalysisPlan] 1차 검증: ok=${validation.ok}, missing=${JSON.stringify(validation.missing)}`);

        const firstAttemptTimedOut = !!execRecord.baseTimedOut;
        if (!validation.ok && !firstAttemptTimedOut) {
          const reason = `missing=${validation.missing.join(',')} | notes=${validation.notes.join(' / ')} | baseError=${execRecord.baseError || '-'} | diag=${(execRecord.diagnostics||[]).join(' / ')}`;
          console.log(`[AnalysisPlan] 재시도 (plan 수정 요청): ${reason}`);
          setRequestStage('analysis_replan');
          try {
            plan = await generateAnalysisPlan(query, activeDomain, dc, conversationContext, {
              retryReason: reason,
              previousPlan: plan,
            });
            execRecord = await executeAnalysisPlan(plan, activeDomain);
            validation = validateAnalysisResults(plan, execRecord);
            console.log(`[AnalysisPlan] 2차 실행: baseRows=${execRecord.baseRowCount}, err=${execRecord.baseError || '-'}, validation.ok=${validation.ok}`);
          } catch (retryErr) {
            console.warn(`[AnalysisPlan] 재시도 실패 (원본 plan으로 답변 시도): ${retryErr.message}`);
          }
        } else if (!validation.ok && firstAttemptTimedOut) {
          console.log(`[AnalysisPlan] 1차 실행 DB 타임아웃 → 재계획 스킵 (동일 범위 재실행 방지)`);
          setRequestStage('analysis_db_timeout_no_retry');
        }

        // ── DB 타임아웃 (1차 또는 2차): 공통 QUERY_SCOPE_TIMEOUT 응답으로 즉시 종료
        //   - aggregate 경로와 동일한 문구·스키마·error_detail 로 응답 → 프론트는 어떤 진입
        //     경로(sync/async success/async failed)로 받든 중립 hourglass UI 표시.
        //   - 재계획 후 2차도 timeout 이면 동일 처리 (동일 범위 재실행 방지 규칙에도 부합).
        if (execRecord.baseTimedOut || (execRecord.baseError && /* 검증 실패 SQL 안 실행된 경우 대비 */ isDbQueryTimeoutError({ message: execRecord.baseError }))) {
          setRequestStage('analysis_db_timeout');
          const timeoutErr = new Error(execRecord.baseError || 'DB query timeout');
          const timeoutResp = buildQueryScopeTimeoutResponse({
            req, err: timeoutErr, sql: execRecord.baseSql || null,
            extra: {
              query, queryMode: 'analysis', domain: activeDomain,
              failedSql: execRecord.baseSql || null,
              dbElapsedMs: execRecord.baseExecMs || 0,
              dbTimeoutLimitMs: NLQ_DB_QUERY_TIMEOUT_MS,
              isAnalysisAnswer: true,
            },
          });
          const nlqUserIdFail = req.session?.user?.id || null;
          saveHistorySafe(
            nlqUserIdFail, query, execRecord.baseSql || null,
            QUERY_SCOPE_TIMEOUT_MESSAGE, 'analysis', {}, [],
            0, execRecord.baseExecMs || 0, 'FAILED', execRecord.baseError, session_id || null, activeDomain,
            { requestId: timeoutResp.body.requestId, errorType: LEGACY_DB_QUERY_TIMEOUT_CODE }
          );
          // analysisPlan / executionDiagnostics 는 진단용 필드 — 프론트 중립 UI 는 렌더하지 않음
          const analysisTimeoutBody = {
            ...timeoutResp.body,
            analysisPlan: plan,
            executionDiagnostics: execRecord.diagnostics || [],
          };
          return res.status(timeoutResp.httpStatus).json(analysisTimeoutBody);
        }

        // ── 실행이 근본적으로 실패한 경우 (타임아웃이 아닌 실제 실행 오류): 정직하게 안내
        if (execRecord.baseError && execRecord.baseRowCount === 0) {
          setRequestStage('analysis_execution_failed');
          const _fmtYm2 = (v) => v ? `${v.substring(0,4)}년 ${parseInt(v.substring(4,6))}월` : '';
          const _pfrom = plan.period && plan.period.from;
          const _pto = plan.period && plan.period.to;
          let cmLabel2 = dc.latestLabel;
          if (_pfrom && _pto && _pfrom !== _pto) {
            cmLabel2 = `${_fmtYm2(_pfrom)} ~ ${_fmtYm2(_pto)}`;
          } else if (_pfrom) {
            cmLabel2 = _fmtYm2(_pfrom);
          }
          const failMsg = `**${cmLabel2}** 기간·도메인(${(plan.domain && plan.domain.value) || activeDomain}) 조건으로 분석에 필요한 데이터를 조회할 수 없었습니다.\n\n` +
              `- 실행 오류: ${execRecord.baseError}\n` +
              `- 확인 사항: 기간·도메인·필터·컬럼명이 올바른지, 학습관리 산식이 최신인지 재검토가 필요합니다.\n\n` +
              `실제 계산되지 않은 수치를 임의로 만들어 인용하지 않도록, **현재 데이터만으로는 결과 확정이 어렵다**고 안내드립니다.`;
          const nlqUserIdFail = req.session?.user?.id || null;
          const analysisRequestId = (typeof getCurrentRequestId === 'function' ? getCurrentRequestId() : null) || req.requestId || null;
          saveHistorySafe(
            nlqUserIdFail, query, execRecord.baseSql,
            failMsg, 'analysis', {}, [],
            0, execRecord.baseExecMs || 0, 'FAILED', execRecord.baseError, session_id || null, activeDomain,
            { requestId: analysisRequestId, errorType: 'execution_failed' }
          );
          return res.status(200).json({
            success: true,
            isAnalysisAnswer: true,
            answerType: 'execution_failed',
            answer: failMsg,
            analysis: failMsg,
            rows: [], rowCount: 0,
            sql: null, explanation: null,
            chartType: 'analysis', chartConfig: {},
            analysisPlan: plan,
            executionDiagnostics: execRecord.diagnostics,
            error_type: 'execution_failed',
            error_code: 'execution_failed',
            requestId: analysisRequestId,
          });
        }

        // ── [5] 최종 답변 생성 (실제 결과만)
        setRequestStage('analysis_answer_generate');
        const { answer: analysis, summary } = await generateFinalAnalysisAnswer(query, plan, execRecord);

        // ── [5-b] 분석 결과 상세표(거래처별/품목별/기간별 1행씩 집계) 프론트에 노출
        //   - 이전에는 rows:[] 로 텍스트만 반환했으나, 사용자 요청에 따라
        //     상관계수·TOP-N 등의 계산 근거가 된 집계 결과를 표로 함께 제공.
        //   - baseRows 는 이미 dimensions 별 GROUP BY 결과 (거래처당 1행 등) 형태.
        //   - 원본 컬럼명(CUSTOMER 등) → 사용자 친화 라벨은 resolveColumnLabels 재사용.
        //   - LLM 최종 답변은 규칙 15 에 의해 표를 텍스트로 반복하지 않음.
        const detailRows = (execRecord.postOps && Array.isArray(execRecord.postOps.baseRows))
          ? execRecord.postOps.baseRows.map(r => {
              const out = {};
              for (const k of Object.keys(r)) {
                const v = r[k];
                if (v === null || v === undefined) out[k] = null;
                else if (typeof v === 'bigint') out[k] = Number(v);
                else if (v instanceof Date) out[k] = v.toISOString();
                else out[k] = v;
              }
              return out;
            })
          : [];
        // 컬럼 라벨 해석 (한글 alias 는 그대로, 영문 raw 컬럼은 comment/ontology 우선)
        let detailColumnLabels = {};
        try {
          detailColumnLabels = await resolveColumnLabels(detailRows, execRecord.baseSql || '', activeDomain);
        } catch (e) {
          console.warn('[AnalysisPlan] columnLabels 해석 실패 (무시):', e.message);
        }
        // 컬럼 순서: dimension 컬럼 먼저, 그다음 metric 컬럼 순 (plan 순서 유지)
        const detailColumnOrder = [];
        const seen = new Set();
        for (const d of (plan.dimensions || [])) {
          for (const col of (d.columns || [])) {
            if (!seen.has(col)) { detailColumnOrder.push(col); seen.add(col); }
          }
        }
        for (const m of (plan.metrics || [])) {
          if (m && m.name && !seen.has(m.name)) { detailColumnOrder.push(m.name); seen.add(m.name); }
        }
        // baseRows 실제 키 중 남은 것 추가 (fallback)
        if (detailRows.length > 0) {
          for (const k of Object.keys(detailRows[0])) {
            if (!seen.has(k)) { detailColumnOrder.push(k); seen.add(k); }
          }
        }

        const nlqUserIdAnalysis = req.session?.user?.id || null;
        // [2026-07-21] chart_config 에 columnOrder / columnLabels 저장 →
        //   질의 이력에서 재열람할 때도 실행 직후와 동일한 상세표(한글 헤더 + 지정 순서) 복원 가능
        const analysisChartConfig = {
          columnOrder: detailColumnOrder,
          columnLabels: detailColumnLabels,
        };
        saveHistory(
          nlqUserIdAnalysis, query, execRecord.baseSql,
          analysis, 'analysis', analysisChartConfig, detailRows,
          execRecord.baseRowCount, execRecord.baseExecMs || 0, 'SUCCESS', null, session_id || null, activeDomain
        ).catch(e => console.error('[History] 저장 실패:', e.message));

        // [2026-07-31] 분석 결과 상세표 옆에 실제 조회 기간 표시.
        //   - 우선순위 1: 실제 실행된 SQL 에서 CALMONTH 파싱 (aggregate 와 동일한 방식으로 통일)
        //   - 우선순위 2: plan.period.from/to (AnalysisPlan 이 확정한 기간) — SQL 파싱 실패 대비 안전망
        let periodInfo = extractPeriodInfoFromSql(execRecord.baseSql);
        if (!periodInfo && plan && plan.period && plan.period.from) {
          const pf = String(plan.period.from).replace(/[^0-9]/g, '');
          const pt = String(plan.period.to || plan.period.from).replace(/[^0-9]/g, '');
          if (/^\d{6}$/.test(pf) && /^\d{6}$/.test(pt)) {
            const from = pf <= pt ? pf : pt;
            const to   = pf <= pt ? pt : pf;
            periodInfo = { from, to, label: buildPeriodLabelKorean(from, to) };
          }
        }

        return res.json({
          success: true,
          isAnalysisAnswer: true,
          answerType: 'result_based',           // RESULT_BASED 경로
          answer: analysis,
          analysis: analysis,
          // ★ 분석 결과 상세표: 거래처별/품목별/기간별 등 집계 결과 (거래처당 1행)
          //   프론트는 이 rows 를 페이지네이션·정렬·검색이 가능한 표로 렌더.
          rows: detailRows,
          data: detailRows,                     // 기존 aggregate 응답과 필드명 호환
          rowCount: detailRows.length,
          columnLabels: detailColumnLabels,     // { CUSTOMER: "거래처", ...}
          columnOrder: detailColumnOrder,       // ["CUSTOMER","CUSTOMER_NM","순매출",...]
          sql: execRecord.baseSql,               // ← 실제 실행 SQL 노출 (진단·투명성)
          explanation: null,
          chartType: 'table', chartConfig: {},   // ← 표 탭이 기본 활성
          periodInfo,                            // [2026-07-31] {from,to,label} 또는 null
          analysisPlan: plan,                    // 진단용 (프론트에서는 무시 가능)
          executionSummary: summary,             // 진단용
          validation: validation,                // 진단용
          executionDiagnostics: execRecord.diagnostics,  // 진단용 (variance=0 원인 등)
        });
      } catch (analysisErr) {
        // ★ 분석 경로 실패 시: 친절한 안내 + 진단용 상세 에러 정보 함께 반환
        //   클라이언트의 "오류 상세보기" 토글에서 원인을 직접 확인할 수 있도록.
        console.error('[NLQ] 분석 경로 실패:', analysisErr);
        setRequestStage('analysis_path');
        const errorDetail = buildErrorDetail({
          req,
          stage: 'analysis_path',
          err: analysisErr,
          extra: {
            phase: 'analysis_path',
            query,
            queryMode: userQueryMode,
            intent: typeof intent !== 'undefined' ? intent : null,
            calmonth: typeof calmonth !== 'undefined' ? calmonth : null,
            domain: activeDomain,
          },
        });
        return res.json({
          success: false,
          isAnalysisAnswer: true,
          answer: '죄송합니다. 분석 답변을 생성하는 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
          rows: [],
          rowCount: 0,
          sql: null,
          requestId: errorDetail.requestId,
          error_user_friendly: true,
          error_detail: errorDetail,
        });
      }
    }

    if (matchedSql) {
      setRequestStage('learned_sql');
      // 학습 데이터 매칭 → AI 호출 없이 직접 사용
      // ★ [PR #257] CALMONTH 시간 리터럴 재바인딩 (축 A):
      //   - 저장 시점의 CALMONTH 값(예: '202605') 또는 자리표시자(:LATEST_MONTH)를
      //     현재 latestMonth / prevMonth 로 동적 치환.
      //   - 사용자 질의에 명시적 년월(2026년 5월 등)이 있으면 원본 유지.
      //   - 자리표시자는 명시적 질의 여부와 무관하게 항상 치환.
      try {
        if (!dateContext) dateContext = await getDataDateContext();
        const beforeRebase = matchedSql;
        matchedSql = rebaseCalmonthForLearnedSql(matchedSql, query, dateContext);
        if (matchedSql !== beforeRebase) {
          console.log(`[NLQ] 학습 SQL CALMONTH rebase 적용 → latestMonth=${dateContext.latestMonth}`);
        }
      } catch (rebaseErr) {
        // rebase 실패 시 안전하게 원본 사용 (회귀 위험보다 서비스 중단 방지 우선)
        console.error('[NLQ] CALMONTH rebase 실패, 원본 SQL 사용:', rebaseErr.message);
      }
      // ★ Metric 산식 자동 치환 (헬퍼 함수 사용)
      matchedSql = await applyMetricFormulaReplacement(matchedSql, activeDomain);
      sql = matchedSql;
      explanation = '학습된 SQL을 사용합니다 (사용자 검증 완료).';
      ragInfo = { mode: 'learned', chunksUsed: 0, promptLength: 0, details: {} };
      // 차트 타입은 AI에게 간단히 판별 요청 (비용 절약을 위해 짧은 프롬프트)
      try {
        const chartCompletion = await openai.chat.completions.create({
          model: GPT_MODEL,
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
      const buildResult = await buildRAGSystemPrompt(query, activeDomain);
      let systemPrompt = buildResult.prompt;
      const ragContext = buildResult.ragContext;
      dateContext = buildResult.dateContext;
      // ★ 사용자가 '현황집계' 라디오를 선택한 경우: 시스템 프롬프트에 명시적 지시 추가
      //   → GPT가 "알려줘" 같은 단어 때문에 analysisRequired:true로 응답하지 않도록 강제
      if (userQueryMode === 'aggregate') {
        systemPrompt += `\n\n[★★★ 사용자 명시 지시: 현황집계 모드 ★★★]
- 사용자가 답변 유형 라디오에서 "현황집계"를 명시적으로 선택했습니다.
- 따라서 이 질문은 표(데이터 조회) + SQL 형태로 답변해야 합니다.
- 질문에 "알려줘", "보여줘" 등의 표현이 포함되어 있어도 **analysisRequired는 반드시 false**로 응답하세요.
- 분석/시사점/원인 등 텍스트 코멘트를 생성하지 말고, SELECT 문으로 결과를 집계해서 보여주는 SQL을 작성하세요.
- 예) "소모품비 알려줘" → SELECT FORMAT(SUM(ZAMT049),0) AS '소모품비(원)' FROM ... (분석 텍스트 X)`;
      } else {
        systemPrompt += `\n\n[★★★ 사용자 명시 지시: 분석질문 모드 ★★★]
- 사용자가 답변 유형 라디오에서 "분석질문"을 명시적으로 선택했습니다.
- 따라서 이 질문은 표/차트 없이 텍스트 분석 답변만 생성해야 합니다 (analysisRequired: true).`;
      }
      console.log(`[NLQ] RAG 프롬프트 길이: ${systemPrompt.length}자 (RAG 활성: ${ragReady}, 모드: ${userQueryMode})`);

      // RAG 검색 상세 정보 수집
      //   ★ ragContext 안에는 표준 카테고리(schema/ontology/metric/code_mapping/feedback/rule/join_condition)
      //     외에도 type_groups({원가:[...]}), type_matched_spans([{start,end,matchedText,type}]) 같은
      //     비표준 필드가 들어올 수 있음.
      //     - type_groups: 객체 → arr.length undefined, 원소에 .text 없음
      //     - type_matched_spans: 배열이지만 원소에 .text/.score 없음
      //   → 배열 여부 + text/score 존재 여부를 방어적으로 체크해서 500 오류 방지.
      if (ragContext) {
        // 방어적으로 배열만 카운트
        const chunksUsed = Object.values(ragContext).reduce((s, arr) => {
          return s + (Array.isArray(arr) ? arr.length : 0);
        }, 0);
        ragInfo = {
          mode: 'rag',
          chunksUsed,
          promptLength: systemPrompt.length,
          details: {},
        };
        for (const [cat, items] of Object.entries(ragContext)) {
          // 배열이 아닌 필드(type_groups 등)는 skip
          if (!Array.isArray(items) || items.length === 0) continue;
          // 각 원소도 text/score 없을 수 있으므로 방어적으로 처리
          ragInfo.details[cat] = items.map(i => {
            const rawText = (i && typeof i.text === 'string') ? i.text : String(i?.text ?? '');
            const rawScore = (i && typeof i.score === 'number') ? i.score : 0;
            return {
              text: rawText.substring(0, 80),
              score: Math.round(rawScore * 1000) / 1000,
            };
          });
        }

        // ★ 원가/비용 그룹 라우팅 로그 (requestId 기반 상세 추적)
        //   detected_group_type, matched_columns, null_field_columns, selected_domain
        if (ragContext.type_groups && Object.keys(ragContext.type_groups).length > 0) {
          const groupTypes = Object.keys(ragContext.type_groups);
          const allMatchedCols = [];
          const nullFieldCols = [];
          for (const gt of groupTypes) {
            const cols = ragContext.type_groups[gt] || [];
            for (const c of cols) {
              allMatchedCols.push(c.column_name);
              // 설명이 비어있는 컬럼 추적 (프롬프트 품질 저하 원인 진단용)
              if (!c.description || String(c.description).trim() === '') {
                nullFieldCols.push(`${c.column_name}(description)`);
              }
            }
          }
          const matchedSpansSummary = (ragContext.type_matched_spans || [])
            .map(s => s.matchedText).join(', ');
          console.log(
            `[RAG][${getCurrentRequestId() || 'no-req-id'}] 원가/비용 그룹 라우팅: ` +
            `detected_group_type=[${groupTypes.join(',')}] ` +
            `matched_spans=[${matchedSpansSummary}] ` +
            `matched_columns=[${allMatchedCols.join(',')}] ` +
            `null_field_columns=[${nullFieldCols.join(',') || 'none'}] ` +
            `selected_domain=${activeDomain}`
          );
        }
      }

      // 대화 히스토리를 GPT messages에 주입 (후속 질문에서 이전 질문 맥락 유지)
      // ⚠️ 중요: 이전 SQL은 LLM에게 절대 주지 않음.
      //   - 과거 학습관리 변경 전(예: Metric 산식 등록 전)에 생성된 SQL이 history에 남아있으면
      //     LLM이 그 잘못된 SQL을 "정답"으로 인식하여 재생산(회귀)함.
      //   - 따라서 이전 턴은 사용자 질의(role=user)만 포함하고, assistant 응답은 주지 않음.
      //   - 후속 질문의 맥락("그 중에서 5월만", "그래프로 보여줘")은 user 질의 흐름만으로 충분.
      const messages = [{ role: 'system', content: systemPrompt }];
      if (Array.isArray(conversationContext) && conversationContext.length > 0) {
        // 최근 3턴만 사용 (토큰 절약 + 오염 최소화)
        const recentCtx = conversationContext.slice(-3);
        for (const turn of recentCtx) {
          if (turn && turn.query) {
            messages.push({ role: 'user', content: turn.query });
            // assistant SQL 주입은 의도적으로 생략 (이전 SQL 회귀 차단)
          }
        }
        console.log(`[NLQ] 대화 컨텍스트 ${recentCtx.length}턴 포함 (질의만, SQL 제외)`);
      }
      messages.push({ role: 'user', content: query });

      setRequestStage('llm_sql_generate');
      const completion = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0].message.content;
      console.log(`[NLQ] GPT 응답: ${raw}`);

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        // JSON 파싱 실패 — GPT가 텍스트(안내 메시지)를 반환한 경우
        const rawLower = (raw || '').toLowerCase();
        if (raw && (raw.includes('등록되어 있지 않') || raw.includes('학습관리') || raw.includes('관리자에게') || raw.includes('정보가 없') || raw.includes('알 수 없'))) {
          return res.json({
            success: true,
            rows: [],
            rowCount: 0,
            sql: null,
            explanation: raw,
            answer: raw,
            isUnknownTerm: true,
          });
        }
        return res.status(500).json({ error: 'AI 응답 파싱 실패', raw });
      }

      // ★ GPT가 JSON은 반환했지만 sql이 없고 안내 메시지만 있는 경우
      if (!parsed.sql && (parsed.explanation || parsed.answer)) {
        const msg = parsed.explanation || parsed.answer || '';
        if (msg.includes('등록되어 있지 않') || msg.includes('학습관리') || msg.includes('관리자') || msg.includes('정보가 없') || msg.includes('알 수 없')) {
          return res.json({
            success: true,
            rows: [],
            rowCount: 0,
            sql: null,
            explanation: msg,
            answer: msg,
            isUnknownTerm: true,
          });
        }
      }

      sql = parsed.sql;
      setRequestStage('sql_generated');
      // ★ GPT 생성 SQL에도 Metric 산식 자동 치환 적용 (GPT가 프롬프트를 무시하고 단순 컬럼 사용 시 안전장치)
      sql = await applyMetricFormulaReplacement(sql, activeDomain);
      // answer는 1단계에서 무시 — SQL 실행 후 결과 기반으로 4-A에서 생성
      explanation = parsed.explanation;
      chartType = parsed.chartType;
      chartConfig = parsed.chartConfig;
      analysisRequired = parsed.analysisRequired === true;
      // [PR #252] GPT 원본 판단 → suggestAnalysis (강제 false 로 뒤집기 전에 확보)
      //   현황집계 모드에서 GPT 가 심층 분석이 필요하다고 본 경우, 프론트에 안내 문구를 표시하기 위함.
      suggestAnalysis = analysisRequired;
      // ★ 사용자가 '현황집계' 라디오 선택 시 GPT가 analysisRequired:true로 응답해도 강제 false
      //   → 표+SQL만 노출, 분석 답변 생성 단계(4-B) 우회
      if (userQueryMode === 'aggregate' && analysisRequired) {
        console.log(`[NLQ] 사용자 '현황집계' 선택 — GPT의 analysisRequired:true 무시 (강제 false, suggestAnalysis=true 로 안내 문구 표시 예정)`);
        analysisRequired = false;
      }
    }

    // 2. SQL 검증
    if (!sql) {
      return res.json({
        success: true, rows: [], rowCount: 0, sql: null,
        explanation: explanation || '요청하신 내용에 대한 SQL을 생성할 수 없습니다.',
        answer: explanation || '알 수 없는 용어입니다. 관리자에게 문의하여 학습관리에 해당 용어를 등록해 주세요.',
        isUnknownTerm: true,
      });
    }

    // ★ 도메인별 DIVISION 자동 필터 주입 (PS→'10', HL→'20', MGMT→no-op)
    //   - 학습 경로/GPT 경로 모두 여기로 합류하므로 한 곳에서 적용
    //   - 이미 DIVISION 조건이 있으면 중복 추가하지 않음
    //
    // [2026-06-16] 사용자 요청 (학습된 SQL 재사용 시 도메인 오작동 수정):
    //   - 학습된 SQL 은 검증 시점의 도메인 조건이 박혀있을 수 있음
    //     (예: PS 에서 "정확해요" 검증 → DIVISION='10' 이 SQL 에 포함됨)
    //   - 이후 HL/MGMT 에서 같은 질문 → 학습 SQL 재사용 시 PS 도메인 데이터가 잘못 조회됨
    //   - 해결: applyDomainFilter 호출 전에 scrubDivisionFilter 로 기존 DIVISION 조건을
    //     모두 제거한 뒤, 현재 선택 도메인 기준으로 새로 주입
    //   - 정책: "학습 SQL 은 쿼리 구조만 재사용, DIVISION 은 실행 시점에 동적 주입"
    // ★ [사업부 명칭 고정 매핑] 순서:
    //   1) normalizeDivisionFilter: 잘못된 DIVISION_NM='HL'/LIKE 등을 DIVISION='20' 로 자동 교정
    //   2) scrubDivisionFilter: 학습 SQL 재사용 시 남아있는 이전 도메인 조건 제거
    //      → normalizeDivisionFilter 가 만든 DIVISION 조건도 학습 SQL 이면 함께 제거되어 도메인 재주입 대상이 됨
    //      → 다만 질의 텍스트 언급 우선 정책 때문에 applyDivisionFromQuery 로 다시 보정
    //   3) applyDomainFilter: 현재 선택 도메인(PS/HL) 기준 DIVISION 주입 (MGMT 는 no-op)
    //   4) applyDivisionFromQuery: MGMT 상태에서도 질의에 HL/PS 언급이 있으면 강제 주입
    //      (PS/HL 도메인에서는 이미 3)에서 주입되었으므로 no-op)
    //   5) normalizeNameSearchFilter: MATERIAL_NM / CUSTOMER_NM LIKE 조건을
    //      REPLACE(col,' ','') LIKE '%공백제거값%' 형태로 변환 (공백 무시 검색)
    sql = normalizeDivisionFilter(sql);
    sql = scrubDivisionFilter(sql);
    sql = applyDomainFilter(sql, activeDomain);
    sql = applyDivisionFromQuery(sql, query);
    sql = normalizeNameSearchFilter(sql);
    // ※ Dummy 제외 SQL 자동주입 제거 — filterDummyRows() 후필터로만 처리

    const sqlUpper = sql.toUpperCase().trim();
    if (!sqlUpper.startsWith('SELECT')) {
      // SQL이 아닌 안내 메시지가 sql 필드에 들어온 경우
      if (sql.includes('등록되어 있지 않') || sql.includes('학습관리') || sql.includes('관리자') || sql.includes('알 수 없')) {
        return res.json({
          success: true, rows: [], rowCount: 0, sql: null,
          explanation: sql, answer: sql, isUnknownTerm: true,
        });
      }
      return res.status(400).json({ error: 'SELECT 쿼리만 허용됩니다.', sql });
    }
    const forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC', 'GRANT', 'REVOKE'];
    for (const kw of forbidden) {
      if (sqlUpper.includes(kw)) {
        return res.status(400).json({ error: `금지된 키워드: ${kw}`, sql });
      }
    }

    // 2-B. SQL 사전 검증 (LLM이 잘못된 SQL을 만들었을 가능성 사전 탐지)
    //   - WHERE 절에 집계함수(SUM/AVG/COUNT/MAX/MIN) 사용 → MariaDB "Invalid use of group function" 에러
    //   - 이런 패턴이 발견되면 LLM에게 에러 컨텍스트와 함께 재요청하여 자동 복구
    const sqlValidation = validateSqlPreExecution(sql);
    if (!sqlValidation.valid) {
      console.warn(`[NLQ] SQL 사전 검증 실패: ${sqlValidation.reason}`);
      console.warn(`[NLQ] 문제 SQL: ${sql}`);
      // LLM에게 에러 컨텍스트 추가하여 재요청
      try {
        const fixPrompt = `이전에 생성한 SQL에 문제가 있습니다.

[잘못된 SQL]
${sql}

[문제점]
${sqlValidation.reason}

[수정 규칙]
- WHERE 절에는 절대 집계함수(SUM/AVG/COUNT/MAX/MIN)를 쓰지 마세요
- 집계 결과로 필터링이 필요하면 HAVING 절을 사용하세요
- GROUP BY 없이 집계함수와 일반 컬럼을 SELECT에 같이 쓰지 마세요
- 분석형 질문이면 모든 KPI를 GROUP BY 없이 단일 행으로 집계하세요 (SELECT SUM(...), SUM(...), ...)

위 규칙을 지켜서 동일한 질문에 대한 올바른 SQL을 다시 생성하세요.
응답 형식은 동일하게 JSON: {"sql": "...", "answer": "...", "explanation": "...", "chartType": "...", "chartConfig": {...}, "analysisRequired": ${analysisRequired}}`;

        const retryCompletion = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: query },
            { role: 'assistant', content: JSON.stringify({ sql }) },
            { role: 'user', content: fixPrompt },
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });
        const retryRaw = retryCompletion.choices[0].message.content;
        console.log(`[NLQ] SQL 재생성 응답: ${retryRaw}`);
        const retryParsed = JSON.parse(retryRaw);
        if (retryParsed.sql) {
          sql = await applyMetricFormulaReplacement(retryParsed.sql, activeDomain);
          // ★ 재생성 경로에도 사업부 명칭 고정 매핑 + 자재명/고객명 공백 무시 규칙 적용
          sql = normalizeDivisionFilter(sql);
          sql = applyDomainFilter(sql, activeDomain);
          sql = applyDivisionFromQuery(sql, query);
          sql = normalizeNameSearchFilter(sql);
          // ※ Dummy 제외 SQL 자동주입 제거 — filterDummyRows() 후필터로만 처리
          // 재생성된 SQL도 한 번 더 검증 (무한루프 방지를 위해 1회만)
          const reval = validateSqlPreExecution(sql);
          if (!reval.valid) {
            console.error(`[NLQ] 재생성 SQL도 검증 실패: ${reval.reason}`);
            // 친절한 에러 메시지 반환
            return res.json({
              success: false,
              sql,
              rows: [],
              rowCount: 0,
              answer: '죄송합니다. 이 질문은 좀 더 구체적으로 다시 말씀해 주세요. 예: "2026년 4월 제품군별 매출과 영업이익 분석"',
              explanation: '쿼리 생성 중 집계 함수 사용 규칙 위반이 반복 감지되어 실행하지 않았습니다.',
              error_user_friendly: true,
            });
          }
          console.log(`[NLQ] SQL 자동 복구 성공`);
        }
      } catch (retryErr) {
        console.error(`[NLQ] SQL 재생성 실패:`, retryErr.message);
        return res.json({
          success: false,
          sql,
          rows: [],
          rowCount: 0,
          answer: '죄송합니다. 질문을 좀 더 구체적으로 다시 말씀해 주시거나, "2026년 4월 매출 분석"처럼 분석 대상 기간을 명확히 표현해 주세요.',
          explanation: `SQL 생성 오류: ${sqlValidation.reason}`,
          error_user_friendly: true,
        });
      }
    }

    // 3. DB 실행
    // [2026-07-22 PR #247] aggregate(현황집계) 경로의 pool.query 에도 서버단
    //   statement timeout(NLQ_DB_QUERY_TIMEOUT_MS, 기본 90s) 을 강제로 부여.
    //   - 배경: nginx proxy_read_timeout(기본 60s) 에 걸려 백엔드는 계속 실행 중인데
    //     클라이언트는 HTTP 504 (X-Request-Id 없는 nginx HTML) 를 받는 문제 (request_aborted).
    //   - 해결: 서버단에서 먼저 명시적으로 끊고, X-Request-Id 헤더가 실린
    //     정상 JSON 응답으로 db_query_timeout 을 반환 → 사용자가 로그 추적 가능.
    setRequestStage('db_execution');
    const startTime = Date.now();
    let rows;
    try {
      [rows] = await nlqPoolQueryWithTimeout(sql, null, NLQ_DB_QUERY_TIMEOUT_MS);
      // ★ Dummy 행 후필터 (SQL 자동주입이 안 닿은 케이스 안전망)
      rows = filterDummyRows(rows);
    } catch (dbErr) {
      // DB 실행 실패 시에도 친절한 메시지로 변환
      const errMsg = dbErr.sqlMessage || dbErr.message || '';
      const dbTimedOut = isDbQueryTimeoutError(dbErr);
      const dbElapsedMs = Date.now() - startTime;
      console.error(`[NLQ] DB 실행 실패${dbTimedOut ? ' (timeout)' : ''}: ${errMsg} (${dbElapsedMs}ms)`);
      console.error(`[NLQ] 실패 SQL: ${sql}`);

      // ────────────────────────────────────────────────────────
      // [2026-08-03] DB 조회 시간 초과: 공통 QUERY_SCOPE_TIMEOUT 응답으로 통일
      //   - aggregate/analysis 두 경로가 동일 문구·동일 스키마를 반환하도록 함
      //   - 프론트는 error_type='db_query_timeout' (하위호환) + errorCode='QUERY_SCOPE_TIMEOUT'
      //     둘 다로 매칭하며, error_detail.errorType 도 동일값 → async 실패 경로에서도 중립 UI
      //   - 표준 문구는 QUERY_SCOPE_TIMEOUT_MESSAGE 상수로 관리 (변경 시 한 곳만 수정)
      // ────────────────────────────────────────────────────────
      if (dbTimedOut) {
        const timeoutResp = buildQueryScopeTimeoutResponse({
          req, err: dbErr, sql,
          extra: {
            query, queryMode: userQueryMode, domain: activeDomain,
            failedSql: sql, dbElapsedMs, dbTimeoutLimitMs: NLQ_DB_QUERY_TIMEOUT_MS,
            isAnalysisAnswer: false,
          },
        });
        // 실패 이력 저장 — deadlock 방지를 위해 saveHistorySafe 사용 (retry + swallow)
        const failUserId = req.session?.user?.id || null;
        saveHistorySafe(
          failUserId, query, sql, null, null, null, null, 0, dbElapsedMs,
          'FAILED', errMsg, session_id || null, activeDomain,
          { requestId: timeoutResp.body.requestId, errorType: LEGACY_DB_QUERY_TIMEOUT_CODE }
        );
        return res.status(timeoutResp.httpStatus).json(timeoutResp.body);
      }

      // ── 일반 DB 실행 오류 (문법/컬럼/파라미터 등)
      let friendly = '죄송합니다. 질문을 처리하는 중 오류가 발생했습니다. 좀 더 구체적으로 다시 말씀해 주세요.';
      if (/Invalid use of group function/i.test(errMsg)) {
        friendly = '죄송합니다. 분석형 질문을 처리하는 중 쿼리 생성에 문제가 있었습니다. 질문을 좀 더 구체적으로 다시 말씀해 주세요. 예: "2026년 4월 제품군별 매출과 영업이익 분석"';
      } else if (/Unknown column/i.test(errMsg)) {
        friendly = '죄송합니다. 질문에 등록되지 않은 용어가 포함된 것 같습니다. 학습관리에서 해당 용어를 확인해 주세요.';
      } else if (/Incorrect parameter count/i.test(errMsg)) {
        friendly = '죄송합니다. 쿼리 생성에 문제가 있었습니다. 다시 한 번 질문해 주세요.';
      } else if (/syntax/i.test(errMsg)) {
        friendly = '죄송합니다. 쿼리 문법 오류가 발생했습니다. 질문을 다시 표현해 주세요.';
      }

      const errorDetail = buildErrorDetail({
        req, stage: 'db_execution', errorType: 'db_execution', err: dbErr,
        extra: {
          query, queryMode: userQueryMode, domain: activeDomain,
          failedSql: sql, dbElapsedMs, dbTimeoutLimitMs: NLQ_DB_QUERY_TIMEOUT_MS,
        },
      });
      const failUserId = req.session?.user?.id || null;
      saveHistorySafe(
        failUserId, query, sql, null, null, null, null, 0, 0,
        'FAILED', errMsg, session_id || null, activeDomain,
        { requestId: errorDetail.requestId || null, errorType: 'db_execution' }
      );
      return res.status(200).json({
        success: false, sql, rows: [], rowCount: 0,
        answer: friendly,
        explanation: `DB 실행 오류: ${errMsg}`,
        requestId: errorDetail.requestId,
        error_user_friendly: true,
        error_type: 'db_execution', error_code: 'db_execution',
        error_detail: errorDetail,
      });
    }
    const execTime = Date.now() - startTime;
    setRequestStage('db_execution_done');

    console.log(`[NLQ] SQL 실행: ${execTime}ms, ${rows.length}행`);

    // ────────────────────────────────────────────────────────
    // [2026-07-22] 브라우저 보호용 서버측 하드 상한 (기본 200,000행)
    //   - 사용자 요구: "일반 조회는 임의 LIMIT 을 붙이지 말 것"
    //     → LLM 프롬프트에서 LIMIT 자동 지시 제거함.
    //   - 하지만 극단적으로 큰 결과 (수백만 행) 를 브라우저로 그대로 보내면
    //     탭이 죽거나 네트워크가 막힘 → 마지막 안전망만 남김.
    //   - 이 상한을 실제로 초과하면 사용자에게 truncated=true 로 명시하여
    //     "결과가 잘렸다"는 사실을 화면에 표시. (임의로 숨기지 않음)
    // ────────────────────────────────────────────────────────
    const AGGREGATE_ROW_HARD_CAP = parseInt(process.env.NLQ_AGGREGATE_ROW_HARD_CAP || '200000', 10);
    const totalRowsFromDb = rows.length;
    let truncated = false;
    if (totalRowsFromDb > AGGREGATE_ROW_HARD_CAP) {
      truncated = true;
      rows = rows.slice(0, AGGREGATE_ROW_HARD_CAP);
      console.warn(`[NLQ] 결과 행 하드 상한 초과: ${totalRowsFromDb.toLocaleString('ko-KR')}행 → ${AGGREGATE_ROW_HARD_CAP.toLocaleString('ko-KR')}행으로 절단 (브라우저 보호)`);
    }

    // 4-A. SQL 결과 기반 사용자 친화적 answer 생성 (항상 결과 데이터를 보고 생성)
    try {
      const sampleData = rows.slice(0, 20);
      const sampleText = JSON.stringify(sampleData, (k, v) => typeof v === 'bigint' ? Number(v) : v);

      // 날짜 컨텍스트 (dateContext가 없으면 폴백)
      const dc = dateContext || await getDataDateContext();
      const dateHint = `[기간 참고] 당월=${dc.latestLabel}, 전월=${dc.prevLabel}. "당월","이번달","전월" 등의 표현에는 반드시 실제 년월을 괄호로 병기하세요. 예: "당월(${dc.latestLabel})", "전월(${dc.prevLabel})"`;
      // ★ 답변 출력 규칙 (전역 규칙)
      //   [2026-07-21] 숫자 표기 규칙 추가:
      //     - 금액·수량은 천 단위 콤마 원본 (예: -2,063,050,449). 억/만 단위 축약 금지.
      //     - 날짜·연월 코드(CALMONTH, YYYYMM)에는 절대 콤마 넣지 않음.
      const formatRule = `[답변 출력 규칙]
- "YYYY년 M월" 형태의 년월 표현은 반드시 **굵게(마크다운 **)** 강조하세요. 예: **2026년 5월**
- 조회 결과에 'Dummy' 값이 있으면 본문에 언급하지 마세요. (사용자에게 노출되지 않습니다)
- **금액·수량은 천 단위 콤마를 붙인 원본**으로 표기하세요. 억/만 단위 축약 금지.
  ✗ 금지: "약 454억원", "2063050449" / ✓ 권장: "-2,063,050,449원", "45,409,440,210원"
- **CALMONTH/YYYYMM 같은 연월 코드에는 콤마를 넣지 마세요.**
  ✗ 금지: "202,601" / ✓ 권장: "**2026년 1월**" (한국어 년월이 최우선) 또는 "202601"
- 음수는 마이너스(-) 뒤에 콤마 적용 (예: -224,513,132).`;

      setRequestStage('llm_answer_generate');
      const answerCompletion = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          {
            role: 'user',
            content: `아래 데이터 조회 결과를 보고, 질문에 대한 답변을 1~2문장의 자연스러운 한국어로 작성해주세요.
SQL/컬럼명/기술용어는 쓰지 마세요.
[PR #252] 금액·수량은 반드시 천 단위 콤마를 붙인 원본 그대로 표기하세요. "억/만 단위 축약" 금지 — 반드시 "21,421,856,292원" 처럼 완전한 숫자를 출력하세요.
${dateHint}
${formatRule}

질문: ${query}
결과 (${rows.length}행): ${sampleText.substring(0, 600)}`
          }
        ],
        temperature: 0.3,
      });
      const rawAnswer = answerCompletion.choices[0].message.content;
      const finishReason = answerCompletion.choices[0].finish_reason;
      console.log(`[NLQ] Answer GPT raw (${finishReason}): "${rawAnswer}"`);
      if (rawAnswer && rawAnswer.trim()) {
        answer = rawAnswer.trim();
      }
      // ★ 후처리: 년월 굵게 (LLM이 빠뜨려도 보장)
      answer = boldYearMonth(answer);
      console.log(`[NLQ] Answer 최종: "${answer}"`);
    } catch (ansErr) {
      console.error('[NLQ] Answer 생성 실패:', ansErr.message);
    }

    // 4-B. 분석형 질문이면 2단계: GPT 텍스트 분석 답변 생성 (결과 0행이어도 생성)
    let analysis = null;
    if (analysisRequired) {
      try {
        console.log(`[NLQ] 분석형 질문 감지 — GPT 텍스트 분석 답변 생성 시작 (데이터 ${rows.length}행)`);

        const dc2 = dateContext || await getDataDateContext();
        const dateInfo = `[기간 참고] 당월=${dc2.latestLabel}, 전월=${dc2.prevLabel}. "당월","이번달","전월" 등 상대적 기간 표현에는 반드시 실제 년월을 괄호로 병기하세요.`;

        let userContent;
        if (rows.length > 0) {
          const dataForAnalysis = rows.slice(0, 50);
          const dataText = JSON.stringify(dataForAnalysis, (key, val) =>
            typeof val === 'bigint' ? Number(val) : val
          , 2);
          userContent = `${dateInfo}\n\n[사용자 질문]\n${query}\n\n[실행한 SQL]\n${sql}\n\n[조회된 데이터 (${rows.length}행)]\n${dataText}\n\n위 데이터를 기반으로 질문에 대한 전문적인 분석 답변을 작성해주세요.`;
        } else {
          userContent = `${dateInfo}\n\n[사용자 질문]\n${query}\n\n[실행한 SQL]\n${sql}\n\n[조회 결과]: 0행 (데이터 없음)\n\nSQL 조회 결과가 0행입니다. 가능한 원인과 함께 질문에 대해 알려진 정보를 바탕으로 답변해주세요.`;
        }

        const analysisCompletion = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            {
              role: 'system',
              content: `당신은 기업 수익성 분석 전문 컨설턴트입니다.
핵심 위주로 간결하게 분석 답변을 작성하세요.

[답변 작성 규칙]
1. 마크다운 형식 (제목, 볼드, 리스트)
2. 핵심 수치 인용 (예: "총매출 45,409,440,210원")
3. 긍정/부정 시사점 균형 제시
4. 실행 가능한 제언 1~3개
5. **금액·수량은 반드시 천 단위 콤마를 붙인 원본**으로 표기 (예: -2,063,050,449원, 45,409,440,210원).
   ✗ 억/만 단위 축약 금지 (예: "약 454억원" 금지). ✓ 원본 콤마 형식 유지.
   음수는 마이너스(-) 뒤에 콤마 적용 (예: -224,513,132).
6. **CALMONTH/YYYYMM 같은 연월 코드에는 절대 콤마를 넣지 마세요.**
   ✗ 금지: "202,601" / ✓ 권장: "**2026년 1월**" (한국어 년월 최우선) 또는 "202601".
7. 비율·이율은 소수(0.0824) 또는 백분율(8.24%) 중 일관되게 사용.
8. 한국어 답변
9. 데이터에 없는 내용 추측 금지
10. 조회 결과 0행: 원인과 대안을 간단히 제안
11. "당월", "전월", "이번달" 등 상대적 기간 표현 시 반드시 실제 년월을 괄호로 병기 (예: "당월(2026년 4월)")

[★ 길이·완결성 규칙 — 반드시 준수]
- 답변은 500~800자 이내로 핵심만 작성 (장황한 나열·반복 금지)
- 모든 문장은 반드시 완결된 형태로 끝낼 것
- 쓰다가 중간에 끊길 수 있는 긴 문장은 애초에 시작하지 말 것
- 마지막 문장까지 깔끔하게 마무리한 뒤 종료`
            },
            { role: 'user', content: userContent }
          ],
          temperature: 0.3,
          max_tokens: 5000,
        });

        const analysisFinishReason = analysisCompletion.choices[0].finish_reason;
        analysis = analysisCompletion.choices[0].message.content.trim();

        // ★ 토큰 한도로 잘린 경우: 미완성 마지막 문장 제거 (사용자에게 오류처럼 보이지 않도록)
        if (analysisFinishReason === 'length' && analysis.length > 0) {
          console.log(`[NLQ] 분석 답변 토큰 한도 도달 — 미완성 문장 정리 (원본 ${analysis.length}자)`);
          // 마지막 완결된 문장 끝(. 또는 다 또는 요 또는 세요 + 줄바꿈) 위치를 찾아 거기까지만 사용
          const lastCleanEnd = Math.max(
            analysis.lastIndexOf('.\n'),
            analysis.lastIndexOf('다.\n'),
            analysis.lastIndexOf('다.'),
            analysis.lastIndexOf('요.\n'),
            analysis.lastIndexOf('요.'),
            analysis.lastIndexOf('세요.\n'),
            analysis.lastIndexOf('세요.'),
            analysis.lastIndexOf('니다.'),
            analysis.lastIndexOf('시오.'),
          );
          if (lastCleanEnd > analysis.length * 0.5) {
            // 마침표 다음 문자까지 포함
            const cutPos = analysis.indexOf('.', lastCleanEnd) + 1;
            analysis = analysis.substring(0, cutPos).trim();
            console.log(`[NLQ] 분석 답변 정리 완료: ${analysis.length}자`);
          }
        }

        console.log(`[NLQ] 분석 답변 생성 완료: ${analysis.length}자 (finish_reason: ${analysisFinishReason})`);
      } catch (analysisErr) {
        console.error('[NLQ] 분석 답변 생성 실패:', analysisErr.message);
        // 분석 실패해도 기본 SQL 결과는 반환
      }
    }

    // ★ 표/차트 헤더 한국어 라벨 매핑 (영문 컬럼명 → 한국어)
    //   1순위 결과 키 자체가 한국어(GPT AS 별칭) → 그대로
    //   2순위 DB COLUMN_COMMENT
    //   3순위 ontology_column.description
    const columnLabels = await resolveColumnLabels(rows, sql, activeDomain);

    // [2026-07-31] 사용자 요구: '분석 대상 상세 결과' 옆에 실제 조회 기간 표시.
    //   - 최종 실행된 SQL(sql) 에서 CALMONTH 조건을 파싱하여 프론트로 전달.
    //   - 기간 정보가 없으면 null 로 두어 프론트가 기간 영역을 아예 표시하지 않도록 함.
    //   - 이력 재열람 경로도 saved 된 generated_sql 로 동일 계산이 가능하므로 일관됨.
    const periodInfo = extractPeriodInfoFromSql(sql);

    const result = {
      success: true,
      query,
      sql,
      answer: answer || '',  // 사용자 친화적 답변 (상단 표시)
      explanation: explanation + (matchedSql ? ' 📚' : (ragReady ? ' 🔍 RAG' : '')),  // 기술적 설명 (SQL탭)
      chartType: chartType || 'table',
      chartConfig: chartConfig || {},
      data: rows,
      columnLabels,                                    // ← 신규: 컬럼명 한국어 매핑
      rowCount: rows.length,                           // 실제 클라이언트로 전송된 행 수 (하드 상한 적용 후)
      totalRowCount: totalRowsFromDb,                  // [2026-07-22] DB 에서 반환된 원본 전체 행 수
      truncated: truncated,                            // [2026-07-22] 하드 상한으로 잘렸는지 여부
      truncatedLimit: truncated ? AGGREGATE_ROW_HARD_CAP : null,
      executionTimeMs: execTime,
      ragEnabled: ragReady,
      ragInfo: ragInfo,
      analysis: analysis,  // 분석형 질문이면 텍스트 답변 포함
      periodInfo,                                      // [2026-07-31] {from,to,label} 또는 null
      // [PR #252] 현황집계 모드에서 GPT 가 "심층 분석이 필요한 질문" 이라고 판단했으면 true.
      //   분석질문 모드(analysisRequired=true)는 이미 분석 답변을 제공하므로 안내 불필요.
      //   실제로 안내 문구를 붙일지는 프론트 렌더링 단계에서 결정 (queryMode==='aggregate' && suggestAnalysis).
      suggestAnalysis: (userQueryMode === 'aggregate' && suggestAnalysis === true),
    };

    // 5. 이력 저장 (비동기, 실패해도 응답에 영향 없음)
    const nlqUserId = req.session?.user?.id || null;
    saveHistory(nlqUserId, query, sql, explanation, chartType || 'table', chartConfig || {}, rows, rows.length, execTime, 'SUCCESS', null, session_id || null, activeDomain)
      .catch(e => console.error('[History] 저장 실패:', e.message));

    return res.json(result);
  } catch (err) {
    console.error('[NLQ] Error:', err);
    const msg = err.sqlMessage || err.message || String(err);

    // ★ 상세 진단 정보 함께 반환 (클라이언트 "오류 상세보기"에서 표시)
    const errorDetail = buildErrorDetail({
      req,
      stage: getRequestCtx()?.lastStage || 'top_level',
      err,
      extra: {
        phase: 'top_level',
        query,
        queryMode: userQueryMode,
        domain: activeDomain,
      },
    });

    // [PR #251] 실패 이력에 requestId + errorType(system) 동반 저장
    const nlqUserId = req.session?.user?.id || null;
    saveHistory(
      nlqUserId, query, null, null, null, null, null, 0, 0,
      'FAILED', msg, session_id || null, activeDomain,
      { requestId: errorDetail.requestId || null, errorType: 'system' }
    ).catch(e => console.error('[History] 실패이력 저장 실패:', e.message));

    return res.status(500).json({
      error: msg,
      query,
      requestId: errorDetail.requestId,
      error_type: 'system',
      error_code: 'system',
      error_detail: errorDetail,
    });
  }
});

// ============================================================
// [2026-06-15] 요청별 로그 사후 조회 API
// ------------------------------------------------------------
// 클라이언트가 504(게이트웨이 타임아웃) 등으로 응답 본문을 받지 못한 경우,
// 응답 헤더의 X-Request-Id 를 기반으로 메모리에 남아있는 로그를 조회한다.
//
// 권한 정책:
//   - 자신의 요청(userId 일치): logLineCount, stage 까지 노출
//   - 관리자(role='admin'): logLines 전체 + stack 등 상세까지 노출
//   - 비로그인: 거부
// ============================================================
app.get('/api/nlq/error-log/:requestId', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  const requestId = String(req.params.requestId || '').trim();
  if (!requestId) return res.status(400).json({ error: 'requestId 가 필요합니다.' });
  const ctx = requestLogLRU.get(requestId);
  if (!ctx) {
    return res.status(404).json({
      error: '해당 requestId 의 로그를 찾을 수 없습니다.',
      hint: '메모리에는 최근 ' + REQ_LOG_LRU_SIZE + '건만 보관됩니다. PM2 로그를 확인하세요: tail -f /home/user/.pm2/logs/nlq-server-out-0.log | grep ' + requestId,
      requestId,
    });
  }
  const isAdmin = req.session.user.role === 'admin';
  const isOwner = ctx.userId && ctx.userId === req.session.user.id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: '다른 사용자의 요청 로그는 조회할 수 없습니다.' });
  }
  const base = {
    requestId,
    stage: ctx.lastStage,
    method: ctx.method,
    url: ctx.url,
    statusCode: ctx.statusCode || null,
    startedAt: new Date(ctx.startedAt).toISOString(),
    finishedAt: ctx.finishedAt ? new Date(ctx.finishedAt).toISOString() : null,
    elapsedMs: ctx.finishedAt ? (ctx.finishedAt - ctx.startedAt) : (Date.now() - ctx.startedAt),
    aborted: !!ctx.aborted,
    logLineCount: ctx.logLines.length,
  };
  if (isAdmin) {
    base.logLines = ctx.logLines.slice();
    base.userId = ctx.userId;
    base.userRole = ctx.userRole;
  } else {
    // 일반 사용자(자기 요청): 민감 정보 제외, 최근 30줄만
    base.logLines = ctx.logLines.slice(-30).map(line => {
      // 비밀번호/세션 토큰 같은 패턴 마스킹 (단순 규칙)
      return line.replace(/password['"]?\s*[:=]\s*['"][^'"]*['"]/gi, 'password="***"')
                 .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer ***');
    });
  }
  return res.json(base);
});

// ============================================================
// [2026-07-30] 오류 접수 API — POST /api/error-reports
// ------------------------------------------------------------
// 자연어 질의 오류 카드의 [오류 접수] 버튼에서 호출.
// requestId 를 sys_aimd_error_reports 에 기록하여
// 관리자가 nlq-server.log 에서 requestId 로 grep 할 수 있도록 한다.
//
// 보안:
//   - 로그인 필수 (401)
//   - user_id / domain_code / business_area_code 는 서버 세션에서 채움
//     (클라이언트가 임의로 다른 user_id, 다른 status 지정 불가)
//   - error_summary 는 500 자로 절단, Stack Trace / SQL / 내부 경로는 저장 금지
//     (상세 오류는 nlq-server.log 에서 requestId 로 추적)
//
// 멱등성:
//   - request_id 컬럼에 UNIQUE 제약 → 동일 requestId 재접수는 INSERT IGNORE 처리
//   - 이미 접수된 경우 기존 레코드를 조회하여 alreadyReported:true 로 반환
// ============================================================
app.post('/api/error-reports', async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  const user = req.session.user;
  const body = req.body || {};

  // ---- 1) requestId 검증 ----
  const requestId = String(body.requestId || '').trim();
  if (!requestId) {
    return res.status(400).json({ error: 'requestId 가 필요합니다.' });
  }
  // req-YYYYMMDD-HHMMSS-XXXXXX 형식 (requestIdMiddleware 참고). 관대하게 64자 이내, 안전 문자만 허용.
  if (requestId.length > 64 || !/^[A-Za-z0-9._\-]+$/.test(requestId)) {
    return res.status(400).json({ error: '유효하지 않은 requestId 형식입니다.' });
  }

  // ---- 2) 서버측 컨텍스트 채우기 (클라이언트 값 신뢰 금지) ----
  const userId = user.id;
  let domainCode = null;
  try { domainCode = await getActiveDomain(req); } catch (_) { domainCode = null; }
  if (!domainCode) domainCode = user.domain_code || null;

  let businessAreaCode = null;
  // 클라이언트가 힌트를 준 경우 화이트리스트(사용자의 실제 권한 area) 안에서만 인정
  const clientAreaHint = typeof body.businessAreaCode === 'string' ? body.businessAreaCode.trim().toUpperCase() : '';
  try {
    const areas = await getUserBusinessAreas(userId, user.role);
    if (clientAreaHint && areas.includes(clientAreaHint)) {
      businessAreaCode = clientAreaHint;
    } else if (areas.length > 0) {
      businessAreaCode = areas[0];
    }
  } catch (_) { /* ignore, null 로 저장 */ }

  // ---- 3) 클라이언트 힌트(요약 정보) 정제 ----
  const truncate = (s, max) => {
    if (s === null || s === undefined) return null;
    const str = String(s);
    return str.length > max ? str.slice(0, max) : str;
  };
  const errorCode    = truncate(body.errorCode,   50);
  const httpStatus   = Number.isInteger(body.httpStatus) ? body.httpStatus
                      : (body.httpStatus && /^\d{3}$/.test(String(body.httpStatus))) ? parseInt(body.httpStatus, 10) : null;
  const errorSummary = truncate(body.errorSummary, 500);
  const queryMode    = truncate(body.queryMode,   20);
  const userQuestion = truncate(body.userQuestion, 2000);

  // ---- 4) INSERT (UNIQUE 위반 시 기존 레코드 반환) ----
  const logTag = `[ErrReport][${requestId}]`;
  try {
    const [ins] = await pool.query(
      `INSERT INTO sys_aimd_error_reports
         (request_id, user_id, business_area_code, domain_code, query_mode,
          user_question, error_code, http_status, error_summary, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')`,
      [requestId, userId, businessAreaCode, domainCode, queryMode,
       userQuestion, errorCode, httpStatus, errorSummary]
    );
    console.log(`${logTag} 신규 접수 완료 (id=${ins.insertId}, user=${userId}, domain=${domainCode || '-'}, area=${businessAreaCode || '-'}, err=${errorCode || '-'})`);
    return res.json({
      success: true,
      alreadyReported: false,
      id: ins.insertId,
      requestId,
      createdAt: new Date().toISOString(),
      message: '오류가 접수되었습니다. 빠르게 확인하겠습니다.',
    });
  } catch (e) {
    if (e && e.code === 'ER_DUP_ENTRY') {
      // 이미 접수된 요청 → 기존 레코드 조회
      try {
        const [rows] = await pool.query(
          `SELECT id, request_id, user_id, status, created_at
             FROM sys_aimd_error_reports
            WHERE request_id = ?
            LIMIT 1`,
          [requestId]
        );
        if (rows.length > 0) {
          const r = rows[0];
          console.log(`${logTag} 중복 접수 요청 → 기존 id=${r.id} 반환 (status=${r.status})`);
          return res.json({
            success: true,
            alreadyReported: true,
            id: r.id,
            requestId: r.request_id,
            status: r.status,
            createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
            message: '이미 접수된 오류입니다. 빠르게 확인하겠습니다.',
          });
        }
      } catch (e2) {
        console.error(`${logTag} 중복 접수 SELECT 실패:`, e2.message);
      }
      // 방어적 fallback (거의 도달하지 않음)
      return res.json({
        success: true,
        alreadyReported: true,
        requestId,
        message: '이미 접수된 오류입니다.',
      });
    }
    console.error(`${logTag} INSERT 실패:`, e.code || '', e.message);
    return res.status(500).json({ error: '오류 접수 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

// ============================================================
// 비동기 분석 Job 시스템 (POST /api/nlq/async + GET /api/nlq/job/:jobId)
// ------------------------------------------------------------
// 배경:
//   - 분석형 질의는 LLM 보조 SQL 다중 생성 + 답변 생성으로 최대 5분 소요
//   - nginx / 사내 게이트웨이가 60s 또는 180s 에서 504 를 띄우면
//     "백엔드는 정상 처리 중인데 화면에는 실패로 보이는" 문제 발생
//
// 해법:
//   - 클라이언트는 POST /api/nlq/async 로 jobId 만 즉시 받고 (수십 ms)
//   - 백엔드가 자기 자신의 /api/nlq 를 self-fetch 로 처리
//     (세션 쿠키만 forward → 기존 captureLogsMiddleware / 권한분리 / error_detail 그대로 동작)
//   - 클라이언트는 GET /api/nlq/job/:jobId 로 1~2초 간격 폴링
//   - TTL 1시간 후 자동 정리
//
// 보안:
//   - 비로그인: 401
//   - 다른 사용자의 jobId: 403 (admin 만 예외)
// ============================================================
const NLQ_JOB_TTL_MS = 60 * 60 * 1000;       // 완료 후 1시간 보관
const NLQ_JOB_MAX_LIFE_MS = 10 * 60 * 1000;  // 시작 후 10분 이상 미완료시 좀비로 간주
const nlqJobs = new Map(); // jobId → job 객체

function generateNlqJobId() {
  const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
  return 'job-' + ts + '-' + crypto.randomBytes(3).toString('hex');
}

// 백그라운드: 자기 자신의 /api/nlq 를 fetch (세션 쿠키 forward)
// [2026-07-21] AbortController 도입 — 사용자가 중지 요청 시 self-fetch 를 abort
async function runNlqJobInBackground(jobId, forwardedCookie, originalRequestId) {
  const job = nlqJobs.get(jobId);
  if (!job) return;
  if (job.cancelled) {
    // 시작 전 이미 취소된 경우
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    return;
  }
  job.status = 'running';
  job.runningAt = Date.now();

  // [2026-07-21] 취소용 AbortController — /api/nlq/cancel 에서 job.abortController.abort() 호출
  const abortController = new AbortController();
  job.abortController = abortController;
  // 10분 timeout 도 함께 붙임 (Node undici headersTimeout 회피)
  const timeoutId = setTimeout(() => {
    try { abortController.abort(new Error('self-fetch timeout (10min)')); } catch(_) {}
  }, 10 * 60 * 1000);

  try {
    const body = JSON.stringify({
      query: job.query,
      conversationContext: job.conversationContext,
      session_id: job.session_id,
      queryMode: job.queryMode,
    });
    const headers = { 'Content-Type': 'application/json' };
    if (forwardedCookie) headers['Cookie'] = forwardedCookie;
    if (originalRequestId) headers['X-Original-Request-Id'] = originalRequestId;
    headers['X-Async-Job-Id'] = jobId;

    // [2026-06-15] self-fetch 에 명시적 10분 timeout 부여.
    //   배경: Node 20 의 글로벌 fetch(undici) 는 headersTimeout 기본값이 300초(5분)이라,
    //   분석형 질의가 5분을 넘기면 self-fetch 만 'fetch failed' 로 abort 되고
    //   백엔드 /api/nlq 본체는 끝까지 진행되어 DB 에는 답변이 저장되지만
    //   클라이언트에는 async_job_failed 가 뜨는 현상이 발생함 (이력에서는 답변 보임).
    //   클라이언트 폴링 max-wait (NLQ_ASYNC_MAX_WAIT_MS = 6분) 보다 충분히 큰 값으로 늘려
    //   5~6분 구간의 정상 응답이 실패로 둔갑하지 않도록 함.
    const r = await fetch(`http://127.0.0.1:${PORT}/api/nlq`, {
      method: 'POST',
      headers,
      body,
      signal: abortController.signal,
    });
    const contentType = r.headers.get('content-type') || '';
    let data = null;
    let rawText = null;
    if (contentType.includes('application/json')) {
      data = await r.json().catch(() => null);
    } else {
      rawText = await r.text().catch(() => null);
    }
    // [2026-07-21] 응답 도착 시점에 이미 취소된 경우 → 결과 폐기 (stale response guard)
    if (job.cancelled) {
      job.status = 'cancelled';
      job.result = null;
      job.finishedAt = Date.now();
      console.log(`[nlq-async] 🛑 job ${jobId} response discarded (already cancelled)`);
      return;
    }
    job.statusCode = r.status;
    job.innerRequestId = r.headers.get('x-request-id') || null;
    if (r.ok && data && data.success !== false) {
      job.status = 'done';
      job.result = data;
    } else {
      job.status = 'failed';
      job.result = data;
      job.error = {
        message: data?.error || data?.message || `내부 호출 실패 (HTTP ${r.status})`,
        statusCode: r.status,
        contentType,
        rawTextPreview: rawText ? rawText.slice(0, 500) : null,
      };
    }
    job.finishedAt = Date.now();
  } catch (e) {
    // [2026-07-21] 사용자가 이미 취소를 요청한 상태(job.cancelled)면 어떤 에러든 cancelled 로 처리
    //   - abortController.abort(new Error('user cancel')) 을 호출하면
    //     Node undici 는 그 reason 을 그대로 throw 하므로 e.name === 'AbortError' 가 아닐 수 있음
    //   - self-fetch timeout 도 마찬가지
    if (job.cancelled) {
      job.status = 'cancelled';
      job.error = null;
      job.finishedAt = Date.now();
      console.log(`[nlq-async] 🛑 job ${jobId} aborted by user cancel (err=${e?.message || e})`);
    } else {
      job.status = 'failed';
      job.error = { message: e?.message || String(e), code: e?.code || null };
      job.finishedAt = Date.now();
      console.error(`[nlq-async] job ${jobId} failed:`, e);
    }
  } finally {
    clearTimeout(timeoutId);
    job.abortController = null;
  }
}

app.post('/api/nlq/async', captureLogsMiddleware, async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.', requestId: getCurrentRequestId() });
  }
  const userId = req.session.user.id;
  const { query, queryMode, conversationContext, session_id } = req.body || {};
  if (!query || !String(query).trim()) {
    return res.status(400).json({ error: '질의를 입력하세요.', requestId: getCurrentRequestId() });
  }
  // [2026-07-30] 직접 SQL 입력 차단 — 프론트 우회 방어 (async 경로에도 동일 적용)
  // [2026-07-31] errorType='direct_sql_disabled' 추가 — sync 경로와 동일한 라우팅 키.
  const sqlBlock = detectDirectSqlQuery(query);
  if (sqlBlock) {
    console.warn(`[SQLModeGuard][${getCurrentRequestId()}] (async) 직접 SQL 실행 요청 차단: reason=${sqlBlock.reason}, userId=${userId}, preview=${String(query).slice(0, 80).replace(/\s+/g, ' ')}`);
    return res.status(400).json({
      error: 'SQL 직접 입력은 지원하지 않습니다. 현황집계 또는 분석질문을 선택하여 자연어로 질문해 주세요.',
      code: 'DIRECT_SQL_DISABLED',
      errorType: 'direct_sql_disabled',
      requestId: getCurrentRequestId(),
    });
  }

  setRequestStage('async_job_accepted');
  const jobId = generateNlqJobId();
  const requestId = getCurrentRequestId();
  const job = {
    jobId,
    status: 'pending',
    userId,
    userRole: req.session.user.role || 'user',
    requestId,
    query: String(query),
    queryMode: queryMode || 'analysis',
    conversationContext: conversationContext || null,
    session_id: session_id || null,
    startedAt: Date.now(),
    runningAt: null,
    finishedAt: null,
    result: null,
    error: null,
    statusCode: null,
    innerRequestId: null,
  };
  nlqJobs.set(jobId, job);

  const forwardedCookie = req.headers.cookie || '';
  // await 하지 않음 — 백그라운드 실행
  runNlqJobInBackground(jobId, forwardedCookie, requestId).catch((e) => {
    console.error(`[nlq-async] uncaught in job ${jobId}:`, e);
  });

  console.log(`[nlq-async] 📥 accepted jobId=${jobId} user=${userId} mode=${job.queryMode} query="${job.query.slice(0, 60)}..."`);
  return res.json({
    success: true,
    jobId,
    status: 'pending',
    requestId,
    startedAt: new Date(job.startedAt).toISOString(),
    pollUrl: `/api/nlq/job/${jobId}`,
    recommendedPollIntervalMs: 1500,
  });
});

app.get('/api/nlq/job/:jobId', async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  const jobId = String(req.params.jobId || '').trim();
  const job = nlqJobs.get(jobId);
  if (!job) {
    return res.status(404).json({
      error: 'job 을 찾을 수 없거나 만료되었습니다.',
      hint: '완료된 job 은 ' + Math.round(NLQ_JOB_TTL_MS / 60000) + '분 후 자동 삭제됩니다.',
      jobId,
    });
  }
  const isAdmin = req.session.user.role === 'admin';
  const isOwner = job.userId === req.session.user.id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: '다른 사용자의 작업에는 접근할 수 없습니다.' });
  }
  const now = Date.now();
  const elapsedMs = (job.finishedAt || now) - job.startedAt;
  const payload = {
    success: true,
    jobId: job.jobId,
    status: job.status,        // pending | running | done | failed | cancelled
    cancelled: !!job.cancelled,
    requestId: job.requestId,
    innerRequestId: job.innerRequestId,
    statusCode: job.statusCode,
    queryMode: job.queryMode,
    startedAt: new Date(job.startedAt).toISOString(),
    runningAt: job.runningAt ? new Date(job.runningAt).toISOString() : null,
    finishedAt: job.finishedAt ? new Date(job.finishedAt).toISOString() : null,
    elapsedMs,
    result: (job.status === 'done' || job.status === 'failed') ? job.result : null,
    error: job.error,
  };
  return res.json(payload);
});

// [2026-07-21] 답변 생성 중지 — 사용자가 UI 에서 중지 버튼 클릭 시 호출
//   - job.cancelled = true 로 마크하고 self-fetch AbortController 를 abort
//   - 이미 완료(done/failed)된 job 은 취소 대상이 아님 → 200 with alreadyFinished:true
//   - 결과가 늦게 도착해도 runNlqJobInBackground 에서 폐기
app.post('/api/nlq/cancel/:jobId', async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  const jobId = String(req.params.jobId || '').trim();
  const job = nlqJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: 'job 을 찾을 수 없거나 만료되었습니다.', jobId });
  }
  const isAdmin = req.session.user.role === 'admin';
  const isOwner = job.userId === req.session.user.id;
  if (!isAdmin && !isOwner) {
    return res.status(403).json({ error: '다른 사용자의 작업은 취소할 수 없습니다.' });
  }
  // 이미 완료됐거나 이미 취소된 경우
  if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
    return res.json({
      success: true,
      jobId,
      status: job.status,
      alreadyFinished: true,
      message: `이미 ${job.status} 상태의 작업입니다.`,
    });
  }
  // 중복 취소 방어
  if (job.cancelled) {
    return res.json({ success: true, jobId, status: job.status, alreadyCancelling: true });
  }
  job.cancelled = true;
  job.cancelledAt = Date.now();
  // self-fetch 중이라면 abort
  try {
    if (job.abortController) {
      job.abortController.abort(new Error('user cancel'));
    }
  } catch (_) {}
  console.log(`[nlq-async] 🛑 cancel requested jobId=${jobId} user=${req.session.user.id}`);
  return res.json({ success: true, jobId, status: 'cancelling', cancelled: true });
});

// TTL cleanup: 완료된 job 은 1시간 후, 미완료 좀비는 시작 후 10분에 정리
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, j] of nlqJobs.entries()) {
    if (j.finishedAt && (now - j.finishedAt) > NLQ_JOB_TTL_MS) {
      nlqJobs.delete(id);
      cleaned++;
    } else if (!j.finishedAt && (now - j.startedAt) > NLQ_JOB_MAX_LIFE_MS) {
      // 좀비: 10분 이상 실행중 (실제로는 끝났을 가능성)
      j.status = 'failed';
      j.error = { message: 'job 이 시간 내(10분) 완료되지 않았습니다 (좀비 정리).' };
      j.finishedAt = now;
      console.warn(`[nlq-async] 🧟 zombie job ${id} forcibly failed`);
    }
  }
  if (cleaned > 0) console.log(`[nlq-async] 🧹 cleaned ${cleaned} expired jobs (remaining=${nlqJobs.size})`);
}, 60_000);

// ============================================================
// 이력 보관 정책 (자연어질의 / nl_query_history)
// ============================================================
// - 시간 기준: 보관기간(NLQ_HISTORY_RETENTION_DAYS, 기본 31일) 초과 행은 자동 DELETE
// - 건수 기준: 사용자별 최신 200건만 유지
// - 실행 시점: (1) 신규 이력 INSERT 시점 (2) 서버 시작 시 (3) 24시간 주기 스케줄
const NLQ_HISTORY_RETENTION_DAYS = 31;

async function purgeExpiredNlqHistory() {
  try {
    const [r] = await pool.query(
      `DELETE FROM nl_query_history WHERE created_at < (NOW() - INTERVAL ? DAY)`,
      [NLQ_HISTORY_RETENTION_DAYS]
    );
    if (r.affectedRows > 0) {
      console.log(`[HistoryRetention] ${NLQ_HISTORY_RETENTION_DAYS}일 경과 이력 ${r.affectedRows}건 자동 삭제`);
    }
    return r.affectedRows;
  } catch (e) {
    console.error('[HistoryRetention] 자동 삭제 실패:', e.message);
    return 0;
  }
}

// 서버 시작 시 1회 실행 + 24시간 주기 반복 (서버 시작 30초 후 첫 실행 — DB 풀 안정화 대기)
setTimeout(() => {
  purgeExpiredNlqHistory().catch(() => {});
  setInterval(() => {
    purgeExpiredNlqHistory().catch(() => {});
  }, 24 * 60 * 60 * 1000);
}, 30 * 1000);

// 이력 보관 정책 API (프론트 표시용)
app.get('/api/history/retention', (req, res) => {
  res.json({ days: NLQ_HISTORY_RETENTION_DAYS });
});

// ============================================================
// 이력 저장 헬퍼 함수
// ------------------------------------------------------------
// [PR #251 / 2026-07-22] 마지막 인자로 옵션 객체 { requestId, errorType } 지원 추가.
//   - 하위호환: 기존 13개 위치 인자 호출부는 그대로 동작 (options 미지정 시 NULL 저장)
//   - 목적: 이력 재열람 시에도 최초 오류 화면과 동일한 requestId / 오류 유형 배지 복원
// ============================================================
// [2026-08-03] saveHistory 의 deadlock-safe 래퍼.
// 배경: 사용자 요청에 따르면 DB 타임아웃 응답 이후 이력 저장 과정에서 Deadlock 발생.
//   원인 추정: saveHistory 는 INSERT + DELETE(retention) + DELETE(user 200-cap) 세 개 문장을
//   같은 커넥션 안에서 순차 실행하며, 실패한 무거운 쿼리 직후 여러 요청이 동시에 이 경로에
//   진입하면 nl_query_history 에 대한 gap lock / next-key lock 충돌로 deadlock 발생 가능.
// 대응:
//   1) fire-and-forget 로 호출 (응답 반환 이후에도 계속 시도) → 사용자 응답 절대 블로킹 안 함
//   2) ER_LOCK_DEADLOCK / ER_LOCK_WAIT_TIMEOUT 발생 시 최대 3회 재시도 (100/300/900ms 백오프)
//   3) 최종 실패해도 응답 흐름과 무관하게 로그만 남기고 삼킴
// 반환값: Promise<void> — 결과 대기 없이 호출해도 안전 (모든 실패는 내부에서 처리)
function saveHistorySafe(...args) {
  const doSave = async () => {
    let attempt = 0;
    const maxAttempts = 3;
    while (attempt < maxAttempts) {
      try {
        await saveHistory(...args);
        return;
      } catch (e) {
        const code = String(e?.code || '').toUpperCase();
        const isDeadlock = code === 'ER_LOCK_DEADLOCK' || code === 'ER_LOCK_WAIT_TIMEOUT'
          || /deadlock|lock wait timeout/i.test(String(e?.message || ''));
        attempt++;
        if (isDeadlock && attempt < maxAttempts) {
          const backoffMs = 100 * Math.pow(3, attempt - 1); // 100ms, 300ms
          console.warn(`[History] Deadlock (attempt ${attempt}/${maxAttempts}), backoff ${backoffMs}ms: ${e.message}`);
          await new Promise(r => setTimeout(r, backoffMs));
          continue;
        }
        console.error(`[History] 저장 실패 (attempt ${attempt}, ${isDeadlock ? 'deadlock' : 'non-retryable'}): ${e.message}`);
        return; // swallow — response flow 방해 금지
      }
    }
  };
  // fire-and-forget — Promise 반환하되 상위에서 await 필요 없음
  const p = doSave();
  // unhandledRejection 방지
  p.catch(() => {});
  return p;
}

async function saveHistory(userId, queryText, sql, explanation, chartType, chartConfig, resultData, rowCount, execTime, status, errorMsg, sessionId, domainCode, options) {
  // result_data는 최대 100행만 저장 (DB 용량 절약)
  const trimmedData = resultData ? JSON.stringify(resultData.slice(0, 100)) : null;
  const configJson = chartConfig ? JSON.stringify(chartConfig) : null;
  const requestId = (options && options.requestId) ? String(options.requestId).slice(0, 64) : null;
  const errorType = (options && options.errorType) ? String(options.errorType).slice(0, 50) : null;
  await pool.query(
    `INSERT INTO nl_query_history (user_id, session_id, domain_code, query_text, generated_sql, explanation, chart_type, chart_config, result_data, row_count, execution_time_ms, status, error_message, request_id, error_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId || null, sessionId || null, domainCode || null, queryText, sql, explanation, chartType, configJson, trimmedData, rowCount, execTime, status, errorMsg, requestId, errorType]
  );

  // 시간 기준 보관 정책: NLQ_HISTORY_RETENTION_DAYS(기본 31일) 경과 행 자동 삭제
  // (저장 시점에 한 번 더 실행해서 즉시성 보장 — 사용자가 새 질의를 하면 바로 정리됨)
  pool.query(
    `DELETE FROM nl_query_history WHERE created_at < (NOW() - INTERVAL ? DAY)`,
    [NLQ_HISTORY_RETENTION_DAYS]
  ).catch(e => console.error('[HistoryRetention] INSERT-time purge 실패 (무시):', e.message));

  // 사용자별 최대 200건 유지
  if (userId) {
    await pool.query(
      `DELETE FROM nl_query_history WHERE user_id = ? AND id NOT IN (
         SELECT id FROM (SELECT id FROM nl_query_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 200) AS tmp
       )`,
      [userId, userId]
    );
  }
}

// ============================================================
// API: 질의 이력 조회 (로그인 사용자 본인 이력만)
// ============================================================
app.get('/api/history', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    const tab = req.query.tab || 'recent'; // recent | bookmarked
    console.log('[GET /api/history] session user:', JSON.stringify(req.session?.user), '→ userId:', userId, 'tab:', tab);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    if (!userId) {
      console.log('[GET /api/history] userId is null/undefined → returning empty array');
      return res.json([]);
    }

    // 즐겨찾기 탭일 때만 HAVING으로 필터 (세션 내 어느 row라도 is_bookmarked=1이면 해당 세션 즐겨찾기)
    const havingClause = tab === 'bookmarked' ? 'HAVING is_bookmarked = 1' : '';

    // 세션 단위로 그룹핑하여 반환 (domain_code + is_bookmarked 포함)
    const [rows] = await pool.query(
      `SELECT
         COALESCE(session_id, CONCAT('legacy_', id)) AS session_key,
         MIN(id) AS first_id,
         MIN(query_text) AS first_query,
         (SELECT q2.query_text FROM nl_query_history q2 WHERE q2.user_id = ? AND COALESCE(q2.session_id, CONCAT('legacy_', q2.id)) = COALESCE(h.session_id, CONCAT('legacy_', h.id)) ORDER BY q2.created_at ASC LIMIT 1) AS title_query,
         MAX(created_at) AS last_time,
         COUNT(*) AS query_count,
         SUM(CASE WHEN status='SUCCESS' THEN 1 ELSE 0 END) AS success_count,
         /* [2026-07-23] 사이드바 아이콘 판정용:
            - 세션 내 "실질적 오류(=db_query_timeout 이 아닌 실패)" 건수.
            - 조회 시간 초과(db_query_timeout)는 사용자 시각에서 시스템 오류가 아니라
              "질문 범위가 넓어 응답이 늦은 안내" 이므로 실패 카운트에서 제외.
            - 프론트(renderHistoryList)에서 hard_fail_count === 0 이면 성공 아이콘 표시.
            - 서버 저장/오류 로그/응답 스키마는 그대로, SELECT 집계 컬럼만 추가. */
         SUM(CASE WHEN status<>'SUCCESS' AND COALESCE(error_type,'') <> 'db_query_timeout' THEN 1 ELSE 0 END) AS hard_fail_count,
         SUM(row_count) AS total_rows,
         session_id,
         MAX(domain_code) AS domain_code,
         MAX(is_bookmarked) AS is_bookmarked
       FROM nl_query_history h
       WHERE user_id = ?
       GROUP BY COALESCE(session_id, CONCAT('legacy_', id))
       ${havingClause}
       ORDER BY last_time DESC
       LIMIT ?`,
      [userId, userId, limit]
    );
    console.log('[GET /api/history] userId:', userId, 'tab:', tab, '→ sessions returned:', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/history] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 세션 단위 즐겨찾기 토글
//   sessionKey: 'legacy_<id>' 또는 UUID 형식 세션 ID
//   세션 내 모든 row의 is_bookmarked를 일괄 업데이트
app.patch('/api/history/session/:sessionKey/bookmark', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const sessionKey = req.params.sessionKey;

    // 현재 즐겨찾기 상태 조회 (세션 첫 row 기준)
    let currentRows;
    if (sessionKey.startsWith('legacy_')) {
      const id = parseInt(sessionKey.replace('legacy_', ''));
      [currentRows] = await pool.query(
        'SELECT MAX(is_bookmarked) AS is_bookmarked FROM nl_query_history WHERE id=? AND user_id=?',
        [id, userId]
      );
    } else {
      [currentRows] = await pool.query(
        'SELECT MAX(is_bookmarked) AS is_bookmarked FROM nl_query_history WHERE session_id=? AND user_id=?',
        [sessionKey, userId]
      );
    }
    if (!currentRows || currentRows.length === 0) {
      return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
    }
    const newVal = currentRows[0].is_bookmarked ? 0 : 1;

    // 세션 내 모든 row 일괄 업데이트
    if (sessionKey.startsWith('legacy_')) {
      const id = parseInt(sessionKey.replace('legacy_', ''));
      await pool.query('UPDATE nl_query_history SET is_bookmarked=? WHERE id=? AND user_id=?', [newVal, id, userId]);
    } else {
      await pool.query('UPDATE nl_query_history SET is_bookmarked=? WHERE session_id=? AND user_id=?', [newVal, sessionKey, userId]);
    }
    res.json({ success: true, is_bookmarked: newVal });
  } catch (err) {
    console.error('[PATCH /api/history/session/:sessionKey/bookmark] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 세션 전체 이력 조회 (세션 내 모든 질문+결과 반환)
app.get('/api/history/session/:sessionId', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const sessionId = req.params.sessionId;

    let rows;
    if (sessionId.startsWith('legacy_')) {
      const id = parseInt(sessionId.replace('legacy_', ''));
      [rows] = await pool.query(
        'SELECT * FROM nl_query_history WHERE id=? AND user_id=? ORDER BY created_at ASC',
        [id, userId]
      );
    } else {
      [rows] = await pool.query(
        'SELECT * FROM nl_query_history WHERE session_id=? AND user_id=? ORDER BY created_at ASC',
        [sessionId, userId]
      );
    }

    if (rows.length === 0) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    // [2026-07-31] 이력 재열람 시에도 최초 실행과 동일한 실제 조회 기간을 표시하기 위해
    //   저장된 generated_sql 에서 CALMONTH 를 파싱하여 period_info 를 함께 반환.
    //   - result_data(100행) 나 별도 컬럼 확장 없이 기존 스키마 그대로 사용.
    //   - SQL 이 없거나 CALMONTH 매칭 실패 시 null → 프론트가 기간 영역을 표시하지 않음.
    const result = rows.map(r => ({
      ...r,
      chart_config: r.chart_config ? JSON.parse(r.chart_config) : null,
      result_data: r.result_data ? JSON.parse(r.result_data) : null,
      period_info: extractPeriodInfoFromSql(r.generated_sql),
    }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 단건 조회 (하위 호환용)
app.get('/api/history/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const [rows] = await pool.query('SELECT * FROM nl_query_history WHERE id=? AND user_id=?', [req.params.id, userId]);
    if (rows.length === 0) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    const r = rows[0];
    r.chart_config = r.chart_config ? JSON.parse(r.chart_config) : null;
    r.result_data = r.result_data ? JSON.parse(r.result_data) : null;
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 삭제 — 세션 단위 또는 단건 (본인 이력만)
app.delete('/api/history/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const param = req.params.id;

    if (param.startsWith('legacy_')) {
      const id = parseInt(param.replace('legacy_', ''));
      await pool.query('DELETE FROM nl_query_history WHERE id=? AND user_id=?', [id, userId]);
    } else if (param.includes('-') && param.length > 20) {
      await pool.query('DELETE FROM nl_query_history WHERE session_id=? AND user_id=?', [param, userId]);
    } else {
      await pool.query('DELETE FROM nl_query_history WHERE id=? AND user_id=?', [param, userId]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 전체 삭제 (본인 이력만)
app.delete('/api/history', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    await pool.query('DELETE FROM nl_query_history WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: 자주질문(즐겨찾기) — 사이드 메뉴 "자주질문" 탭
// ============================================================
// 정책:
// - 사용자별 보관 (user_favorite_questions)
// - 같은 사용자/같은 질문 중복 방지 (UNIQUE KEY: user_id + SHA1(LOWER(TRIM(text))))
// - 토글: 존재하면 DELETE, 없으면 INSERT (단순화)
// - 클릭 재사용 시 use_count++, last_used_at 갱신
// - 질문 길이 1000자 제한 (긴 텍스트 방지)
// ============================================================

// 질문 정규화 → SHA1 해시 (UNIQUE KEY 매칭용)
function normalizeAndHashQuery(text) {
  const normalized = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return crypto.createHash('sha1').update(normalized, 'utf8').digest('hex');
}

// [GET] /api/favorite-questions
// → 본인의 자주질문 목록 (최근 추가 / 사용 빈도 순서 선택 가능)
app.get('/api/favorite-questions', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const sortBy = (req.query.sort === 'used') ? 'used' : 'recent';
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    let orderClause;
    if (sortBy === 'used') {
      orderClause = 'ORDER BY use_count DESC, COALESCE(last_used_at, created_at) DESC, id DESC';
    } else {
      orderClause = 'ORDER BY created_at DESC, id DESC';
    }
    const [rows] = await pool.query(
      `SELECT id, query_text, query_hash, domain_code, query_mode,
              last_used_at, use_count, created_at
       FROM user_favorite_questions
       WHERE user_id = ?
       ${orderClause}
       LIMIT ?`,
      [userId, limit]
    );
    res.json({ success: true, items: rows, count: rows.length, sort: sortBy });
  } catch (err) {
    console.error('[GET /api/favorite-questions] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// [POST] /api/favorite-questions
// body: { query_text, domain_code?, query_mode? }
// → 신규 추가 (이미 존재하면 멱등하게 success=true, alreadyExists=true)
app.post('/api/favorite-questions', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const { query_text, domain_code, query_mode } = req.body || {};
    const text = String(query_text || '').trim();
    if (!text) return res.status(400).json({ error: '질문 내용이 비어 있습니다.' });
    if (text.length > 1000) return res.status(400).json({ error: '질문이 너무 깁니다. (최대 1000자)' });
    const hash = normalizeAndHashQuery(text);
    // 이미 있는지 확인
    const [existing] = await pool.query(
      'SELECT id, query_text FROM user_favorite_questions WHERE user_id=? AND query_hash=? LIMIT 1',
      [userId, hash]
    );
    if (existing.length > 0) {
      return res.json({ success: true, alreadyExists: true, id: existing[0].id, query_hash: hash });
    }
    const [result] = await pool.query(
      `INSERT INTO user_favorite_questions
         (user_id, query_text, query_hash, domain_code, query_mode)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, text, hash, domain_code || null, query_mode || null]
    );
    res.json({ success: true, id: result.insertId, query_hash: hash, alreadyExists: false });
  } catch (err) {
    console.error('[POST /api/favorite-questions] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// [DELETE] /api/favorite-questions
// query string 또는 body 의 query_text 또는 query_hash 로 삭제
// (id 기반은 /api/favorite-questions/:id 로 별도 지원)
app.delete('/api/favorite-questions', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const text = (req.query.query_text || req.body?.query_text || '').toString().trim();
    let hash = (req.query.query_hash || req.body?.query_hash || '').toString().trim();
    if (!hash && text) hash = normalizeAndHashQuery(text);
    if (!hash) return res.status(400).json({ error: 'query_text 또는 query_hash 가 필요합니다.' });
    const [result] = await pool.query(
      'DELETE FROM user_favorite_questions WHERE user_id=? AND query_hash=?',
      [userId, hash]
    );
    res.json({ success: true, deleted: result.affectedRows, query_hash: hash });
  } catch (err) {
    console.error('[DELETE /api/favorite-questions] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// [DELETE] /api/favorite-questions/:id
// 본인 소유 id 기준 삭제
app.delete('/api/favorite-questions/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id 가 잘못되었습니다.' });
    const [result] = await pool.query(
      'DELETE FROM user_favorite_questions WHERE id=? AND user_id=?',
      [id, userId]
    );
    res.json({ success: true, deleted: result.affectedRows });
  } catch (err) {
    console.error('[DELETE /api/favorite-questions/:id] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// [POST] /api/favorite-questions/:id/use
// → 사용자가 자주질문 클릭 시 use_count++ / last_used_at 갱신
//   (재질의 시점 호출 — 통계용)
app.post('/api/favorite-questions/:id/use', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id 가 잘못되었습니다.' });
    const [result] = await pool.query(
      `UPDATE user_favorite_questions
         SET use_count = use_count + 1,
             last_used_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [id, userId]
    );
    res.json({ success: true, updated: result.affectedRows });
  } catch (err) {
    console.error('[POST /api/favorite-questions/:id/use] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// [GET] /api/favorite-questions/check?query_text=...
// → 특정 질문이 이미 자주질문에 저장되어 있는지 확인 (말풍선 하트 초기 상태 동기화)
app.get('/api/favorite-questions/check', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const text = String(req.query.query_text || '').trim();
    if (!text) return res.json({ success: true, exists: false });
    const hash = normalizeAndHashQuery(text);
    const [rows] = await pool.query(
      'SELECT id FROM user_favorite_questions WHERE user_id=? AND query_hash=? LIMIT 1',
      [userId, hash]
    );
    res.json({ success: true, exists: rows.length > 0, id: rows[0]?.id || null, query_hash: hash });
  } catch (err) {
    console.error('[GET /api/favorite-questions/check] error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
      ai: GPT_MODEL,
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
// API: 데이터 기준월 컨텍스트 (프론트엔드 기준월 안내용)
// ============================================================
app.get('/api/data-date-context', async (req, res) => {
  try {
    const ctx = await getDataDateContext();
    res.json({
      latestMonth: ctx.latestMonth,
      prevMonth: ctx.prevMonth,
      latestLabel: ctx.latestLabel,
      prevLabel: ctx.prevLabel,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
// 학습관리 API: Ontology (컬럼) — 관리자 전용 + domain 필터
// ============================================================
// 전체 목록 (동의어 포함, domain 필터)
app.get('/api/ontology', requireAdmin, async (req, res) => {
  const dc = req.query.domain_code || await getActiveDomain(req);
  try {
    const [columns] = await pool.query(
      `SELECT c.*, GROUP_CONCAT(s.id, ':::', s.synonym_text ORDER BY s.id SEPARATOR '|||') AS synonyms
       FROM ontology_column c
       LEFT JOIN ontology_synonym s ON s.column_id = c.id
       WHERE c.domain_code = ?
       GROUP BY c.id ORDER BY c.id`, [dc]
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

// type 정규화: '원가' | '비용' | null 만 반환
function _normalizeType(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (s === '원가' || s === '비용') return s;
  return null;
}

// 추가
app.post('/api/ontology', requireAdmin, async (req, res) => {
  const { column_name, table_name, description, data_type } = req.body;
  const dc = req.body.domain_code || await getActiveDomain(req);
  if (!column_name) return res.status(400).json({ error: 'column_name 필수' });
  const type = _normalizeType(req.body.type);
  try {
    const [r] = await pool.query(
      'INSERT INTO ontology_column (domain_code, column_name, table_name, description, data_type, type) VALUES (?,?,?,?,?,?)',
      [dc, column_name, table_name || 'bw_profitability_data', description || '', data_type || '', type]
    );
    // is_active 는 DB DEFAULT 1 로 자동 활성화됨
    res.json({ id: r.insertId, domain_code: dc, column_name, table_name: table_name || 'bw_profitability_data', description, data_type, type, is_active: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정
app.put('/api/ontology/:id', requireAdmin, async (req, res) => {
  const { column_name, table_name, description, data_type } = req.body;
  // type 이 body 에 포함된 경우에만 갱신 (undefined 면 기존값 유지)
  const hasType = Object.prototype.hasOwnProperty.call(req.body, 'type');
  try {
    if (hasType) {
      const type = _normalizeType(req.body.type);
      await pool.query(
        'UPDATE ontology_column SET column_name=?, table_name=?, description=?, data_type=?, type=? WHERE id=?',
        [column_name, table_name, description, data_type, type, req.params.id]
      );
    } else {
      await pool.query(
        'UPDATE ontology_column SET column_name=?, table_name=?, description=?, data_type=? WHERE id=?',
        [column_name, table_name, description, data_type, req.params.id]
      );
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 원가/비용 구분 인라인 저장 (드롭다운 즉시 반영)
// body: { type: '원가' | '비용' | null | '' }
app.patch('/api/ontology/:id/type', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const type = _normalizeType(req.body?.type);
    await pool.query('UPDATE ontology_column SET type=? WHERE id=?', [type, id]);
    // 프롬프트 빌드 시점에 매번 DB 조회하므로 RAG 재빌드 불필요.
    res.json({ success: true, id: Number(id), type });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 삭제
app.delete('/api/ontology/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM ontology_synonym WHERE column_id=?', [req.params.id]);
    await pool.query('DELETE FROM ontology_column WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 활성/비활성 토글 (is_active)
// body: { is_active: 0|1 }  (생략 시 현재 값의 반대로 토글)
// → 비활성 컬럼은 NLQ(RAG 인덱스/동의어 매칭/RAG 컨텍스트) 및 비주얼 쿼리빌더 응답에서 제외됨
app.patch('/api/ontology/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    let nextVal;
    if (req.body && (req.body.is_active === 0 || req.body.is_active === 1
                  || req.body.is_active === '0' || req.body.is_active === '1')) {
      nextVal = Number(req.body.is_active) ? 1 : 0;
    } else {
      const [[row]] = await pool.query('SELECT is_active FROM ontology_column WHERE id=?', [id]);
      if (!row) return res.status(404).json({ error: 'not found' });
      nextVal = row.is_active ? 0 : 1;
    }
    await pool.query('UPDATE ontology_column SET is_active=? WHERE id=?', [nextVal, id]);

    // 백그라운드로 RAG 인덱스 재빌드 (비동기, 응답 블로킹 X)
    setImmediate(async () => {
      try {
        const count = await buildRagIndex(pool);
        ragReady = true;
        console.log(`[Ontology Toggle] RAG 재인덱싱 완료: ${count} 청크 (column_id=${id}, is_active=${nextVal})`);
      } catch (e) {
        console.error('[Ontology Toggle] RAG 재인덱싱 실패 (무시):', e.message);
      }
    });

    res.json({ success: true, id: Number(id), is_active: nextVal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 동의어 추가
app.post('/api/ontology/:id/synonym', requireAdmin, async (req, res) => {
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
app.delete('/api/ontology/synonym/:synId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM ontology_synonym WHERE id=?', [req.params.synId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 학습관리 API: Ontology 엑셀 업로드
// ============================================================

// 엑셀 미리보기 (파싱만 수행, DB 반영 안함)
app.post('/api/ontology/upload-excel/preview', requireAdmin, upload.single('file'), async (req, res) => {
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
app.post('/api/ontology/upload-excel/apply', requireAdmin, express.json({ limit: '10mb' }), async (req, res) => {
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
    [2, 'MATERIAL_NM', 'bw_profitability_data', '자재 명', 'VARCHAR(100)', '제품명,상품명,자재명', '', ''],
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
// 학습관리 API: Metric (계산 지표) — 관리자 전용 + domain 필터
// ============================================================
app.get('/api/metric', requireAdmin, async (req, res) => {
  const dc = req.query.domain_code || await getActiveDomain(req);
  try {
    const [metrics] = await pool.query(
      `SELECT m.*, GROUP_CONCAT(s.id, ':::', s.synonym_text ORDER BY s.id SEPARATOR '|||') AS synonyms
       FROM metric m
       LEFT JOIN metric_synonym s ON s.metric_id = m.id
       WHERE m.domain_code = ?
       GROUP BY m.id ORDER BY m.id`, [dc]
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

// ============================================================
// [2026-06-30] Metric → RAG 인덱스 자동 동기화 헬퍼
//   학습관리에서 metric / metric_synonym 변경 시 호출되어 RAG 인덱스를 즉시 갱신.
//   - 인덱스 미준비 상태(ragReady=false)이면 스킵 (전체 빌드 시 함께 반영됨)
//   - 임베딩 호출은 best-effort: 실패해도 본 API 응답은 정상 200으로 반환
// ============================================================
async function syncMetricToRag(metricId) {
  if (!ragReady) return; // 인덱스 미준비 시 스킵
  try {
    const [rows] = await pool.query(
      `SELECT m.id, m.metric_code, m.aggregation, m.formula, m.description, m.domain_code,
              GROUP_CONCAT(s.synonym_text SEPARATOR ', ') AS synonyms
       FROM metric m
       LEFT JOIN metric_synonym s ON s.metric_id = m.id
       WHERE m.id = ?
       GROUP BY m.id`,
      [metricId]
    );
    // 기존 청크 제거
    await removeFromIndex(pool, 'metric', metricId);
    if (rows.length === 0) {
      console.log(`[RAG sync] metric #${metricId} 삭제됨 → 인덱스에서 제거`);
      return;
    }
    const m = rows[0];
    const formula = (m.formula || '').trim();
    const aggUpper = (m.aggregation || '').toUpperCase();
    const hasAggInside = /\b(SUM|AVG|COUNT|MAX|MIN)\s*\(/i.test(formula);
    let sqlExpr; let level;
    if (hasAggInside) { sqlExpr = formula; level = 'column-level'; }
    else if (aggUpper === 'CALC') { sqlExpr = `SUM(${formula})`; level = 'row-level'; }
    else if (['SUM','AVG','COUNT','MAX','MIN'].includes(aggUpper)) { sqlExpr = `${aggUpper}(${formula})`; level = 'row-level'; }
    else { sqlExpr = formula; level = 'row-level'; }
    let text = `지표: ${m.description || m.metric_code} = ${sqlExpr} [${level}, 도메인:${m.domain_code || 'ALL'}]`;
    text += `. 원본 산식(학습관리 등록값): ${formula}`;
    if (m.synonyms) text += `. 동의어: ${m.synonyms}`;
    await addToIndex(pool, 'metric', metricId, text, {
      metric_code: m.metric_code,
      aggregation: m.aggregation,
      formula: m.formula,
      sql_expr: sqlExpr,
      level,
      description: m.description,
      domain_code: m.domain_code,
    });
    console.log(`[RAG sync] metric #${metricId} (${m.metric_code}) → 인덱스 갱신 완료`);
  } catch (e) {
    console.error(`[RAG sync] metric #${metricId} 동기화 실패 (본 API 응답엔 영향 없음):`, e.message);
  }
}

app.post('/api/metric', requireAdmin, async (req, res) => {
  const { metric_code, aggregation, formula, table_name, description } = req.body;
  const dc = req.body.domain_code || await getActiveDomain(req);
  if (!metric_code || !formula) return res.status(400).json({ error: 'metric_code, formula 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO metric (domain_code, metric_code, aggregation, formula, table_name, description) VALUES (?,?,?,?,?,?)',
      [dc, metric_code, aggregation || 'SUM', formula, table_name || 'bw_profitability_data', description || '']
    );
    // [2026-06-30] RAG 인덱스에 즉시 반영
    syncMetricToRag(r.insertId).catch(() => {});
    res.json({ id: r.insertId, domain_code: dc, metric_code, aggregation: aggregation || 'SUM', formula, table_name: table_name || 'bw_profitability_data', description });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/metric/:id', requireAdmin, async (req, res) => {
  const { metric_code, aggregation, formula, table_name, description } = req.body;
  try {
    await pool.query(
      'UPDATE metric SET metric_code=?, aggregation=?, formula=?, table_name=?, description=? WHERE id=?',
      [metric_code, aggregation, formula, table_name, description, req.params.id]
    );
    // [2026-06-30] RAG 인덱스에 즉시 반영
    syncMetricToRag(Number(req.params.id)).catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/metric/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM metric_synonym WHERE metric_id=?', [req.params.id]);
    await pool.query('DELETE FROM metric WHERE id=?', [req.params.id]);
    // [2026-06-30] RAG 인덱스에서 제거 (DELETE 후 호출 — syncMetricToRag가 행 없음 감지 후 remove만 수행)
    syncMetricToRag(Number(req.params.id)).catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/metric/:id/synonym', requireAdmin, async (req, res) => {
  const { synonym_text } = req.body;
  if (!synonym_text) return res.status(400).json({ error: 'synonym_text 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO metric_synonym (metric_id, synonym_text) VALUES (?,?)',
      [req.params.id, synonym_text]
    );
    // [2026-06-30] 동의어 변경도 RAG 청크 text에 영향 → 재인덱싱
    syncMetricToRag(Number(req.params.id)).catch(() => {});
    res.json({ id: r.insertId, synonym_text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/metric/synonym/:synId', requireAdmin, async (req, res) => {
  try {
    // 삭제 전에 metric_id 조회 (RAG 재동기화용)
    const [pre] = await pool.query('SELECT metric_id FROM metric_synonym WHERE id=?', [req.params.synId]);
    const metricId = pre.length > 0 ? Number(pre[0].metric_id) : null;
    await pool.query('DELETE FROM metric_synonym WHERE id=?', [req.params.synId]);
    if (metricId) syncMetricToRag(metricId).catch(() => {});
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 학습관리 API: JOIN (조인 조건) — 관리자 전용 + domain 필터
// ============================================================
app.get('/api/join', requireAdmin, async (req, res) => {
  const dc = req.query.domain_code || await getActiveDomain(req);
  try {
    const [rows] = await pool.query('SELECT * FROM join_condition WHERE domain_code = ? ORDER BY id', [dc]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/join', requireAdmin, async (req, res) => {
  const { left_column, left_table, right_column, right_table, join_type, operator, description } = req.body;
  const dc = req.body.domain_code || await getActiveDomain(req);
  if (!left_column || !left_table || !right_column || !right_table)
    return res.status(400).json({ error: '필수 필드 누락' });
  try {
    const [r] = await pool.query(
      'INSERT INTO join_condition (domain_code, left_column, left_table, right_column, right_table, join_type, operator, description) VALUES (?,?,?,?,?,?,?,?)',
      [dc, left_column, left_table, right_column, right_table, join_type || 'LEFT', operator || '=', description || '']
    );
    res.json({ id: r.insertId, domain_code: dc, left_column, left_table, right_column, right_table, join_type: join_type || 'LEFT', operator: operator || '=' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/join/:id', requireAdmin, async (req, res) => {
  const { left_column, left_table, right_column, right_table, join_type, operator, description } = req.body;
  try {
    await pool.query(
      'UPDATE join_condition SET left_column=?, left_table=?, right_column=?, right_table=?, join_type=?, operator=?, description=? WHERE id=?',
      [left_column, left_table, right_column, right_table, join_type, operator, description, req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/join/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM join_condition WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 학습관리 API: 코드값 매핑 (Code Mapping) — 관리자 전용 + domain 필터
// ============================================================
// 전체 조회 (컬럼별 그룹핑, domain 필터)
app.get('/api/code-mapping', requireAdmin, async (req, res) => {
  const dc = req.query.domain_code || await getActiveDomain(req);
  try {
    const [rows] = await pool.query('SELECT * FROM code_mapping WHERE domain_code = ? OR domain_code IS NULL ORDER BY column_name, code_value', [dc]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 컬럼별 조회
app.get('/api/code-mapping/column/:colName', requireAdmin, async (req, res) => {
  const dc = req.query.domain_code || await getActiveDomain(req);
  try {
    const [rows] = await pool.query(
      'SELECT * FROM code_mapping WHERE column_name=? AND (domain_code = ? OR domain_code IS NULL) ORDER BY code_value',
      [req.params.colName, dc]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 추가
app.post('/api/code-mapping', requireAdmin, async (req, res) => {
  const { column_name, column_name_nm, code_value, display_name, table_name, description } = req.body;
  const dc = req.body.domain_code || await getActiveDomain(req);
  if (!column_name || !code_value || !display_name)
    return res.status(400).json({ error: 'column_name, code_value, display_name 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO code_mapping (domain_code, column_name, column_name_nm, code_value, display_name, table_name, description) VALUES (?,?,?,?,?,?,?)',
      [dc, column_name, column_name_nm || null, code_value, display_name, table_name || 'bw_profitability_data', description || '']
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
app.put('/api/code-mapping/:id', requireAdmin, async (req, res) => {
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
app.delete('/api/code-mapping/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM code_mapping WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DB 실데이터에 매핑 적용 (현재 스키마에는 _NM 컬럼이 없으므로 AI 프롬프트에만 반영)
app.post('/api/code-mapping/apply', requireAdmin, async (req, res) => {
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
app.get('/api/code-mapping/columns', requireAdmin, async (req, res) => {
  const dc = req.query.domain_code || await getActiveDomain(req);
  try {
    const [rows] = await pool.query(
      'SELECT column_name, column_name_nm, COUNT(*) AS cnt FROM code_mapping WHERE domain_code = ? OR domain_code IS NULL GROUP BY column_name, column_name_nm ORDER BY column_name', [dc]
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
  const dc = await getActiveDomain(req);
  if (!query_text || !original_sql || !feedback_type)
    return res.status(400).json({ error: 'query_text, original_sql, feedback_type 필수' });
  if (!['correct', 'corrected'].includes(feedback_type))
    return res.status(400).json({ error: "feedback_type은 'correct' 또는 'corrected'" });
  try {
    let finalSql = feedback_type === 'correct' ? original_sql : (corrected_sql || original_sql);
    // ★ [PR #257] 축 B — CALMONTH 자리표시자 파라미터화
    //   - 질의에 명시적 년월이 없다면(당월/이번달/시간 표현 없음 등),
    //     저장 시점의 CALMONTH 리터럴을 :LATEST_MONTH / :PREV_MONTH 자리표시자로 치환.
    //   - 다음에 이 SQL이 학습 매칭될 때 rebaseCalmonthForLearnedSql 에서 정확히 재바인딩됨.
    //   - 질의에 "2026년 5월" 같은 명시적 년월이 있으면 원본 그대로 저장 (사용자 명시 존중).
    try {
      const dcCtx = await getDataDateContext();
      const beforeParam = finalSql;
      finalSql = parameterizeCalmonthForSave(finalSql, query_text || '', dcCtx);
      if (finalSql !== beforeParam) {
        console.log(`[Feedback] CALMONTH 자리표시자 파라미터화 적용 (latest=${dcCtx.latestMonth}, prev=${dcCtx.prevMonth})`);
      }
    } catch (paramErr) {
      // 파라미터화 실패해도 원본 저장은 진행 (기존 동작 보존)
      console.error('[Feedback] CALMONTH 파라미터화 실패, 원본 저장으로 진행:', paramErr.message);
    }
    const [r] = await pool.query(
      'INSERT INTO sql_feedback (query_text, original_sql, corrected_sql, feedback_type, domain_code) VALUES (?,?,?,?,?)',
      [query_text, original_sql, finalSql, feedback_type, dc]
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

// 피드백 목록 조회 (domain 필터)
app.get('/api/feedback', async (req, res) => {
  const dc = await getActiveDomain(req);
  try {
    const [rows] = await pool.query(
      'SELECT * FROM sql_feedback WHERE domain_code = ? OR domain_code IS NULL ORDER BY created_at DESC LIMIT 100', [dc]
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
app.get('/api/learning/stats', requireAdmin, async (req, res) => {
  const dc = req.query.domain_code || await getActiveDomain(req);
  try {
    const [o] = await pool.query('SELECT COUNT(*) AS cnt FROM ontology_column WHERE domain_code = ?', [dc]);
    const [os] = await pool.query('SELECT COUNT(*) AS cnt FROM ontology_synonym s JOIN ontology_column c ON s.column_id=c.id WHERE c.domain_code = ?', [dc]);
    const [m] = await pool.query('SELECT COUNT(*) AS cnt FROM metric WHERE domain_code = ?', [dc]);
    const [ms] = await pool.query('SELECT COUNT(*) AS cnt FROM metric_synonym s JOIN metric mt ON s.metric_id=mt.id WHERE mt.domain_code = ?', [dc]);
    const [j] = await pool.query('SELECT COUNT(*) AS cnt FROM join_condition WHERE domain_code = ?', [dc]);
    const [cm] = await pool.query('SELECT COUNT(*) AS cnt FROM code_mapping WHERE is_active=1 AND (domain_code = ? OR domain_code IS NULL)', [dc]);
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

    const startTime = Date.now();
    console.log(`[Report] PPT 생성 시작: calmonth=${calmonth}, prompt="${prompt ? prompt.substring(0,50) : '(없음)'}"`);

    const { stdout, stderr } = await execFileAsync('python3', args, {
      cwd: import.meta.dirname,
      timeout: 180000,  // 3분 타임아웃 (GPT 슬라이드 플랜 포함)
      maxBuffer: 50 * 1024 * 1024,
      encoding: 'buffer',
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    if (stderr && stderr.length > 0) {
      console.warn(`[Report] PPT stderr (${elapsed}s):`, stderr.toString('utf8').substring(0, 500));
    }
    console.log(`[Report] PPT 생성 완료: ${elapsed}s, ${(stdout.length / 1024).toFixed(0)}KB`);

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
    const stderrMsg = e.stderr ? Buffer.isBuffer(e.stderr) ? e.stderr.toString('utf8').substring(0, 300) : String(e.stderr).substring(0, 300) : '';
    console.error('[Report] PPT generation error:', e.message);
    if (stderrMsg) console.error('[Report] PPT stderr:', stderrMsg);
    const userMsg = e.killed ? '보고서 생성 시간이 초과되었습니다 (3분). 프롬프트를 간결하게 수정해주세요.'
                   : e.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? '보고서 파일이 너무 큽니다.'
                   : `보고서 생성 오류: ${e.message}`;
    res.status(500).json({ error: userMsg });
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
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bw_profitability_data'
      ORDER BY ORDINAL_POSITION
    `);

    // 2. Ontology 컬럼 정보 조회 (설명 보강, domain 필터)
    //    is_active 도 함께 조회 → 비활성 컬럼은 빌더 응답에서 제외
    const dc = await getActiveDomain(req);
    const [ontoCols] = await pool.query(`SELECT id, column_name, description, data_type, is_active FROM ontology_column WHERE domain_code = ?`, [dc]);
    const ontoMap = {};
    const inactiveColSet = new Set(); // 비활성 컬럼명(UPPER) 집합
    for (const o of ontoCols) {
      ontoMap[o.column_name.toUpperCase()] = o;
      if (o.is_active === 0) {
        inactiveColSet.add(o.column_name.toUpperCase());
      }
    }

    // 2-1. Ontology 동의어 일괄 조회 (도메인 필터 적용됨 — ontology_column이 이미 도메인 필터)
    const ontoSynonymMap = {}; // { COLUMN_NAME_UPPER: ['동의어1', '동의어2', ...] }
    const ontoColIds = ontoCols.map(o => o.id).filter(Boolean);
    if (ontoColIds.length > 0) {
      try {
        const [synRows] = await pool.query(
          `SELECT column_id, synonym_text FROM ontology_synonym WHERE column_id IN (${ontoColIds.map(() => '?').join(',')})`,
          ontoColIds
        );
        // column_id → column_name 역매핑
        const idToName = {};
        for (const o of ontoCols) idToName[o.id] = o.column_name.toUpperCase();
        for (const s of synRows) {
          const colName = idToName[s.column_id];
          if (!colName) continue;
          if (!ontoSynonymMap[colName]) ontoSynonymMap[colName] = [];
          ontoSynonymMap[colName].push(s.synonym_text);
        }
      } catch (synErr) {
        console.error('[Builder] Ontology synonym 조회 오류 (무시):', synErr.message);
      }
    }

    // 카테고리 분류
    const catMap = {
      'SEQ': 'system',
      'CALYEAR': 'period', 'CALMONTH': 'period', 'CALDAY': 'period',
      'CO_AREA': 'org', 'CO_AREA_NM': 'org', 'PROFIT_CTR': 'org', 'PROFIT_CTR_NM': 'org', 'DIVISION': 'org', 'DIVISION_NM': 'org', 'PLANT': 'org', 'PLANT_NM': 'org',
      'DISTR_CHAN': 'org', 'DISTR_CHAN_NM': 'org', 'BIC_ZDISTCHAN': 'org', 'BIC_ZORG_TEAM': 'org', 'SALES_OFF': 'org', 'SALES_OFF_NM': 'org',
      'MATL_TYPE': 'product', 'MATL_TYPE_NM': 'product', 'MATL_GROUP': 'product', 'MATL_GROUP_NM': 'product',
      'PRODH1': 'product', 'PRODH1_NM': 'product', 'PRODH2': 'product', 'PRODH2_NM': 'product', 'PRODH3': 'product', 'PRODH3_NM': 'product', 'PRODH4': 'product', 'PRODH4_NM': 'product',
      'BIC_ZJPCODE': 'product', 'BIC_ZJPCODE_NM': 'product', 'BIC_ZBRAND': 'product', 'BIC_ZBRAND_NM': 'product', 'BIC_ZSBRAND': 'product', 'BIC_ZSBRAND_NM': 'product',
      'MATERIAL': 'product', 'MATERIAL_NM': 'product',
      'BILL_TYPE': 'trade', 'BILL_TYPE_NM': 'trade', 'INCOTERMS': 'trade', 'INCOTERMS_NM': 'trade', 'CUST_GROUP': 'trade', 'CUST_GROUP_NM': 'trade',
      'CUST_GRP1': 'trade', 'CUST_GRP1_NM': 'trade', 'ZZKVGR7': 'trade', 'ZZKVGR7_NM': 'trade', 'COUNTRY': 'trade', 'COUNTRY_NM': 'trade', 'BIC_ZKUNN2': 'trade', 'BIC_ZKUNN2_NM': 'trade', 'CUSTOMER': 'trade', 'CUSTOMER_NM': 'trade',
      'BIC_ZBOXUNIT': 'unit', 'BIC_ZBAGUNIT': 'unit', 'BIC_ZUNIT': 'unit', 'CURRENCY': 'unit',
      'BIC_ZQTY_BOX': 'quantity', 'BIC_ZQTY_BAG': 'quantity', 'BIC_ZQTY_KE': 'quantity',
    };

    // 3. Metric 계산 지표 먼저 조회 (DB 컬럼 루프 전에 — 산식 참조 컬럼을 ontology에서 숨기기 위해)
    const dc2 = dc; // dc 변수 alias
    let metricRows = [];
    try {
      const [_rows] = await pool.query(
        `SELECT id, metric_code, aggregation, formula, table_name, description, domain_code FROM metric WHERE domain_code = ?`,
        [dc2]
      );
      metricRows = _rows;
    } catch (e) {
      console.error('[Builder] metric 사전조회 오류 (무시):', e.message);
    }

    // 3-1. Metric으로 등록된 DB 컬럼명 집합 구축 (ontology 섹션에서 숨기기 위해)
    //   ─ metric_code 자체가 DB 컬럼명과 같은 경우만 제외 (예: metric_code='ZAMT035' → 매출총이익)
    //   ─ formula 내 참조 컬럼(예: SUM(ZAMT001))은 원본 데이터이므로 ontology에 그대로 노출
    //   ─ 즉, ZAMT001 같은 원본 컬럼이 metric으로 등록되지 않았다면 [금액] 섹션에 정상 표시됨
    const validDbColSet = new Set(dbCols.map(r => r.COLUMN_NAME.toUpperCase()));
    const metricCodeSet = new Set(); // metric_code = DB 컬럼명인 경우만 (UPPER)
    for (const m of metricRows) {
      if (m.metric_code) {
        const code = String(m.metric_code).toUpperCase();
        if (validDbColSet.has(code)) {
          metricCodeSet.add(code);
        }
      }
    }

    const columns = [];
    for (const r of dbCols) {
      const name = r.COLUMN_NAME;
      const ctype = r.COLUMN_TYPE;
      const onto = ontoMap[name.toUpperCase()];

      // ★ 비활성 컬럼은 빌더 응답에서 제외 (ontology_column.is_active=0)
      if (inactiveColSet.has(name.toUpperCase())) continue;

      // ★ Metric으로 등록된 컬럼(metric_code = 컬럼명)은 ontology 섹션에서 제외
      //    → 같은 ZAMT035가 [금액]에도 [계산지표]에도 나오는 중복 표시 방지 (계산지표만 노출)
      //    formula에서 참조되는 원본 컬럼(예: ZAMT001)은 ontology에 그대로 노출됨
      if (metricCodeSet.has(name.toUpperCase())) continue;

      // 타입 분류
      const dataType = /bigint|decimal|int|double|float/i.test(ctype) ? 'number' : 'text';

      // 라벨: Ontology 설명 > DB COMMENT > 컬럼명
      const label = (onto && onto.description) ? onto.description : (r.COLUMN_COMMENT || name);

      // 카테고리
      let category = catMap[name] || 'other';
      if (!catMap[name]) {
        if (name.startsWith('ZQTY') || name.includes('ZQTY_')) category = 'quantity';
        else if (name.startsWith('ZAMT')) category = 'amount';
      }

      // Ontology 동의어 포함
      const synonyms = ontoSynonymMap[name.toUpperCase()] || [];
      columns.push({ name, label, type: dataType, db_type: ctype, category, synonyms });
    }

    // 3-2. Metric 계산 지표를 columns에 추가 (위에서 조회한 metricRows 사용)
    try {
      // 동의어 일괄 조회
      const metricIds = metricRows.map(m => m.id);
      let synonymMap = {};
      if (metricIds.length > 0) {
        const [synRows] = await pool.query(
          `SELECT metric_id, synonym_text FROM metric_synonym WHERE metric_id IN (${metricIds.map(() => '?').join(',')})`,
          metricIds
        );
        for (const s of synRows) {
          if (!synonymMap[s.metric_id]) synonymMap[s.metric_id] = [];
          synonymMap[s.metric_id].push(s.synonym_text);
        }
      }
      for (const m of metricRows) {
        columns.push({
          name: `METRIC__${m.metric_code}`,
          label: m.description || m.metric_code,
          type: 'number',
          db_type: 'metric_formula',
          category: 'metric',
          is_metric: true,
          metric_code: m.metric_code,
          formula: m.formula,
          aggregation: m.aggregation || 'CALC',
          synonyms: synonymMap[m.id] || [],
        });
      }
    } catch (metErr) {
      console.error('[Builder] metric 조회 오류 (무시):', metErr.message);
    }

    res.json({ columns });
  } catch (err) {
    console.error('[Builder] columns error:', err.message);
    res.status(500).json({ error: '컬럼 목록 조회 실패: ' + err.message });
  }
});

// GET /api/builder/values/:columnName - 특정 컬럼의 고유값 목록 (필터 조건 자동완성용)
//
// [2026-06-29] 사용자 요청 #2~#4 반영:
//   - ?q=검색어  : 컬럼값에 부분 일치하는 값만 조회 (대소문자 무시)
//   - ?limit=N   : 응답 행수 제한 (기본 100, 최대 500)
//
// [2026-06-29 PR #192] HTTP 504 (Nginx 60s gateway timeout) 대응:
//   - 이중 쿼리 (COUNT(DISTINCT) + GROUP BY) → 단일 쿼리로 축소
//   - MariaDB `MAX_STATEMENT_TIME` 으로 서버단 25s 안전망
//
// [2026-06-29 PR #193] '달력연도' 선택 시 일자값(2026-05-11) 섞임 이슈 수정 + 컨텍스트 필터링:
//   원인 분석:
//     ① 선택된 필드(예: CALYEAR) 의 컬럼명을 그대로 호출하므로 매핑 오류는 아님 —
//        하지만 운영 DB 의 CALYEAR 컬럼에 데이터가 비어 다른 컬럼이 노출됐을 가능성.
//     ② 상단 [날짜 범위] / [도메인(PS/HL/MGMT)] 컨텍스트를 무시하고 풀 테이블 GROUP BY
//        → 사용자가 보고 있는 화면(2026년 4월~5월)과 무관한 과거 값까지 노출 + timeout.
//   개선 사항:
//     1) ?date_start=YYYYMM&date_end=YYYYMM 쿼리 파라미터 받아 CALMONTH BETWEEN 조건 적용
//     2) ?domain=PS|HL|MGMT 받아 DIVISION = '10'/'20' 자동 부여 (MGMT 는 조건 없음)
//        - 프론트가 안 보내면 세션 active_domain 으로 fallback (getActiveDomain)
//     3) 날짜형 컬럼(CALYEAR/CALMONTH/CALDAY) 은 시간 역순(ORDER BY value DESC) 정렬 —
//        최근 값이 먼저 보이도록. 일반 컬럼은 count DESC (인기값 우선).
//     4) 컬럼 자기 자신은 자동 필터 대상에서 제외 (예: CALMONTH 값 조회 시 CALMONTH 필터 미적용)
//        그래야 "지금 화면에서 어떤 월이 있는지" 둘러볼 수 있음.
app.get('/api/builder/values/:columnName', async (req, res) => {
  const { columnName } = req.params;
  const q = (req.query.q || '').toString().trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);

  // ─── [2026-06-29] 요청 단위 로거 — timeout/오류 추적용 ─────────────────
  //   LLM 호출 없음을 명시 (사용자 요청 #4)
  const log = createReqLogger(req, '/api/builder/values', {
    column: columnName,
    q,
    limit,
    llm_used: false,  // ★ 이 엔드포인트는 DB DISTINCT 만 수행, LLM 호출 0건
  });
  log.stage('request_received');

  // ─── 컨텍스트 파라미터 파싱 (요구사항 #3) ───────────────────────────────
  const rawDateStart = (req.query.date_start || '').toString().trim();
  const rawDateEnd   = (req.query.date_end   || '').toString().trim();
  // YYYYMM (6자리 숫자) 만 허용 — SQL 인젝션 차단
  const dateStart = /^\d{6}$/.test(rawDateStart) ? rawDateStart : '';
  const dateEnd   = /^\d{6}$/.test(rawDateEnd)   ? rawDateEnd   : '';
  // 도메인: 프론트 ?domain=... 우선, 없으면 세션 active_domain 으로 fallback
  // [2026-07-30] 사용자 표시명 alias('통합' → 'MGMT') 도 허용 — resolveDomainAlias 가 대문자화 후 매핑
  let domainParam = resolveDomainAlias((req.query.domain || '').toString().trim()).toUpperCase();
  if (!['PS', 'HL', 'MGMT'].includes(domainParam)) {
    try {
      domainParam = (await getActiveDomain(req)) || 'PS';
    } catch (_) {
      domainParam = 'PS';
    }
  }
  log.withCtx({ domain: domainParam, date_start: dateStart || null, date_end: dateEnd || null });
  log.stage('params_resolved');

  // 서버단 statement timeout — Nginx 60s 보다 먼저 끊고 친절한 메시지 반환
  const stmtTimeoutMs = Math.max(parseInt(process.env.BUILDER_VALUES_STATEMENT_TIMEOUT_MS || '25000', 10), 1000);
  const t0 = Date.now();
  try {
    // 화이트리스트 검증 — DB 에 실제 존재하는 컬럼인지 확인
    const [check] = await pool.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bw_profitability_data' AND COLUMN_NAME = ?
    `, [columnName]);
    log.stage('column_whitelist_check', {
      valid: check.length > 0,
      mapped_db_column: check.length > 0 ? check[0].COLUMN_NAME : null,
    });
    if (check.length === 0) {
      log.error('column_not_found', new Error(`column not found: ${columnName}`));
      return res.status(404).json({
        error: `존재하지 않는 컬럼: ${columnName}`,
        hint: '운영 DB 와 스키마가 다를 수 있습니다. ontology_column 매핑을 확인해주세요.',
      });
    }

    // ─── 컬럼 종류 판별 (요구사항 #4: 정렬 정책 분기) ──────────────────────
    //   - 날짜형(CALYEAR/CALMONTH/CALDAY): ORDER BY value DESC (최근 값 우선)
    //   - 일반형: ORDER BY count DESC (인기값 우선)
    const isDateColumn = ['CALYEAR', 'CALMONTH', 'CALDAY'].includes(columnName.toUpperCase());

    // ─── WHERE 조건 누적 ────────────────────────────────────────────────
    //   기본: NULL/빈 값 제외
    const whereParts = [`\`${columnName}\` IS NOT NULL`, `\`${columnName}\` != ''`];
    const params = [];

    // 검색어 필터 (LIKE) — 검색어가 있을 때만 풀스캔 대신 인덱스 가능성 확보
    if (q) {
      whereParts.push(`CAST(\`${columnName}\` AS CHAR) LIKE ?`);
      params.push(`%${q}%`);
    }

    // 날짜 범위 필터 — CALMONTH 가 항상 존재한다고 가정 (스키마 보장)
    //   단, 조회 대상 컬럼이 CALMONTH 면 자기 자신을 필터하지 않음 (전 범위 둘러보기)
    const upperCol = columnName.toUpperCase();
    if (dateStart && dateEnd && upperCol !== 'CALMONTH') {
      whereParts.push(`CALMONTH BETWEEN ? AND ?`);
      params.push(dateStart, dateEnd);
    } else if (dateStart && dateEnd && upperCol === 'CALMONTH') {
      // 자기 자신 컬럼이지만 사용자가 직접 보낸 범위는 신뢰 — 그대로 적용해서
      // "지금 화면 기준으로 가능한 월 후보" 만 노출
      whereParts.push(`CALMONTH BETWEEN ? AND ?`);
      params.push(dateStart, dateEnd);
    }

    // 도메인 필터 — DIVISION = '10' (PS) / '20' (HL) / 없음 (MGMT)
    //   단, 조회 대상 컬럼이 DIVISION 이면 자기 자신 필터 제외
    if (upperCol !== 'DIVISION') {
      if (domainParam === 'PS') {
        whereParts.push(`DIVISION = '10'`);
      } else if (domainParam === 'HL') {
        whereParts.push(`DIVISION = '20'`);
      }
      // MGMT 는 조건 없음
    }

    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    // ─── 정렬 정책 분기 (요구사항 #4) ───────────────────────────────────
    const orderBy = isDateColumn
      ? `\`${columnName}\` DESC`   // 최근 날짜 먼저
      : `cnt DESC, \`${columnName}\` ASC`; // 인기값 우선, 동률이면 알파벳순

    // ─── 단일 GROUP BY 쿼리 + statement timeout ────────────────────────
    const fetchLimit = limit + 1;
    const stmtTimeoutSec = Math.max(1, Math.round(stmtTimeoutMs / 1000));
    const sql = `SET STATEMENT MAX_STATEMENT_TIME=${stmtTimeoutSec} FOR
      SELECT \`${columnName}\` AS val, COUNT(*) AS cnt
      FROM bw_profitability_data
      ${whereSql}
      GROUP BY \`${columnName}\`
      ORDER BY ${orderBy}
      LIMIT ${fetchLimit}`;

    // ─── [로그] SQL 빌드 완료 ─────────────────────────────────────
    log.stage('sql_built', {
      sql: sql.replace(/\s+/g, ' ').trim(),  // 한 줄로 정규화 (로그 가독성)
      params,
      stmt_timeout_ms: stmtTimeoutMs,
      sort_by: isDateColumn ? 'value_desc' : 'count_desc',
    });

    let rows;
    const dbStart = Date.now();
    log.stage('db_execute_start');
    try {
      const result = await pool.query(sql, params);
      rows = result[0];
    } catch (qErr) {
      const dbElapsed = Date.now() - dbStart;
      const isTimeout = /MAX_STATEMENT_TIME|statement\s+timeout|query\s+execution\s+was\s+interrupted/i.test(qErr.message || '');
      log.error(isTimeout ? 'db_execute_timeout' : 'db_execute_failed', qErr, {
        db_elapsed_ms: dbElapsed,
        timeout_ms: stmtTimeoutMs,
      });
      console.error(`[Builder][values] ${columnName} q='${q}' domain=${domainParam} date=${dateStart}~${dateEnd} ` +
        `${isTimeout ? 'TIMEOUT' : 'ERROR'} after ${Date.now() - t0}ms: ${qErr.message} reqId=${log.requestId}`);
      if (isTimeout) {
        return res.status(503).json({
          error: '값 조회 시간이 초과되었습니다',
          reason: 'statement_timeout',
          column: columnName,
          q,
          hint: q
            ? '검색어를 더 구체적으로 입력하거나 값을 직접 타이핑해 주세요.'
            : '값이 매우 많은 컬럼입니다. 검색어를 입력해 좁혀주세요 (예: 앞 글자 1~2자).',
          timeout_ms: stmtTimeoutMs,
          requestId: log.requestId,
        });
      }
      throw qErr;
    }
    const dbElapsed = Date.now() - dbStart;
    log.stage('db_execute_done', { row_count: rows.length, db_elapsed_ms: dbElapsed, timeout: false });

    const truncated = rows.length > limit;
    if (truncated) rows = rows.slice(0, limit);

    const values = rows.map(r => ({
      value: typeof r.val === 'bigint' ? Number(r.val) : r.val,
      count: Number(r.cnt),
    }));

    const elapsed = Date.now() - t0;
    console.log(`[Builder][values] ${columnName} q='${q}' domain=${domainParam} ` +
      `date=${dateStart || '-'}~${dateEnd || '-'} sort=${isDateColumn ? 'value DESC' : 'count DESC'} ` +
      `→ ${values.length}건${truncated ? '(+more)' : ''} in ${elapsed}ms`);

    log.stage('response_sent', {
      total_row_count: values.length,
      truncated,
      total_elapsed_ms: elapsed,
    });
    res.json({
      column: columnName,
      values,
      total: values.length,
      total_distinct: truncated ? null : values.length,
      truncated,
      q,
      limit,
      // 디버그/검증용 — 프론트는 안 써도 됨
      applied_filters: {
        date_start: dateStart || null,
        date_end: dateEnd || null,
        domain: domainParam,
        is_date_column: isDateColumn,
        sort_by: isDateColumn ? 'value_desc' : 'count_desc',
      },
      elapsed_ms: elapsed,
      requestId: log.requestId,
    });
  } catch (err) {
    log.error('unexpected_error', err);
    console.error(`[Builder][values] error reqId=${log.requestId}:`, err.message);
    res.status(500).json({ error: '값 조회 실패: ' + err.message, requestId: log.requestId });
  }
});

// POST /api/builder/query - 쿼리 빌더 실행
app.post('/api/builder/query', async (req, res) => {
  const { fields, conditions, group_by, order_by, order_dir, limit: limitStr, prompt,
          date_start, date_end, compare_yoy, compare_mom, compare_dims, history_id } = req.body;

  // ─── [2026-06-29] 요청 단위 로거 — 11개 stage 단계별 추적 ────────────────
  //   (사용자 요청 #3) 요청 수신 → LLM 필요 여부 → LLM 호출/응답 → SQL 파싱
  //   → DB 실행 → 이력 저장 → 응답 반환 까지 모든 단계를 requestId 로 묶음
  const log = createReqLogger(req, '/api/builder/query', {
    fields_count: Array.isArray(fields) ? fields.length : 0,
    has_prompt: !!(prompt && String(prompt).trim()),
    compare_mom: !!compare_mom,
    compare_yoy: !!compare_yoy,
    date_start: date_start || null,
    date_end: date_end || null,
    history_id: history_id || null,
  });
  log.stage('request_received', { prompt_preview: (prompt && String(prompt).trim().slice(0, 80)) || null });

  console.log(`[Builder] 요청: fields=${fields?.length}, compare_mom=${compare_mom}, compare_yoy=${compare_yoy}, date=${date_start}~${date_end}, compare_dims=${JSON.stringify(compare_dims)} reqId=${log.requestId}`);

  // ─── [2026-06-30 PR #197] 클라이언트 abort 감지 ────────────────────────
  //   (사용자 요청 #4, #5)
  //   - 프론트가 fetch timeout 으로 먼저 abort 한 경우, 백엔드는 DB 실행을
  //     계속 진행하므로 response_sent 로그가 찍히더라도 사용자 화면에는
  //     아무것도 표시되지 않는 모순적 UX 가 발생.
  //   - req.on('close') 는 클라이언트가 정상 응답을 받기 전에 연결을 끊었을 때
  //     발생. Node.js 16+ 에서는 res.writableEnded 가 true 이면 정상 응답 후
  //     close 이므로 무시해야 함.
  //   - req.aborted 플래그(Node 14+ deprecated, 16+ 는 res.destroyed) 와
  //     res.writableEnded 를 함께 확인하여 정확한 client abort 만 로깅.
  let clientAborted = false;
  req.on('close', () => {
    // 응답이 정상적으로 종료(res.writableEnded=true) 됐다면 정상 close
    if (!res.writableEnded) {
      clientAborted = true;
      // 백엔드는 작업을 계속 진행하지만, 로그에는 "응답 전 client 가 끊었다"는 사실을 남김
      log.error('client_aborted', new Error('client closed connection before response'), {
        res_headers_sent: !!res.headersSent,
        res_writable_ended: !!res.writableEnded,
      });
    }
  });

  if (!fields || fields.length === 0) {
    log.error('validation_failed', new Error('fields 없음'), { reason: 'no_fields' });
    return res.status(400).json({ error: '조회할 필드를 하나 이상 선택해주세요.', requestId: log.requestId });
  }

  // 날짜 조건 필수 검증
  if (!date_start || !date_end || date_start.length !== 6 || date_end.length !== 6) {
    log.error('validation_failed', new Error('date 잘못됨'), { reason: 'invalid_date' });
    return res.status(400).json({ error: '날짜 조건(시작/종료 년월)을 설정해주세요.', requestId: log.requestId });
  }

  log.stage('validation_done');
  const safeLimit = Math.min(parseInt(limitStr) || 1000, 5000);

  try {
    // 화이트리스트: DB 실제 컬럼명 검증
    const [validColRows] = await pool.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bw_profitability_data'
    `);
    const validCols = new Set(validColRows.map(r => r.COLUMN_NAME));

    // ── Metric 산식 매핑 조회 ──
    // METRIC__ 접두사가 붙은 필드를 감지하여 DB에서 formula 조회
    const metricFieldNames = fields.filter(f => f.column && f.column.startsWith('METRIC__')).map(f => f.column.replace('METRIC__', ''));
    const metricFormulaMap = {}; // { METRIC__LABOR_COST: { formula, aggregation, metric_code } }
    if (metricFieldNames.length > 0) {
      try {
        const dc = await getActiveDomain(req);
        // 모든 metric 조회 (SUM 타입 산식 해석을 위해 전체 필요)
        const [allMetricRows] = await pool.query(
          `SELECT metric_code, formula, aggregation FROM metric WHERE domain_code = ?`, [dc]
        );
        const allMetricMap = {};
        for (const m of allMetricRows) allMetricMap[m.metric_code] = m;

        // SUM 집계 타입의 산식을 SQL로 변환하는 헬퍼
        const resolveFormula = (formula, aggregation) => {
          if (aggregation === 'CALC') return formula; // 이미 SUM() 등 포함된 산식
          // SUM 타입: 산식 내 각 컬럼 참조를 SUM()으로 감싸기
          // 1. 다른 metric_code 참조를 해당 산식으로 치환 (재귀 방지를 위해 1단계만)
          let resolved = formula;
          for (const [code, meta] of Object.entries(allMetricMap)) {
            if (resolved.includes(code) && code !== formula) {
              // metric_code 참조를 해당 산식으로 치환 (괄호로 감쌈)
              const re = new RegExp('\\b' + code + '\\b', 'g');
              const subFormula = resolveFormula(meta.formula, meta.aggregation);
              resolved = resolved.replace(re, `(${subFormula})`);
            }
          }
          // 2. 아직 SUM()에 감싸지지 않은 DB 컬럼 참조를 SUM()으로 감싸기
          // 패턴: 알파벳/언더스코어로 시작하는 단어 (이미 SUM( 등 함수로 감싸진 것은 제외)
          // [2026-06-29] 사용자 따옴표 규칙: 컬럼명에 백틱(`) 사용 금지
          resolved = resolved.replace(/\b([A-Z][A-Z0-9_]+)\b(?!\s*\()/g, (match) => {
            // SQL 키워드/함수는 제외
            if (['SUM','AVG','COUNT','MAX','MIN','NULLIF','COALESCE','CASE','WHEN','THEN','ELSE','END','AND','OR','NOT','NULL','AS'].includes(match)) return match;
            // 이미 SUM()등으로 감싸져 있으면 스킵 (lookbehind는 위 regex에서 처리)
            return `SUM(${match})`;
          });
          return resolved;
        };

        for (const name of metricFieldNames) {
          const m = allMetricMap[name];
          if (m) {
            const sqlFormula = resolveFormula(m.formula, m.aggregation);
            metricFormulaMap[`METRIC__${m.metric_code}`] = {
              formula: sqlFormula,
              aggregation: m.aggregation || 'CALC',
              metric_code: m.metric_code,
            };
          }
        }
        console.log(`[Builder] Metric 산식 매핑: ${JSON.stringify(Object.entries(metricFormulaMap).map(([k,v]) => k + '=' + v.formula))}`);
        log.stage('metric_resolved', {
          resolved_metrics: Object.keys(metricFormulaMap),
          count: Object.keys(metricFormulaMap).length,
        });
      } catch (metErr) {
        console.error('[Builder] Metric formula 조회 오류:', metErr.message);
        log.error('metric_resolve_failed', metErr);
      }
    }

    // ============================================================
    // [2026-06-24] Metric 산식 → 월별 조건부 SUM 변환 헬퍼
    // ------------------------------------------------------------
    // GPT 보완 단계에서 "4월/5월 차이" 같은 월별 비교 요청이 들어왔을 때,
    // Metric formula 의 각 `SUM(...)` 을 `SUM(CASE WHEN CALMONTH=? THEN ... ELSE 0 END)` 로
    // 변환해 GPT 프롬프트에 명시적인 예시로 제공한다.
    //
    // 입력 :  SUM(`ZAMT001`) - SUM(`ZAMT002`)
    // 출력 :  SUM(CASE WHEN CALMONTH = '202604' THEN `ZAMT001` ELSE 0 END)
    //       - SUM(CASE WHEN CALMONTH = '202604' THEN `ZAMT002` ELSE 0 END)
    // ============================================================
    // ============================================================
    // [2026-06-30 PR #199] Metric 산식 SUM 자동 감싸기 헬퍼
    // ------------------------------------------------------------
    //   - 학습관리에서 산식이 row-level (SUM 제거) 로 저장될 수 있음.
    //     예) "ZAMT001-ZAMT002+ZAMT004-(ZAMT006+ZAMT007+...)"
    //   - 이 경우 GROUP BY 가 있는 SQL 에서는 자재별 합계가 아니라
    //     임의 row 값이 나오므로 잘못된 결과 발생.
    //   - 따라서 최종 SQL 생성 시 row-level 산식은 시스템이 자동으로
    //     SUM(...) 또는 SUM(CASE WHEN CALMONTH=... THEN ... ELSE 0 END)
    //     로 감싸줘야 함.
    // ============================================================

    // SQL 키워드 / 함수명 / 차원 컬럼 (COALESCE 대상에서 제외할 토큰)
    const FORMULA_RESERVED = new Set([
      // 집계/스칼라 함수
      'SUM','AVG','COUNT','MAX','MIN','NULLIF','COALESCE','ROUND','ABS','IF','IFNULL','CAST','CONVERT',
      'GREATEST','LEAST','FLOOR','CEIL','CEILING','POWER','SQRT','LOG','EXP','MOD','DATE','YEAR','MONTH','DAY',
      // 키워드
      'CASE','WHEN','THEN','ELSE','END','AND','OR','NOT','NULL','AS','BETWEEN','IN','IS','TRUE','FALSE',
      'SELECT','FROM','WHERE','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','ASC','DESC','DISTINCT',
      // 차원/시간 컬럼 (NULL 안전 대상 아님)
      'CALMONTH','CALDAY','CALYEAR','MATERIAL_NM','DIVISION','DIVISION_NM','PLANT','PLANT_NM',
    ]);

    // 산식에 이미 SUM(...) 형태의 집계 함수가 포함되어 있는지 판별
    //   - SUM, COUNT, AVG, MAX, MIN 중 하나라도 있으면 "이미 집계됨" 으로 간주
    //   - 비율 지표(예: ROUND(SUM(A)/SUM(B), 2)) 처럼 복잡한 산식도 SUM 포함
    //     으로 판별되어 추가 감싸기를 안 함 (이중 SUM 방지).
    function formulaContainsAggregate(formula) {
      if (!formula) return false;
      return /\b(SUM|COUNT|AVG|MAX|MIN)\s*\(/i.test(formula);
    }

    // 산식에 SUM 이외의 비-가법 집계 함수(AVG/COUNT/MAX/MIN)가 있는지
    //   → 이런 산식은 월별 SUM(CASE WHEN..) 으로 단순 감싸면 의미가 깨지므로
    //     별도 처리 또는 보존 대상
    function formulaContainsNonSumAggregate(formula) {
      if (!formula) return false;
      return /\b(AVG|COUNT|MAX|MIN)\s*\(/i.test(formula);
    }

    // 산식 내 DB 컬럼 참조만 안전하게 COALESCE(컬럼, 0) 으로 감싸기 (NULL 안전)
    //   - 환경변수 BUILDER_METRIC_NULL_AS_ZERO 로 on/off (기본 on)
    //   - 핵심 규칙: 토큰 뒤에 `(` 가 있으면 = 함수 → 보존, RESERVED 면 보존, METRIC_ 접두면 보존
    //   - lookahead `(?=\s*\()` 만으로는 `ROUND` 같은 함수명을 정규식 그리디 매칭에서
    //     "ROUN" + "D(" 로 쪼개는 경우가 있어, 단어 경계 + 사용자 정의 토큰화로 처리
    const METRIC_NULL_AS_ZERO = (process.env.BUILDER_METRIC_NULL_AS_ZERO || 'true').toLowerCase() === 'true';
    function applyNullSafe(formula) {
      if (!METRIC_NULL_AS_ZERO || !formula) return formula;
      // 영문 대소문자 토큰을 모두 추출하여, 그 뒤가 `(` 가 아니고 RESERVED 가 아니고
      // METRIC_ 접두가 아닌 것만 COALESCE 로 감싸기.
      // (백틱으로 감싸진 컬럼도 처리)
      return formula.replace(
        /`([A-Za-z_][A-Za-z0-9_]*)`|([A-Za-z_][A-Za-z0-9_]*)/g,
        (match, bt, plain, offset, full) => {
          const token = bt || plain;
          // 1) 함수 호출: 토큰 직후가 ( 면 보존 (공백 허용)
          const rest = full.slice(offset + match.length);
          if (/^\s*\(/.test(rest)) return match;
          // 2) 백틱으로 감싸진 컬럼 → 백틱 제거 후 COALESCE
          if (bt) return `COALESCE(${bt}, 0)`;
          // 3) RESERVED 키워드/함수/차원 컬럼
          if (FORMULA_RESERVED.has(token.toUpperCase())) return token;
          // 4) Metric 참조
          if (token.startsWith('METRIC_')) return token;
          // 5) 너무 짧은 토큰(a, x 등)은 변수 가능성 — 그대로 둠
          if (token.length < 3) return token;
          // 6) 그 외 = DB 컬럼으로 간주 → COALESCE
          return `COALESCE(${token}, 0)`;
        }
      );
    }

    // 산식을 월별 비교용으로 재작성
    //
    // 분기 (사용자 요청 #199):
    //   Case A: SUM(컬럼) 패턴이 있는 기존 산식
    //           → 각 SUM(컬럼) 을 SUM(CASE WHEN CALMONTH=... THEN 컬럼 ELSE 0 END) 로 변환
    //           → NULL 안전 옵션 적용 시 컬럼은 COALESCE(컬럼, 0) 으로 감싸기
    //   Case B: SUM 이외의 비-가법 집계(AVG/COUNT/MAX/MIN) 가 있는 비율 산식
    //           → 단순 SUM(CASE WHEN..) 으로 감싸면 의미 깨짐 → 그대로 보존
    //   Case C: SUM 도 다른 집계도 없는 row-level 산식 (사용자가 SUM 제거한 케이스)
    //           → 전체 산식을 NULL 안전 처리 후
    //             SUM(CASE WHEN CALMONTH=... THEN (산식) ELSE 0 END) 로 감싸기
    function rewriteFormulaForMonth(formula, month) {
      if (!formula || !month) return formula;

      // Case A: SUM(컬럼) 패턴 직접 매칭 (NULL safe 적용 전 원본에서 검사)
      if (/SUM\s*\(\s*`?[A-Z][A-Z0-9_]*\s*`?\s*\)/i.test(formula)) {
        // 원본 → 각 SUM(컬럼) 만 변환 (다른 컬럼은 그대로 두고, 변환 결과에만 COALESCE 적용)
        return formula.replace(/SUM\s*\(\s*`?([A-Z][A-Z0-9_]*)`?\s*\)/gi, (m, colName) => {
          const colExpr = METRIC_NULL_AS_ZERO ? `COALESCE(${colName}, 0)` : colName;
          return `SUM(CASE WHEN CALMONTH = '${month}' THEN ${colExpr} ELSE 0 END)`;
        });
      }

      // Case B: AVG/COUNT/MAX/MIN 등 다른 집계 포함 → 보존
      if (formulaContainsNonSumAggregate(formula)) {
        return formula;
      }

      // Case C: row-level 산식 → 전체를 SUM(CASE WHEN..) 으로 감싸기
      const safeFormula = applyNullSafe(formula);
      return `SUM(CASE WHEN CALMONTH = '${month}' THEN (${safeFormula}) ELSE 0 END)`;
    }

    // 산식을 일반 (월 분기 없는) 집계용으로 감싸기
    //   - 이미 집계 함수(SUM/AVG/COUNT/MAX/MIN) 포함 → 그대로 (이중 SUM 방지)
    //   - row-level 산식 → NULL 안전 처리 후 SUM(...) 으로 감싸기
    function wrapMetricFormulaAggregated(formula) {
      if (!formula) return formula;
      if (formulaContainsAggregate(formula)) {
        return formula; // 이미 집계 포함 → 보존
      }
      const safeFormula = applyNullSafe(formula);
      return `SUM(${safeFormula})`;
    }

    // ─── [2026-07-01 PR #214] GPT 생성 SQL 구조 검증 ──────────────────────
    //   목적:
    //     GPT 가 "SUM/AVG/COUNT 는 최상위 SELECT 에서만" 규칙을 지켰는지 검사.
    //     지키지 않은 SQL (내부 서브쿼리에서 이미 집계된 SQL) 은 실행계획이 무거워져
    //     timeout 을 유발하므로 실행 전에 거부하고 기본 SQL 로 fallback.
    //
    //   검증 대상:
    //     1) 프롬프트가 "월별 비교/증가율/퍼센트/YoY/MoM/증감액/N월 대비" 등 비교 지표를 요청한 경우
    //     2) 사용자가 선택한 차원 컬럼 (group_by) 이 최종 SQL 에 보존되었는지
    //     3) 사용자가 선택한 차원이 최종 GROUP BY 에 들어있는지
    //     4) 프롬프트에 "증가율/퍼센트/%/대비" 가 있으면 실제 그런 컬럼이 생성됐는지
    //     5) 내부 서브쿼리에 SUM/AVG/COUNT 가 과도하게 있지 않은지 (경고 수준)
    //
    //   반환: { ok: boolean, issues: string[], warnings: string[] }
    //     - ok=false : 구조 위반, GPT SQL 거부하고 기본 SQL 로 fallback
    //     - warnings : 로그에만 남기고 실행은 허용
    // ────────────────────────────────────────────────────────────────────
    function validateGptSqlStructure(gptSql, ctx) {
      const issues = [];
      const warnings = [];
      const promptText = String(ctx.promptText || '').toLowerCase();
      const dimCols    = Array.isArray(ctx.dimCols) ? ctx.dimCols : [];
      const upperSql   = String(gptSql || '').toUpperCase();

      // [검증1] 사용자가 선택한 차원 컬럼이 최종 SQL 에 존재하는가
      //   (GPT 가 차원을 임의 제거하는 케이스 방지)
      for (const col of dimCols) {
        if (!col) continue;
        const rx = new RegExp('\\b' + col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (!rx.test(gptSql)) {
          issues.push(`dimension_dropped:${col}`);
        }
      }

      // [검증2] 차원이 GROUP BY 에 포함됐는가 (집계 함수가 있는 경우에만)
      //   집계가 없는 조회 (단순 SELECT ... FROM ...) 는 GROUP BY 불필요
      const hasAggregate = /\b(SUM|AVG|COUNT|MIN|MAX)\s*\(/i.test(gptSql);
      if (hasAggregate && dimCols.length > 0) {
        // 최종 GROUP BY 절 추출 (마지막 GROUP BY … 이후 ORDER BY / LIMIT 이전까지)
        const gbMatch = gptSql.match(/GROUP\s+BY\s+([^;]*?)(?:\s+ORDER\s+BY|\s+LIMIT|\s*$)/i);
        const gbClause = gbMatch ? gbMatch[1] : '';
        for (const col of dimCols) {
          if (!col) continue;
          // "x.MATERIAL_NM" / "MATERIAL_NM" / "t.MATERIAL_NM" 등 어떤 alias 로든 등장하면 OK
          const rx = new RegExp('\\b' + col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          if (!rx.test(gbClause)) {
            issues.push(`dimension_missing_from_group_by:${col}`);
          }
        }
      }

      // [검증3] 프롬프트가 증가율/퍼센트/대비/차이/YoY/MoM 을 요청했는데 그런 컬럼이 실제로 생성됐는가
      const wantsGrowth =
        /(증가율|감소율|퍼센트|%|대비|증감|차이|비율|yoy|mom|month.*over.*month|year.*over.*year|전월|전년|월별\s*비교)/i.test(promptText);
      if (wantsGrowth) {
        //  - alias 에 '증가율'/'퍼센트'/'차이'/'증감' 이 있거나
        //  - a/b*100 또는 (a-b)*100 같은 계산 표현이 있으면 OK
        const hasGrowthAlias  = /AS\s+['"`]?\s*(증가율|감소율|퍼센트|차이|증감|비율|YoY|MoM|%)/i.test(gptSql);
        const hasGrowthCalc   = /\*\s*100(\.0)?/.test(gptSql) || /-\s*SUM\s*\(/i.test(upperSql);
        if (!hasGrowthAlias && !hasGrowthCalc) {
          issues.push('growth_column_missing');
        }
      }

      // [검증4] "월별 비교/증가율 등" 프롬프트에서 최상위 집계 규칙 위반 검사
      //   조건: 프롬프트가 위 kw 에 매칭 AND SQL 에 서브쿼리 (FROM (SELECT ...) x) 가 있음
      //   위반: 서브쿼리 안에 SUM(CASE WHEN ...) 가 있음
      //         → 내부에서 집계된 것 → 우리가 원하는 구조 아님 → 거부
      //   허용: 서브쿼리 없이 flat SELECT (SUM CASE WHEN 이 최상위이므로 OK)
      const kwMatch = wantsGrowth;
      if (kwMatch) {
        // 서브쿼리 여부 확인 — FROM ( SELECT ... ) [AS] alias 패턴
        const hasSubquery = /FROM\s*\(\s*SELECT\b/i.test(gptSql);
        if (hasSubquery) {
          // 서브쿼리 부분만 추출: 첫 번째 FROM ( 부터 매칭되는 ) 까지
          //   간단한 depth 카운터로 서브쿼리 본문 잡기
          const startIdx = gptSql.search(/FROM\s*\(\s*SELECT\b/i);
          if (startIdx >= 0) {
            // '(' 위치 찾기
            const parenStart = gptSql.indexOf('(', startIdx);
            let depth = 0;
            let end = -1;
            for (let i = parenStart; i < gptSql.length; i++) {
              const ch = gptSql[i];
              if (ch === '(') depth++;
              else if (ch === ')') {
                depth--;
                if (depth === 0) { end = i; break; }
              }
            }
            if (end > parenStart) {
              const subBody = gptSql.substring(parenStart + 1, end);
              // 서브쿼리 안에 SUM(CASE WHEN ... ) 가 있으면 위반
              //   ※ CASE WHEN 자체는 row-level 이라 OK, SUM 이 감싼 형태가 문제
              if (/\bSUM\s*\(\s*CASE\s+WHEN\b/i.test(subBody)) {
                issues.push('inner_aggregate_on_case_when');
              }
              // 서브쿼리 안 SUM/AVG/COUNT 개수 카운트 (2개 이상이면 강한 위반)
              const innerAggCount = (subBody.match(/\b(SUM|AVG|COUNT)\s*\(/gi) || []).length;
              if (innerAggCount >= 2) {
                issues.push(`inner_aggregate_count:${innerAggCount}`);
              } else if (innerAggCount === 1) {
                warnings.push(`inner_aggregate_count:1`);
              }
            }
          }
        }
      }

      // [검증5] SELECT/FROM/GROUP BY 균형 sanity (최소한의 파싱 안전성)
      const openParen  = (gptSql.match(/\(/g) || []).length;
      const closeParen = (gptSql.match(/\)/g) || []).length;
      if (openParen !== closeParen) {
        issues.push(`paren_mismatch:${openParen}vs${closeParen}`);
      }

      return { ok: issues.length === 0, issues, warnings };
    }

    // ── 헬퍼 함수 ──
    const calcPrevMonth = (ym) => {
      const y = parseInt(ym.slice(0, 4), 10);
      const m = parseInt(ym.slice(4, 6), 10);
      if (m === 1) return `${y - 1}12`;
      return `${y}${String(m - 1).padStart(2, '0')}`;
    };
    const calcPrevYear = (ym) => {
      const y = parseInt(ym.slice(0, 4), 10);
      return `${y - 1}${ym.slice(4, 6)}`;
    };

    const hasCompare = compare_mom || compare_yoy;
    const userFieldCols = fields.map(f => f.column);

    // ── 사용자 필터 조건 WHERE 절 생성 (공통) ──
    const buildUserConditions = (paramArr) => {
      const parts = [];
      if (conditions && conditions.length > 0) {
        for (let i = 0; i < conditions.length; i++) {
          const cond = conditions[i];
          const col = cond.column;
          if (!col || !validCols.has(col)) continue;
          const op = cond.operator || '=';
          const val = cond.value || '';
          const logic = (cond.logic || 'AND').toUpperCase();
          let clause;
          // [2026-06-29] 사용자 따옴표 규칙: 컬럼명 백틱 미사용
          if (['=','!=','>','>=','<','<='].includes(op)) {
            clause = `${col} ${op} ?`; paramArr.push(val);
          } else if (op === 'LIKE') {
            clause = `${col} LIKE ?`; paramArr.push(`%${val}%`);
          } else if (op === 'NOT LIKE') {
            clause = `${col} NOT LIKE ?`; paramArr.push(`%${val}%`);
          } else if (op === 'IN') {
            const inVals = String(val).split(',').map(v => v.trim()).filter(v => v);
            if (inVals.length === 0) continue;
            clause = `${col} IN (${inVals.map(() => '?').join(',')})`;
            paramArr.push(...inVals);
          } else if (op === 'IS NULL') { clause = `${col} IS NULL`;
          } else if (op === 'IS NOT NULL') { clause = `${col} IS NOT NULL`;
          } else if (op === 'BETWEEN') {
            const bVals = String(val).split(',').map(v => v.trim());
            if (bVals.length !== 2) continue;
            clause = `${col} BETWEEN ? AND ?`; paramArr.push(bVals[0], bVals[1]);
          } else { clause = `${col} = ?`; paramArr.push(val); }
          parts.push(`${parts.length === 0 ? 'AND' : (logic === 'OR' ? 'OR' : 'AND')} ${clause}`);
        }
      }
      return parts.join(' ');
    };

    // ── SELECT 절: 기준 필드(dimension) / 수치 필드(measure) 분리 ──
    // 비교 모드에서는 숫자 필드에 집계함수가 없으면 자동으로 SUM 적용
    const dimFields = [];  // GROUP BY 대상 (텍스트 필드)
    const measureFields = []; // 집계 대상 (SUM 등)

    // 숫자 타입 컬럼 목록 조회 (비교 모드 자동 SUM용)
    const numericTypes = new Set(['int','bigint','decimal','double','float','tinyint','smallint','mediumint','numeric']);
    let numericColSet = new Set();
    if (hasCompare) {
      try {
        const [typeRows] = await pool.query(`
          SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bw_profitability_data'
        `);
        numericColSet = new Set(typeRows.filter(r => numericTypes.has(r.DATA_TYPE.toLowerCase())).map(r => r.COLUMN_NAME));
      } catch(e) { /* fallback: 빈 set */ }
    }

    for (const f of fields) {
      const col = f.column;
      const isMetric = col.startsWith('METRIC__') && metricFormulaMap[col];

      // Metric 필드는 validCols 검증 스킵 (DB 컬럼이 아닌 계산 산식)
      if (!isMetric && !validCols.has(col)) return res.status(400).json({ error: `유효하지 않은 컬럼: ${col}` });
      let agg = f.aggregate;
      const alias = f.alias || (isMetric ? metricFormulaMap[col].metric_code : col);

      if (isMetric) {
        // Metric 필드는 항상 measure (산식 자체에 SUM 등이 포함됨)
        measureFields.push({ col, agg: '__METRIC__', alias, formula: metricFormulaMap[col].formula });
        console.log(`[Builder] Metric 필드 추가: ${col} → formula: ${metricFormulaMap[col].formula}`);
      } else {
        // ★ 비교 모드: 집계함수 없는 숫자 필드는 자동으로 SUM 적용
        if (hasCompare && (!agg || agg === '') && numericColSet.has(col)) {
          agg = 'SUM';
          console.log(`[Builder] 비교모드 자동 SUM 적용: ${col} (alias: ${alias})`);
        }

        if (agg && ['SUM','COUNT','AVG','MAX','MIN'].includes(agg.toUpperCase())) {
          measureFields.push({ col, agg: agg.toUpperCase(), alias });
        } else {
          dimFields.push({ col, alias });
        }
      }
    }

    console.log(`[Builder] 필드 분류: dim=${dimFields.length}개(${dimFields.map(d=>d.col).join(',')}), measure=${measureFields.length}개(${measureFields.map(m=>m.col).join(',')})`);
    log.stage('field_classified', {
      dim_count: dimFields.length,
      measure_count: measureFields.length,
      dim_cols: dimFields.map(d => d.col),
      measure_cols: measureFields.map(m => m.col),
      has_compare: !!hasCompare,
    });

    let sql, finalParams;

    // ═══════════════════════════════════════════════
    // 비교 모드: 당월 기준 LEFT JOIN 방식 (당월에 존재하는 데이터만 표시)
    // ═══════════════════════════════════════════════
    if (hasCompare && measureFields.length > 0) {
      const curMonth = date_end; // 당월(당기)
      const prevMonth = compare_mom ? calcPrevMonth(curMonth) : calcPrevYear(curMonth);
      const curLabel = compare_mom ? '당월' : '당기';
      const prevLabel = compare_mom ? '전월' : '전년동기';
      const compareLabel = compare_mom ? '전월대비' : '전년대비';

      console.log(`[Builder] 비교모드: curMonth=${curMonth}, prevMonth=${prevMonth}, dim=${dimFields.length}, measure=${measureFields.length}`);

      // ── 전략: cur 서브쿼리 LEFT JOIN prev 서브쿼리 ──
      // cur = 당월 데이터만 GROUP BY (모든 dim) → 기준 행
      // prev = 전월 데이터만 GROUP BY (compare_dims만) → LEFT JOIN으로 매칭
      // → 비교 기준(compare_dims)만으로 매칭, 나머지 dim은 조회만

      // compare_dims: 프론트엔드에서 선택한 비교 기준 DIM (없으면 전체 dim 사용)
      const compareDimSet = new Set(Array.isArray(compare_dims) ? compare_dims.filter(d => validCols.has(d)) : []);
      // 비교 기준 dim 필드 (JOIN 조건에 사용)
      const joinDimFields = compareDimSet.size > 0
        ? dimFields.filter(d => compareDimSet.has(d.col))
        : dimFields;  // compare_dims 미지정 시 전체 dim 사용 (하위 호환)

      const allDimColsList = dimFields.map(d => `\`${d.col}\``);
      const joinDimColsList = joinDimFields.map(d => `\`${d.col}\``);

      console.log(`[Builder] 비교기준 DIM: [${joinDimFields.map(d=>d.col).join(',')}] (전체 DIM: [${dimFields.map(d=>d.col).join(',')}])`);

      // ── cur 서브쿼리 ── (모든 dim으로 GROUP BY — 조회 세분화)
      const curGroupByCols = [...allDimColsList];
      const curSelectParts = [...allDimColsList];
      measureFields.forEach(m => {
        if (m.agg === '__METRIC__') {
          // Metric: 산식 그대로 사용 (SUM 등이 이미 포함됨)
          curSelectParts.push(`(${m.formula}) AS \`${m.col}_cur\``);
        } else {
          curSelectParts.push(`${m.agg}(\`${m.col}\`) AS \`${m.col}_cur\``);
        }
      });
      const curParams = [curMonth];
      const curUserWhere = buildUserConditions(curParams);
      let curSql = `SELECT ${curSelectParts.join(', ')} FROM bw_profitability_data WHERE \`CALMONTH\` = ?${curUserWhere ? ' ' + curUserWhere : ''}`;
      if (curGroupByCols.length > 0) {
        curSql += ` GROUP BY ${curGroupByCols.join(', ')}`;
      }

      // ── prev 서브쿼리 ── (비교기준 dim만으로 GROUP BY — 매칭용 합산)
      const prevGroupByCols = [...joinDimColsList];
      const prevSelectParts = [...joinDimColsList];
      measureFields.forEach(m => {
        if (m.agg === '__METRIC__') {
          prevSelectParts.push(`(${m.formula}) AS \`${m.col}_prev\``);
        } else {
          prevSelectParts.push(`${m.agg}(\`${m.col}\`) AS \`${m.col}_prev\``);
        }
      });
      const prevParams = [prevMonth];
      const prevUserWhere = buildUserConditions(prevParams);
      let prevSql = `SELECT ${prevSelectParts.join(', ')} FROM bw_profitability_data WHERE \`CALMONTH\` = ?${prevUserWhere ? ' ' + prevUserWhere : ''}`;
      if (prevGroupByCols.length > 0) {
        prevSql += ` GROUP BY ${prevGroupByCols.join(', ')}`;
      }

      // ── 최종 SELECT 컬럼 ──
      // 첫 컬럼: 달력연도/월 (당월 값 리터럴)
      const outerSelectParts = [`'${curMonth}' AS \`달력연도/월\``];

      // dim 컬럼 (cur 기준)
      dimFields.forEach(d => {
        outerSelectParts.push(`cur.\`${d.col}\` AS \`${d.alias}\``);
      });

      // measure 컬럼: 당월값, 전월값, 증감상태
      measureFields.forEach(m => {
        const curAlias = `${curLabel}${m.alias}`;
        const prevAlias = `${prevLabel}${m.alias}`;
        const diffAlias = measureFields.length > 1 ? `${compareLabel}(${m.alias})` : compareLabel;

        outerSelectParts.push(`COALESCE(cur.\`${m.col}_cur\`, 0) AS \`${curAlias}\``);
        outerSelectParts.push(`COALESCE(prev.\`${m.col}_prev\`, 0) AS \`${prevAlias}\``);
        // 전월값 0일 때 '🆕 신규' 표시, 아니면 기존 증감 표시
        outerSelectParts.push(
          `CASE ` +
            `WHEN prev.\`${m.col}_prev\` IS NULL THEN '🆕 신규(${prevLabel} 데이터 없음)' ` +
            `WHEN COALESCE(cur.\`${m.col}_cur\`, 0) > COALESCE(prev.\`${m.col}_prev\`, 0) ` +
              `THEN CONCAT('▲ ', FORMAT(ABS(COALESCE(cur.\`${m.col}_cur\`, 0) - COALESCE(prev.\`${m.col}_prev\`, 0)), 0), ' 상승') ` +
            `WHEN COALESCE(cur.\`${m.col}_cur\`, 0) < COALESCE(prev.\`${m.col}_prev\`, 0) ` +
              `THEN CONCAT('▼ ', FORMAT(ABS(COALESCE(cur.\`${m.col}_cur\`, 0) - COALESCE(prev.\`${m.col}_prev\`, 0)), 0), ' 하락') ` +
            `ELSE '— 변동없음' END AS \`${diffAlias}\``
        );
      });

      // ── JOIN 구성 ──
      // 비교기준 dim(joinDimFields)만으로 매칭
      // 비교기준이 있으면: LEFT JOIN ... ON 비교기준 dim 매칭
      // 비교기준이 없으면: LEFT JOIN ... ON 1=1 (전체 합계끼리 결합)
      let joinClause;
      if (joinDimFields.length > 0) {
        const onCond = joinDimFields.map(d => `cur.\`${d.col}\` = prev.\`${d.col}\``).join(' AND ');
        joinClause = `LEFT JOIN (${prevSql}) AS prev ON ${onCond}`;
      } else {
        joinClause = `LEFT JOIN (${prevSql}) AS prev ON 1=1`;
      }

      sql = `SELECT ${outerSelectParts.join(', ')} FROM (${curSql}) AS cur ${joinClause}`;

      // ORDER BY
      if (order_by) {
        const dir = (order_dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        sql += ` ORDER BY \`${order_by}\` ${dir}`;
      }
      sql += ` LIMIT ${safeLimit}`;

      // 파라미터 조합: cur서브쿼리 params + prev서브쿼리 params
      finalParams = [...curParams, ...prevParams];

      console.log(`[Builder] 비교모드 SQL: ${sql.substring(0, 300)}...`);
      console.log(`[Builder] 비교모드 params: [${finalParams.join(', ')}]`);
      log.stage('base_sql_built', {
        mode: 'compare',
        compare_type: compare_mom ? 'mom' : 'yoy',
        sql_preview: sql.substring(0, 500),
        sql_length: sql.length,
        param_count: finalParams.length,
      });

    // ═══════════════════════════════════════════════
    // 일반 모드 (비교 없음): 사용자가 명시 선택한 필드만 SELECT/GROUP BY
    // (이전: CALMONTH 자동 첫 컬럼 추가 → 정책 변경: 사용자 명시 선택만 처리)
    // 프론트엔드에서 기간 필드(CALMONTH/CALDAY) 미선택 시 피벗 실행 차단
    // ═══════════════════════════════════════════════
    } else {
      // [2026-06-29] 사용자 따옴표 규칙 적용 (컬럼/테이블 백틱 미사용, alias 만 single quote)
      // [2026-06-30 PR #199] Metric 산식 SUM 자동 감싸기
      //   - 학습관리에서 산식이 row-level (SUM 없음) 로 저장된 경우, 시스템이
      //     GROUP BY 컨텍스트에서 SUM(산식) 으로 자동 감싸줘야 함.
      //   - wrapMetricFormulaAggregated() 가 이미 집계 함수 포함 여부를 판별해서
      //     안전하게 처리 (이중 SUM 방지).
      const selectParts = [];
      for (const f of fields) {
        const col = f.column;
        const agg = f.aggregate;
        const alias = f.alias || col;
        const isMetric = col.startsWith('METRIC__') && metricFormulaMap[col];
        if (isMetric) {
          // Metric: row-level 산식이면 SUM 으로, 이미 집계 포함이면 그대로
          const wrapped = wrapMetricFormulaAggregated(metricFormulaMap[col].formula);
          selectParts.push(`${wrapped} AS '${alias}'`);
        } else if (agg && ['SUM','COUNT','AVG','MAX','MIN'].includes(agg.toUpperCase())) {
          selectParts.push(`${agg.toUpperCase()}(${col}) AS '${alias}'`);
        } else {
          selectParts.push(`${col} AS '${alias}'`);
        }
      }

      const whereParts = [];
      finalParams = [];

      if (date_start === date_end) {
        whereParts.push('CALMONTH = ?');
        finalParams.push(date_start);
      } else {
        whereParts.push('CALMONTH BETWEEN ? AND ?');
        finalParams.push(date_start, date_end);
      }
      const userWhere = buildUserConditions(finalParams);
      if (userWhere) whereParts.push(userWhere);

      // ─── [2026-07-01 PR #210] GROUP BY 자동 산출 (사용자 요청) ─────────────
      //   문제: 사용자가 UI 에서 [CALMONTH, CALDAY, MATERIAL_NM, Metric(매출원가)] 선택 시
      //         프론트는 hasAgg = selectedFields.some(f => f.aggregate) 로 판정하는데
      //         Metric 필드는 payload 에서 aggregate='' 로 전송되므로 hasAgg=false 로 잘못 판정
      //         → group_by=[] 로 전송됨.
      //         반면 백엔드 SELECT 절은 wrapMetricFormulaAggregated 로 SUM 자동 감싸기 적용
      //         → SUM(...) + 일반 컬럼 (CALMONTH 등) 이 GROUP BY 없이 공존하는 위험한 SQL 생성.
      //         MariaDB ONLY_FULL_GROUP_BY 가 꺼져 있어 에러 대신 "임의 1행" 결과가 나옴.
      //
      //   해결: 백엔드에서 fields 를 dimension / metric(집계) 로 자체 분류하고
      //         "집계 지표가 하나라도 있으면 dimension 컬럼 전부를 GROUP BY 에 자동 추가".
      //         프론트에서 온 group_by 는 상위 우선순위로 존중하되, 누락이 있으면 보완.
      //
      //   판정 규칙:
      //     - Metric 필드 (col.startsWith('METRIC__') && metricFormulaMap[col]) → 집계 지표
      //     - SUM/COUNT/AVG/MAX/MIN aggregate 지정 필드 → 집계 지표
      //     - 그 외 (aggregate 없음, non-Metric) → dimension 후보
      // ─────────────────────────────────────────────────────────────────────
      const dimensionCols = [];      // GROUP BY 후보 (사용자 선택 차원)
      const metricAliases = [];      // 집계 지표 alias (진단 로그용)
      let hasAggregateMetric = false;
      for (const f of fields) {
        const col = f.column;
        const agg = f.aggregate;
        const alias = f.alias || col;
        const isMetric = col.startsWith('METRIC__') && metricFormulaMap[col];
        const isExplicitAgg = agg && ['SUM','COUNT','AVG','MAX','MIN'].includes(String(agg).toUpperCase());
        if (isMetric) {
          // Metric: wrapMetricFormulaAggregated 가 SUM 자동 감싸므로 항상 집계로 취급
          //   (row-level 산식이든 SUM 포함 산식이든 최종 SELECT 절엔 집계 함수가 들어감)
          hasAggregateMetric = true;
          metricAliases.push(alias);
        } else if (isExplicitAgg) {
          hasAggregateMetric = true;
          metricAliases.push(`${agg.toUpperCase()}(${col})`);
        } else {
          // dimension 후보. Metric prefix 는 SELECT 에서만 쓰이고 GROUP BY 에는 들어가면 안 됨
          if (!col.startsWith('METRIC__') && validCols.has(col)) {
            dimensionCols.push(col);
          }
        }
      }

      // GROUP BY 산출
      //   1) 사용자(프론트) 가 명시한 group_by 를 우선 반영
      //   2) 집계 지표가 있는데 dimension 컬럼이 GROUP BY 에 누락되어 있으면 자동 추가
      const groupParts = [];
      const groupBySeen = new Set();
      const addToGroup = (c) => {
        if (!c || groupBySeen.has(c)) return;
        if (c.startsWith('METRIC__')) return;   // Metric 은 GROUP BY 에 넣지 않음
        if (!validCols.has(c)) return;
        groupParts.push(c);
        groupBySeen.add(c);
      };
      // (1) 프론트 group_by 존중
      if (group_by && group_by.length > 0) {
        for (const g of group_by) addToGroup(g);
      }
      // (2) 집계 지표가 있으면 dimension 컬럼 전부를 GROUP BY 에 강제 포함
      const autoAddedDims = [];
      if (hasAggregateMetric && dimensionCols.length > 0) {
        for (const d of dimensionCols) {
          if (!groupBySeen.has(d)) {
            addToGroup(d);
            autoAddedDims.push(d);
          }
        }
      }
      const groupByAutoCorrected = autoAddedDims.length > 0;

      // 자체 판정 결과를 stage 로그로 남김 (사용자 요청 #5 항목)
      log.stage('group_by_resolution', {
        selected_fields: fields.map(f => ({
          column: f.column,
          alias: f.alias || f.column,
          aggregate: f.aggregate || null,
          is_metric: !!(f.column && f.column.startsWith('METRIC__')),
        })),
        dimension_cols: dimensionCols,
        metric_cols_or_aliases: metricAliases,
        has_aggregate_metric: hasAggregateMetric,
        group_by_from_frontend: Array.isArray(group_by) ? group_by : [],
        generated_group_by_cols: groupParts,
        group_by_auto_corrected: groupByAutoCorrected,
        auto_added_dims: autoAddedDims,
      });
      if (groupByAutoCorrected) {
        console.log(`[Builder][PR #210] GROUP BY 자동 보정: 프론트=${JSON.stringify(group_by || [])} → 최종=${JSON.stringify(groupParts)} (auto_added=${JSON.stringify(autoAddedDims)}) reqId=${log.requestId}`);
      }

      let orderClause = '';
      if (order_by) {
        const dir = (order_dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        orderClause = `ORDER BY ${order_by} ${dir}`;
      }

      sql = `SELECT ${selectParts.join(', ')} FROM bw_profitability_data`;
      if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(' ')}`;
      if (groupParts.length > 0) sql += ` GROUP BY ${groupParts.join(', ')}`;
      if (orderClause) sql += ` ${orderClause}`;
      sql += ` LIMIT ${safeLimit}`;

      // ─── [2026-07-01 PR #210] SQL 방어적 검증 (사용자 요청 #3, #4) ────────
      //   MariaDB/MySQL 이 ONLY_FULL_GROUP_BY 를 끄고 운영되는 경우
      //   집계함수 + 일반 컬럼 + GROUP BY 부재 조합이 에러 없이 "임의 1행" 을 반환.
      //   여기서 SQL 문자열을 직접 검사해서 그 조합을 감지하고 강제 보정.
      //
      //   판정 방법 (SELECT 절만 스캔):
      //     - hasAggFn: /\b(SUM|COUNT|AVG|MAX|MIN)\s*\(/i 매치
      //     - hasBareCol: SELECT 절에 알려진 dimension 컬럼이 non-aggregated 로 나옴
      //     - GROUP BY 부재: /\bGROUP\s+BY\b/i 매치 실패
      //   위 3 조건 모두 참이면 fields 기반으로 GROUP BY 를 다시 붙임.
      // ─────────────────────────────────────────────────────────────────────
      try {
        const selectMatch = sql.match(/^\s*SELECT\s+([\s\S]*?)\s+FROM\s+/i);
        const selectClause = selectMatch ? selectMatch[1] : '';
        const hasAggFn = /\b(SUM|COUNT|AVG|MAX|MIN)\s*\(/i.test(selectClause);
        const hasGroupBy = /\bGROUP\s+BY\b/i.test(sql);
        // dimension 컬럼 중 실제로 select 에 non-aggregate 로 나온 것 탐지
        const bareDimsInSelect = dimensionCols.filter(d => {
          const re = new RegExp('(^|[^A-Z0-9_])' + d + '(\\s+AS|\\s*,|\\s*$)', 'i');
          return re.test(selectClause);
        });
        if (hasAggFn && bareDimsInSelect.length > 0 && !hasGroupBy) {
          // 방어적 재삽입: LIMIT/ORDER 앞에 GROUP BY 삽입
          const gb = ' GROUP BY ' + bareDimsInSelect.join(', ');
          if (/\bORDER\s+BY\b/i.test(sql)) {
            sql = sql.replace(/\bORDER\s+BY\b/i, gb + ' ORDER BY');
          } else if (/\bLIMIT\b/i.test(sql)) {
            sql = sql.replace(/\bLIMIT\b/i, gb + ' LIMIT');
          } else {
            sql = sql + gb;
          }
          log.stage('group_by_defensive_injected', {
            reason: 'aggregate_with_bare_dim_but_no_group_by',
            injected_cols: bareDimsInSelect,
            has_agg_fn: true,
            has_group_by_after: /\bGROUP\s+BY\b/i.test(sql),
          });
          console.warn(`[Builder][PR #210] 방어 검증에서 GROUP BY 재삽입: cols=${JSON.stringify(bareDimsInSelect)} reqId=${log.requestId}`);
        }
      } catch (validationErr) {
        log.error('group_by_validation_failed', validationErr, {
          sql_length: sql.length,
        });
      }

      log.stage('base_sql_built', {
        mode: 'normal',
        sql_preview: sql.substring(0, 500),
        sql_length: sql.length,
        param_count: finalParams.length,
        group_by_cols: groupParts,
        has_aggregate_metric: hasAggregateMetric,
        group_by_auto_corrected: groupByAutoCorrected,
      });
    }

    // ============================================================
    // [2026-06-29] 추가 프롬프트 처리 — 규칙 기반 우선, GPT 는 fallback
    // ------------------------------------------------------------
    //   문제: GPT 호출이 60s+ 걸려 Nginx 504 발생
    //   해결: 단순 월별 비교는 GPT 없이 코드만으로 처리 → 즉시 응답
    //
    //   각 단계별 시간 측정 로깅 (사용자 요청 #1):
    //   - [PromptStage] 패턴 분석 + 규칙 기반 SQL 생성 시간
    //   - [GPTStage]    GPT 호출 시작/완료 시간 + elapsed
    //   - [DBStage]     SQL 실행 시간 (이미 아래 로깅)
    // ============================================================
    const needGpt = prompt && prompt.trim();
    log.stage('llm_needed_check', {
      prompt_present: !!(prompt && String(prompt).trim()),
      prompt_length: prompt ? String(prompt).length : 0,
      llm_used: false, // 이 시점에서는 아직 LLM 호출 안 함. 실제 호출 시 별도 stage 로 기록
    });
    // [2026-06-29] GPT 보완 결과를 호출자에게도 알릴 수 있도록 상태 변수 분리
    //   - 'rule_based' : 규칙 기반 처리 성공 (GPT 호출 없음, 새로 추가)
    //   - 'applied'    : GPT SQL 채택 성공
    //   - 'timeout'    : GPT 응답이 시간 안에 안 옴 → 기본 SQL + 코드단 fallback 적용
    //   - 'error'      : GPT 호출 실패 (네트워크/키 등) → 기본 SQL 유지
    //   - 'metric_loss': GPT 가 산식 단순화 → 기본 SQL 유지
    //   - 'skipped'    : 안전 검증 실패 → 기본 SQL 유지
    let gptStatus = null;
    let gptErrorMessage = null;
    let promptStageMs = 0;
    // [2026-07-01 PR #208] GPT/DB timing breakdown 을 최종 응답 & 로그에 노출
    //   - llmElapsedMs : LLM 호출 왕복 시간 (성공/timeout 무관하게 캡처)
    //   - llmTimedOut  : GPT timeout 여부 (true 이면 GPT 원인)
    //   - dbStageMs 는 아래에서 계산됨
    let llmElapsedMs = 0;
    let llmTimedOut = false;

    // ────────────────────────────────────────────────
    // [Stage 1] 규칙 기반 처리 시도 (사용자 요청 #2)
    //   - 패턴 1: "X월 Y월 (...) 차이" → 월별 + 차이 컬럼
    //   - 패턴 2: "X월 (..)"           → 단일 월 필터
    //   - 패턴 3: "전월 대비 (..)"     → 전월 / 당월 / 증감 / 증감률
    //
    //   ★ 2026-06-29 (수정): regex 매칭 대신 SELECT 절을 처음부터 재구성하여
    //      매칭 실패 케이스 제거. 또한 월별 비교 모드일 때는 시간 차원
    //      (CALMONTH/CALDAY) 을 GROUP BY 에서 자동 제외하여 한 행에 월별
    //      컬럼이 나란히 나오도록 함.
    //
    //   매칭되면 즉시 SQL 생성 후 GPT 호출 스킵
    // ────────────────────────────────────────────────
    let ruleDiagnostics = null; // 규칙 기반 실패/스킵 사유 진단
    // [2026-06-30] Fix — 규칙 기반 진입 전 원본 SQL/params 백업
    //   목적: 규칙 기반이 "월 필드는 뽑았는데 비교 의도는 미충족" 이라는 애매한
    //   상태로 끝난 경우, 원래 기본 SQL 로 되돌린 뒤 GPT 로 위임하기 위함.
    const originalSqlBeforeRule = sql;
    const originalParamsBeforeRule = finalParams.slice();
    if (needGpt) {
      const promptStart = Date.now();
      try {
        const usedMetricEntriesPre = Object.entries(metricFormulaMap);
        const trimmedPrompt = prompt.trim();

        // 패턴: "X월 Y월 영업이익 차이" / "4월과 5월의 차이" / "차이도 같이"
        const monthMatches = [...trimmedPrompt.matchAll(/(\d{1,2})\s*월/g)].map(m => parseInt(m[1], 10));
        const uniqMonths = [...new Set(monthMatches)].filter(m => m >= 1 && m <= 12);
        const hasDiffKeyword = /차이|차액|증감|뺀|빼서/.test(trimmedPrompt);
        const hasGrowthKeyword = /증가율|성장률|증감률|상승률|하락률/.test(trimmedPrompt);
        const hasPrevMonthKeyword = /전월\s*대비|MoM|m\/m/i.test(trimmedPrompt);

        // [2026-06-30] Fix — 사용자의 "비교 의도" 폭넓게 감지 (규칙 감지 키워드보다 상위)
        //   목적: 규칙 기반이 처리 못 하는 표현("3월 대비", "지난달 대비", "vs", "얼마나 늘었어" 등)을
        //   사용자가 원한 경우, 규칙이 어중간한 결과로 확정하지 않고 GPT 로 위임하기 위함.
        //   ※ 이 플래그 자체는 아무 SQL 도 생성하지 않음. "의도가 있었는지" 만 체크.
        const hasComparisonIntent =
          hasDiffKeyword || hasGrowthKeyword || hasPrevMonthKeyword ||
          /대비|비교|vs\b|늘었|줄었|증가|감소|얼마나|지난달|저번달|이전\s*(월|달)|전년|작년|YoY|Y\/Y/i.test(trimmedPrompt);

        // 진단 정보 (사용자 요청 #6 — 실패 사유 명시)
        ruleDiagnostics = {
          metric_count: usedMetricEntriesPre.length,
          prompt_len: trimmedPrompt.length,
          months_found: uniqMonths,
          has_diff: hasDiffKeyword,
          has_prev_month: hasPrevMonthKeyword,
          has_growth: hasGrowthKeyword,
        };

        const isShortPrompt = trimmedPrompt.length <= 200;
        const canRule = usedMetricEntriesPre.length >= 1
          && usedMetricEntriesPre.length <= 2
          && isShortPrompt
          && date_start && date_end;

        if (canRule && (uniqMonths.length >= 1 || hasPrevMonthKeyword)) {
          // 사용자가 명시한 월 또는 전월대비 → 실제 YYYYMM 후보 생성
          let candidates = [];
          if (uniqMonths.length >= 1) {
            for (const yyyy of [date_start.slice(0,4), date_end.slice(0,4)]) {
              for (const mm of uniqMonths) {
                const ymStr = `${yyyy}${String(mm).padStart(2, '0')}`;
                if (ymStr >= date_start && ymStr <= date_end && !candidates.includes(ymStr)) {
                  candidates.push(ymStr);
                }
              }
            }
            candidates.sort();
          } else if (hasPrevMonthKeyword) {
            candidates = [calcPrevMonth(date_end), date_end];
          }

          ruleDiagnostics.candidates = candidates;

          if (candidates.length >= 1) {
            // ────────────────────────────────────────────────
            // SELECT 절 처음부터 재구성 (regex 매칭 X)
            //   1) 차원(dimension) 필드: 그대로 유지, 단 CALMONTH/CALDAY 는
            //      월별 비교 모드에서 제외 (한 행에 월별 컬럼이 나란히 와야 함)
            //   2) Metric 필드: 월별로 분해 + 차이/증감률 컬럼
            //   3) 기타 measure (SUM 등 일반 집계): 그대로 유지
            // ────────────────────────────────────────────────
            const newSelectParts = [];
            const newGroupParts = [];
            const isTimeDim = (c) => ['CALMONTH', 'CALDAY', 'CALYEAR'].includes(c);

            for (const f of fields) {
              const col = f.column;
              const agg = f.aggregate;
              const alias = f.alias || col;
              const isMetric = col.startsWith('METRIC__') && metricFormulaMap[col];

              if (isMetric) {
                const meta = metricFormulaMap[col];
                // 월별 컬럼들
                for (const ym of candidates) {
                  const monthFormula = rewriteFormulaForMonth(meta.formula, ym);
                  const mmInt = parseInt(ym.slice(4), 10);
                  newSelectParts.push(`(${monthFormula}) AS '${mmInt}월 ${alias}'`);
                }
                // 차이/증감률 컬럼
                if (candidates.length >= 2 && (hasDiffKeyword || hasPrevMonthKeyword)) {
                  const m1 = candidates[0];
                  const m2 = candidates[candidates.length - 1];
                  const f1 = rewriteFormulaForMonth(meta.formula, m1);
                  const f2 = rewriteFormulaForMonth(meta.formula, m2);
                  const mm1 = parseInt(m1.slice(4), 10);
                  const mm2 = parseInt(m2.slice(4), 10);
                  newSelectParts.push(`(${f2}) - (${f1}) AS '${alias} 차이(${mm2}월-${mm1}월)'`);
                  if (hasGrowthKeyword || hasPrevMonthKeyword) {
                    newSelectParts.push(`ROUND(((${f2}) - (${f1})) / NULLIF((${f1}), 0) * 100, 2) AS '${alias} 증감률(%)'`);
                  }
                }
              } else if (isTimeDim(col)) {
                // 월별 비교 모드: 시간 차원은 SELECT/GROUP BY 에서 제외
                //   → 한 행에 4월/5월 컬럼이 나란히 표시됨
                continue;
              } else if (agg && ['SUM','COUNT','AVG','MAX','MIN'].includes(agg.toUpperCase())) {
                newSelectParts.push(`${agg.toUpperCase()}(${col}) AS '${alias}'`);
              } else {
                // 일반 차원 (자재명, 사업부 등) → SELECT + GROUP BY
                newSelectParts.push(`${col} AS '${alias}'`);
                newGroupParts.push(col);
              }
            }

            // WHERE 절은 finalParams 와 함께 그대로 유지 (date_start/date_end 와 사용자 조건)
            const whereParts2 = [];
            const newFinalParams = [];
            if (date_start === date_end) {
              whereParts2.push('CALMONTH = ?');
              newFinalParams.push(date_start);
            } else {
              whereParts2.push('CALMONTH BETWEEN ? AND ?');
              newFinalParams.push(date_start, date_end);
            }
            const userWhere2 = buildUserConditions(newFinalParams);
            if (userWhere2) whereParts2.push(userWhere2);

            let orderClause2 = '';
            if (order_by && !isTimeDim(order_by)) {
              const dir = (order_dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
              orderClause2 = `ORDER BY ${order_by} ${dir}`;
            }

            let newSql = `SELECT ${newSelectParts.join(', ')} FROM bw_profitability_data`;
            if (whereParts2.length > 0) newSql += ` WHERE ${whereParts2.join(' ')}`;
            if (newGroupParts.length > 0) newSql += ` GROUP BY ${newGroupParts.join(', ')}`;
            if (orderClause2) newSql += ` ${orderClause2}`;
            newSql += ` LIMIT ${safeLimit}`;

            // [2026-06-30] Fix — 규칙 기반 결과가 사용자 "비교 의도" 를 충족했는지 검증
            //   시나리오: 프롬프트에 "3월 대비 증가율" — 월은 [3] 하나만 잡히고
            //     hasDiffKeyword=false 이라 차이/증감률 컬럼은 안 만들어짐. 이 경우
            //     결과는 "3월 컬럼 하나만 뽑는 SQL" 인데 사용자는 "3월 대비 4월 증가율"
            //     을 원한 것. → 규칙으로 확정 짓지 말고 GPT 로 위임.
            //
            //   판정: (a) 사용자가 비교 의도를 표현했는데 (b) 실제 비교 컬럼이 안 나왔으면 미충족.
            //         미충족이면 원본 SQL/params 로 되돌린 뒤 rule_based 확정 스킵.
            const producedComparisonColumn = newSelectParts.some(p => /차이\(|증감률\(/.test(p));
            const ruleFullySatisfied = !hasComparisonIntent || producedComparisonColumn;

            if (!ruleFullySatisfied) {
              // 미충족 → 원본 SQL/params 복구 후 rule_based 확정 스킵 → 아래 Stage 2 (GPT) 에서 처리
              ruleDiagnostics.skip_reason = 'comparison_intent_unmet';
              ruleDiagnostics.candidates_from_prompt = candidates;
              ruleDiagnostics.produced_comparison_column = false;
              promptStageMs = Date.now() - promptStart;
              console.log(`[PromptStage] 규칙 매칭됐으나 사용자 비교 의도(${JSON.stringify({diff:hasDiffKeyword, growth:hasGrowthKeyword, prev:hasPrevMonthKeyword, broad:hasComparisonIntent})}) 를 충족 못 함 → GPT 위임 (${promptStageMs}ms)`);
              log.stage('rule_deferred_to_gpt', {
                llm_used: false,
                reason: 'comparison_intent_unmet',
                months_found: candidates,
                has_comparison_intent: hasComparisonIntent,
                produced_comparison_column: false,
              });
              // sql, finalParams 는 원본 유지 (originalSqlBeforeRule, originalParamsBeforeRule)
              // gptStatus 는 여전히 null → Stage 2 GPT 호출로 진행
            } else {
              sql = newSql;
              finalParams = newFinalParams;
              gptStatus = 'rule_based';
              promptStageMs = Date.now() - promptStart;
              log.stage('rule_based_applied', {
                llm_used: false,
                months: candidates,
                has_diff: hasDiffKeyword,
                has_growth: hasGrowthKeyword,
                prompt_stage_ms: promptStageMs,
                sql_preview: newSql.substring(0, 300),
              });
              // [PR #208] 규칙 기반 최종 SQL 도 파일로 저장 (검증 편의)
              try {
                const fname = `/tmp/nlq-final-sql-${log.requestId}.sql`;
                fs.writeFileSync(fname, `-- requestId: ${log.requestId}\n-- ts: ${new Date().toISOString()}\n-- gpt_status: rule_based\n-- months: ${candidates.join(',')}\n${newSql}\n`, 'utf8');
                log.stage('final_sql_file_written', {
                  file: fname,
                  sql_length: newSql.length,
                });
              } catch (fwErr) {
                log.error('final_sql_file_write_failed', fwErr, { sql_length: newSql.length });
              }
              console.log(`[PromptStage] 규칙 기반 처리 적용 (${promptStageMs}ms) — months=${candidates.join(',')}, diff=${hasDiffKeyword}, growth=${hasGrowthKeyword}, metric=${usedMetricEntriesPre.map(([c])=>c).join(',')}`);
              console.log(`[PromptStage] 재구성 SQL preview: ${newSql.slice(0, 200)}...`);
            }
          } else {
            ruleDiagnostics.skip_reason = 'no_month_candidates_in_range';
            console.log(`[PromptStage] 규칙 매칭됐으나 후보 월이 date_start~date_end 범위에 없음: months=${uniqMonths.join(',')}, range=${date_start}~${date_end}`);
          }
        } else {
          // 미매칭 사유 진단
          if (usedMetricEntriesPre.length === 0) {
            ruleDiagnostics.skip_reason = 'no_metric_field';
          } else if (usedMetricEntriesPre.length > 2) {
            ruleDiagnostics.skip_reason = 'too_many_metrics';
          } else if (!isShortPrompt) {
            ruleDiagnostics.skip_reason = 'prompt_too_long';
          } else if (uniqMonths.length === 0 && !hasPrevMonthKeyword) {
            ruleDiagnostics.skip_reason = 'no_month_or_prev_keyword';
          } else {
            ruleDiagnostics.skip_reason = 'other';
          }
          console.log(`[PromptStage] 규칙 미적용: ${ruleDiagnostics.skip_reason} (metric=${usedMetricEntriesPre.length}, months=${uniqMonths.join(',')}, diff=${hasDiffKeyword})`);
        }
      } catch (ruleErr) {
        console.error('[PromptStage] 규칙 기반 처리 오류 (GPT 로 진행):', ruleErr.message, ruleErr.stack);
        if (ruleDiagnostics) ruleDiagnostics.skip_reason = 'exception: ' + ruleErr.message;
      }
      if (gptStatus !== 'rule_based') {
        promptStageMs = Date.now() - promptStart;
        console.log(`[PromptStage] 규칙 미적용 (${promptStageMs}ms) → GPT 호출 진행`);
      }
    }

    // ────────────────────────────────────────────────
    // [Stage 2] GPT 보완 — 규칙 기반이 적용 안 된 경우에만 호출
    // ────────────────────────────────────────────────
    if (needGpt && gptStatus !== 'rule_based') {
      try {
        let resolvedSql = sql;
        let paramIdx = 0;
        resolvedSql = resolvedSql.replace(/\?/g, () => {
          const v = finalParams[paramIdx++];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });

        // ────────────────────────────────────────────────────────
        // [2026-06-24] Metric 산식을 GPT 프롬프트에 명시
        //   기존: GPT 가 기본 SQL 만 보고 "영업이익" 등 alias 가 어떤 산식인지
        //         몰라서 ZAMT055 같은 단일 컬럼으로 단순화하는 경우가 있었음.
        //   수정: 사용된 Metric 의 alias / 원본 formula / 월별 변환 예시 를
        //         프롬프트에 함께 넣어 GPT 가 산식 전체를 보존하도록 가이드.
        // ────────────────────────────────────────────────────────
        let metricGuide = '';
        const usedMetricEntries = Object.entries(metricFormulaMap);
        if (usedMetricEntries.length > 0) {
          metricGuide += '\n\n[계산지표(Metric) 산식 — 절대 단일 컬럼으로 단순화하지 말 것]\n';
          for (const [col, meta] of usedMetricEntries) {
            // 해당 Metric 의 사용자 alias 추정 (fields 에서 검색)
            const fld = fields.find(f => f.column === col);
            const alias = (fld && fld.alias) || meta.metric_code;
            metricGuide += `- "${alias}" (코드: ${meta.metric_code}) = ${meta.formula}\n`;
            // 월별 변환 예시 (date_start, date_end 가 다르면 양 끝 월에 대해 보여줌)
            if (date_start && date_end) {
              const exA = rewriteFormulaForMonth(meta.formula, date_start);
              metricGuide += `   · ${date_start} 월값 변환 예시: ${exA}\n`;
              if (date_start !== date_end) {
                const exB = rewriteFormulaForMonth(meta.formula, date_end);
                metricGuide += `   · ${date_end} 월값 변환 예시: ${exB}\n`;
              }
            }
          }
          metricGuide += '\n[중요] 위 Metric 의 alias("' + usedMetricEntries.map(([c]) => {
            const fld = fields.find(f => f.column === c);
            return (fld && fld.alias) || metricFormulaMap[c].metric_code;
          }).join('", "') + '") 가 SELECT 절에 나타나는 경우, 반드시 위 "산식 전체" 를 사용해야 합니다. ' +
            '월별 비교(예: "4월 5월 차이") 요청 시에는:\n' +
            '  - 산식 안에 SUM(컬럼) 이 있으면 각 SUM(컬럼) 을 `SUM(CASE WHEN CALMONTH = \'YYYYMM\' THEN 컬럼 ELSE 0 END)` 로 변환\n' +
            '  - 산식이 SUM 없는 row-level 형태(예: `ZAMT001-ZAMT002+...`)면 전체 산식을 `SUM(CASE WHEN CALMONTH = \'YYYYMM\' THEN (산식) ELSE 0 END)` 로 감싸기\n' +
            '절대 산식의 일부 컬럼만 추출해 단순 SUM 하지 마세요. GROUP BY 가 있는데 산식이 row-level 인 채로 SELECT 절에 두면 그룹 내 임의 row 값이 나오는 잘못된 결과가 됩니다.\n';
        }

        const userPromptText = `\n\n[추가 요청]\n${prompt}`;
        const gptPrompt = `[테이블 스키마]\n${TABLE_SCHEMA}\n\n[기본 SQL]\n${resolvedSql}${metricGuide}${userPromptText}\n\n위 기본 SQL을 기반으로 요청사항을 반영한 완성된 SELECT 문을 작성해주세요.\n반드시 위 스키마에 존재하는 컬럼명만 사용하세요.\nWHERE 조건의 값은 반드시 리터럴 값으로 직접 작성하세요 (? 파라미터 바인딩 사용 금지).\nSELECT 문만 작성하고 JSON 형식이 아닌 순수 SQL만 반환하세요.`;
        // [2026-06-29 PR #196] GPT 호출 timeout 40s → 90s 상향
        //   - 운영 로그에서 40s 도달 시점에 abort 다발 발생 확인 (reqId=mqyzh7wsve1x 등)
        //     → 프롬프트가 길어지면(현재 약 9.5KB) gpt-5.5 응답이 40s 를 넘기는 사례 다수
        //   - 4-layer timeout 일관성 (안쪽 < 바깥쪽):
        //       LLM 90s  <  Express server.setTimeout 110s
        //                <  Nginx proxy_read_timeout 120s
        //                <  Frontend fetch AbortController 130s
        //   - OpenAI SDK 의 `timeout` 옵션과 `AbortSignal` 양쪽으로 이중 보호
        //   - 90s 안에도 응답 못 받으면 abort → 코드단 fallback 으로 기본 SQL 응답
        //   - 환경변수 BUILDER_GPT_TIMEOUT_MS 로 운영 중 재조정 가능
        const GPT_TIMEOUT_MS = parseInt(process.env.BUILDER_GPT_TIMEOUT_MS || '90000', 10);
        const gptStartTime = Date.now();
        console.log(`[GPTStage] GPT 호출 시작 (timeout=${GPT_TIMEOUT_MS}ms, prompt_len=${prompt.length})`);
        log.stage('llm_call_start', {
          llm_used: true,
          model: GPT_MODEL,
          timeout_ms: GPT_TIMEOUT_MS,
          prompt_len: prompt.length,
          gpt_prompt_len: gptPrompt.length,
        });
        const gptAbort = new AbortController();
        const gptTimer = setTimeout(() => gptAbort.abort(), GPT_TIMEOUT_MS);
        let completion;
        try {
          completion = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            { role: 'system', content:
              '당신은 SQL 전문가입니다. 주어진 기본 SQL을 기반으로 요청사항을 반영한 SELECT 문만 작성하세요.\n' +
              '중요 규칙:\n' +
              '1. 반드시 제공된 테이블 스키마에 존재하는 컬럼명만 사용하세요.\n' +
              '2. "매출"은 ZAMT001(총매출), "순매출"은 ZAMT003 등 스키마의 한국어 설명을 참고하여 올바른 컬럼을 매핑하세요.\n' +
              '3. 존재하지 않는 컬럼명을 임의로 생성하지 마세요.\n' +
              '4. SELECT 문 이외의 DML(INSERT, UPDATE, DELETE) 및 DDL(DROP, ALTER, CREATE, TRUNCATE)은 절대 생성하지 마세요.\n' +
              '5. 결과 컬럼에 한글 alias를 사용하세요.\n' +
              '6. WHERE 조건의 CALMONTH 범위는 기본적으로 변경하지 마세요. ' +
              '   단, 추가 프롬프트에 사용자가 명시적으로 언급한 월이 기본 SQL 의 CALMONTH 범위에 없는 경우 ' +
              '(예: 기본 SQL 이 CALMONTH=\'202603\' 인데 프롬프트가 "3월 대비 4월 증가율" 이라 4월 이 필요한 경우), ' +
              '   프롬프트에 명시된 월도 포함되도록 WHERE 절의 CALMONTH 범위를 확장하는 것은 허용합니다. ' +
              '   이때 원래 범위를 축소하거나 변경하지 말고 반드시 확장(BETWEEN 또는 IN)만 하세요.\n' +
              '7. [계산지표(Metric) 산식] 섹션에 명시된 alias 가 SELECT 절에 있으면 반드시 명시된 "산식 전체" 를 사용하세요. ' +
              '   - 산식 안의 일부 컬럼(예: ZAMT055)만 추출해 단순 SUM 으로 대체하지 마세요.\n' +
              '8. 추가 프롬프트의 비교/증가율/그룹화 요청은 반드시 SQL 에 반영하세요.\n' +
              '   - "4월 5월 차이" → 4월값, 5월값, 차이 3개 컬럼 생성\n' +
              '   - "전월 대비 증가율" → 전월값, 당월값, 증감액, 증가율(%) 4개 컬럼 생성\n' +
              '   - "3월 대비 4월 증가율" / "3월 대비 증가율" → 3월값, 4월값, 증감액, 증가율(%) 컬럼 생성 ' +
              '     (기본 SQL 의 CALMONTH 범위가 3월만이라면 규칙6에 따라 4월 도 포함되도록 확장)\n' +
              '   - "N월 대비" 패턴에서 비교 대상 월이 명시 안 되면 기본 SQL 의 CALMONTH 범위 중 가장 큰(최신) 월을 사용\n' +
              '   - "사업부별로" → GROUP BY 에 해당 컬럼 추가\n' +
              '9. 따옴표 규칙: 컬럼명/테이블명에는 백틱(`) 이나 작은따옴표를 사용하지 마세요. ' +
              '   - 잘못된 예: SELECT `MATERIAL_NM` FROM `bw_profitability_data`\n' +
              '   - 올바른 예: SELECT MATERIAL_NM FROM bw_profitability_data\n' +
              '   - AS 뒤의 한글 alias 만 작은따옴표로 감쌉니다 (예: AS \'4월 영업이익\')\n' +
              '   - WHERE 조건값은 작은따옴표로 감쌉니다 (예: CALMONTH = \'202604\')\n' +
              '\n' +
              '=========================================================\n' +
              '[★★★★★ 최상위 집계 규칙 (Top-level Aggregation Rule) — 성능 필수 ★★★★★]\n' +
              '월별 비교/증감액/증가율/감소율/퍼센트/비율/YoY/MoM/월별 차이 등 "비교 지표" 를\n' +
              '만들 때는 반드시 아래 2단 구조로 작성하세요.\n' +
              '\n' +
              '### 원칙: SUM/AVG/COUNT 는 최상위 SELECT 단계에서만 수행\n' +
              '- 내부 서브쿼리(FROM 절 안) 에는 **row-level 계산 컬럼만** 만드세요.\n' +
              '- 최종 바깥 SELECT 에서 `SUM(x.컬럼)` 형태로 집계하세요.\n' +
              '- **내부 서브쿼리 안에 SUM(CASE WHEN ...) 를 넣지 마세요.** (실행계획이 무거워져 timeout 유발)\n' +
              '\n' +
              '### 잘못된 예 (내부에서 이미 집계 — 금지):\n' +
              '  SELECT MATERIAL_NM, cost_202603, cost_202604, (cost_202604 - cost_202603) AS 증감액\n' +
              '  FROM (\n' +
              '    SELECT MATERIAL_NM,\n' +
              '      SUM(CASE WHEN CALMONTH = \'202603\' THEN 산식 ELSE 0 END) AS cost_202603,   -- ❌ 내부 SUM 금지\n' +
              '      SUM(CASE WHEN CALMONTH = \'202604\' THEN 산식 ELSE 0 END) AS cost_202604    -- ❌ 내부 SUM 금지\n' +
              '    FROM bw_profitability_data\n' +
              '    WHERE CALMONTH BETWEEN \'202603\' AND \'202604\'\n' +
              '    GROUP BY MATERIAL_NM\n' +
              '  ) t\n' +
              '\n' +
              '### 올바른 예 (내부 row-level + 외부 SUM):\n' +
              '  SELECT x.MATERIAL_NM AS \'자재 명\',\n' +
              '         SUM(x.cost_202603) AS \'2026년 3월 매출원가(제품)\',\n' +
              '         SUM(x.cost_202604) AS \'2026년 4월 매출원가(제품)\',\n' +
              '         SUM(x.cost_202604) - SUM(x.cost_202603) AS \'증감액\',\n' +
              '         CASE WHEN SUM(x.cost_202603) = 0 THEN NULL\n' +
              '              ELSE (SUM(x.cost_202604) - SUM(x.cost_202603)) * 100.0 / SUM(x.cost_202603)\n' +
              '         END AS \'증가율(%)\'\n' +
              '  FROM (\n' +
              '    SELECT MATERIAL_NM,\n' +
              '      CASE WHEN CALMONTH = \'202603\' THEN (COALESCE(ZAMT006,0)+COALESCE(ZAMT007,0)+...) ELSE 0 END AS cost_202603,\n' +
              '      CASE WHEN CALMONTH = \'202604\' THEN (COALESCE(ZAMT006,0)+COALESCE(ZAMT007,0)+...) ELSE 0 END AS cost_202604\n' +
              '    FROM bw_profitability_data\n' +
              '    WHERE CALMONTH BETWEEN \'202603\' AND \'202604\'\n' +
              '  ) x\n' +
              '  GROUP BY x.MATERIAL_NM\n' +
              '\n' +
              '### Metric 산식 처리\n' +
              '- Metric 산식(예: COALESCE(ZAMT006,0)+COALESCE(ZAMT007,0)+... ) 자체는 row-level 산식입니다.\n' +
              '- 산식 안에 SUM 을 씌우지 말고, 그대로 내부 서브쿼리의 CASE WHEN 안에 넣으세요.\n' +
              '- 외부 SELECT 에서 SUM(x.cost_YYYYMM) 형태로 집계하세요.\n' +
              '\n' +
              '### 기존 차원(GROUP BY 컬럼) 보존\n' +
              '- 사용자가 조회 필드로 선택한 차원(예: MATERIAL_NM, PLANT_NM 등)은 반드시 유지하세요.\n' +
              '- 최상위 SELECT 에 `x.차원컬럼` 을 포함하고, 최상위 GROUP BY 에도 `x.차원컬럼` 을 넣으세요.\n' +
              '- 절대 차원 컬럼을 임의로 제거하지 마세요.\n' +
              '\n' +
              '### 적용 대상 프롬프트 키워드\n' +
              '"전월 대비", "N월 대비", "증감액", "증가율", "감소율", "퍼센트", "%", "비율",\n' +
              '"YoY", "MoM", "월별 비교", "지표별 차이", "월 차이" 등이 프롬프트에 있으면\n' +
              '반드시 위 2단 구조로 작성하세요.\n' +
              '=========================================================\n'
            },
            { role: 'user', content: gptPrompt },
          ],
          temperature: 0.1,
          // GPT 응답 자체 timeout (OpenAI SDK 레벨)
          // baseURL 이 Genspark 프록시인 경우에도 동일하게 동작
          // (SDK 가 fetch 옵션으로 전달)
          // eslint-disable-next-line camelcase
          }, { signal: gptAbort.signal, timeout: GPT_TIMEOUT_MS });
        } finally {
          clearTimeout(gptTimer);
        }
        const gptElapsed = Date.now() - gptStartTime;
        llmElapsedMs = gptElapsed; // [PR #208] outer scope 로 노출
        console.log(`[GPTStage] GPT 응답 완료: ${gptElapsed}ms`);
        log.stage('llm_response_received', {
          llm_elapsed_ms: gptElapsed,
          response_len: (completion?.choices?.[0]?.message?.content || '').length,
        });
        let gptSql = completion.choices[0].message.content.trim();
        gptSql = gptSql.replace(/```sql\s*/gi, '').replace(/```\s*/g, '').trim();
        const forbidden = ['INSERT','UPDATE','DELETE','DROP','ALTER','TRUNCATE','CREATE'];
        const isSafe = !forbidden.some(w => new RegExp('\\b' + w + '\\b', 'i').test(gptSql));

        // [2026-06-24] Metric 산식 보존 검증
        //   - 사용된 Metric 산식 안의 핵심 컬럼들이 GPT 응답에 모두 살아있는지 체크
        //   - 한두 개만 살아 있으면 (예: ZAMT055 만) → GPT 가 산식을 단순화한 것 →
        //     기본 SQL 유지 + 코드 단에서 월별 변환 적용
        let metricLossDetected = false;
        if (isSafe && usedMetricEntries.length > 0) {
          for (const [, meta] of usedMetricEntries) {
            // formula 에서 컬럼명만 추출 (ZAMT001, ZAMT002 등)
            const cols = [...meta.formula.matchAll(/\b(ZAMT\d+|[A-Z][A-Z0-9_]{2,})\b/g)]
              .map(m => m[1])
              .filter(c => !['SUM','AVG','COUNT','MAX','MIN','NULLIF','COALESCE','CASE','WHEN','THEN','ELSE','END','AND','OR','NOT','NULL','AS','SELECT','FROM','WHERE','GROUP','BY','ORDER','LIMIT','CALMONTH','CALDAY','CALYEAR'].includes(c));
            const uniqCols = [...new Set(cols)];
            if (uniqCols.length >= 3) { // 산식이 3개 이상 컬럼을 가진 경우만 검증
              const missing = uniqCols.filter(c => !new RegExp('\\b' + c + '\\b').test(gptSql));
              // 절반 이상 누락이면 산식 손실로 판단
              if (missing.length > uniqCols.length / 2) {
                console.warn(`[Builder] GPT 가 Metric "${meta.metric_code}" 산식을 단순화한 것으로 보임. 누락 컬럼: ${missing.length}/${uniqCols.length}`);
                metricLossDetected = true;
                break;
              }
            }
          }
        }

        // ─── [2026-07-01 PR #214] 최상위 집계 규칙 & 차원 보존 검증 ──────
        //   GPT 가 "SUM/AVG/COUNT 는 최상위 SELECT 에서만" 규칙을 지켰는지,
        //   사용자가 선택한 차원 컬럼이 유지됐는지, 증가율 요청에 실제 증가율 컬럼이
        //   생성됐는지 검증. 실패 시 기본 SQL fallback 으로 조용히 전환.
        let structureIssueDetected = false;
        let structureIssues = [];
        let structureWarnings = [];
        if (isSafe && /^SELECT/i.test(gptSql) && !metricLossDetected) {
          try {
            const validationResult = validateGptSqlStructure(gptSql, {
              promptText: prompt || '',
              dimCols: Array.isArray(group_by) ? group_by : [],
            });
            structureIssues   = validationResult.issues || [];
            structureWarnings = validationResult.warnings || [];
            if (!validationResult.ok) {
              structureIssueDetected = true;
              console.warn('[Builder] GPT SQL 구조 검증 실패 → 기본 SQL fallback. 사유:', structureIssues.join(', '));
              log.stage('gpt_sql_structure_invalid', {
                issues: structureIssues,
                warnings: structureWarnings,
                dim_cols: Array.isArray(group_by) ? group_by : [],
                sql_preview: gptSql.substring(0, 300),
              });
            } else if (structureWarnings.length > 0) {
              // 경고만 있으면 실행 허용하되 로그로 남김 (opt-in 튜닝 자료)
              log.stage('gpt_sql_structure_warn', {
                warnings: structureWarnings,
                sql_preview: gptSql.substring(0, 300),
              });
            }
          } catch (validationErr) {
            // 검증 로직 자체가 실패하면 방어적으로 통과 (원본 GPT SQL 흐름 유지)
            //   운영에서 예상 못한 SQL 형태가 검증기를 터뜨려서 정상 요청까지 막지 않도록.
            console.error('[Builder] validateGptSqlStructure 예외 (fail-open):', validationErr && validationErr.message);
            log.error('gpt_sql_structure_validator_error', validationErr, {});
          }
        }

        if (isSafe && /^SELECT/i.test(gptSql) && !metricLossDetected && !structureIssueDetected) {
          sql = gptSql;
          finalParams = [];
          gptStatus = 'applied';
          log.stage('sql_parse_validated', {
            outcome: 'applied',
            sql_preview: sql.substring(0, 300),
            sql_length: sql.length,
          });
          // [2026-07-01 PR #208] GPT 최종 SQL 을 별도 파일 로 저장 + 로그에 전체 SQL 남김
          //   - 사용자 요청: "GPT 가 생성한 최종 SQL 전체를 로그에 남겨줘"
          //   - 방법1: nlq-server.log 에는 정상 로그 흐름 유지 위해 짧은 preview 대신
          //     multi-line 은 escape 문제로 파일로 저장.
          //   - 방법2: `final_sql` 필드에 전체 SQL 을 인라인. 로그 파일 라인 하나가 길어지지만
          //     검색성이 좋아지므로 인라인 로그도 함께 남긴다.
          try {
            const tmpDir = '/tmp';
            const fname = `${tmpDir}/nlq-final-sql-${log.requestId}.sql`;
            fs.writeFileSync(fname, `-- requestId: ${log.requestId}\n-- ts: ${new Date().toISOString()}\n-- gpt_status: applied\n${sql}\n`, 'utf8');
            log.stage('final_sql_file_written', {
              file: fname,
              sql_length: sql.length,
            });
          } catch (fwErr) {
            log.error('final_sql_file_write_failed', fwErr, { sql_length: sql.length });
          }
        } else if (metricLossDetected) {
          console.log('[Builder] GPT 응답에서 Metric 산식 손실 감지 → 기본 SQL 유지');
          gptStatus = 'metric_loss';
          gptErrorMessage = 'GPT 가 Metric 산식을 단순화하여 기본 SQL 을 유지했습니다.';
          log.error('sql_parse_failed', new Error('metric_loss'), {
            outcome: 'metric_loss',
            reason: 'GPT 가 Metric 산식을 단순화함',
          });
        } else if (structureIssueDetected) {
          // [PR #214] 구조 검증 실패 (내부 서브쿼리에 SUM/CASE, 차원 누락, 증가율 컬럼 미생성 등)
          //   → 기본 SQL 로 조용히 fallback. 사용자 화면에는 안내만 표시됨 (PR #213 흐름).
          //   운영에서는 이 stage 를 grep 하여 GPT 프롬프트 튜닝 자료로 활용.
          console.log('[Builder] GPT SQL 구조 검증 실패 → 기본 SQL 유지. 사유:', structureIssues.join(', '));
          gptStatus = 'structure_invalid';
          gptErrorMessage = 'GPT 응답이 SQL 구조 규칙(최상위 집계/차원 보존) 을 지키지 않아 기본 SQL 을 유지했습니다.';
          log.error('sql_parse_failed', new Error('structure_invalid'), {
            outcome: 'structure_invalid',
            issues: structureIssues,
            warnings: structureWarnings,
            sql_preview: gptSql.substring(0, 300),
          });
        } else {
          gptStatus = 'skipped';
          gptErrorMessage = 'GPT 응답이 안전 검증을 통과하지 못해 기본 SQL 을 유지했습니다.';
          log.error('sql_parse_failed', new Error('unsafe_or_not_select'), {
            outcome: 'skipped',
            is_safe: isSafe,
            starts_with_select: /^SELECT/i.test(gptSql),
            sql_preview: gptSql.substring(0, 200),
          });
        }
      } catch (gptErr) {
        // [2026-06-29] timeout/abort 케이스 구분
        const isAbort =
          gptErr?.name === 'AbortError' ||
          gptErr?.code === 'ETIMEDOUT' ||
          /aborted|timeout|timed out/i.test(gptErr?.message || '');
        gptStatus = isAbort ? 'timeout' : 'error';
        gptErrorMessage = isAbort
          ? 'GPT 보완이 시간 초과되어 기본 SQL 을 사용합니다.'
          : `GPT 보완 실패: ${gptErr.message}`;
        // [PR #208] LLM 소요시간 & timeout 여부를 outer 로 노출
        //   - gptStartTime 은 llm_call_start 직전. try 진입 이후이므로 catch 에서도 접근 가능.
        try { llmElapsedMs = Date.now() - gptStartTime; } catch (_) { /* ignore */ }
        llmTimedOut = isAbort;
        console.error(`[Builder] GPT prompt enhancement ${gptStatus}:`, gptErr.message);
        log.error(isAbort ? 'llm_call_timeout' : 'llm_call_failed', gptErr, {
          llm_used: true,
          outcome: gptStatus,
          err_name: gptErr?.name,
          err_code: gptErr?.code,
          llm_elapsed_ms: llmElapsedMs,
        });

        // ────────────────────────────────────────────────
        // [2026-06-29] 코드단 fallback — 추가 프롬프트에서 월별 비교 의도 감지 시
        //   기본 SQL 에 rewriteFormulaForMonth 를 자동 적용하여
        //   '4월 5월 영업이익 차이' 같은 요청을 GPT 없이도 처리한다.
        //
        // 매칭 규칙 (단순/안전 위주, 한국어 기반):
        //   - prompt 에서 "X월" 패턴 1~2개 추출 → 해당 월을 date_start/date_end 기준
        //     YYYYMM 으로 변환
        //   - usedMetricEntries 가 있으면 SELECT 절의 해당 컬럼을 월별 SUM(CASE WHEN) 으로 교체
        //   - 컬럼 수가 적은 경우(1~2 metric)만 처리하여 SQL 폭주 방지
        // ────────────────────────────────────────────────
        try {
          if (usedMetricEntries.length > 0 && usedMetricEntries.length <= 2 && date_start && date_end) {
            const monthMatches = [...prompt.matchAll(/(\d{1,2})\s*월/g)].map(m => parseInt(m[1], 10));
            const uniqMonths = [...new Set(monthMatches)].filter(m => m >= 1 && m <= 12);
            if (uniqMonths.length >= 1) {
              // date_start ~ date_end 범위 안에서 해당 월의 실제 YYYYMM 을 찾음
              const yyyyStart = date_start.slice(0, 4);
              const yyyyEnd = date_end.slice(0, 4);
              const candidates = [];
              for (const yyyy of [yyyyStart, yyyyEnd]) {
                for (const mm of uniqMonths) {
                  const ymStr = `${yyyy}${String(mm).padStart(2, '0')}`;
                  if (ymStr >= date_start && ymStr <= date_end && !candidates.includes(ymStr)) {
                    candidates.push(ymStr);
                  }
                }
              }
              if (candidates.length >= 1) {
                console.log(`[Builder] GPT fallback: 월별 변환 적용 — 월=${candidates.join(',')}`);
                // 기본 SQL 의 metric alias 컬럼을 월별로 분리해 새 SELECT 절 구성
                for (const [col, meta] of usedMetricEntries) {
                  const fld = fields.find(f => f.column === col);
                  const alias = (fld && fld.alias) || meta.metric_code;
                  // 원본 SELECT 절에서 해당 metric expression 한 줄을 찾아서 월별로 치환
                  // 단순화: alias 가 있는 형태인 `(...) AS '영업이익'` 또는 `... AS \`영업이익\`` 패턴 매칭
                  const aliasEsc = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const re = new RegExp(`([^,\\n]+?\\bAS\\s+['\`"]${aliasEsc}['\`"])`, 'i');
                  if (re.test(sql)) {
                    // 월별 변환 컬럼 생성
                    const monthExprs = candidates.map(ym => {
                      const monthFormula = rewriteFormulaForMonth(meta.formula, ym);
                      const mmInt = parseInt(ym.slice(4), 10);
                      return `(${monthFormula}) AS '${mmInt}월 ${alias}'`;
                    });
                    let diffExpr = '';
                    if (candidates.length === 2) {
                      const [m1, m2] = candidates;
                      const f1 = rewriteFormulaForMonth(meta.formula, m1);
                      const f2 = rewriteFormulaForMonth(meta.formula, m2);
                      const mm1 = parseInt(m1.slice(4), 10);
                      const mm2 = parseInt(m2.slice(4), 10);
                      diffExpr = `, (${f2}) - (${f1}) AS '${mm2}월-${mm1}월 ${alias} 차이'`;
                    }
                    sql = sql.replace(re, monthExprs.join(', ') + diffExpr);
                  }
                }
              }
            }
          }
        } catch (fbErr) {
          console.error('[Builder] GPT fallback 월별 변환 실패:', fbErr.message);
        }
      }
    }

    // [2026-06-16] 사용자 요청: 비주얼 쿼리 빌더도 자연어 질의(L3452) 와 동일하게 상단 도메인 필터 적용
    // - PS   → AND DIVISION = '10'
    // - HL   → AND DIVISION = '20'
    // - MGMT → 적용 안 함 (PS+HL 전체 조회)
    // - 세션의 active_domain 사용 (사용자가 상단에서 선택한 도메인)
    // - GPT 보완 이후 호출되어, GPT 가 SQL 을 교체한 경우에도 정상 적용
    //
    // [2026-06-16 추가] 사용자 요청 (학습 SQL 재사용 도메인 오작동 수정의 확장 적용):
    // - GPT 보완 SQL 안에 도메인과 무관한 DIVISION 조건이 박혀있을 수 있으므로,
    //   scrubDivisionFilter 로 기존 DIVISION 조건을 모두 제거한 뒤 현재 도메인으로 재주입
    // - 정책: "도메인은 항상 상단 선택값 우선" (자연어 질의와 동일 정책)
    try {
      const activeDomainForBuilder = await getActiveDomain(req);
      const sqlBefore = sql;
      // ★ 사업부 명칭 고정 매핑: DIVISION_NM='HL' 등 잘못된 조건을 코드 기반으로 교정
      sql = normalizeDivisionFilter(sql);
      sql = scrubDivisionFilter(sql);
      sql = applyDomainFilter(sql, activeDomainForBuilder);
      // ★ 자재명/고객명 공백 무시 검색 (MATERIAL_NM / CUSTOMER_NM)
      sql = normalizeNameSearchFilter(sql);
      if (sql !== sqlBefore) {
        console.log(`[Builder] 도메인 필터 적용: domain=${activeDomainForBuilder}`);
      }
      log.stage('domain_filter_applied', {
        domain: activeDomainForBuilder,
        changed: sql !== sqlBefore,
        sql_length: sql.length,
      });
    } catch (dfErr) {
      console.error('[Builder] 도메인 필터 적용 실패 (원본 SQL 유지):', dfErr.message);
      log.error('domain_filter_failed', dfErr);
    }

    // ────────────────────────────────────────────────
    // [2026-07-01 PR #208] Final SQL Analysis — DB 실행 직전에 최종 SQL 을 분석
    //   1) 사용자 프롬프트에서 요구된 컬럼 유형(intent) 감지
    //   2) 최종 SQL 에서 alias 추출
    //   3) 요구된 컬럼이 실제 SQL 에 반영됐는지 검증 → intent_verification
    //
    //   이 stage 는 로그에만 정보를 남기고 SQL 자체는 변경하지 않는다.
    //   판정 결과는 response_sent / responseObj.prompt_reflected 에 반영된다.
    // ────────────────────────────────────────────────
    let intentVerification = null;
    try {
      const promptIntent = detectPromptIntent(prompt);
      const sqlAliases = extractSqlColumnAliases(sql);
      const columnFlags = classifyResultColumns(sqlAliases);
      intentVerification = verifyPromptReflected(promptIntent, columnFlags, sqlAliases);
      log.stage('final_sql_analysis', {
        prompt_intent: {
          has_growth: promptIntent.has_growth,
          has_diff: promptIntent.has_diff,
          has_month_compare: promptIntent.has_month_compare,
          months_in_prompt: promptIntent.months,
          requires_growth_column: promptIntent.requires_growth_column,
          requires_diff_column: promptIntent.requires_diff_column,
          requires_multi_month_columns: promptIntent.requires_multi_month_columns,
        },
        actual_columns: sqlAliases,
        expected_columns: intentVerification.required_intents,
        result_column_flags: columnFlags,
        prompt_reflected_strict: intentVerification.prompt_reflected,
        partial_reflected: intentVerification.partial_reflected,
        missing_intents: intentVerification.missing_intents,
        gpt_status: gptStatus,
        sql_length: sql.length,
        // 전체 SQL 을 로그 라인에 인라인 (multi-line 은 개행이 JSON escape 됨)
        final_sql: sql,
      });
    } catch (ivErr) {
      log.error('final_sql_analysis_failed', ivErr, { sql_length: sql.length });
    }

    // SQL 실행 (시간 측정 — 사용자 요청 #1)
    // ─── [2026-06-30 PR #198] DB 쿼리 timeout 명시 설정 ──────────────────────
    //   (사용자 요청 #3 — timeout 정합성)
    //   - mysql2 의 query 옵션 timeout 은 클라이언트 쪽 cancel 만 수행하므로
    //     DB 서버에서는 쿼리가 계속 돌 수 있음 → MariaDB 의 SET STATEMENT
    //     max_statement_time 으로 서버측에서도 cancel.
    //   - 기본 100s (Express 110s 보다 안쪽). 환경변수로 조정 가능.
    //   - 100s 를 넘으면 ER_QUERY_TIMEOUT 또는 ER_STATEMENT_TIMEOUT 으로
    //     던져지므로 db_execute_failed 로 정확히 로깅됨.
    const DB_QUERY_TIMEOUT_MS = parseInt(process.env.BUILDER_DB_QUERY_TIMEOUT_MS || '100000', 10);
    const dbStart = Date.now();
    log.stage('db_execute_start', {
      sql_preview: sql.substring(0, 300),
      sql_length: sql.length,
      param_count: finalParams.length,
      gpt_status: gptStatus,
      db_query_timeout_ms: DB_QUERY_TIMEOUT_MS,
      // [PR #208] 전체 SQL 을 인라인 로그로 남김 — final_sql_analysis 와 db_execute_start
      //   두 stage 에서 동일한 SQL 을 남겨야 "DB 가 실제로 실행한 SQL" 을 확실히 특정 가능.
      final_sql: sql,
      final_params: finalParams,
    });
    let rows;
    let dbTimedOut = false;
    try {
      // MariaDB: SET STATEMENT max_statement_time=<초> FOR <SQL>
      // mysql2 query 옵션 timeout: 클라이언트 cancel (서버 cancel 은 위 SET 으로)
      const timeoutSec = Math.ceil(DB_QUERY_TIMEOUT_MS / 1000);
      const wrappedSql = `SET STATEMENT max_statement_time=${timeoutSec} FOR ${sql}`;
      const result = finalParams.length > 0
        ? await pool.query({ sql: wrappedSql, timeout: DB_QUERY_TIMEOUT_MS }, finalParams)
        : await pool.query({ sql: wrappedSql, timeout: DB_QUERY_TIMEOUT_MS });
      rows = result[0];
    } catch (dbErr) {
      const dbElapsed = Date.now() - dbStart;
      // MariaDB ER_STATEMENT_TIMEOUT(1969) / mysql2 timeout(PROTOCOL_SEQUENCE_TIMEOUT)
      const code = dbErr?.code || '';
      const errno = dbErr?.errno || 0;
      dbTimedOut = (
        code === 'PROTOCOL_SEQUENCE_TIMEOUT' ||
        errno === 1969 ||  // ER_STATEMENT_TIMEOUT
        /max_statement_time|query.*timeout|statement.*timeout/i.test(String(dbErr?.message || ''))
      );
      log.error(dbTimedOut ? 'db_query_timeout' : 'db_execute_failed', dbErr, {
        db_elapsed_ms: dbElapsed,
        db_query_timeout_ms: DB_QUERY_TIMEOUT_MS,
        sql_preview: sql.substring(0, 300),
        sql_length: sql.length,
        error_code: code,
        errno,
        sql_state: dbErr?.sqlState,
      });
      // DB 쿼리 timeout 은 명시적 504 + JSON 으로 응답 → 프론트가 정확한 메시지 표시 가능
      if (dbTimedOut) {
        const msg = `DB 조회 시간이 초과되었습니다 (${Math.round(dbElapsed/1000)}초, 한도 ${timeoutSec}초). ` +
                    `조회 기간을 좁히거나 차원 수를 줄여서 재시도해 주세요.`;
        log.stage('response_sent', {
          db_elapsed_ms: dbElapsed,
          db_timed_out: true,
          http_status: 504,
          delivered: !req.destroyed && !res.writableEnded,
        });
        if (!res.headersSent && !res.writableEnded) {
          return res.status(504).json({
            error: msg,
            error_type: 'db_query_timeout',
            db_elapsed_ms: dbElapsed,
            db_query_timeout_ms: DB_QUERY_TIMEOUT_MS,
            requestId: log.requestId,
          });
        }
        return; // 이미 응답 끊김 — 추가 처리 불필요
      }
      throw dbErr; // 다른 에러는 기존 outer catch 로 전파
    }
    const dbStageMs = Date.now() - dbStart;
    console.log(`[DBStage] SQL 실행 완료: ${dbStageMs}ms, rows=${rows.length}`);
    log.stage('db_execute_done', {
      row_count: rows.length,
      db_elapsed_ms: dbStageMs,
    });

    // ─── [2026-06-30 PR #197] Slow SQL 자동 EXPLAIN 로깅 ───────────────────
    //   (사용자 요청 #2, #3)
    //   - DB 실행이 BUILDER_EXPLAIN_SLOW_MS (기본 30000ms = 30s) 이상 걸린 경우
    //     EXPLAIN 결과를 자동으로 로그에 기록 → 운영에서 즉시 원인 진단 가능.
    //   - EXPLAIN 자체는 매우 빠르고(<1s) 부수효과가 없으므로 응답에 영향 없음.
    //   - 실패하더라도 응답에는 영향 주지 않음 (조용히 무시).
    const EXPLAIN_SLOW_MS = parseInt(process.env.BUILDER_EXPLAIN_SLOW_MS || '30000', 10);
    if (dbStageMs >= EXPLAIN_SLOW_MS) {
      try {
        const explainStart = Date.now();
        const explainSql = `EXPLAIN ${sql}`;
        const [explainRows] = finalParams.length > 0
          ? await pool.query(explainSql, finalParams)
          : await pool.query(explainSql);
        const explainElapsed = Date.now() - explainStart;
        log.stage('db_explain_slow', {
          db_elapsed_ms: dbStageMs,
          explain_elapsed_ms: explainElapsed,
          explain_rows: explainRows,
          sql_length: sql.length,
          threshold_ms: EXPLAIN_SLOW_MS,
        });
      } catch (explainErr) {
        log.error('db_explain_failed', explainErr, { db_elapsed_ms: dbStageMs });
      }
    }

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

    // 실행 시간 계산
    const startTime = Date.now();
    // (이미 위에서 쿼리 실행 완료됨, execTime은 대략적 값)

    // 히스토리 자동 저장 (비동기, 실패해도 응답에 영향 없음)
    const histUserId = req.session?.user?.id || null;
    const activeDomain = await getActiveDomain(req);
    const savedId = saveBuilderHistory(histUserId, fields, conditions, group_by, order_by, order_dir, limitStr, prompt, sql, clean.length, 0, 'SUCCESS', null, history_id || null, activeDomain)
      .then(id => {
        log.stage('history_save_done', { history_id: id || null });
        return id;
      })
      .catch(e => {
        console.error('[Builder History] 저장 실패:', e.message);
        log.error('history_save_failed', e);
        return null;
      });

    // 비교모드일 때 compare_info 포함
    const hid = await savedId;
    // [2026-06-15] 결과 즐겨찾기 별 동기화를 위해 저장된 이력의 is_bookmarked 값을 함께 반환
    //   - 기존 이력 재실행 시(history_id 가 있을 때) 이미 즐겨찾기였다면 별이 채워진 상태로 보여야 함
    //   - 신규 이력이면 0 (미등록)
    let isBookmarked = 0;
    if (hid) {
      try {
        const [bmRows] = await pool.query('SELECT is_bookmarked FROM builder_query_history WHERE id=? LIMIT 1', [hid]);
        isBookmarked = bmRows.length > 0 ? (bmRows[0].is_bookmarked ? 1 : 0) : 0;
      } catch (e) { /* 조회 실패는 무시 — 프론트가 캐시로 폴백 */ }
    }
    // [2026-06-24] 응답 SQL 에 prepared statement 의 `?` 플레이스홀더를 실제 값으로 인라인
    //   - 사용자가 '생성된 SQL' 영역에서 본 SQL 을 그대로 '수정 SQL 실행' 으로 재실행할 수 있어야 함
    //   - 인라인하지 않으면 `?` 가 남아 ER_PARSE_ERROR 발생
    //   - SQL injection 위험 없음: 서버 내부에서 검증된 값(날짜/조건 등)만 인라인,
    //     문자열은 single-quote escape, 숫자/null 만 허용
    let sqlForResponse = sql;
    if (finalParams && finalParams.length > 0) {
      let paramIdx = 0;
      sqlForResponse = sql.replace(/\?/g, () => {
        if (paramIdx >= finalParams.length) return '?'; // 안전망: 파라미터 부족 시 원본 유지
        const v = finalParams[paramIdx++];
        if (v === null || v === undefined) return 'NULL';
        if (typeof v === 'number') return String(v);
        if (typeof v === 'boolean') return v ? '1' : '0';
        return `'${String(v).replace(/'/g, "''")}'`;
      });
    }
    const responseObj = { success: true, sql: sqlForResponse, columns: cols, rows: clean, row_count: clean.length, chart, history_id: hid || null, is_bookmarked: isBookmarked };
    // [2026-06-29] GPT 보완 상태를 프론트에 알림 (사용자에게 안내 가능)
    if (gptStatus) {
      responseObj.gpt_status = gptStatus;
      if (gptErrorMessage) responseObj.gpt_message = gptErrorMessage;
    }
    // [2026-06-29] 단계별 처리 시간 (디버깅/관제용)
    // [2026-07-01 PR #208] stage_timing_breakdown 추가 — GPT vs DB 병목 명확 구분
    responseObj.timing = {
      prompt_stage_ms: promptStageMs,
      llm_stage_ms: llmElapsedMs,
      db_stage_ms: dbStageMs,
      // 병목 판정 (프론트 배너에서 활용 가능)
      bottleneck:
        llmTimedOut ? 'gpt_timeout' :
        dbStageMs >= 60000 ? 'db_slow' :
        llmElapsedMs >= 30000 ? 'gpt_slow' :
        'normal',
    };
    // [2026-06-29 → 2026-07-01 PR #208] 사용자 요청 #2 — prompt_reflected 판정 강화
    //   기존: gptStatus === 'rule_based' || 'applied' → 무조건 true
    //   신규:
    //     1) gptStatus 가 실패(timeout/error/metric_loss/skipped) → prompt_reflected=false
    //     2) 성공이더라도 사용자가 명시적으로 요구한 컬럼(증가율/차이/월별)이
    //        결과에 반영 안 됐으면 → prompt_reflected=false, partial_reflected=true
    //        (일부만 반영) 또는 partial_reflected=false (전무)
    //     3) 사용자 요구가 명시적이지 않으면 (예: "매출 알려줘") 기존 로직 유지
    if (needGpt) {
      const gptTechSuccess = (gptStatus === 'rule_based' || gptStatus === 'applied');
      // intent 판정 결과가 있고 명시적 요구사항이 존재하는 경우 → 그것으로 override
      if (intentVerification && intentVerification.required_intents.length > 0) {
        // 실제 실행된 결과 컬럼(cols) 이 있으면 그것도 병행 검증
        // (SQL alias 는 quote 처리 등으로 놓칠 수 있으므로 실 result column 이 더 확실)
        let colsClassify = { has_growth_column: false, has_diff_column: false, month_alias_count: 0 };
        if (cols && cols.length > 0) {
          colsClassify = classifyResultColumns(cols);
        }
        // SQL alias 판정 or 실제 결과 컬럼 판정 중 하나라도 성공한 경우 met 으로 간주
        const finalMet = [];
        const promptIntentForResp = detectPromptIntent(prompt);
        if (promptIntentForResp.requires_growth_column && (intentVerification.result_column_flags.has_growth_column || colsClassify.has_growth_column)) finalMet.push('growth_column');
        if (promptIntentForResp.requires_diff_column && (intentVerification.result_column_flags.has_diff_column || colsClassify.has_diff_column)) finalMet.push('diff_column');
        if (promptIntentForResp.requires_multi_month_columns && (intentVerification.result_column_flags.month_alias_count >= 2 || colsClassify.month_alias_count >= 2)) finalMet.push('multi_month_columns');
        const finalMissing = intentVerification.required_intents.filter(r => !finalMet.includes(r));
        const strictReflected = gptTechSuccess && finalMissing.length === 0;
        const partialReflected = gptTechSuccess && finalMet.length > 0 && finalMissing.length > 0;
        responseObj.prompt_reflected = strictReflected;
        responseObj.partial_reflected = partialReflected;
        responseObj.reflection_details = {
          gpt_status: gptStatus,
          gpt_tech_success: gptTechSuccess,
          required_intents: intentVerification.required_intents,
          met_intents: finalMet,
          missing_intents: finalMissing,
          sql_column_flags: intentVerification.result_column_flags,
          result_column_flags: colsClassify,
          actual_result_columns: cols || [],
        };
        // 사용자에게 안내 (gpt_message 가 없거나 성공 상태일 때)
        if (!strictReflected && !gptErrorMessage) {
          if (partialReflected) {
            responseObj.gpt_message = `요청하신 컬럼 중 일부만 반영되었습니다 (누락: ${finalMissing.join(', ')}). 프롬프트를 좀 더 구체적으로 재입력해 주세요.`;
          } else {
            responseObj.gpt_message = `요청하신 "${finalMissing.join(', ')}" 컬럼이 결과에 반영되지 않았습니다. 프롬프트를 다시 확인해 주세요.`;
          }
        }
      } else {
        // 명시적 intent 없음 → 기존 로직
        responseObj.prompt_reflected = gptTechSuccess;
        responseObj.partial_reflected = false;
      }
      if (ruleDiagnostics) responseObj.rule_diagnostics = ruleDiagnostics;
    }
    // 응답에 requestId 포함 (Nginx 매칭용)
    responseObj.requestId = log.requestId;
    if (hasCompare && measureFields.length > 0) {
      // dimFields, joinDimFields는 비교모드 블록 내 변수 → 여기서 재계산
      const allDimAliases = fields.filter(f => {
        const a = f.aggregate;
        return (!a || a === '') && !['CALMONTH', 'CALDAY'].includes(f.column);
      }).map(f => f.alias || f.column);
      const compareDimAliases = (Array.isArray(compare_dims) ? compare_dims : [])
        .filter(d => validCols.has(d))
        .map(d => {
          const fld = fields.find(f => f.column === d);
          return fld ? (fld.alias || d) : d;
        });
      responseObj.compare_info = {
        compare_dims: compareDimAliases.length > 0 ? compareDimAliases : allDimAliases,
        all_dims: allDimAliases,
        mode: compare_mom ? '전월대비' : '전년대비',
      };
    }
    // ─── [2026-06-30 PR #198 → 2026-07-01 PR #208] 응답 전 클라이언트 연결 상태 점검 ──────
    //   (사용자 요청 #4/#5 — delivered=false 원인 구분 강화)
    //   구분:
    //       client_timeout         : 프론트 fetch abort (req.aborted + 빠른 close)
    //       proxy_timeout          : Nginx/게이트웨이가 먼저 끊음 (응답 시간 > 임계값)
    //       socket_writable_ended  : socket 이 이미 writable 아님 (res.writableEnded=true 이지만 데이터 미전송)
    //       socket_destroyed       : req.destroyed=true (하위 소켓 파괴)
    //       response_delivery_failed: 그 외 정상 close 가 아닌 미상의 실패
    //       null                   : 정상 전달
    //   PR #208: 판정에 필요한 원 신호(res_writable_ended, req_destroyed, headers_sent) 를
    //     로그에 함께 남겨서 사후 분석 가능하게 함.
    const totalElapsedMs = Date.now() - log.t0;
    const resWritableEnded = !!res.writableEnded;
    const reqDestroyed = !!req.destroyed;
    const resHeadersSent = !!res.headersSent;
    // [2026-07-01 PR #208] delivered/stillConnected 판정 완화 (오탐 방지)
    //   - 이전 로직: `!clientAborted && !req.destroyed && !res.writableEnded` 를 모두 만족해야 stillConnected=true
    //   - 문제: keep-alive 재사용 준비 상태에서 req.destroyed=true 가 될 수 있어
    //     실제 응답은 성공했는데도 delivery_failure_reason 이 잘못 잡힘 (sandbox curl 재현 확인).
    //   - 신규 로직: 유일하게 신뢰할 수 있는 실패 신호는 clientAborted (req 'close' 이벤트가
    //     writableEnded=false 상태에서 온 것) + res.writableEnded=true 상태에서 res.destroyed=true.
    //   - req.destroyed 만으로는 실패로 확정하지 않고, 원 신호만 로그에 남김.
    const resDestroyed = !!res.destroyed;
    const isRealDeliveryFailure = clientAborted || (!resHeadersSent && resDestroyed);
    const stillConnected = !isRealDeliveryFailure;

    // delivered=false 일 때 원인 추정
    let deliveryFailureReason = null;
    if (isRealDeliveryFailure) {
      const NGINX_PROXY_TIMEOUT_MS = parseInt(process.env.BUILDER_NGINX_PROXY_TIMEOUT_MS || '120000', 10);
      // 임계 판정: Nginx timeout (기본 120s) 이상이면 proxy_timeout 우선
      if (totalElapsedMs >= NGINX_PROXY_TIMEOUT_MS - 5000) {
        deliveryFailureReason = 'proxy_timeout';
      } else if (clientAborted) {
        deliveryFailureReason = 'client_timeout';
      } else if (resDestroyed) {
        deliveryFailureReason = 'response_socket_destroyed';
      } else {
        deliveryFailureReason = 'response_delivery_failed';
      }
    }

    // [PR #208] response_sent 로그에 강화된 prompt_reflected + timing breakdown 반영
    const otherMs = Math.max(0, totalElapsedMs - dbStageMs - llmElapsedMs - promptStageMs);
    log.stage('response_sent', {
      row_count: clean.length,
      column_count: cols.length,
      columns: cols,
      gpt_status: gptStatus,
      // 강화된 prompt_reflected: responseObj 에서 그대로 반사 (intent 검증 반영)
      prompt_reflected: needGpt ? (responseObj.prompt_reflected ?? null) : null,
      partial_reflected: needGpt ? (responseObj.partial_reflected ?? false) : null,
      missing_intents: needGpt ? (responseObj.reflection_details?.missing_intents || []) : null,
      met_intents: needGpt ? (responseObj.reflection_details?.met_intents || []) : null,
      db_stage_ms: dbStageMs,
      llm_stage_ms: llmElapsedMs,
      prompt_stage_ms: promptStageMs,
      other_stage_ms: otherMs,
      total_elapsed_ms: totalElapsedMs,
      // 병목 판정 (사용자 요청 #4: GPT/DB timeout 원인 명확화)
      timing_bottleneck:
        llmTimedOut ? 'gpt_timeout' :
        dbStageMs >= 60000 ? 'db_slow' :
        llmElapsedMs >= 30000 ? 'gpt_slow' :
        'normal',
      llm_timed_out: llmTimedOut,
      client_aborted: clientAborted,
      delivered: stillConnected,
      delivery_failure_reason: deliveryFailureReason,
    });
    if (!stillConnected) {
      // 백엔드 작업은 성공했지만 사용자는 받지 못한 케이스 — 별도 식별용 로그
      log.error('response_failed', new Error(`response built but ${deliveryFailureReason || 'unknown'}`), {
        db_stage_ms: dbStageMs,
        llm_stage_ms: llmElapsedMs,
        total_elapsed_ms: totalElapsedMs,
        row_count: clean.length,
        column_count: cols.length,
        reason: deliveryFailureReason || 'unknown',
        client_aborted: clientAborted,
        // [PR #208] 원 신호를 함께 남김 (사후 분석용)
        res_writable_ended: resWritableEnded,
        req_destroyed: reqDestroyed,
        res_headers_sent: resHeadersSent,
        gpt_status: gptStatus,
        timing_bottleneck:
          llmTimedOut ? 'gpt_timeout' :
          dbStageMs >= 60000 ? 'db_slow' :
          llmElapsedMs >= 30000 ? 'gpt_slow' :
          'normal',
        // [PR #208] 원 시그널 (오탐 진단용)
        raw_signals: {
          res_writable_ended: resWritableEnded,
          req_destroyed: reqDestroyed,
          res_destroyed: resDestroyed,
          res_headers_sent: resHeadersSent,
        },
      });
      // 그래도 res.json 은 안전하게 시도(Express 가 내부적으로 무시)
      try { res.json(responseObj); } catch (_) { /* 이미 끊긴 소켓 — 무시 */ }
    } else {
      res.json(responseObj);
    }
  } catch (err) {
    console.error('[Builder] query error:', err.message);
    log.error('unexpected_error', err, {
      client_aborted: clientAborted,
    });
    // 실패 이력도 저장
    const histUserId = req.session?.user?.id || null;
    const activeDomain = await getActiveDomain(req);
    saveBuilderHistory(histUserId, fields, conditions, group_by, order_by, order_dir, limitStr, prompt, null, 0, 0, 'FAILED', err.message, null, activeDomain)
      .catch(e => console.error('[Builder History] 실패이력 저장 실패:', e.message));
    res.status(500).json({ error: `DB 오류: ${err.message}`, sql: '', requestId: log.requestId });
  }
});

// ============================================================
// POST /api/builder/execute-sql - 사용자가 직접 편집한 SQL 실행
// ------------------------------------------------------------
// 보안 가드:
//  1) 로그인 필수 (req.session.user)
//  2) SELECT 문만 허용 (DDL/DML 키워드 차단)
//  3) 다중 statement 차단 (세미콜론으로 분리되는 추가 문장 거부)
//  4) 테이블 화이트리스트: bw_profitability_data 만 허용
//  5) LIMIT 강제 주입/캡 (safeLimit = min(요청값, 5000))
//  6) 차트 자동 판별 결과 포함 → 기존 결과 영역에 동일하게 렌더링 가능
// ============================================================
app.post('/api/builder/execute-sql', async (req, res) => {
  // 1) 인증
  if (!req.session?.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }

  const { sql: rawSql, limit: limitStr } = req.body || {};

  if (!rawSql || typeof rawSql !== 'string' || !rawSql.trim()) {
    return res.status(400).json({ error: 'SQL이 비어 있습니다.' });
  }

  // 정규화: 좌우 공백 + 끝 세미콜론 제거
  let sql = rawSql.trim();
  // 라인 주석(--) / 블록 주석(/* */) 제거 — 우회 시도 방지
  const sqlNoComment = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n\r]*/g, ' ');

  // 2) 다중 statement 차단 (끝 세미콜론은 허용 후 제거)
  const trimmedNoSemicolon = sqlNoComment.replace(/;\s*$/, '');
  if (trimmedNoSemicolon.includes(';')) {
    return res.status(400).json({ error: '다중 SQL statement는 허용되지 않습니다. 한 번에 하나의 SELECT 문만 실행할 수 있습니다.' });
  }
  // 실제 실행할 SQL 에서도 끝 세미콜론 제거
  sql = sql.replace(/;\s*$/, '');

  // 3) SELECT-only 검증 (WITH 도 차단 — 단순화)
  if (!/^\s*SELECT\b/i.test(sqlNoComment)) {
    return res.status(400).json({ error: 'SELECT 문만 실행 가능합니다.' });
  }

  // 4) 금지 키워드 블랙리스트
  const forbiddenPattern = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|RENAME|REPLACE|MERGE|CALL|EXEC|EXECUTE|HANDLER|LOCK|UNLOCK|SET\s+@|LOAD_FILE|INTO\s+OUTFILE|INTO\s+DUMPFILE|SLEEP\s*\(|BENCHMARK\s*\()\b/i;
  const forbiddenMatch = sqlNoComment.match(forbiddenPattern);
  if (forbiddenMatch) {
    return res.status(400).json({ error: `허용되지 않는 키워드가 포함되어 있습니다: ${forbiddenMatch[0].trim()}` });
  }

  // 5) 테이블 화이트리스트: bw_profitability_data 만 허용
  if (!/\bbw_profitability_data\b/i.test(sqlNoComment)) {
    return res.status(400).json({ error: '허용된 테이블(bw_profitability_data)만 사용할 수 있습니다.' });
  }
  // information_schema / mysql 등 시스템 DB 접근 차단
  if (/\b(information_schema|mysql|performance_schema|sys)\b/i.test(sqlNoComment)) {
    return res.status(400).json({ error: '시스템 스키마(information_schema/mysql 등) 접근은 허용되지 않습니다.' });
  }

  // 6) LIMIT 강제 주입/캡
  const safeLimit = Math.min(parseInt(limitStr) || 1000, 5000);
  if (/\bLIMIT\b/i.test(sql)) {
    // 기존 LIMIT 값을 safeLimit 으로 덮어쓰기 (OFFSET 형태 포함)
    sql = sql.replace(/\bLIMIT\s+\d+(\s*,\s*\d+)?/i, `LIMIT ${safeLimit}`)
             .replace(/\bLIMIT\s+\d+\s+OFFSET\s+\d+/i, `LIMIT ${safeLimit}`);
  } else {
    sql = `${sql} LIMIT ${safeLimit}`;
  }

  // 7) 실행
  try {
    const t0 = Date.now();
    const [rows] = await pool.query(sql);
    const execTime = Date.now() - t0;

    // 컬럼 추출: 빈 결과 대비 information_schema 대신 첫 행 키 사용
    const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

    // BigInt → Number 변환 (JSON serialization 호환)
    const clean = rows.map(r => {
      const o = {};
      for (const k of Object.keys(r)) {
        const v = r[k];
        o[k] = typeof v === 'bigint' ? Number(v) : v;
      }
      return o;
    });

    // 차트 자동 판별 (기존 빌더와 동일)
    const chart = builderSuggestChart(cols, clean.length);

    console.log(`[Builder] 사용자 SQL 실행 성공: ${clean.length}행, ${execTime}ms, user=${req.session.user.user_id}`);

    res.json({
      success: true,
      sql,
      columns: cols,
      rows: clean,
      row_count: clean.length,
      chart,
      exec_time_ms: execTime,
      edited: true
    });
  } catch (err) {
    console.error('[Builder] 사용자 SQL 실행 오류:', err.message);
    res.status(500).json({
      error: `SQL 실행 오류: ${err.message}`,
      sql,
      code: err.code || null,
      sqlState: err.sqlState || null
    });
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
// [2026-07-01 PR #208] Builder — Prompt intent 감지 & 결과 SQL 컬럼 검증 헬퍼
// ============================================================
// 사용자 요청: "GPT 적용 성공/규칙 기반 성공"의 판정 기준을 강화하려면
//   1) 사용자가 프롬프트에서 무엇을 요구했는지 (expected)
//   2) 실제 최종 SQL 이 어떤 alias 를 만들었는지 (actual)
// 두 축을 비교해야 하므로 아래 두 헬퍼를 사용한다.
//
//  - detectPromptIntent(prompt) → { has_growth, has_diff, has_month_compare, months, requires_growth_column, requires_diff_column, requires_multi_month_columns }
//  - extractSqlColumnAliases(sql) → [{ alias, has_case_when_calmonth }, ...]
//  - verifyPromptReflected(intent, aliases) → { prompt_reflected, partial_reflected, expected_columns, actual_columns, missing }
//
// 규칙(간단·안전 위주):
//   - 프롬프트에 "증가율/성장률/증감률/상승률/하락률/%/percent" → requires_growth_column=true
//   - 프롬프트에 "차이/차액/증감액/gap" → requires_diff_column=true
//   - 프롬프트에 "N월" 이 2개 이상, 또는 "대비/vs/비교" 가 있으면 requires_multi_month_columns=true
//
// alias 는 `AS '한글이름'` 또는 `AS \`한글이름\`` 또는 `AS 한글이름` 패턴에서 추출.
// (컬럼명이 한글이면 quote 로 감싸는 게 표준. Quote 없는 alias 도 fallback 처리.)
function detectPromptIntent(prompt) {
  const text = String(prompt || '').trim();
  if (!text) {
    return {
      has_prompt: false,
      has_growth: false,
      has_diff: false,
      has_month_compare: false,
      months: [],
      requires_growth_column: false,
      requires_diff_column: false,
      requires_multi_month_columns: false,
    };
  }
  const has_growth = /증가율|성장률|증감률|상승률|하락률|%|퍼센트|percent/i.test(text);
  const has_diff = /차이|차액|증감액|증감|gap|차\b/i.test(text);
  const compareKw = /대비|비교|vs\b|늘었|줄었|증가|감소|얼마나|지난달|저번달|이전\s*(월|달)|전월|전년|작년|MoM|YoY|Y\/Y|m\/m/i.test(text);
  // 프롬프트에서 "3월" 같은 월 표현 추출 (중복 제거)
  const monthMatches = [...text.matchAll(/(\d{1,2})\s*월/g)].map(m => parseInt(m[1], 10));
  const months = [...new Set(monthMatches)].filter(m => m >= 1 && m <= 12);
  // "N월 대비" 만 있어도 (예: "3월 대비 증가율") 다른 월 컬럼이 필요하므로 multi_month 로 간주
  const requires_multi_month_columns = months.length >= 2 || (months.length >= 1 && compareKw) || compareKw;
  return {
    has_prompt: true,
    has_growth,
    has_diff,
    has_month_compare: compareKw,
    months,
    requires_growth_column: has_growth,
    requires_diff_column: has_diff,
    requires_multi_month_columns,
  };
}

// SQL 문자열에서 "AS ..." alias 를 추출.
//   - `AS 'foo'`   → foo
//   - `AS "foo"`   → foo
//   - `AS \`foo\`` → foo
//   - `AS foo`     → foo   (한글/영문 식별자, 공백/특수기호 이전까지)
// alias 안의 CASE WHEN CALMONTH 유무는 alias 를 정의하는 SELECT 표현식에 나오는지 별도 판정.
function extractSqlColumnAliases(sql) {
  const out = [];
  if (!sql || typeof sql !== 'string') return out;
  // 우선 quote 로 감싼 alias 추출
  const patterns = [
    /AS\s+'([^']+)'/gi,
    /AS\s+"([^"]+)"/gi,
    /AS\s+`([^`]+)`/gi,
  ];
  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(sql)) !== null) {
      const a = (m[1] || '').trim();
      if (a && !seen.has(a)) {
        seen.add(a);
        out.push(a);
      }
    }
  }
  // Quote 없는 alias fallback (한글/영문/숫자/(), 공백/괄호가 나오기 전까지)
  const bareRe = /AS\s+([A-Za-z_\uac00-\ud7a3][A-Za-z0-9_\uac00-\ud7a3()%\-]{0,80})/gi;
  let bm;
  while ((bm = bareRe.exec(sql)) !== null) {
    const a = (bm[1] || '').trim();
    // quote 안에 있으면 이미 처리됨. 단순히 seen 만 체크.
    if (a && !seen.has(a)) {
      // AS 뒤가 SELECT 서브쿼리 alias 인 경우 컬럼 alias 가 아닐 수 있으니 얕게 필터
      if (!/^(SELECT|FROM|WHERE|GROUP|ORDER|LIMIT)$/i.test(a)) {
        seen.add(a);
        out.push(a);
      }
    }
  }
  return out;
}

// 실제 alias 리스트에서 "증가율" / "차이" / "월비교" 유형 컬럼이 있는지 판정.
// (한글 서비스라 한글 키워드 위주로 판정 — 영문 alias 도 병렬로 인정)
function classifyResultColumns(aliases) {
  const has_growth_column = aliases.some(a =>
    /증가율|성장률|증감률|상승률|하락률|growth|%/i.test(a)
  );
  const has_diff_column = aliases.some(a =>
    /(차이|차액|증감액|차\)|증감\)|gap|diff)/i.test(a)
  );
  // "3월", "4월" 같이 월이 포함된 alias 개수
  const monthAliasCount = aliases.filter(a => /(\d{1,2}\s*월|\d{4}\s*[-/]?\s*\d{1,2}|\d{6})/.test(a)).length;
  return { has_growth_column, has_diff_column, month_alias_count: monthAliasCount };
}

// 사용자 의도(intent) vs 실제 SQL 결과 컬럼(classify) 비교 → prompt_reflected/partial_reflected 산출.
//   prompt_reflected=true : 요구된 컬럼이 모두 존재
//   partial_reflected=true : 요구된 컬럼 중 일부만 존재 (하나 이상, 그러나 모두는 아님)
//   prompt_reflected=false : 요구는 있으나 하나도 반영 안 됨
// intent 가 아무 것도 요구하지 않는 경우 (예: 단순 조회 프롬프트) → prompt_reflected=null (기존 로직 유지)
function verifyPromptReflected(intent, classify, aliases) {
  const required = [];
  const met = [];
  if (intent.requires_growth_column) {
    required.push('growth_column');
    if (classify.has_growth_column) met.push('growth_column');
  }
  if (intent.requires_diff_column) {
    required.push('diff_column');
    if (classify.has_diff_column) met.push('diff_column');
  }
  if (intent.requires_multi_month_columns) {
    required.push('multi_month_columns');
    if (classify.month_alias_count >= 2) met.push('multi_month_columns');
  }
  const missing = required.filter(r => !met.includes(r));
  let prompt_reflected = null;
  let partial_reflected = false;
  if (required.length === 0) {
    // 명시적 요구사항 없음 → 판정 유보 (호출부에서 기존 로직 유지)
    prompt_reflected = null;
    partial_reflected = false;
  } else if (missing.length === 0) {
    prompt_reflected = true;
    partial_reflected = false;
  } else if (met.length > 0) {
    prompt_reflected = false;
    partial_reflected = true;
  } else {
    prompt_reflected = false;
    partial_reflected = false;
  }
  return {
    prompt_reflected,
    partial_reflected,
    required_intents: required,
    met_intents: met,
    missing_intents: missing,
    actual_columns: aliases,
    result_column_flags: classify,
  };
}

// ============================================================
// 빌더 히스토리 저장 헬퍼 함수
// ============================================================
async function saveBuilderHistory(userId, fields, conditions, groupBy, orderBy, orderDir, limitVal, prompt, sql, rowCount, execTime, status, errorMsg, existingHistoryId, domainCode) {
  // 제목 자동 생성: 필드 alias 기반 (alias에 이미 집계함수가 포함되어 있으므로 그대로 사용)
  const fieldLabels = (fields || []).map(f => f.alias || f.column);
  let title = fieldLabels.slice(0, 3).join(', ');
  if (fieldLabels.length > 3) title += ` 외 ${fieldLabels.length - 3}개`;
  if (conditions && conditions.length > 0) {
    const condLabels = conditions.filter(c => c.column).map(c => c.column).slice(0, 2);
    if (condLabels.length > 0) title += ` (${condLabels.join(',')} 필터)`;
  }
  if (!title) title = 'Untitled Query';

  // 기존 이력 ID가 전달된 경우 → UPDATE (재실행 시 중복 방지)
  if (existingHistoryId) {
    const [existing] = await pool.query(
      'SELECT id FROM builder_query_history WHERE id = ? AND user_id = ?',
      [existingHistoryId, userId]
    );
    if (existing.length > 0) {
      await pool.query(
        `UPDATE builder_query_history SET title=?, fields_json=?, conditions_json=?, group_by_json=?, order_by=?, order_dir=?, limit_val=?, prompt=?, generated_sql=?, row_count=?, execution_time_ms=?, status=?, error_message=?, domain_code=?, created_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?`,
        [
          title.substring(0, 200),
          JSON.stringify(fields || []),
          JSON.stringify(conditions || []),
          JSON.stringify(groupBy || []),
          orderBy || null,
          orderDir || 'DESC',
          parseInt(limitVal) || 1000,
          prompt || null,
          sql || null,
          rowCount || 0,
          execTime || 0,
          status,
          errorMsg || null,
          domainCode || null,
          existingHistoryId,
          userId,
        ]
      );
      console.log(`[Builder History] 기존 이력 업데이트 완료: id=${existingHistoryId}`);
      return existingHistoryId;
    }
  }

  // 새 이력 INSERT
  const [insertResult] = await pool.query(
    `INSERT INTO builder_query_history (user_id, title, fields_json, conditions_json, group_by_json, order_by, order_dir, limit_val, prompt, generated_sql, row_count, execution_time_ms, status, error_message, domain_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId || null,
      title.substring(0, 200),
      JSON.stringify(fields || []),
      JSON.stringify(conditions || []),
      JSON.stringify(groupBy || []),
      orderBy || null,
      orderDir || 'DESC',
      parseInt(limitVal) || 1000,
      prompt || null,
      sql || null,
      rowCount || 0,
      execTime || 0,
      status,
      errorMsg || null,
      domainCode || null,
    ]
  );
  const newId = insertResult.insertId;
  console.log(`[Builder History] 새 이력 저장: id=${newId}`);

  // 사용자별 최대 50개 유지: 초과분 삭제
  if (userId) {
    await pool.query(
      `DELETE FROM builder_query_history WHERE user_id = ? AND id NOT IN (
         SELECT id FROM (SELECT id FROM builder_query_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50) AS tmp
       )`,
      [userId, userId]
    );
  } else {
    await pool.query(
      `DELETE FROM builder_query_history WHERE user_id IS NULL AND id NOT IN (
         SELECT id FROM (SELECT id FROM builder_query_history WHERE user_id IS NULL ORDER BY created_at DESC LIMIT 50) AS tmp
       )`
    );
  }
  return newId;
}

// ============================================================
// [2026-07-01 PR #209] Admin: requestId 로 저장된 final SQL 조회
// ============================================================
//   사용 케이스:
//     프로덕션에서 사용자가 "화면 SQL 이 base SQL 로 보인다" 신고 → response_delivery_failed
//     인 경우 프론트는 응답을 못 받아 확인 불가. 그러나 서버는 /tmp/nlq-final-sql-<reqid>.sql
//     로 실제 실행한 SQL 을 파일로 저장했음. 이 엔드포인트로 관리자가 즉시 조회 가능.
//
//   응답:
//     200 { requestId, sql, stored_at, size_bytes, source: 'file'|'memory' }
//     404 { error: 'not_found', tried: [...] }
//     403 관리자 아님
//
//   보안: requireAdmin. requestId 는 /^[a-z0-9-]{6,64}$/ 만 허용 (path traversal 방지).
// ============================================================
app.get('/api/admin/final-sql/:requestId', requireAdmin, async (req, res) => {
  const rid = String(req.params.requestId || '');
  if (!/^[a-z0-9-]{6,64}$/i.test(rid)) {
    return res.status(400).json({ error: 'invalid_request_id' });
  }
  const filePath = `/tmp/nlq-final-sql-${rid}.sql`;
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf8');
      return res.json({
        requestId: rid,
        sql: content,
        stored_at: stat.mtime.toISOString(),
        size_bytes: stat.size,
        source: 'file',
        file_path: filePath,
      });
    }
    return res.status(404).json({
      error: 'not_found',
      tried: [filePath],
      hint: 'Final SQL file is written only when gpt_status is "applied" or "rule_based". ' +
            'For older requests, check nlq-server.log for stage="final_sql_analysis" with this requestId.',
    });
  } catch (fsErr) {
    console.error('[Admin] final-sql read error:', fsErr.message);
    return res.status(500).json({ error: 'read_failed', message: fsErr.message });
  }
});

// ============================================================
// API: 빌더 히스토리 조회/삭제 (user_id 기반 필터링)
// ============================================================
app.get('/api/builder/history', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    console.log('[GET /api/builder/history] session user:', JSON.stringify(req.session?.user), '→ userId:', userId);
    const limit = Math.min(parseInt(req.query.limit) || 50, 50);
    const tab = req.query.tab || 'recent'; // recent | bookmarked | shared

    // 로그인하지 않은 사용자에게는 빈 배열 반환 (데이터 유출 방지)
    if (!userId) {
      console.log('[GET /api/builder/history] userId is null/undefined → returning empty array');
      return res.json([]);
    }

    let rows;
    if (tab === 'bookmarked') {
      // 즐겨찾기 탭: 본인의 북마크된 이력만
      [rows] = await pool.query(
        `SELECT id, title, fields_json, conditions_json, group_by_json, order_by, order_dir, limit_val, prompt, generated_sql, row_count, execution_time_ms, status, error_message, is_bookmarked, domain_code, created_at
         FROM builder_query_history WHERE user_id = ? AND is_bookmarked = 1 ORDER BY created_at DESC LIMIT ?`,
        [userId, limit]
      );
    } else if (tab === 'shared') {
      // 보관함 탭: 나에게 공유된 쿼리
      [rows] = await pool.query(
        `SELECT s.id, s.title, s.fields_json, s.conditions_json, s.group_by_json, s.order_by, s.order_dir, s.limit_val, s.prompt, s.generated_sql,
                s.memo, s.is_read, s.from_user_id, u.name AS from_user_name, s.created_at,
                0 AS row_count, 0 AS execution_time_ms, 'SUCCESS' AS status, NULL AS error_message, 0 AS is_bookmarked
         FROM shared_queries s
         LEFT JOIN users u ON u.user_id COLLATE utf8mb4_unicode_ci = s.from_user_id
         WHERE s.to_user_id = ? ORDER BY s.created_at DESC LIMIT ?`,
        [userId, limit]
      );
    } else {
      // 최근이력 탭: 본인의 이력만 (user_id 기반 엄격 필터)
      [rows] = await pool.query(
        `SELECT id, title, fields_json, conditions_json, group_by_json, order_by, order_dir, limit_val, prompt, generated_sql, row_count, execution_time_ms, status, error_message, is_bookmarked, domain_code, created_at
         FROM builder_query_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
        [userId, limit]
      );
    }

    console.log('[GET /api/builder/history] userId:', userId, 'tab:', tab, '→ rows returned:', rows.length);
    const result = rows.map(r => ({
      ...r,
      fields_json: r.fields_json ? JSON.parse(r.fields_json) : [],
      conditions_json: r.conditions_json ? JSON.parse(r.conditions_json) : [],
      group_by_json: r.group_by_json ? JSON.parse(r.group_by_json) : [],
    }));
    res.json(result);
  } catch (err) {
    console.error('[GET /api/builder/history] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/builder/history/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    console.log(`[GET /api/builder/history/${req.params.id}] userId=${userId}`);
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const [rows] = await pool.query('SELECT * FROM builder_query_history WHERE id=? AND user_id=?', [req.params.id, userId]);
    console.log(`[GET /api/builder/history/${req.params.id}] rows found: ${rows.length}`);
    if (rows.length === 0) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    const r = rows[0];
    r.fields_json = r.fields_json ? JSON.parse(r.fields_json) : [];
    r.conditions_json = r.conditions_json ? JSON.parse(r.conditions_json) : [];
    r.group_by_json = r.group_by_json ? JSON.parse(r.group_by_json) : [];
    res.json(r);
  } catch (err) {
    console.error(`[GET /api/builder/history/${req.params.id}] error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/builder/history/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    await pool.query('DELETE FROM builder_query_history WHERE id=? AND user_id=?', [req.params.id, userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/builder/history', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    if (userId) {
      await pool.query('DELETE FROM builder_query_history WHERE user_id = ? OR user_id IS NULL', [userId]);
    } else {
      await pool.query('TRUNCATE TABLE builder_query_history');
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: 북마크 토글
// ------------------------------------------------------------
// [2026-06-15] 권한 분리 강화 — 기존 핸들러는 user_id 검사를 안 해서
//   다른 사용자의 이력 북마크 상태를 바꿀 수 있는 보안 결함이 있었음.
//   이제 본인 소유(owner) 또는 user_id=NULL(레거시 이력, 처음 클릭 시 소유권 귀속) 만 토글 허용.
//   admin 은 어떤 이력이든 토글 가능.
// ============================================================
app.patch('/api/builder/history/:id/bookmark', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const isAdmin = req.session.user.role === 'admin';
    // 현재 상태 + 소유자 조회 후 권한 검증
    const [rows] = await pool.query('SELECT is_bookmarked, user_id FROM builder_query_history WHERE id=?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    const ownerId = rows[0].user_id;
    const isOwner = ownerId && ownerId === userId;
    const isOrphan = !ownerId; // user_id=NULL 인 레거시 이력 — 처음 클릭한 사용자에게 귀속
    if (!isAdmin && !isOwner && !isOrphan) {
      return res.status(403).json({ error: '다른 사용자의 이력은 변경할 수 없습니다.' });
    }
    const newVal = rows[0].is_bookmarked ? 0 : 1;
    await pool.query('UPDATE builder_query_history SET is_bookmarked=?, user_id=COALESCE(user_id,?) WHERE id=?', [newVal, userId, req.params.id]);
    res.json({ success: true, is_bookmarked: newVal });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: 공유하기 — 이력을 다른 사용자에게 공유
// ============================================================
app.post('/api/builder/history/:id/share', async (req, res) => {
  try {
    const fromUserId = req.session?.user?.id;
    if (!fromUserId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const { to_user_ids, memo } = req.body;
    if (!to_user_ids || !Array.isArray(to_user_ids) || to_user_ids.length === 0) {
      return res.status(400).json({ error: '공유 대상 사용자를 선택해주세요.' });
    }

    // 원본 이력 조회
    const [rows] = await pool.query('SELECT * FROM builder_query_history WHERE id=?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    const src = rows[0];

    // 각 대상 사용자에게 공유 레코드 생성 (스냅샷 복사)
    let sharedCount = 0;
    for (const toUserId of to_user_ids) {
      if (toUserId === fromUserId) continue; // 자기 자신 제외
      await pool.query(
        `INSERT INTO shared_queries (history_id, from_user_id, to_user_id, title, fields_json, conditions_json, group_by_json, order_by, order_dir, limit_val, prompt, generated_sql, memo)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          src.id, fromUserId, toUserId, src.title,
          src.fields_json, src.conditions_json, src.group_by_json,
          src.order_by, src.order_dir, src.limit_val,
          src.prompt, src.generated_sql, memo || null,
        ]
      );
      sharedCount++;
    }
    res.json({ success: true, shared_count: sharedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: 보관함 안읽은 공유 개수 (※ :id 라우트보다 먼저 정의)
// ============================================================
app.get('/api/builder/shared/unread/count', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.json({ count: 0 });
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM shared_queries WHERE to_user_id = ? AND is_read = 0',
      [userId]
    );
    res.json({ count: rows[0].cnt });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: 보관함에서 공유 항목 삭제
// ============================================================
app.delete('/api/builder/shared/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    await pool.query('DELETE FROM shared_queries WHERE id=? AND to_user_id=?', [req.params.id, userId]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: 보관함 공유 항목 상세 조회 (복원용)
// ============================================================
app.get('/api/builder/shared/:id', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    const [rows] = await pool.query(
      `SELECT s.*, u.name AS from_user_name FROM shared_queries s LEFT JOIN users u ON u.user_id COLLATE utf8mb4_unicode_ci = s.from_user_id WHERE s.id=? AND s.to_user_id=?`,
      [req.params.id, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: '공유 이력을 찾을 수 없습니다.' });
    const r = rows[0];
    // 읽음 처리
    if (!r.is_read) {
      await pool.query('UPDATE shared_queries SET is_read=1 WHERE id=?', [r.id]);
    }
    r.fields_json = r.fields_json ? JSON.parse(r.fields_json) : [];
    r.conditions_json = r.conditions_json ? JSON.parse(r.conditions_json) : [];
    r.group_by_json = r.group_by_json ? JSON.parse(r.group_by_json) : [];
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// API: 공유용 사용자 목록 (DB LIKE 검색 지원)
//   ?q=검색어 → user_id 또는 name LIKE '%검색어%'
//   q 없으면 전체 목록 반환
// ============================================================
app.get('/api/builder/users', async (req, res) => {
  try {
    const userId = req.session?.user?.id || null;
    const q = (req.query.q || '').trim();

    let sql = `SELECT user_id, name, group_name FROM users WHERE is_active = 1`;
    const params = [];

    // 본인 제외 (로그인 상태일 때만)
    if (userId) {
      sql += ` AND user_id != ?`;
      params.push(userId);
    }

    // 검색어가 있으면 LIKE 조건 추가
    if (q) {
      sql += ` AND (user_id LIKE ? OR name LIKE ?)`;
      params.push(`%${q}%`, `%${q}%`);
    }

    sql += ` ORDER BY name LIMIT 50`;

    const [rows] = await pool.query(sql, params);
    res.json(rows || []);
  } catch (err) {
    console.error('[Builder Users] 사용자 목록 조회 실패:', err.message);
    res.json([]);
  }
});

// ============================================================
// 데이터 업로드 API (Python openpyxl 기반 — xlsx 전용, 추가 적재)
// ============================================================

// ============================================================
// RBAC 관리 API — 역할/메뉴/매핑 관리 (관리자 전용)
// ============================================================

// --- 역할(Role) CRUD ---
// 전체 역할 목록 조회
app.get('/api/admin/roles', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles ORDER BY sort_order, id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 역할 생성
app.post('/api/admin/roles', requireAdmin, async (req, res) => {
  const { role_code, role_name, description, sort_order } = req.body;
  if (!role_code || !role_name) return res.status(400).json({ error: 'role_code, role_name은 필수입니다.' });
  try {
    const [result] = await pool.query(
      'INSERT INTO roles (role_code, role_name, description, sort_order) VALUES (?, ?, ?, ?)',
      [role_code, role_name, description || null, sort_order || 0]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: '이미 존재하는 역할 코드입니다.' });
    res.status(500).json({ error: err.message });
  }
});

// 역할 수정
app.put('/api/admin/roles/:id', requireAdmin, async (req, res) => {
  const { role_name, description, sort_order, is_active } = req.body;
  const updates = [], vals = [];
  if (role_name !== undefined) { updates.push('role_name=?'); vals.push(role_name); }
  if (description !== undefined) { updates.push('description=?'); vals.push(description); }
  if (sort_order !== undefined) { updates.push('sort_order=?'); vals.push(sort_order); }
  if (is_active !== undefined) { updates.push('is_active=?'); vals.push(is_active ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ error: '수정할 필드가 없습니다.' });
  vals.push(req.params.id);
  try {
    await pool.query(`UPDATE roles SET ${updates.join(', ')} WHERE id=?`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 역할 삭제 (admin, user 기본 역할은 삭제 방지)
app.delete('/api/admin/roles/:id', requireAdmin, async (req, res) => {
  try {
    const [role] = await pool.query('SELECT role_code FROM roles WHERE id=?', [req.params.id]);
    if (role.length > 0 && ['admin', 'user'].includes(role[0].role_code)) {
      return res.status(400).json({ error: '기본 역할(admin, user)은 삭제할 수 없습니다.' });
    }
    // 이 역할을 가진 사용자가 있는지 확인
    const [userCheck] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE role_id=?', [req.params.id]);
    if (userCheck[0].cnt > 0) {
      return res.status(400).json({ error: `이 역할을 사용 중인 사용자가 ${userCheck[0].cnt}명 있습니다. 먼저 사용자의 역할을 변경해주세요.` });
    }
    await pool.query('DELETE FROM roles WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 메뉴(Menu) 목록 조회 ---
app.get('/api/admin/menus', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM menus WHERE is_active = 1 ORDER BY sort_order, id');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 역할-메뉴 매핑 관리 ---
// 특정 역할의 메뉴 매핑 조회
app.get('/api/admin/roles/:roleId/menus', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT m.id AS menu_id, m.menu_code, m.menu_name, m.menu_url, m.icon_class, m.sort_order,
             IF(rm.id IS NOT NULL, 1, 0) AS is_mapped
      FROM menus m
      LEFT JOIN role_menus rm ON rm.menu_id = m.id AND rm.role_id = ?
      WHERE m.is_active = 1
      ORDER BY m.sort_order, m.id
    `, [req.params.roleId]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 특정 역할의 메뉴 매핑 저장 (전체 교체 방식)
app.put('/api/admin/roles/:roleId/menus', requireAdmin, async (req, res) => {
  const { menu_ids } = req.body; // [1, 2, 3, ...]
  if (!Array.isArray(menu_ids)) return res.status(400).json({ error: 'menu_ids 배열이 필요합니다.' });
  const roleId = parseInt(req.params.roleId);
  try {
    // 역할 존재 확인
    const [roleCheck] = await pool.query('SELECT id, role_code FROM roles WHERE id=?', [roleId]);
    if (roleCheck.length === 0) return res.status(404).json({ error: '역할을 찾을 수 없습니다.' });

    // 트랜잭션으로 기존 매핑 삭제 → 새 매핑 삽입
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM role_menus WHERE role_id = ?', [roleId]);
      if (menu_ids.length > 0) {
        const values = menu_ids.map(mid => [roleId, parseInt(mid)]);
        await conn.query('INSERT INTO role_menus (role_id, menu_id) VALUES ?', [values]);
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
    console.log(`[RBAC] 역할(${roleCheck[0].role_code}) 메뉴 매핑 갱신: ${menu_ids.length}개 메뉴`);
    res.json({ success: true, mapped_count: menu_ids.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- 사용자 역할(role_id) 변경 API ---
app.put('/api/admin/users/:userId/role', requireAdmin, async (req, res) => {
  const { role_id } = req.body;
  if (!role_id) return res.status(400).json({ error: 'role_id가 필요합니다.' });
  try {
    // 역할 존재 확인 + role_code 가져오기
    const [roleRow] = await pool.query('SELECT id, role_code FROM roles WHERE id=?', [role_id]);
    if (roleRow.length === 0) return res.status(404).json({ error: '역할을 찾을 수 없습니다.' });
    // users 테이블 업데이트 (role_id만 변경 — role 컬럼 제거됨)
    await pool.query(
      'UPDATE users SET role_id=?, updated_at=NOW() WHERE user_id=?',
      [role_id, req.params.userId]
    );
    res.json({ success: true, role_code: roleRow[0].role_code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 관리자 전용 API: 사용자 권한 관리
// ============================================================
// 전체 사용자 목록 (조직도 경로 포함 + RBAC role_id + 업무영역 권한)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.user_id, u.name, u.group_name, u.group_id, u.role_id, u.domain_code, u.is_active,
              COALESCE(r.role_code, 'user') AS role_code, r.role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.id`
    );

    // 업무영역 매핑 일괄 조회 (N+1 방지)
    let baMap = new Map(); // user_id -> [area_code]
    try {
      const [uba] = await pool.query(
        `SELECT uba.user_id, uba.area_code
           FROM sys_aimd_user_areas uba
           JOIN sys_aimd_areas ba ON ba.area_code = uba.area_code
          WHERE ba.is_active = 1`
      );
      uba.forEach(r => {
        if (!baMap.has(r.user_id)) baMap.set(r.user_id, []);
        baMap.get(r.user_id).push(r.area_code);
      });
    } catch(e) { console.error('[BA] users 목록 업무영역 조회 실패:', e.message); }

    // 각 사용자의 조직도 경로 구성 + 업무영역 병합
    //   ※ 2026-07 옵션 B 이후: admin/일반 구분 없이 sys_aimd_user_areas 매핑을 그대로 사용.
    //     admin 도 부팅 시 백필 마이그레이션으로 활성 area 전체가 매핑되어 있음
    //     (아래 initBusinessAreaTables() 참고). 매핑 자체가 비어 있는 극단적 케이스에만
    //     최소 접근권 PROFITABILITY 폴백.
    const result = [];
    for (const row of rows) {
      let orgPath = '';
      if (row.group_id) {
        try { orgPath = await buildOrgPath(row.group_id); } catch(e) { /* 무시 */ }
      }
      const businessAreas = baMap.get(row.user_id) || ['PROFITABILITY'];
      result.push({ ...row, org_path: orgPath, business_areas: businessAreas });
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 업무영역 마스터 조회 (권한관리 UI에서 체크박스 렌더용) ──
app.get('/api/admin/business-areas', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, area_code, area_name, description, sort_order, is_active
         FROM sys_aimd_areas
        WHERE is_active = 1
        ORDER BY sort_order, id`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 사용자 업무영역 조회 ──
app.get('/api/admin/users/:userId/business-areas', requireAdmin, async (req, res) => {
  try {
    const [ur] = await pool.query(
      `SELECT COALESCE(r.role_code, 'user') AS role_code
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.user_id = ?`, [req.params.userId]);
    if (ur.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });
    const areas = await getUserBusinessAreas(req.params.userId, ur[0].role_code);
    res.json({
      user_id: req.params.userId,
      role_code: ur[0].role_code,
      is_admin: ur[0].role_code === 'admin',
      business_areas: areas,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── 사용자 업무영역 일괄 교체 (bulk set) ──
// body: { business_areas: ['PROFITABILITY', 'MANUFACTURING_COST'] }
// - 2026-07 옵션 B 이후: admin 도 예외 없이 동일하게 sys_aimd_user_areas 에 저장
// - 유효 area_code 화이트리스트 검증
// - 트랜잭션으로 DELETE + INSERT 원자성 보장
app.put('/api/admin/users/:userId/business-areas', requireAdmin, async (req, res) => {
  const { business_areas } = req.body || {};
  if (!Array.isArray(business_areas)) {
    return res.status(400).json({ error: 'business_areas 배열이 필요합니다.' });
  }

  try {
    // 대상 사용자 존재 확인
    //   ※ 2026-07 옵션 B 이후: admin 도 예외 없이 일반 사용자와 동일하게
    //     sys_aimd_user_areas 에 실제 매핑을 저장한다. (이전에는 admin 이면
    //     DELETE/INSERT 를 스킵하고 활성 전체를 그대로 반환했음 → UI/DB 불일치 원인)
    const [ur] = await pool.query(
      `SELECT u.user_id FROM users u WHERE u.user_id = ?`,
      [req.params.userId]
    );
    if (ur.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

    // 유효 area_code 화이트리스트 검증
    const [valid] = await pool.query(
      'SELECT area_code FROM sys_aimd_areas WHERE is_active = 1'
    );
    const validCodes = new Set(valid.map(v => v.area_code));
    const invalid = business_areas.filter(a => !validCodes.has(a));
    if (invalid.length > 0) {
      return res.status(400).json({ error: `유효하지 않은 업무영역: ${invalid.join(', ')}` });
    }

    // 중복 제거
    const uniqueAreas = [...new Set(business_areas)];

    // 트랜잭션: 기존 매핑 삭제 → 새 매핑 삽입
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM sys_aimd_user_areas WHERE user_id = ?', [req.params.userId]);
      if (uniqueAreas.length > 0) {
        const grantedBy = req.session?.user?.id || 'ADMIN';
        const rows = uniqueAreas.map(a => [req.params.userId, a, grantedBy]);
        await conn.query(
          'INSERT INTO sys_aimd_user_areas (user_id, area_code, granted_by) VALUES ?',
          [rows]
        );
      }
      await conn.commit();
      console.log(`[BA] ${req.params.userId} 업무영역 설정: [${uniqueAreas.join(', ')}] by ${req.session?.user?.id}`);
      res.json({ success: true, business_areas: uniqueAreas });
    } catch(e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[BA] PUT /api/admin/users/:userId/business-areas 실패:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 사용자 권한/도메인/활성 수정 (role 변경 시 role_id도 동기화)
app.put('/api/admin/users/:userId', requireAdmin, async (req, res) => {
  const { role, role_id, domain_code, is_active } = req.body;
  const updates = [];
  const vals = [];
  if (role_id !== undefined) {
    // RBAC role_id 변경
    updates.push('role_id=?'); vals.push(role_id);
  } else if (role !== undefined) {
    // role 문자열 → role_id로 변환
    try {
      const [rr] = await pool.query('SELECT id FROM roles WHERE role_code=?', [role]);
      if (rr.length > 0) { updates.push('role_id=?'); vals.push(rr[0].id); }
    } catch(e) {}
  }
  if (domain_code !== undefined) { updates.push('domain_code=?'); vals.push(domain_code); }
  if (is_active !== undefined) { updates.push('is_active=?'); vals.push(is_active ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ error: '수정할 필드가 없습니다.' });
  vals.push(req.params.userId);
  try {
    await pool.query(`UPDATE users SET ${updates.join(', ')}, updated_at=NOW() WHERE user_id=?`, vals);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/data-upload/preview — Python xlsx_preview.py 호출
app.post('/api/data-upload/preview', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '파일이 없습니다.' });

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.xlsx') {
    return res.status(400).json({ error: '.xlsx 파일만 지원됩니다.' });
  }

  // multer는 확장자 없이 해시 파일명으로 저장 → openpyxl이 인식 못함 → .xlsx 확장자 추가
  const origPath = path.join(UPLOAD_DIR, req.file.filename);
  const fullPath = origPath + '.xlsx';
  fs.renameSync(origPath, fullPath);
  const storedName = req.file.filename + '.xlsx';  // filePath로 클라이언트에 전달
  const scriptPath = path.join(import.meta.dirname, 'xlsx_preview.py');

  try {
    console.log(`[Data Upload] Preview 시작 (Python): ${req.file.originalname}`);
    console.time('[Data Upload] preview-python');

    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, fullPath], {
      maxBuffer: 50 * 1024 * 1024,   // 50MB stdout buffer
      timeout: 600000,                // 10분 타임아웃
    });

    if (stderr) console.log('[Data Upload] Python stderr:', stderr);
    console.timeEnd('[Data Upload] preview-python');

    const result = JSON.parse(stdout.trim());
    if (result.error) throw new Error(result.error);

    // 클라이언트에 필요한 필드 추가
    result.fileName = req.file.originalname;
    result.filePath = storedName;  // .xlsx 확장자 포함된 파일명

    console.log(`[Data Upload] Preview 완료: ${result.fileName}, ${result.totalRows}행, 매핑 ${result.mappedCount}/${result.totalExcelCols}컬럼`);

    res.json(result);
  } catch (err) {
    console.error('[Data Upload] Preview error:', err.message);
    res.status(500).json({ error: '파일 분석 실패: ' + err.message });
  }
});

// POST /api/data-upload/apply — Python xlsx_load.py 호출 (추가 적재, DELETE 없음!)
app.post('/api/data-upload/apply', requireAdmin, async (req, res) => {
  const { filePath, fileName, mappedCols } = req.body;
  if (!filePath || !mappedCols || mappedCols.length === 0) {
    return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
  }

  const fullPath = path.join(UPLOAD_DIR, filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(400).json({ error: '업로드된 파일을 찾을 수 없습니다. 다시 업로드해주세요.' });
  }

  const scriptPath = path.join(import.meta.dirname, 'xlsx_load.py');
  const mappedColsJson = JSON.stringify(mappedCols);

  try {
    console.log(`[Data Upload] Apply 시작 (Python): file=${fileName || filePath}, cols=${mappedCols.length}개`);
    console.time('[Data Upload] apply-python');

    const { stdout, stderr } = await execFileAsync('python3', [scriptPath, fullPath, mappedColsJson], {
      maxBuffer: 50 * 1024 * 1024,
      timeout: 1800000,               // 30분 타임아웃 (대용량 적재)
    });

    if (stderr) console.log('[Data Upload] Python stderr:', stderr);
    console.timeEnd('[Data Upload] apply-python');

    // stdout의 마지막 줄이 JSON 결과
    const lines = stdout.trim().split('\n');
    const resultLine = lines[lines.length - 1];
    const result = JSON.parse(resultLine);

    if (result.error) throw new Error(result.error);

    // 임시 파일 삭제
    try { fs.unlinkSync(fullPath); } catch(e) {}

    console.log(`[Data Upload] 적재 완료: 기존 ${result.beforeRows}행 유지, 신규 ${result.insertedRows}/${result.totalExcelRows}행 INSERT, 총 ${result.totalDbRows}행`);

    res.json(result);
  } catch (err) {
    console.error('[Data Upload] Apply error:', err.message);
    res.status(500).json({ error: 'DB 적재 실패: ' + err.message });
  }
});

// report.html 페이지 서빙
app.get('/report', (req, res) => {
  res.sendFile(path.join(import.meta.dirname, 'public', 'report.html'));
});

// ============================================================
// 배치관리 API: SAP RFC → bw_profitability_data 동기화 작업 관리
// ============================================================

// ============================================================
// RBAC 테이블 자동 생성 + 시드 데이터
// ============================================================
// ============================================================
// [2026-06-16] users.password 평문 → SHA-256 일괄 마이그레이션
// ------------------------------------------------------------
// 사용자 요청: 운영 DB 에 평문으로 저장된 사용자들도 SHA-256 해시값으로 일괄 업데이트
//
// 멱등성 보장:
//   - SHA-256 해시는 항상 64자 16진수
//   - DB 의 password 가 64자 16진수가 아닌 행만 평문으로 간주하고 해싱
//   - 여러 번 실행해도 안전 (이미 해시된 행은 건너뜀)
//
// 안전성:
//   - 빈 문자열/null password 는 건드리지 않음
//   - 트랜잭션 없이 행 단위 UPDATE (대규모 lock 방지)
//   - 실패해도 서버 기동 자체는 진행 (best-effort)
// ============================================================
async function migrateUserPasswordsToSha256() {
  try {
    // 1) users 테이블 존재 확인
    const [tbl] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
    );
    if (tbl[0].cnt === 0) {
      console.log('[Migration] users 테이블이 없어 password 마이그레이션 건너뜀');
      return;
    }

    // 2) 평문으로 추정되는 행 조회
    //    - password IS NOT NULL AND password != ''
    //    - LENGTH(password) != 64  OR  password 가 hex 가 아님
    const [rows] = await pool.query(
      `SELECT user_id, password FROM users
       WHERE password IS NOT NULL AND password <> ''
         AND NOT (LENGTH(password) = 64 AND password REGEXP '^[0-9a-fA-F]{64}$')`
    );

    if (rows.length === 0) {
      console.log('[Migration] users.password: 평문 사용자 없음 (모두 이미 SHA-256 해시) ✅');
      return;
    }

    console.log(`[Migration] users.password: 평문 ${rows.length}건 발견 → SHA-256 해싱 시작`);
    let success = 0, fail = 0;
    for (const r of rows) {
      try {
        const hashed = hashPassword(r.password);
        await pool.query('UPDATE users SET password=? WHERE user_id=?', [hashed, r.user_id]);
        success++;
      } catch (e) {
        fail++;
        console.error(`[Migration] user_id=${r.user_id} 해싱 실패:`, e.message);
      }
    }
    console.log(`[Migration] users.password SHA-256 일괄 변환 완료: 성공 ${success} / 실패 ${fail} / 총 ${rows.length}`);
  } catch (e) {
    console.error('[Migration] users.password 마이그레이션 전체 오류 (무시하고 서버 기동 진행):', e.message);
  }
}

async function ensureRbacTables() {
  try {
    // 1) roles 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role_code VARCHAR(30) NOT NULL UNIQUE COMMENT '역할 코드 (예: admin, user, PS 등)',
        role_name VARCHAR(100) NOT NULL COMMENT '역할 표시명',
        description VARCHAR(255) NULL COMMENT '역할 설명',
        sort_order INT DEFAULT 0 COMMENT '정렬순서',
        is_active TINYINT DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_roles_code (role_code),
        INDEX idx_roles_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 역할 테이블'
    `);

    // 2) menus 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS menus (
        id INT AUTO_INCREMENT PRIMARY KEY,
        menu_code VARCHAR(50) NOT NULL UNIQUE COMMENT '메뉴 코드 (URL path)',
        menu_name VARCHAR(100) NOT NULL COMMENT '메뉴 표시명',
        menu_url VARCHAR(200) NOT NULL COMMENT '메뉴 URL (예: /index.html)',
        icon_class VARCHAR(100) NULL COMMENT 'Font Awesome 아이콘 클래스',
        sort_order INT DEFAULT 0 COMMENT '정렬순서',
        is_active TINYINT DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_menus_code (menu_code),
        INDEX idx_menus_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 메뉴 테이블'
    `);

    // 3) role_menus 매핑 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_menus (
        id INT AUTO_INCREMENT PRIMARY KEY,
        role_id INT NOT NULL,
        menu_id INT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_role_menu (role_id, menu_id),
        INDEX idx_rm_role (role_id),
        INDEX idx_rm_menu (menu_id),
        CONSTRAINT fk_rm_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
        CONSTRAINT fk_rm_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='RBAC 역할-메뉴 매핑'
    `);

    // 4) users 테이블에 role_id 컬럼 추가 (없으면)
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role_id'`
    );
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE users ADD COLUMN role_id INT NULL COMMENT 'RBAC 역할 FK' AFTER role`);
      console.log('[RBAC] users.role_id 컬럼 추가 완료');
    }

    // 5) 시드 데이터 — 역할이 비어있을 때만 삽입
    const [roleCount] = await pool.query('SELECT COUNT(*) AS cnt FROM roles');
    if (roleCount[0].cnt === 0) {
      await pool.query(`
        INSERT INTO roles (role_code, role_name, description, sort_order) VALUES
        ('admin', '관리자', '전체 메뉴 접근 가능한 시스템 관리자', 1),
        ('user', '일반 사용자', '기본 메뉴만 접근 가능', 2)
      `);
      console.log('[RBAC] 기본 역할(admin, user) 시드 데이터 삽입');
    }

    // 6) 시드 데이터 — 메뉴가 비어있을 때만 삽입
    const [menuCount] = await pool.query('SELECT COUNT(*) AS cnt FROM menus');
    if (menuCount[0].cnt === 0) {
      await pool.query(`
        INSERT INTO menus (menu_code, menu_name, menu_url, icon_class, sort_order) VALUES
        ('nlq',       '자연어 질의',          '/',               'fas fa-comments',          1),
        ('builder',   '비주얼 쿼리 빌더',    '/builder.html',   'fas fa-th-large',          2),
        ('report',    'PPT 분석 장표 생성',   '/report',         'fas fa-file-powerpoint',   3),
        ('learning',  '학습 관리',            '/learning.html',  'fas fa-graduation-cap',    4),
        ('permission','권한 관리',           '/permission.html','fas fa-shield-alt',        5),
        ('batch',     '배치 관리',            '/batch.html',     'fas fa-sync-alt',          6)
      `);
      console.log('[RBAC] 기본 메뉴 시드 데이터 삽입');
    }

    // 7) 시드 데이터 — role_menus 매핑이 비어있을 때만 삽입
    const [rmCount] = await pool.query('SELECT COUNT(*) AS cnt FROM role_menus');
    if (rmCount[0].cnt === 0) {
      // admin → 모든 메뉴
      await pool.query(`
        INSERT INTO role_menus (role_id, menu_id)
        SELECT r.id, m.id FROM roles r CROSS JOIN menus m WHERE r.role_code = 'admin'
      `);
      // user → 기본 메뉴만 (nlq, builder, report)
      await pool.query(`
        INSERT INTO role_menus (role_id, menu_id)
        SELECT r.id, m.id FROM roles r CROSS JOIN menus m
        WHERE r.role_code = 'user' AND m.menu_code IN ('nlq', 'builder', 'report')
      `);
      console.log('[RBAC] 기본 역할-메뉴 매핑 시드 데이터 삽입');
    }

    // 8) role_id가 NULL인 사용자 → 기본 'user' 역할로 강제 매핑
    const [nullRoleUsers] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE role_id IS NULL');
    if (nullRoleUsers[0].cnt > 0) {
      // 먼저 role 값이 roles.role_code와 매칭되는 것 매핑
      await pool.query(`
        UPDATE users u
        JOIN roles r ON r.role_code = u.role
        SET u.role_id = r.id
        WHERE u.role_id IS NULL AND u.role IS NOT NULL
      `);
      // 그래도 남은 NULL (role 값이 roles에 없는 경우) → 'user' 역할로 강제 배정
      const [stillNull] = await pool.query('SELECT COUNT(*) AS cnt FROM users WHERE role_id IS NULL');
      if (stillNull[0].cnt > 0) {
        const [userRole] = await pool.query("SELECT id FROM roles WHERE role_code='user' LIMIT 1");
        if (userRole.length > 0) {
          await pool.query('UPDATE users SET role_id = ? WHERE role_id IS NULL', [userRole[0].id]);
          console.log(`[RBAC] ${stillNull[0].cnt}명 레거시 사용자 → 'user' 역할로 강제 매핑`);
        }
      }
      console.log(`[RBAC] ${nullRoleUsers[0].cnt}명 사용자 role_id 마이그레이션 완료`);
    }

    // 9) admin.html 메뉴 → permission.html에 통합되어 제거
    try {
      const [adminMenu] = await pool.query("SELECT id FROM menus WHERE menu_code = 'admin'");
      if (adminMenu.length > 0) {
        const menuId = adminMenu[0].id;
        await pool.query('DELETE FROM role_menus WHERE menu_id = ?', [menuId]);
        await pool.query('DELETE FROM menus WHERE id = ?', [menuId]);
        console.log('[RBAC] admin 메뉴(사용자 관리) 제거 → permission.html(권한 관리)로 통합');
      }
      // permission 메뉴 이름 업데이트
      await pool.query("UPDATE menus SET menu_name = '권한 관리' WHERE menu_code = 'permission' AND menu_name != '권한 관리'");
    } catch(e) { /* ignore — not critical */ }

    // 10) users.role 레거시 컬럼 제거 (role_id로 완전 전환)
    try {
      const [roleCol] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'`
      );
      if (roleCol.length > 0) {
        await pool.query('ALTER TABLE users DROP COLUMN role');
        console.log('[RBAC] users.role 레거시 컬럼 제거 완료 (role_id로 전환)');
      }
    } catch(e) { console.error('[RBAC] role 컬럼 제거 실패 (무시):', e.message); }

    console.log('[RBAC] RBAC 테이블 및 시드 데이터 준비 완료');
  } catch (e) {
    console.error('[RBAC] 테이블 생성/시드 실패:', e.message);
  }
}

// ============================================================
// 업무영역 권한 (Business Area Access Control)
// ------------------------------------------------------------
// [2026-07-24] 도입
//   - 업무영역: PROFITABILITY(수익성분석) / MANUFACTURING_COST(제조원가)
//   - users.domain_code(PS/HL/MGMT: 학습관리 도메인)와는 완전히 별개의 축
//   - 다중값 허용 (사용자별로 1개 이상의 업무영역 부여 가능)
//   - 화면·URL·API·데이터 접근을 모두 제어하는 실제 접근 권한
//
// 테이블 명명 규칙: sys_aimd_ Prefix (AI 경영의사결정 시스템 공통)
//   - sys_aimd_areas       : 업무영역 마스터
//   - sys_aimd_user_areas  : 사용자-업무영역 매핑
//
// [2026-07-24] 리네이밍 마이그레이션 자동 처리
//   기존 개발 환경에 옛 이름 테이블(business_areas / user_business_areas)이
//   있는 경우 CREATE 전에 안전 RENAME하여 데이터/PK/FK/AUTO_INCREMENT 보존.
// ============================================================
async function ensureBusinessAreaTables() {
  try {
    // 0) 옛 이름 → 새 이름 마이그레이션 (있을 때만)
    //    FK 제약이 두 테이블을 서로 묶고 있으므로 순서 주의:
    //    (a) 자식(user_business_areas) 의 FK 를 임시 DROP → 부모 rename → 자식 rename → FK 재생성
    try {
      const [oldChild]  = await pool.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_business_areas'`);
      const [oldParent] = await pool.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'business_areas'`);
      const [newChild]  = await pool.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_user_areas'`);
      const [newParent] = await pool.query(
        `SELECT TABLE_NAME FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_areas'`);

      if ((oldParent.length > 0 || oldChild.length > 0) &&
          newParent.length === 0 && newChild.length === 0) {
        console.log('[BA] 옛 테이블명 감지 → sys_aimd_ prefix 로 안전 RENAME 시작');

        // 자식 테이블의 FK 이름을 실제로 조회 (환경별 자동생성 방지)
        if (oldChild.length > 0) {
          const [fks] = await pool.query(`
            SELECT CONSTRAINT_NAME
              FROM information_schema.TABLE_CONSTRAINTS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'user_business_areas'
               AND CONSTRAINT_TYPE = 'FOREIGN KEY'`);
          for (const fk of fks) {
            await pool.query(
              `ALTER TABLE \`user_business_areas\` DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``
            );
            console.log(`[BA] FK 임시 제거: ${fk.CONSTRAINT_NAME}`);
          }
        }

        // 원자적 RENAME (RENAME TABLE 은 다중 대상을 한 문장에서 처리 가능)
        if (oldParent.length > 0 && oldChild.length > 0) {
          await pool.query(
            `RENAME TABLE \`business_areas\` TO \`sys_aimd_areas\`,
                          \`user_business_areas\` TO \`sys_aimd_user_areas\``
          );
        } else if (oldParent.length > 0) {
          await pool.query(`RENAME TABLE \`business_areas\` TO \`sys_aimd_areas\``);
        } else if (oldChild.length > 0) {
          await pool.query(`RENAME TABLE \`user_business_areas\` TO \`sys_aimd_user_areas\``);
        }
        console.log('[BA] 테이블명 RENAME 완료');

        // FK 재생성 (자식 테이블이 존재하는 경우)
        const [afterChild] = await pool.query(
          `SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sys_aimd_user_areas'`);
        if (afterChild.length > 0) {
          await pool.query(`
            ALTER TABLE \`sys_aimd_user_areas\`
              ADD CONSTRAINT \`fk_sys_aimd_ua_user\`
                FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`user_id\`)
                ON DELETE CASCADE,
              ADD CONSTRAINT \`fk_sys_aimd_ua_area\`
                FOREIGN KEY (\`area_code\`) REFERENCES \`sys_aimd_areas\`(\`area_code\`)
                ON DELETE CASCADE ON UPDATE CASCADE
          `);
          console.log('[BA] FK 재생성 완료 (fk_sys_aimd_ua_user, fk_sys_aimd_ua_area)');
        }
      }
    } catch (renameErr) {
      console.error('[BA] 리네이밍 마이그레이션 실패 (계속 진행):', renameErr.message);
    }

    // 1) sys_aimd_areas 마스터 테이블
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sys_aimd_areas (
        id INT AUTO_INCREMENT PRIMARY KEY,
        area_code VARCHAR(32) NOT NULL UNIQUE COMMENT '업무영역 코드 (예: PROFITABILITY, MANUFACTURING_COST)',
        area_name VARCHAR(64) NOT NULL COMMENT '업무영역 표시명',
        description VARCHAR(255) NULL COMMENT '업무영역 설명',
        sort_order INT DEFAULT 0 COMMENT '정렬순서',
        is_active TINYINT DEFAULT 1 COMMENT '활성 여부 (0=비활성)',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sys_aimd_areas_code (area_code),
        INDEX idx_sys_aimd_areas_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AIMD 업무영역 마스터'
    `);

    // 2) sys_aimd_user_areas 매핑 테이블 (사용자 ↔ 업무영역 N:N)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sys_aimd_user_areas (
        user_id VARCHAR(64) NOT NULL,
        area_code VARCHAR(32) NOT NULL,
        granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        granted_by VARCHAR(64) NULL COMMENT '부여한 관리자 user_id (감사용)',
        PRIMARY KEY (user_id, area_code),
        INDEX idx_sys_aimd_ua_user (user_id),
        INDEX idx_sys_aimd_ua_area (area_code),
        CONSTRAINT fk_sys_aimd_ua_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
        CONSTRAINT fk_sys_aimd_ua_area FOREIGN KEY (area_code) REFERENCES sys_aimd_areas(area_code) ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AIMD 사용자-업무영역 매핑'
    `);

    // 3) 시드 데이터 — 업무영역 마스터 (멱등)
    await pool.query(`
      INSERT IGNORE INTO sys_aimd_areas (area_code, area_name, description, sort_order) VALUES
        ('PROFITABILITY',      '수익성분석', '수익성 분석 관련 업무영역 (기본)', 10),
        ('MANUFACTURING_COST', '제조원가',   '제조원가 관련 업무영역',           20)
    `);

    // 4-a) 마이그레이션 — 매핑이 하나도 없는 사용자에게 PROFITABILITY 자동 부여
    //      (신규 사용자 포함하여 기본 접근권을 보장. 멱등: INSERT IGNORE + LEFT JOIN 필터)
    const [migResult] = await pool.query(`
      INSERT IGNORE INTO sys_aimd_user_areas (user_id, area_code, granted_by)
      SELECT u.user_id, 'PROFITABILITY', 'SYSTEM_MIGRATION'
        FROM users u
        LEFT JOIN sys_aimd_user_areas uba ON uba.user_id = u.user_id
       WHERE uba.user_id IS NULL
    `);
    if (migResult.affectedRows > 0) {
      console.log(`[BA] ${migResult.affectedRows}명 사용자에게 PROFITABILITY 기본 권한 부여`);
    }

    // 4-b) [옵션 B — 2026-07] admin 계정 백필
    //      admin 은 항상 활성 area 전체에 대한 매핑 Row 를 가지도록 보장.
    //      → 서버 코드에서 admin 예외 분기가 제거되었으므로, 실제 접근권은 이 매핑이 결정.
    //      → 새 area 를 마스터에 추가하면 다음 부팅 시 자동으로 admin 에게도 부여됨.
    //      멱등: PK(user_id, area_code) + INSERT IGNORE.
    const [adminBackfill] = await pool.query(`
      INSERT IGNORE INTO sys_aimd_user_areas (user_id, area_code, granted_by)
      SELECT u.user_id, ba.area_code, 'SYSTEM_ADMIN_BACKFILL'
        FROM users u
        JOIN roles r     ON r.id = u.role_id AND r.role_code = 'admin'
        JOIN sys_aimd_areas ba ON ba.is_active = 1
    `);
    if (adminBackfill.affectedRows > 0) {
      console.log(`[BA] admin 계정에 활성 area 전체 백필: ${adminBackfill.affectedRows} row`);
    }

    console.log('[BA] 업무영역 권한 테이블 및 시드 데이터 준비 완료');
  } catch (e) {
    console.error('[BA] 테이블 생성/시드 실패:', e.message);
  }
}

// ============================================================
// [2026-07-30] 오류 접수 (Error Reports) 테이블
// ------------------------------------------------------------
// 목적:
//   자연어 질의 화면에서 사용자가 오류 카드 하단의 [오류 접수] 버튼을 클릭하면
//   해당 요청의 requestId 를 DB 에 저장 → 관리자가 nlq-server.log 에서
//   requestId 로 즉시 grep 하여 원인을 확인할 수 있게 함.
//
// 설계 원칙:
//   - request_id 를 UNIQUE 로 두어 DB 레벨 멱등성 보장 (같은 request_id 중복 접수 불가)
//   - 상세 stack / 원문 SQL / 서버 내부 경로 등은 저장하지 않음 (사용자 요구)
//     → 상세 오류는 nlq-server.log 에서 request_id 로 추적
//   - status: OPEN / IN_PROGRESS / RESOLVED / IGNORED (관리자용 워크플로우)
//   - user_id 는 서버 세션에서 채움 (클라이언트 조작 방지)
//
// 사용자 요구사항의 컬럼 스펙 그대로 구현.
// ============================================================
async function ensureErrorReportsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sys_aimd_error_reports (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        request_id          VARCHAR(64)  NOT NULL UNIQUE COMMENT '오류 요청 ID (nlq-server.log grep 키, 중복 접수 방지)',
        user_id             VARCHAR(64)  NOT NULL        COMMENT '오류를 접수한 사용자 (서버 세션에서 채움)',
        business_area_code  VARCHAR(32)  NULL            COMMENT '업무영역 내부 코드 (PROFITABILITY / MANUFACTURING_COST 등)',
        domain_code         VARCHAR(10)  NULL            COMMENT '도메인 내부 코드 (PS / HL / MGMT)',
        query_mode          VARCHAR(20)  NULL            COMMENT '질의 모드 (aggregate=현황집계 / analysis=분석질문 / builder 등)',
        user_question       TEXT         NULL            COMMENT '사용자가 입력한 질문 원문',
        error_code          VARCHAR(50)  NULL            COMMENT '오류 분류 코드 (TIMEOUT / HTTP_504 / SQL_EXECUTION_ERROR / GATEWAY_TIMEOUT / SYSTEM 등)',
        http_status         INT          NULL            COMMENT 'HTTP 상태 코드 (있는 경우)',
        error_summary       VARCHAR(500) NULL            COMMENT '사용자 화면에 표시된 안전한 오류 요약 (원문 stack/경로 저장 금지)',
        status              VARCHAR(20)  NOT NULL DEFAULT 'OPEN' COMMENT 'OPEN / IN_PROGRESS / RESOLVED / IGNORED',
        created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_err_reports_request_id (request_id),
        INDEX idx_err_reports_user       (user_id),
        INDEX idx_err_reports_status     (status),
        INDEX idx_err_reports_created    (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AIMD 사용자 오류 접수 (nlq-server.log 매칭 키: request_id)'
    `);
    console.log('[ErrReport] 오류 접수 테이블(sys_aimd_error_reports) 준비 완료');
  } catch (e) {
    console.error('[ErrReport] 오류 접수 테이블 생성 실패:', e.message);
  }
}

// ── RBAC 기본 메뉴 (폴백용) ──
// RBAC 테이블이 아직 준비 안 됐거나, role_id가 NULL인 경우 role_code로 폴백
const DEFAULT_MENUS_ALL = [
  { menu_code:'nlq',       menu_name:'자연어 질의',        menu_url:'/',               icon_class:'fas fa-comments',        sort_order:1 },
  { menu_code:'builder',   menu_name:'비주얼 쿼리 빌더',  menu_url:'/builder.html',   icon_class:'fas fa-th-large',        sort_order:2 },
  { menu_code:'report',    menu_name:'PPT 분석 장표 생성', menu_url:'/report',         icon_class:'fas fa-file-powerpoint', sort_order:3 },
  { menu_code:'learning',  menu_name:'학습 관리',          menu_url:'/learning.html',  icon_class:'fas fa-graduation-cap',  sort_order:4 },
  { menu_code:'permission',menu_name:'권한 관리',           menu_url:'/permission.html',icon_class:'fas fa-shield-alt',      sort_order:5 },
  { menu_code:'batch',     menu_name:'배치 관리',          menu_url:'/batch.html',     icon_class:'fas fa-sync-alt',        sort_order:6 },
];
const DEFAULT_MENUS_USER = DEFAULT_MENUS_ALL.filter(m => ['nlq','builder','report'].includes(m.menu_code));

/**
 * role 값에 따른 기본 메뉴 폴백
 */
function getDefaultMenusByRole(role) {
  return role === 'admin' ? DEFAULT_MENUS_ALL : DEFAULT_MENUS_USER;
}

/**
 * 사용자의 역할에 매핑된 허용 메뉴 목록 조회
 * RBAC 테이블/role_id가 없으면 기존 role 값으로 폴백
 * @returns {Array} [{menu_code, menu_name, menu_url, icon_class, sort_order}]
 */
async function getUserAllowedMenus(userId) {
  try {
    // 먼저 role_id 확인
    const [userRow] = await pool.query(
      `SELECT u.role_id, COALESCE(r.role_code, 'user') AS role_code
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.user_id = ?`, [userId]);
    if (userRow.length === 0) return DEFAULT_MENUS_USER;

    const user = userRow[0];

    // role_id가 NULL이면 기본 메뉴 폴백
    if (!user.role_id) {
      console.log(`[RBAC] ${userId}: role_id NULL → role_code='${user.role_code}' 기본 메뉴 폴백`);
      return getDefaultMenusByRole(user.role_code);
    }

    const [rows] = await pool.query(`
      SELECT m.menu_code, m.menu_name, m.menu_url, m.icon_class, m.sort_order
      FROM roles r
      JOIN role_menus rm ON rm.role_id = r.id
      JOIN menus m ON m.id = rm.menu_id AND m.is_active = 1
      WHERE r.id = ? AND r.is_active = 1
      ORDER BY m.sort_order
    `, [user.role_id]);

    // RBAC 매핑이 0건이면 (role_menus 시드 안 됨) role_code로 폴백
    if (rows.length === 0) {
      console.log(`[RBAC] ${userId}: role_id=${user.role_id} 매핑 0건 → role_code='${user.role_code}' 기본 메뉴 폴백`);
      return getDefaultMenusByRole(user.role_code);
    }

    return rows;
  } catch (e) {
    console.error('[RBAC] getUserAllowedMenus 실패:', e.message);
    // 테이블 자체가 없는 등 오류 → 기본 메뉴 폴백
    try {
      const [u] = await pool.query(
        `SELECT COALESCE(r.role_code, 'user') AS role_code
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.user_id = ?`, [userId]);
      return getDefaultMenusByRole(u.length > 0 ? u[0].role_code : 'user');
    } catch (e2) {
      return DEFAULT_MENUS_USER;
    }
  }
}

/**
 * URL path가 사용자에게 허용된 메뉴인지 확인
 * RBAC 실패 시 기존 admin/user 방식으로 폴백
 */
async function isMenuAllowed(userId, urlPath) {
  try {
    const normalizedPath = urlPath === '/index.html' ? '/' : urlPath;

    // 먼저 role_id 확인
    const [userRow] = await pool.query(
      `SELECT u.role_id, COALESCE(r.role_code, 'user') AS role_code
       FROM users u LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.user_id = ?`, [userId]);
    if (userRow.length === 0) return false;

    const user = userRow[0];

    // role_id NULL → 기존 방식 폴백
    if (!user.role_id) {
      const adminOnly = ['/learning.html', '/upload.html', '/batch.html', '/permission.html'];
      if (adminOnly.includes(normalizedPath)) return user.role_code === 'admin';
      return true; // 기본 페이지는 모두 허용
    }

    const [rows] = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM roles r
      JOIN role_menus rm ON rm.role_id = r.id
      JOIN menus m ON m.id = rm.menu_id AND m.is_active = 1
      WHERE r.id = ? AND r.is_active = 1 AND m.menu_url = ?
    `, [user.role_id, normalizedPath]);

    if (rows[0].cnt > 0) return true;

    // role_menus에 매핑이 없을 수도 → 기존 방식 추가 체크
    const [totalMappings] = await pool.query('SELECT COUNT(*) AS cnt FROM role_menus WHERE role_id = ?', [user.role_id]);
    if (totalMappings[0].cnt === 0) {
      // 매핑이 아예 없으면 시드 전 상태 → 기존 방식
      const adminOnly = ['/learning.html', '/upload.html', '/batch.html', '/permission.html'];
      if (adminOnly.includes(normalizedPath)) return user.role_code === 'admin';
      return true;
    }

    return false;
  } catch (e) {
    console.error('[RBAC] isMenuAllowed 실패:', e.message);
    // 테이블 없음 등 → 기존 방식 폴백
    try {
      const [u] = await pool.query(
        `SELECT COALESCE(r.role_code, 'user') AS role_code
         FROM users u LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.user_id = ?`, [userId]);
      if (u.length === 0) return false;
      const adminOnly = ['/learning.html', '/upload.html', '/batch.html', '/permission.html'];
      if (adminOnly.includes(urlPath)) return u[0].role_code === 'admin';
      return true;
    } catch (e2) {
      return true; // 최종 폴백: 접근 허용 (서비스 중단 방지)
    }
  }
}

// ============================================================
// 업무영역 권한 헬퍼 & 미들웨어 (Business Area Access)
// ------------------------------------------------------------
//  - getUserBusinessAreas(userId, roleCode)
//      → 2026-07 옵션 B 이후: role 구분 없이 sys_aimd_user_areas 매핑을 그대로 조회.
//        admin 도 예외 없이 실제 매핑 Row 기반으로 판정.
//        (부팅 시 admin 에게 활성 area 전체를 백필하는 마이그레이션이 있어
//         "새 area 추가 시 admin 이 접근 못 하는" 사고는 별도로 예방됨.)
//        매핑이 완전히 비어있는 극단적 케이스에만 최소 PROFITABILITY 폴백.
//  - requireBusinessArea(areaCode)
//      → 서버측 미들웨어: 세션 role 기준으로 매 요청마다 DB 재조회
//      → 프론트 값 신뢰 없음. 401(로그인 필요) / 403(권한 없음) 반환
// ============================================================

/**
 * 사용자의 접근 가능 업무영역 코드 리스트 조회
 * @param {string} userId
 * @param {string} [_roleCode]  하위 호환용(현재는 미사용). 예전엔 admin 분기용.
 * @returns {Promise<string[]>}  area_code 배열 (예: ['PROFITABILITY', 'MANUFACTURING_COST'])
 */
async function getUserBusinessAreas(userId, _roleCode) {
  // role 구분 없이 매핑 그대로 조회
  try {
    const [rows] = await pool.query(
      `SELECT uba.area_code
         FROM sys_aimd_user_areas uba
         JOIN sys_aimd_areas ba ON ba.area_code = uba.area_code
        WHERE uba.user_id = ? AND ba.is_active = 1
        ORDER BY ba.sort_order, ba.id`,
      [userId]
    );
    const list = rows.map(r => r.area_code);
    // 매핑이 아예 없는 경우(마이그레이션 미완/신규 사용자 등)에도 최소 PROFITABILITY 는 보장
    return list.length > 0 ? list : ['PROFITABILITY'];
  } catch (e) {
    console.error('[BA] getUserBusinessAreas 실패:', e.message);
    return ['PROFITABILITY'];
  }
}

/**
 * 특정 업무영역 접근 권한을 요구하는 Express 미들웨어
 * @param {string} areaCode  예: 'MANUFACTURING_COST'
 * @returns {Function} express middleware
 */
function requireBusinessArea(areaCode) {
  return async (req, res, next) => {
    if (!req.session?.user) {
      return res.status(401).json({ error: '로그인이 필요합니다.' });
    }
    const u = req.session.user;
    try {
      // ★ 매 요청마다 DB에서 최신 role/권한 재조회 (프론트 값 신뢰 금지)
      const [freshRow] = await pool.query(
        `SELECT COALESCE(r.role_code, 'user') AS role_code
           FROM users u LEFT JOIN roles r ON r.id = u.role_id
          WHERE u.user_id = ?`, [u.id]
      );
      const roleCode = freshRow.length > 0 ? freshRow[0].role_code : (u.role || 'user');
      const areas = await getUserBusinessAreas(u.id, roleCode);
      if (!areas.includes(areaCode)) {
        return res.status(403).json({
          error: `업무영역 [${areaCode}] 접근 권한이 없습니다.`,
          required_area: areaCode,
        });
      }
      req.userBusinessAreas = areas;   // 후속 핸들러에서 재사용 가능
      req.userRoleCode = roleCode;
      next();
    } catch (e) {
      console.error('[BA] requireBusinessArea 실패:', e.message);
      return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
    }
  };
}

/**
 * 서버 시작 시 batch_jobs 테이블 자동 생성
 */
async function ensureBatchJobsTable() {
  try {
    // 신규 환경: 완전한 스키마로 생성 (interface_id 포함)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS batch_jobs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_type VARCHAR(50) NOT NULL DEFAULT 'SAP_RFC_SYNC' COMMENT '작업유형',
        interface_id VARCHAR(50) NULL COMMENT '인터페이스 ID (batch_master)',
        cmonth VARCHAR(6) NOT NULL COMMENT '입력년월 (YYYYMM)',
        mode VARCHAR(20) NOT NULL DEFAULT 'replace' COMMENT '실행모드: replace/append/dry-run',
        status ENUM('pending','running','success','failed','cancelled') NOT NULL DEFAULT 'pending',
        started_at DATETIME NULL,
        finished_at DATETIME NULL,
        total_rows INT DEFAULT 0 COMMENT 'T_DATA 수신 행 수',
        inserted_rows INT DEFAULT 0 COMMENT 'DB INSERT 행 수',
        deleted_rows INT DEFAULT 0 COMMENT 'DELETE한 기존 행 수',
        error_message TEXT NULL,
        log_text LONGTEXT NULL COMMENT '실행 로그',
        created_by VARCHAR(50) NULL COMMENT '실행자 ID',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_batch_status (status),
        INDEX idx_batch_cmonth (cmonth),
        INDEX idx_batch_jobs_interface (interface_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='배치 작업 이력'
    `);

    // 기존 환경 보완: interface_id 컬럼/인덱스가 없으면 추가 (멱등성)
    const [colChk] = await pool.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_jobs' AND COLUMN_NAME = 'interface_id'`
    );
    if (!colChk[0].c) {
      await pool.query(
        `ALTER TABLE batch_jobs
           ADD COLUMN interface_id VARCHAR(50) NULL COMMENT '인터페이스 ID (batch_master)' AFTER job_type`
      );
      console.log('[Batch] batch_jobs.interface_id 컬럼 자동 추가');
    }
    const [idxChk] = await pool.query(
      `SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'batch_jobs' AND INDEX_NAME = 'idx_batch_jobs_interface'`
    );
    if (!idxChk[0].c) {
      await pool.query(`ALTER TABLE batch_jobs ADD INDEX idx_batch_jobs_interface (interface_id)`);
      console.log('[Batch] batch_jobs.idx_batch_jobs_interface 인덱스 자동 추가');
    }

    console.log('[Batch] batch_jobs 테이블 준비 완료');
  } catch (e) {
    console.error('[Batch] batch_jobs 테이블 생성 실패:', e.message);
  }
}

// =====================================================================
// 배치 스케줄러 (Scheduler Tick)
//
//  - 1분마다 batch_schedule 을 조회하여 실행 시각이 도래한 행을 자동 실행
//  - 지원 타입:
//      * once   : exec_datetime <= NOW() AND last_run_status IS NULL
//      * daily  : 매일 exec_time
//      * monthly: 매월 exec_day_of_month 의 exec_time
//  - manual 은 자동 실행 대상이 아님 (사용자가 직접 [수동실행] 버튼 클릭)
//
// 중복 실행 방지:
//  - 같은 interface_id 에 batch_jobs.status='running' 행이 있으면 skip
//  - daily/monthly: last_run_at 가 "오늘"이면 이미 실행한 것으로 간주 후 skip
//  - once: last_run_status 가 NULL 이 아니면 (이미 한 번 시도됨) 다시 실행 안 함
// =====================================================================

let _schedulerTickRunning = false;
const SCHEDULER_TICK_MS = Number(process.env.SCHEDULER_TICK_MS || 60_000); // 기본 60초

async function runScheduleRow(s) {
  // s: batch_schedule 행 + 마스터 JOIN 필드 (default_mode)
  try {
    // 1) 중복 실행 차단 — 같은 인터페이스가 running 이면 skip
    const [running] = await pool.query(
      `SELECT id FROM batch_jobs
        WHERE status = 'running'
          AND cmonth = ?
          AND created_by IS NOT NULL
        LIMIT 1`,
      [s.target_cmonth || '000000']
    );
    if (running.length) {
      console.log(`[Scheduler] skip schedule_id=${s.id} (other running job)`);
      return;
    }

    // 2) 대상년월 결정
    let cmonth = s.target_cmonth;
    if (!cmonth) {
      // daily/monthly 는 today 의 yyyymm
      const now = new Date();
      cmonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // 3) 실행 모드 결정 — 허용 모드는 상수(ALLOWED_MODES_LIST) 기준
    let mode = s.exec_mode || s.default_mode || 'replace';
    if (!ALLOWED_MODES_LIST.includes(mode)) mode = ALLOWED_MODES_LIST[0];

    // 4) batch_jobs 레코드 생성 — interface_id 를 반드시 함께 기록해서
    //    [인터페이스 이력관리] 탭에서 해당 인터페이스로 필터링/연결이 가능하도록 함
    const [r] = await pool.query(
      `INSERT INTO batch_jobs
         (job_type, interface_id, cmonth, mode, status, created_by, log_text)
       VALUES (?, ?, ?, ?, 'pending', ?, ?)`,
      ['SAP_RFC_SYNC', s.interface_id, cmonth, mode, `scheduler:${s.interface_id}`,
       `[Scheduler] schedule_id=${s.id} interface=${s.interface_id} type=${s.schedule_type} 자동 실행 시작`]
    );
    const jobId = r.insertId;

    // 5) batch_schedule 의 last_run 정보 갱신
    await pool.query(
      `UPDATE batch_schedule
          SET last_run_at = NOW(),
              last_run_status = 'running'
        WHERE id = ?`,
      [s.id]
    );

    console.log(`[Scheduler] FIRE schedule_id=${s.id} interface=${s.interface_id} cmonth=${cmonth} mode=${mode} jobId=${jobId}`);

    // 6) 실제 RFC 실행 (비동기, 결과는 last_run_status 에 반영)
    executeBatchJob(jobId, cmonth, mode)
      .then(async () => {
        const [j] = await pool.query('SELECT status FROM batch_jobs WHERE id=?', [jobId]);
        const finalStatus = j[0]?.status === 'success' ? 'success' : 'failed';
        await pool.query(
          `UPDATE batch_schedule SET last_run_status = ? WHERE id = ?`,
          [finalStatus, s.id]
        );
      })
      .catch(async (err) => {
        console.error(`[Scheduler] schedule_id=${s.id} 실행 실패:`, err.message);
        await pool.query(
          `UPDATE batch_schedule SET last_run_status = 'failed' WHERE id = ?`,
          [s.id]
        );
      });
  } catch (err) {
    console.error(`[Scheduler] schedule_id=${s.id} 처리 오류:`, err.message);
  }
}

async function schedulerTick() {
  if (_schedulerTickRunning) return; // 중첩 실행 방지
  _schedulerTickRunning = true;
  try {
    // ----- (A) once 예약: exec_datetime <= NOW() AND last_run_status IS NULL -----
    const [onceRows] = await pool.query(
      `SELECT s.*, m.default_mode
         FROM batch_schedule s
         LEFT JOIN batch_master m ON m.interface_id = s.interface_id
        WHERE s.schedule_type = 'once'
          AND s.is_active = 1
          AND s.exec_datetime IS NOT NULL
          AND s.exec_datetime <= NOW()
          AND s.last_run_status IS NULL
        ORDER BY s.exec_datetime ASC
        LIMIT 20`
    );
    for (const s of onceRows) await runScheduleRow(s);

    // ----- (B) daily: 오늘 exec_time 이 지났고, 오늘 아직 안 돈 행 -----
    const [dailyRows] = await pool.query(
      `SELECT s.*, m.default_mode
         FROM batch_schedule s
         LEFT JOIN batch_master m ON m.interface_id = s.interface_id
        WHERE s.schedule_type = 'daily'
          AND s.is_active = 1
          AND s.exec_time IS NOT NULL
          AND TIME(NOW()) >= s.exec_time
          AND (s.last_run_at IS NULL OR DATE(s.last_run_at) < DATE(NOW()))
        ORDER BY s.id ASC
        LIMIT 20`
    );
    for (const s of dailyRows) await runScheduleRow(s);

    // ----- (C) monthly: 오늘이 exec_day_of_month(또는 말일 보정)이고 exec_time 지났으며 이번 달 미실행 -----
    const [monthlyRows] = await pool.query(
      `SELECT s.*, m.default_mode,
              LAST_DAY(NOW()) AS month_last_day
         FROM batch_schedule s
         LEFT JOIN batch_master m ON m.interface_id = s.interface_id
        WHERE s.schedule_type = 'monthly'
          AND s.is_active = 1
          AND s.exec_time IS NOT NULL
          AND s.exec_day_of_month IS NOT NULL
          AND (
            DAY(NOW()) = s.exec_day_of_month
            OR (s.exec_day_of_month > DAY(LAST_DAY(NOW())) AND DAY(NOW()) = DAY(LAST_DAY(NOW())))
          )
          AND TIME(NOW()) >= s.exec_time
          AND (
            s.last_run_at IS NULL
            OR DATE_FORMAT(s.last_run_at, '%Y-%m') < DATE_FORMAT(NOW(), '%Y-%m')
          )
        ORDER BY s.id ASC
        LIMIT 20`
    );
    for (const s of monthlyRows) await runScheduleRow(s);

  } catch (err) {
    console.error('[Scheduler] tick 오류:', err.message);
  } finally {
    _schedulerTickRunning = false;
  }
}

function startScheduler() {
  console.log(`[Scheduler] 시작 — tick 주기: ${SCHEDULER_TICK_MS}ms`);
  // 시작 후 5초 뒤에 첫 tick (서버 준비 완료까지 대기)
  setTimeout(() => {
    schedulerTick().catch(e => console.error('[Scheduler] first tick:', e.message));
    setInterval(() => {
      schedulerTick().catch(e => console.error('[Scheduler] tick:', e.message));
    }, SCHEDULER_TICK_MS);
  }, 5000);
}

// 배치 작업 목록 조회 (최근 50건)
app.get('/api/batch/jobs', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const [rows] = await pool.query(
      `SELECT id, job_type, cmonth, mode, status, started_at, finished_at,
              total_rows, inserted_rows, deleted_rows, error_message,
              created_by, created_at,
              TIMESTAMPDIFF(SECOND, started_at, IFNULL(finished_at, NOW())) AS elapsed_sec
       FROM batch_jobs ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 배치 작업 상세 조회 (로그 포함)
app.get('/api/batch/jobs/:id', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM batch_jobs WHERE id=?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 배치 작업 실행 (SAP RFC → DB INSERT)
app.post('/api/batch/execute', requireAdmin, async (req, res) => {
  const { cmonth, mode } = req.body;

  // 입력 유효성 검사
  if (!cmonth || cmonth.length !== 6 || !/^\d{6}$/.test(cmonth)) {
    return res.status(400).json({ error: '유효하지 않은 년월입니다. YYYYMM 형식으로 입력하세요. (예: 202604)' });
  }

  const year = parseInt(cmonth.substring(0, 4));
  const month = parseInt(cmonth.substring(4, 6));
  if (year < 2020 || year > 2030 || month < 1 || month > 12) {
    return res.status(400).json({ error: '유효 범위를 벗어난 년월입니다. (2020~2030년, 1~12월)' });
  }

  const execMode = mode || 'replace';
  if (!['replace', 'append', 'dry-run'].includes(execMode)) {
    return res.status(400).json({ error: '유효하지 않은 실행모드입니다. (replace/append/dry-run)' });
  }

  // 중복 실행 체크 (running 상태 작업이 있으면 차단)
  try {
    const [running] = await pool.query(
      "SELECT id, cmonth FROM batch_jobs WHERE status = 'running' LIMIT 1"
    );
    if (running.length > 0) {
      return res.status(409).json({
        error: `이미 실행 중인 작업이 있습니다. (ID: ${running[0].id}, ${running[0].cmonth})`,
        runningJobId: running[0].id,
      });
    }
  } catch (e) { /* 무시, 계속 진행 */ }

  // 작업 레코드 생성 — [배치관리] 화면은 수익성데이터(NLP_RFC_001) 전용 이므로 interface_id 고정
  const userId = req.session?.user?.id || 'unknown';
  let jobId;
  try {
    const [r] = await pool.query(
      `INSERT INTO batch_jobs (job_type, interface_id, cmonth, mode, status, created_by)
       VALUES ('SAP_RFC_SYNC', 'NLP_RFC_001', ?, ?, 'pending', ?)`,
      [cmonth, execMode, userId]
    );
    jobId = r.insertId;
  } catch (e) {
    return res.status(500).json({ error: '작업 생성 실패: ' + e.message });
  }

  // 즉시 응답 반환 (비동기 실행)
  res.json({
    success: true,
    jobId,
    cmonth,
    mode: execMode,
    message: '배치 작업이 시작되었습니다. 작업 목록에서 진행 상황을 확인하세요.',
  });

  // 비동기로 Python 스크립트 실행
  executeBatchJob(jobId, cmonth, execMode).catch(err => {
    console.error(`[Batch] 작업 ${jobId} 비동기 실행 실패:`, err.message);
  });
});

/**
 * 배치 작업 비동기 실행 (Spring Boot /profit-api/sap-rfc/execute 호출)
 *
 * 운영환경: Spring Boot 플랫폼의 SAP JCo 모듈이 실제 RFC 호출 + DB INSERT를 수행
 * nlq-server는 배치 작업 이력(batch_jobs)을 관리하고, Spring Boot API에 프록시 요청
 *
 * Spring Boot API가 미배포 상태(연결 불가)이면 → batch_jobs에 실패 기록 + 상세 안내
 */
async function executeBatchJob(jobId, cmonth, mode) {
  const logLines = [];
  const addLog = (msg) => {
    const ts = new Date().toISOString().substring(11, 19);
    logLines.push(`[${ts}] ${msg}`);
  };

  try {
    // 상태 → running
    await pool.query(
      "UPDATE batch_jobs SET status='running', started_at=NOW(), log_text=? WHERE id=?",
      ['작업 시작...\n', jobId]
    );
    addLog(`배치 작업 시작 (ID: ${jobId}, CMONTH: ${cmonth}, MODE: ${mode})`);

    // Spring Boot API URL (환경변수 또는 기본값)
    const springBaseUrl = process.env.SPRING_API_URL || 'http://localhost:18093';
    addLog(`SPRING_API_URL 환경변수: ${process.env.SPRING_API_URL || '(미설정 → 기본값 사용)'}`);
    addLog(`Spring Boot 대상 URL: ${springBaseUrl}`);

    // ── Spring Boot 사전 연결 진단 ──
    addLog(`── Spring Boot 연결 진단 시작 ──`);
    try {
      const healthUrl = `${springBaseUrl}/profit-api/sap-rfc/check/202601`;
      addLog(`헬스체크 호출: GET ${healthUrl}`);
      const healthRes = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
      const healthData = await healthRes.json().catch(() => ({}));
      addLog(`헬스체크 응답: HTTP ${healthRes.status} → ${JSON.stringify(healthData)}`);
      addLog(`Spring Boot 연결 확인 완료`);
    } catch (healthErr) {
      addLog(`헬스체크 실패: ${healthErr.message}`);
      addLog(`Spring Boot가 ${springBaseUrl} 에서 응답하지 않습니다.`);

      // 포트 열림 여부 추가 진단
      try {
        const url = new URL(springBaseUrl);
        addLog(`대상 호스트: ${url.hostname}, 포트: ${url.port || '80'}`);
      } catch (_) { /* ignore */ }

      addLog(`── 진단 결과: Spring Boot 미실행 또는 URL 오류 ──`);
      await pool.query('UPDATE batch_jobs SET log_text=? WHERE id=?', [logLines.join('\n'), jobId]);

      throw new Error(
        `Spring Boot 연결 실패 (${springBaseUrl})\n` +
        `상세: ${healthErr.message}\n\n` +
        `[진단 정보]\n` +
        `- SPRING_API_URL 환경변수: ${process.env.SPRING_API_URL || '(미설정)'}\n` +
        `- 대상 URL: ${springBaseUrl}\n\n` +
        `[해결방법]\n` +
        `1. Spring Boot 플랫폼 실행 확인: curl ${springBaseUrl}/profit-api/sap-rfc/check/202601\n` +
        `2. .env에 SPRING_API_URL 설정 확인 (현재: ${process.env.SPRING_API_URL || '미설정'})\n` +
        `3. Spring Boot 로그 확인: sudo journalctl -u analytics -n 50 --no-pager\n` +
        `4. 포트 확인: ss -tlnp | grep 18093`
      );
    }

    // ── SAP RFC 실행 요청 ──
    const apiUrl = `${springBaseUrl}/profit-api/sap-rfc/execute`;
    addLog(`── SAP RFC 실행 요청 ──`);
    addLog(`API 호출: POST ${apiUrl}`);
    addLog(`요청 데이터: { cmonth: "${cmonth}", mode: "${mode}", jobId: ${jobId} }`);
    await pool.query('UPDATE batch_jobs SET log_text=? WHERE id=?', [logLines.join('\n'), jobId]);

    // Spring Boot API 호출 (fetch) — jobId를 전달하여 같은 batch_jobs 레코드 사용
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1800000); // 30분 타임아웃

    let springResponse;
    try {
      springResponse = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cmonth, mode, jobId }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(timeout);
      if (fetchErr.name === 'AbortError') {
        throw new Error('Spring Boot API 호출 타임아웃 (30분 초과)');
      }
      throw new Error(
        `Spring Boot API 실행 요청 실패 (${apiUrl})\n` +
        `상세: ${fetchErr.message}`
      );
    }
    clearTimeout(timeout);

    const responseData = await springResponse.json().catch(() => ({}));
    addLog(`Spring Boot 응답: HTTP ${springResponse.status}`);
    addLog(`응답 데이터: ${JSON.stringify(responseData)}`);

    if (!springResponse.ok) {
      throw new Error(
        `Spring Boot API 오류 (HTTP ${springResponse.status}): ` +
        (responseData.message || responseData.error || JSON.stringify(responseData))
      );
    }

    // Spring Boot가 비동기 실행 중이므로, 배치 상태를 폴링하여 추적
    // jobId를 전달했으므로 Spring Boot는 같은 batch_jobs 레코드를 사용
    const springBatchId = responseData.data?.batchId || responseData.batchId || jobId;
    addLog(`Spring Boot 배치 등록 완료 (batchId: ${springBatchId})`);
    addLog(`비동기 실행 중... Spring Boot에서 SAP RFC 호출 → DB INSERT 진행`);

    // Spring Boot 배치 완료를 폴링 (5초 간격, 최대 30분)
    // 주의: Spring Boot가 batch_jobs.log_text를 직접 업데이트하므로
    //       Node.js는 폴링 로그만 별도 관리하고, 최종 결과에서 병합
    const pollUrl = `${springBaseUrl}/profit-api/batches/${springBatchId}`;
    let completed = false;
    const maxPolls = 360; // 5초 × 360 = 30분
    let lastSpringLogText = '';

    addLog(`── 폴링 시작 (5초 간격, 최대 30분) ──`);
    addLog(`폴링 URL: ${pollUrl}`);

    for (let i = 0; i < maxPolls; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5초 대기

      try {
        const pollRes = await fetch(pollUrl);
        const pollData = await pollRes.json();
        const springStatus = pollData.data?.status || pollData.status;
        const springLogText = pollData.data?.logText || '';
        const totalRows = pollData.data?.totalRows || 0;
        const insertedRows = pollData.data?.processedRows || pollData.data?.insertedRows || 0;
        const deletedRows = pollData.data?.deletedRows || 0;
        const elapsedSec = pollData.data?.elapsedSec || 0;

        // Spring Boot의 log_text가 업데이트되었으면 콘솔에 출력
        if (springLogText && springLogText !== lastSpringLogText) {
          const newLines = springLogText.substring(lastSpringLogText.length).trim();
          if (newLines) {
            console.log(`[Batch ${jobId}] Spring Boot 로그 업데이트:\n${newLines}`);
          }
          lastSpringLogText = springLogText;
        }

        // 매 폴링마다 콘솔 로그 (간결하게)
        const elapsed = (i + 1) * 5;
        console.log(`[Batch ${jobId}] 폴링 #${i + 1} (${elapsed}초): status=${springStatus}, total=${totalRows}, inserted=${insertedRows}`);

        // 10초마다(2회) log_text에 폴링 상태 기록
        if (i % 2 === 0) {
          addLog(`폴링 #${i + 1} (${elapsed}초): status=${springStatus}, rows=${insertedRows}/${totalRows}`);
        }

        if (springStatus === 'success' || springStatus === 'COMPLETED' || springStatus === 'COMPLETED_WITH_ERRORS') {
          const errorRows = pollData.data?.errorRows || 0;

          addLog(`── 배치 완료 ──`);
          addLog(`결과: T_DATA=${totalRows}행, INSERT=${insertedRows}행, DELETE=${deletedRows}행, 에러=${errorRows}행`);
          addLog(`소요시간: ${elapsedSec}초`);

          // Spring Boot의 상세 log_text를 Node.js 폴링 로그 뒤에 병합
          const mergedLog = logLines.join('\n') +
              '\n\n── Spring Boot 실행 상세 로그 ──\n' +
              (springLogText || '(로그 없음)');

          await pool.query(
            `UPDATE batch_jobs SET status='success', finished_at=NOW(),
                    total_rows=?, inserted_rows=?, deleted_rows=?, log_text=?
             WHERE id=?`,
            [totalRows, insertedRows, deletedRows, mergedLog, jobId]
          );
          console.log(`[Batch] 작업 ${jobId} 완료: T_DATA=${totalRows}행, INSERT=${insertedRows}행, DELETE=${deletedRows}행 (${elapsedSec}초)`);
          completed = true;
          break;

        } else if (springStatus === 'failed' || springStatus === 'FAILED') {
          const errMsg = pollData.data?.errorMessage || '알 수 없는 오류';
          addLog(`── 배치 실패 ──`);
          addLog(`에러: ${errMsg}`);

          // 실패 시에도 Spring Boot 로그 병합
          const mergedLog = logLines.join('\n') +
              '\n\n── Spring Boot 실행 상세 로그 ──\n' +
              (springLogText || '(로그 없음)');

          await pool.query(
            `UPDATE batch_jobs SET status='failed', finished_at=NOW(),
                    error_message=?, log_text=?
             WHERE id=?`,
            [errMsg.substring(0, 5000), mergedLog, jobId]
          );
          console.error(`[Batch] 작업 ${jobId} 실패 (Spring): ${errMsg}`);
          completed = true;
          break;
        }
        // pending, running → 계속 폴링
      } catch (pollErr) {
        // 네트워크 오류는 로그 남기고 재시도
        if (i % 6 === 0) {
          addLog(`폴링 오류 (재시도 중): ${pollErr.message}`);
          console.error(`[Batch ${jobId}] 폴링 오류: ${pollErr.message}`);
        }
      }
    }

    if (!completed) {
      throw new Error('Spring Boot 배치 작업이 30분 내에 완료되지 않았습니다.');
    }

  } catch (err) {
    const errMsg = err.message || String(err);
    addLog(`오류 발생: ${errMsg}`);

    await pool.query(
      `UPDATE batch_jobs SET status='failed', finished_at=NOW(),
              error_message=?, log_text=?
       WHERE id=?`,
      [errMsg.substring(0, 5000), logLines.join('\n'), jobId]
    ).catch(e => console.error('[Batch] 실패 상태 업데이트 실패:', e.message));

    console.error(`[Batch] 작업 ${jobId} 실패:`, errMsg);
  }
}

// 해당 월 기존 데이터 건수 조회 (실행 전 확인용)
app.get('/api/batch/check/:cmonth', requireAdmin, async (req, res) => {
  const { cmonth } = req.params;
  if (!cmonth || cmonth.length !== 6 || !/^\d{6}$/.test(cmonth)) {
    return res.status(400).json({ error: '유효하지 않은 년월' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT COUNT(*) AS cnt FROM bw_profitability_data WHERE CALMONTH = ?',
      [cmonth]
    );
    // 최근 해당 월 작업 이력
    const [history] = await pool.query(
      `SELECT id, status, mode, total_rows, inserted_rows, finished_at
       FROM batch_jobs WHERE cmonth = ? ORDER BY id DESC LIMIT 5`,
      [cmonth]
    );
    res.json({
      cmonth,
      existingRows: rows[0].cnt,
      recentJobs: history,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 배치 작업 DB 전체 통계
app.get('/api/batch/stats', requireAdmin, async (req, res) => {
  try {
    const [total] = await pool.query('SELECT COUNT(*) AS cnt FROM batch_jobs');
    const [success] = await pool.query("SELECT COUNT(*) AS cnt FROM batch_jobs WHERE status='success'");
    const [failed] = await pool.query("SELECT COUNT(*) AS cnt FROM batch_jobs WHERE status='failed'");
    const [running] = await pool.query("SELECT COUNT(*) AS cnt FROM batch_jobs WHERE status='running'");
    const [lastJob] = await pool.query(
      "SELECT id, cmonth, status, finished_at FROM batch_jobs ORDER BY id DESC LIMIT 1"
    );
    // bw_profitability_data 전체 행수
    const [dbRows] = await pool.query('SELECT COUNT(*) AS cnt FROM bw_profitability_data');
    // CALMONTH별 데이터 건수
    const [monthData] = await pool.query(
      'SELECT CALMONTH, COUNT(*) AS cnt FROM bw_profitability_data GROUP BY CALMONTH ORDER BY CALMONTH DESC LIMIT 12'
    );
    res.json({
      totalJobs: total[0].cnt,
      successJobs: success[0].cnt,
      failedJobs: failed[0].cnt,
      runningJobs: running[0].cnt,
      lastJob: lastJob[0] || null,
      totalDbRows: dbRows[0].cnt,
      monthlyData: monthData,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
// 인터페이스 관리 API (SAP ↔ AI Analytics)
//   - batch_master      : 인터페이스 마스터 CRUD
//   - batch_schedule    : 인터페이스 수행(스케줄) CRUD + 토글/수동실행
//   - batch_jobs        : 인터페이스 이력 조회 (interface_id 필터)
//   * 모든 엔드포인트는 admin 권한 필요
// ============================================================

// ---------- (A) 마스터 CRUD ----------

// 마스터 목록
app.get('/api/interface/master', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT interface_id, interface_name, sender, receiver, rfc_name,
              rfc_func_or_url, rfc_param,
              IFTBL,
              default_mode, remark,
              is_active, created_by, updated_by, created_at, updated_at
         FROM batch_master
         ORDER BY interface_id ASC`
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// RFC 함수명 + 인터페이스명 distinct 목록 (이력 필터용)
app.get('/api/interface/rfc-list', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT interface_id,
              interface_name,
              rfc_name
         FROM batch_master
        WHERE rfc_name IS NOT NULL
          AND rfc_name <> ''
        ORDER BY interface_id ASC`
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 마스터 단건
app.get('/api/interface/master/:id', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM batch_master WHERE interface_id = ?',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '인터페이스를 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 실행 모드 상수 — 이전에는 batch_master.allowed_modes 컬럼으로 인터페이스별 차등화했으나,
// 실제 등록된 모든 인터페이스가 동일 값이어서 상수로 일원화 (YAGNI).
const ALLOWED_MODES_DEFAULT = 'replace,append,dry-run';
const ALLOWED_MODES_LIST    = ALLOWED_MODES_DEFAULT.split(',').map(s => s.trim());

// IFTBL(인터페이스 테이블) 식별자 검증 (SQL Injection 방지)
function validateIftbl(iftbl) {
  if (iftbl != null && iftbl !== '' && !SAFE_IDENT.test(iftbl)) {
    return 'IFTBL(인터페이스 테이블) 은 영문/숫자/언더스코어만 허용됩니다.';
  }
  return null;
}

// 마스터 생성
//  - receiver 기본값: 'analytics' (수신 시스템은 다른 값을 들 이유가 없어서 고정)
app.post('/api/interface/master', requireAdmin, async (req, res) => {
  const {
    interface_id, interface_name,
    sender = 'SAP', receiver = 'analytics',
    rfc_name = null,
    rfc_func_or_url = null, rfc_param = null,
    IFTBL = null,
    default_mode = 'replace',
    remark = null, is_active = 1,
  } = req.body || {};
  if (!interface_id || !interface_name) {
    return res.status(400).json({ error: 'interface_id, interface_name 필수' });
  }
  const mappingErr = validateIftbl(IFTBL);
  if (mappingErr) return res.status(400).json({ error: mappingErr });
  try {
    const userId = req.session?.user?.user_id || 'admin';
    await pool.query(
      `INSERT INTO batch_master
         (interface_id, interface_name, sender, receiver, rfc_name,
          rfc_func_or_url, rfc_param,
          IFTBL,
          default_mode, remark,
          is_active, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [interface_id, interface_name, sender, receiver, rfc_name,
       rfc_func_or_url, rfc_param,
       IFTBL || null,
       default_mode, remark,
       is_active ? 1 : 0, userId, userId]
    );
    res.json({ ok: true, interface_id });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '이미 존재하는 interface_id 입니다.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 마스터 수정
app.put('/api/interface/master/:id', requireAdmin, async (req, res) => {
  const {
    interface_name, sender, receiver, rfc_name,
    rfc_func_or_url, rfc_param,
    IFTBL,
    default_mode,
    remark, is_active,
  } = req.body || {};
  const mappingErr = validateIftbl(IFTBL);
  if (mappingErr) return res.status(400).json({ error: mappingErr });
  try {
    const userId = req.session?.user?.user_id || 'admin';
    const [r] = await pool.query(
      `UPDATE batch_master
          SET interface_name    = COALESCE(?, interface_name),
              sender            = COALESCE(?, sender),
              receiver          = COALESCE(?, receiver),
              rfc_name          = ?,
              rfc_func_or_url   = ?,
              rfc_param         = ?,
              IFTBL             = ?,
              default_mode      = COALESCE(?, default_mode),
              remark            = ?,
              is_active         = COALESCE(?, is_active),
              updated_by        = ?
        WHERE interface_id = ?`,
      [interface_name ?? null, sender ?? null, receiver ?? null,
       rfc_name ?? null,
       rfc_func_or_url ?? null, rfc_param ?? null,
       (IFTBL === undefined || IFTBL === '') ? null : IFTBL,
       default_mode ?? null,
       remark ?? null,
       (is_active === undefined || is_active === null) ? null : (is_active ? 1 : 0),
       userId, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: '인터페이스를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 마스터 삭제 (스케줄/이력은 FK CASCADE 또는 interface_id NULL 유지)
app.delete('/api/interface/master/:id', requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM batch_master WHERE interface_id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '인터페이스를 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- (B) 스케줄 CRUD ----------

// 스케줄 목록 (마스터 JOIN)
//  - once 예약은 같은 interface_id 가 여러 행 존재할 수 있음
//  - 정렬: 인터페이스 ASC, once 의 경우 exec_datetime ASC 로 시간순
app.get('/api/interface/schedule', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.id, s.interface_id, m.interface_name,
              s.schedule_type, s.exec_time, s.exec_datetime,
              s.exec_day_of_month, s.target_cmonth, s.exec_mode,
              s.is_active, s.last_run_at, s.last_run_status, s.next_run_at,
              s.remark, s.created_by, s.created_at, s.updated_at,
              m.default_mode
         FROM batch_schedule s
         LEFT JOIN batch_master m ON m.interface_id = s.interface_id
        ORDER BY s.interface_id ASC,
                 (s.schedule_type = 'once') DESC,
                 s.exec_datetime DESC,
                 s.id ASC`
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 스케줄 단건
app.get('/api/interface/schedule/:id', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT s.*, m.interface_name
         FROM batch_schedule s
         LEFT JOIN batch_master m ON m.interface_id = s.interface_id
        WHERE s.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '스케줄을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 스케줄 생성
//  - schedule_type: daily / monthly / manual / once
//  - once: exec_datetime (YYYY-MM-DD HH:MM:SS) + target_cmonth + exec_mode 필수
const VALID_TYPES = ['daily', 'monthly', 'manual', 'once'];

function validateScheduleFields({ schedule_type, exec_time, exec_day_of_month,
                                  exec_datetime, target_cmonth, exec_mode }) {
  if (!VALID_TYPES.includes(schedule_type)) {
    return `schedule_type 은 ${VALID_TYPES.join('/')} 중 하나여야 합니다.`;
  }
  if (schedule_type === 'once') {
    if (!exec_datetime) return 'once 모드는 exec_datetime (실행일시) 가 필수입니다.';
    // YYYY-MM-DD HH:MM[:SS] 또는 YYYY-MM-DDTHH:MM 허용
    const dtStr = String(exec_datetime).trim();
    const ok = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(dtStr);
    if (!ok) return 'exec_datetime 형식이 올바르지 않습니다. (YYYY-MM-DD HH:MM)';
    if (!target_cmonth || !/^\d{6}$/.test(String(target_cmonth))) {
      return 'once 모드는 target_cmonth (YYYYMM) 가 필수입니다.';
    }
    if (exec_mode && !ALLOWED_MODES_LIST.includes(exec_mode)) {
      return `exec_mode 가 허용 목록 (${ALLOWED_MODES_LIST.join('/')}) 에 없습니다.`;
    }
  }
  if (schedule_type === 'monthly') {
    const d = Number(exec_day_of_month);
    if (!Number.isInteger(d) || d < 1 || d > 31) {
      return 'monthly 모드는 exec_day_of_month (1~31) 가 필요합니다.';
    }
  }
  if ((schedule_type === 'daily' || schedule_type === 'monthly') && !exec_time) {
    return `${schedule_type} 모드는 exec_time (HH:MM:SS) 가 필요합니다.`;
  }
  return null;
}

app.post('/api/interface/schedule', requireAdmin, async (req, res) => {
  const {
    interface_id,
    schedule_type = 'daily',
    exec_time = '06:00:00',
    exec_day_of_month = null,
    exec_datetime = null,
    target_cmonth = null,
    exec_mode = null,
    is_active = 1,
    remark = null,
  } = req.body || {};
  if (!interface_id) return res.status(400).json({ error: 'interface_id 필수' });

  try {
    // 마스터 존재여부 + default_mode 조회
    const [mrows] = await pool.query(
      'SELECT default_mode FROM batch_master WHERE interface_id = ?',
      [interface_id]
    );
    if (!mrows.length) return res.status(400).json({ error: '존재하지 않는 interface_id 입니다.' });
    const defaultMode = mrows[0].default_mode || 'replace';

    const vErr = validateScheduleFields({
      schedule_type, exec_time, exec_day_of_month,
      exec_datetime, target_cmonth, exec_mode,
    });
    if (vErr) return res.status(400).json({ error: vErr });

    const userId = req.session?.user?.user_id || 'admin';

    // 타입별로 보존할 필드 정리 (불필요한 컬럼은 NULL)
    const isOnce    = schedule_type === 'once';
    const isManual  = schedule_type === 'manual';
    const isMonthly = schedule_type === 'monthly';
    const finalExecTime = (isManual || isOnce) ? null : exec_time;
    const finalExecDay  = isMonthly ? Number(exec_day_of_month) : null;
    const finalExecDt   = isOnce ? String(exec_datetime).replace('T', ' ') : null;
    const finalCmonth   = isOnce ? String(target_cmonth) : (target_cmonth || null);
    const finalMode     = isOnce ? (exec_mode || defaultMode) : (exec_mode || null);

    const [r] = await pool.query(
      `INSERT INTO batch_schedule
         (interface_id, schedule_type, exec_time, exec_datetime,
          exec_day_of_month, target_cmonth, exec_mode,
          is_active, remark, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [interface_id, schedule_type, finalExecTime, finalExecDt,
       finalExecDay, finalCmonth, finalMode,
       is_active ? 1 : 0, remark, userId, userId]
    );
    res.json({ ok: true, id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
      return res.status(400).json({ error: '존재하지 않는 interface_id 입니다.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 스케줄 수정
//  - 부분 업데이트 지원: schedule_type 가 명시되지 않으면 기존 타입 유지
//  - schedule_type 가 명시되면 그 타입에 맞춰 다른 필드 (NULL/값) 일관성 보정
app.put('/api/interface/schedule/:id', requireAdmin, async (req, res) => {
  const {
    schedule_type, exec_time, exec_day_of_month,
    exec_datetime, target_cmonth, exec_mode,
    is_active, remark,
  } = req.body || {};

  if (schedule_type && !VALID_TYPES.includes(schedule_type)) {
    return res.status(400).json({ error: `schedule_type 은 ${VALID_TYPES.join('/')} 중 하나여야 합니다.` });
  }
  try {
    // 기존 행 + 마스터 default_mode 조회
    const [orig] = await pool.query(
      `SELECT s.*, m.default_mode
         FROM batch_schedule s
         LEFT JOIN batch_master m ON m.interface_id = s.interface_id
        WHERE s.id = ?`,
      [req.params.id]
    );
    if (!orig.length) return res.status(404).json({ error: '스케줄을 찾을 수 없습니다.' });
    const cur = orig[0];
    const effectiveType = schedule_type || cur.schedule_type;

    // 신규/현재값 머지 후 검증 (변경 안 한 필드는 기존값 사용)
    const merged = {
      schedule_type:     effectiveType,
      exec_time:         exec_time         !== undefined ? exec_time         : cur.exec_time,
      exec_day_of_month: exec_day_of_month !== undefined ? exec_day_of_month : cur.exec_day_of_month,
      exec_datetime:     exec_datetime     !== undefined ? exec_datetime     : cur.exec_datetime,
      target_cmonth:     target_cmonth     !== undefined ? target_cmonth     : cur.target_cmonth,
      exec_mode:         exec_mode         !== undefined ? exec_mode         : cur.exec_mode,
    };
    const vErr = validateScheduleFields(merged);
    if (vErr) return res.status(400).json({ error: vErr });

    const userId = req.session?.user?.user_id || 'admin';

    // 타입별 NULL 보정
    const isOnce    = effectiveType === 'once';
    const isManual  = effectiveType === 'manual';
    const isMonthly = effectiveType === 'monthly';
    const finalExecTime = (isManual || isOnce) ? null : (merged.exec_time || '06:00:00');
    const finalExecDay  = isMonthly ? Number(merged.exec_day_of_month) : null;
    const finalExecDt   = isOnce ? String(merged.exec_datetime).replace('T', ' ') : null;
    const finalCmonth   = isOnce ? String(merged.target_cmonth) : (merged.target_cmonth || null);
    const finalMode     = isOnce ? (merged.exec_mode || cur.default_mode || 'replace') : (merged.exec_mode || null);

    // once 로 새로 바뀌면, 다시 미실행 상태로 되돌림 (last_run_* 초기화)
    const resetLastRun = (schedule_type === 'once') && (cur.schedule_type !== 'once');

    const [r] = await pool.query(
      `UPDATE batch_schedule
          SET schedule_type     = ?,
              exec_time         = ?,
              exec_datetime     = ?,
              exec_day_of_month = ?,
              target_cmonth     = ?,
              exec_mode         = ?,
              is_active         = COALESCE(?, is_active),
              remark            = ?,
              ${resetLastRun ? 'last_run_at=NULL, last_run_status=NULL,' : ''}
              updated_by        = ?
        WHERE id = ?`,
      [effectiveType, finalExecTime, finalExecDt,
       finalExecDay, finalCmonth, finalMode,
       (is_active === undefined || is_active === null) ? null : (is_active ? 1 : 0),
       (remark !== undefined ? remark : cur.remark),
       userId, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: '스케줄을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 스케줄 삭제
app.delete('/api/interface/schedule/:id', requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM batch_schedule WHERE id = ?', [req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ error: '스케줄을 찾을 수 없습니다.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 스케줄 활성/비활성 토글
app.post('/api/interface/schedule/:id/toggle', requireAdmin, async (req, res) => {
  try {
    const userId = req.session?.user?.user_id || 'admin';
    const [r] = await pool.query(
      `UPDATE batch_schedule
          SET is_active = IF(is_active = 1, 0, 1),
              updated_by = ?
        WHERE id = ?`,
      [userId, req.params.id]
    );
    if (!r.affectedRows) return res.status(404).json({ error: '스케줄을 찾을 수 없습니다.' });
    const [rows] = await pool.query('SELECT is_active FROM batch_schedule WHERE id = ?', [req.params.id]);
    res.json({ ok: true, is_active: rows[0]?.is_active });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 스케줄 수동 실행 (interface_id 만 batch_jobs 에 기록 — 실제 RFC 호출은 추후 연결)
app.post('/api/interface/schedule/:id/run', requireAdmin, async (req, res) => {
  try {
    // (1) 스케줄 + 마스터 조회 (RFC 메타 정보 포함)
    const [rows] = await pool.query(
      `SELECT s.interface_id, m.interface_name, m.is_active,
              m.rfc_name, m.rfc_func_or_url, m.rfc_param,
              m.default_mode
         FROM batch_schedule s
         LEFT JOIN batch_master m ON m.interface_id = s.interface_id
        WHERE s.id = ?`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '스케줄을 찾을 수 없습니다.' });
    const sch = rows[0];

    // (2) 입력값 검증 — body로부터 cmonth + mode 받음 (UI에서 모드 선택 가능)
    //     cmonth 미지정시 현재 년월, mode 미지정시 batch_master.default_mode
    let { cmonth, mode } = req.body || {};

    if (!cmonth) {
      const now = new Date();
      cmonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    if (!/^\d{6}$/.test(cmonth)) {
      return res.status(400).json({ error: '유효하지 않은 년월입니다. YYYYMM 형식이어야 합니다.' });
    }

    // 실행 모드 검증 — 허용 모드는 상수(ALLOWED_MODES_LIST)
    const defaultMode = sch.default_mode || 'replace';
    const execMode = mode || defaultMode;
    if (!ALLOWED_MODES_LIST.includes(execMode)) {
      return res.status(400).json({ error: `유효하지 않은 실행 모드입니다. (허용: ${ALLOWED_MODES_LIST.join('/')})` });
    }

    // (3) 중복 실행 차단 — 같은 인터페이스가 이미 running이면 거부
    const [runningRows] = await pool.query(
      `SELECT id FROM batch_jobs
        WHERE interface_id = ? AND status = 'running' LIMIT 1`,
      [sch.interface_id]
    );
    if (runningRows.length > 0) {
      return res.status(409).json({
        error: `이미 실행 중인 작업이 있습니다. (job_id=${runningRows[0].id})`,
        runningJobId: runningRows[0].id,
      });
    }

    const userId = req.session?.user?.user_id || req.session?.user?.id || 'admin';

    // (4) batch_jobs에 작업 레코드 생성 — [배치관리]와 동일한 'SAP_RFC_SYNC' 타입
    const [ins] = await pool.query(
      `INSERT INTO batch_jobs
         (job_type, interface_id, cmonth, mode, status, created_by)
       VALUES ('SAP_RFC_SYNC', ?, ?, ?, 'pending', ?)`,
      [sch.interface_id, cmonth, execMode, userId]
    );
    const jobId = ins.insertId;

    // (5) 스케줄에도 last_run_at/status = running 표시
    await pool.query(
      `UPDATE batch_schedule
          SET last_run_at = NOW(), last_run_status = 'running', updated_by = ?
        WHERE id = ?`,
      [userId, req.params.id]
    );

    // (6) 즉시 응답 — 비동기 실행은 별도로 진행
    res.json({
      ok: true,
      job_id: jobId,
      interface_id: sch.interface_id,
      rfc_name: sch.rfc_name,
      cmonth,
      mode: execMode,
      message: `인터페이스 실행이 시작되었습니다. (RFC: ${sch.rfc_name || '-'}, MODE: ${execMode.toUpperCase()})`,
    });

    // (7) Spring Boot 호출 — [배치관리]와 동일한 executeBatchJob 재사용
    //     SAP RFC 실패시에도 batch_schedule.last_run_status 동기화
    executeBatchJob(jobId, cmonth, execMode)
      .then(async () => {
        await pool.query(
          `UPDATE batch_schedule SET last_run_status = 'success' WHERE id = ?`,
          [req.params.id]
        ).catch(() => {});
      })
      .catch(async (err) => {
        console.error(`[Interface Run] job ${jobId} 실패:`, err.message);
        await pool.query(
          `UPDATE batch_schedule SET last_run_status = 'failed' WHERE id = ?`,
          [req.params.id]
        ).catch(() => {});
      });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- (C) 상단 상태(통계) + 월별 ----------

// 인터페이스별 통계 (interface_id 없으면 전체)
app.get('/api/interface/stats', requireAdmin, async (req, res) => {
  const interfaceId = (req.query.interface_id || '').trim();
  const useFilter = interfaceId && interfaceId !== 'ALL';
  try {
    const baseWhere = useFilter ? 'WHERE interface_id = ?' : '';
    const params = useFilter ? [interfaceId] : [];

    const [total]   = await pool.query(`SELECT COUNT(*) AS cnt FROM batch_jobs ${baseWhere}`, params);
    const [success] = await pool.query(`SELECT COUNT(*) AS cnt FROM batch_jobs ${baseWhere}${useFilter ? ' AND' : ' WHERE'} status='success'`, params);
    const [failed]  = await pool.query(`SELECT COUNT(*) AS cnt FROM batch_jobs ${baseWhere}${useFilter ? ' AND' : ' WHERE'} status='failed'`, params);
    const [running] = await pool.query(`SELECT COUNT(*) AS cnt FROM batch_jobs ${baseWhere}${useFilter ? ' AND' : ' WHERE'} status='running'`, params);

    // [legacy] batch_jobs 누적 inserted_rows 합계 (재적재 시 중복 합산되어 실제 DB 행수와 다름)
    //   → 호환성을 위해 inserted_rows_sum 필드로 계속 반환하지만,
    //     화면 메인 지표(total_rows)는 실제 테이블 COUNT(*) 로 교체.
    const [rowsSum] = await pool.query(
      `SELECT IFNULL(SUM(inserted_rows), 0) AS total_inserted FROM batch_jobs ${baseWhere}${useFilter ? ' AND' : ' WHERE'} status='success'`,
      params
    );

    let interfaceName = '전체';
    let mappedIftbl = null;  // 인터페이스가 실제 적재하는 테이블명
    if (useFilter) {
      const [m] = await pool.query(
        'SELECT interface_name, IFTBL FROM batch_master WHERE interface_id = ?',
        [interfaceId]
      );
      interfaceName = m[0]?.interface_name || interfaceId;
      mappedIftbl = m[0]?.IFTBL || null;
    } else {
      // 전체(ALL) 선택 시 기본 데이터는 NLP_RFC_001(수익성분석) IFTBL 을 사용한다
      // (다중 인터페이스를 동시에 합산하지 않는다 — 화면 메인 지표는 단일 테이블 기준)
      const [m] = await pool.query(
        "SELECT IFTBL FROM batch_master WHERE interface_id = 'NLP_RFC_001'"
      );
      mappedIftbl = m[0]?.IFTBL || null;
    }

    // ★ 실제 DB 테이블 행수 (재적재로 인한 중복 합산이 없는 진짜 적재량)
    //   IFTBL 식별자는 [A-Za-z_][A-Za-z0-9_]* 화이트리스트로 검증하여
    //   SQL Injection 을 차단한다. (아래 monthly API 의 SAFE_IDENT 와 동일)
    let dbTotalRows = 0;
    const safeIdentRegex = /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (mappedIftbl && safeIdentRegex.test(mappedIftbl)) {
      try {
        const [tbl] = await pool.query(`SELECT COUNT(*) AS cnt FROM \`${mappedIftbl}\``);
        dbTotalRows = Number(tbl[0].cnt) || 0;
      } catch (e) {
        // IFTBL 이 존재하지 않거나 권한 문제일 수 있음 — 0 으로 폴백
        console.warn(`[interface/stats] IFTBL=${mappedIftbl} COUNT 실패: ${e.message}`);
      }
    }

    res.json({
      interface_id: useFilter ? interfaceId : 'ALL',
      interface_name: interfaceName,
      // ★ total_rows: 실제 DB 테이블에 현재 적재되어 있는 행수 (재적재 중복 X)
      //   화면의 "전체 DB 행수" 메인 지표에 해당.
      total_rows: dbTotalRows,
      // [참고] 배치 이력 누적 적재량 (재적재 시 중복 합산)
      //   기존 클라이언트 호환성을 위해 같이 반환.
      inserted_rows_sum: Number(rowsSum[0].total_inserted) || 0,
      iftbl: mappedIftbl,
      total_jobs: total[0].cnt,
      success_jobs: success[0].cnt,
      failed_jobs: failed[0].cnt,
      running_jobs: running[0].cnt,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 월별 데이터 (최근 12개월, started_at 기준)
// 월별 적재 데이터 현황
//   - 인터페이스별로 batch_master.IFTBL(인터페이스 테이블) 매핑을 조회한 뒤,
//     해당 테이블의 CALMONTH 별 행 수를 GROUP BY 로 집계하여 반환한다.
//     (월 컬럼은 SAP BW 표준에 따라 CALMONTH 로 고정)
//   - 응답 포맷: { items: [{CALMONTH:'YYYYMM', cnt:N}, ...] }
//                (배치관리 화면의 /api/batch/stats monthlyData 와 동일 포맷)
//   - interface_id 가 'ALL' 또는 빈 값이면 NLP_RFC_001(default: bw_profitability_data)
//     매핑을 사용한다 (운영 기본 데이터 = 수익성분석).
//   - 매핑이 없는 인터페이스(IFTBL 이 NULL) 는 unmapped:true 로 빈 결과 반환.
//   - IFTBL 값은 SELECT 문에 그대로 보간되므로, [a-zA-Z0-9_] 화이트리스트 검증 필수.
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MONTH_COLUMN = 'CALMONTH';  // SAP BW 표준 월 컬럼 (현재 운영 적재 테이블 공통)
app.get('/api/interface/monthly', requireAdmin, async (req, res) => {
  const reqInterfaceId = (req.query.interface_id || '').trim();
  const useFilter = reqInterfaceId && reqInterfaceId !== 'ALL';
  try {
    // 1) 매핑 조회. ALL 이면 NLP_RFC_001(수익성분석 기본) 의 매핑을 사용.
    const targetId = useFilter ? reqInterfaceId : 'NLP_RFC_001';
    const [mapRows] = await pool.query(
      'SELECT interface_id, interface_name, IFTBL FROM batch_master WHERE interface_id = ?',
      [targetId]
    );
    if (!mapRows.length) {
      return res.json({ items: [], unmapped: true, reason: 'interface_not_found', interface_id: targetId });
    }
    const m = mapRows[0];
    if (!m.IFTBL) {
      return res.json({
        items: [], unmapped: true, reason: 'no_iftbl_mapping',
        interface_id: m.interface_id, interface_name: m.interface_name,
      });
    }
    // 2) 화이트리스트 검증 (SQL Injection 방지)
    if (!SAFE_IDENT.test(m.IFTBL)) {
      return res.status(500).json({ error: `IFTBL 값이 안전한 식별자 형식이 아닙니다 (${m.interface_id}).` });
    }
    // 3) CALMONTH 별 행수 집계
    const [rows] = await pool.query(
      `SELECT ${MONTH_COLUMN} AS CALMONTH, COUNT(*) AS cnt
         FROM \`${m.IFTBL}\`
        GROUP BY ${MONTH_COLUMN}
        ORDER BY ${MONTH_COLUMN} DESC
        LIMIT 12`
    );
    // 오래된 → 최신 순으로 정렬해서 반환
    res.json({
      items: rows.reverse(),
      interface_id: m.interface_id,
      interface_name: m.interface_name,
      IFTBL: m.IFTBL,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- (D) 이력 조회 + 재수행 ----------

// 이력 목록 (filter: interface_id / rfc_name / status / start / end)
app.get('/api/interface/history', requireAdmin, async (req, res) => {
  const { interface_id, rfc_name, status, start, end } = req.query;
  const where = [];
  const params = [];
  if (interface_id && interface_id !== 'ALL') { where.push('j.interface_id = ?'); params.push(interface_id); }
  if (rfc_name && rfc_name !== 'ALL') { where.push('m.rfc_name = ?'); params.push(rfc_name); }
  if (status && status !== 'ALL') { where.push('j.status = ?'); params.push(status); }
  if (start) { where.push('IFNULL(j.started_at, j.created_at) >= ?'); params.push(start + ' 00:00:00'); }
  if (end)   { where.push('IFNULL(j.started_at, j.created_at) <= ?'); params.push(end + ' 23:59:59'); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  try {
    const [rows] = await pool.query(
      `SELECT j.id, j.job_type, j.interface_id, m.interface_name, m.rfc_name,
              j.cmonth, j.mode, j.status,
              j.started_at, j.finished_at,
              j.total_rows, j.inserted_rows, j.deleted_rows,
              j.error_message, j.created_by, j.created_at
         FROM batch_jobs j
         LEFT JOIN batch_master m ON m.interface_id = j.interface_id
         ${whereSql}
        ORDER BY j.id DESC
        LIMIT ?`,
      [...params, limit]
    );
    res.json({ items: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 단건 (로그 포함)
app.get('/api/interface/history/:jobId', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT j.*, m.interface_name
         FROM batch_jobs j
         LEFT JOIN batch_master m ON m.interface_id = j.interface_id
        WHERE j.id = ?`,
      [req.params.jobId]
    );
    if (!rows.length) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 이력 재수행 (failed 만 허용)
app.post('/api/interface/history/:jobId/rerun', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, interface_id, cmonth, status FROM batch_jobs WHERE id = ?`,
      [req.params.jobId]
    );
    if (!rows.length) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
    const src = rows[0];
    if (src.status !== 'failed') {
      return res.status(400).json({ error: '실패 상태의 작업만 재수행할 수 있습니다.' });
    }
    if (!src.interface_id) {
      return res.status(400).json({ error: '인터페이스 ID 가 없는 이력입니다.' });
    }

    const userId = req.session?.user?.user_id || 'admin';
    const [ins] = await pool.query(
      `INSERT INTO batch_jobs
         (job_type, interface_id, cmonth, mode, status, started_at, created_by)
       VALUES ('INTERFACE_RERUN', ?, ?, 'rerun', 'running', NOW(), ?)`,
      [src.interface_id, src.cmonth, userId]
    );
    const newJobId = ins.insertId;

    // 비동기: 더미 성공 처리 (실제 RFC 호출은 추후 연결)
    setImmediate(async () => {
      try {
        await pool.query(
          `UPDATE batch_jobs
              SET status='success', finished_at=NOW(),
                  log_text = CONCAT(IFNULL(log_text, ''),
                                    '[재수행] src_job=', ?, ' interface=', ?, ' user=', ?, ' time=', NOW(), '\n')
            WHERE id = ?`,
          [src.id, src.interface_id, userId, newJobId]
        );
      } catch (e) {
        await pool.query(
          `UPDATE batch_jobs SET status='failed', finished_at=NOW(), error_message=? WHERE id=?`,
          [String(e.message || e), newJobId]
        ).catch(() => {});
      }
    });

    res.json({ ok: true, new_job_id: newJobId });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
// 글로벌 에러 핸들러 — 처리되지 않은 에러 시 HTML 대신 JSON 반환
// ============================================================
app.use((err, req, res, _next) => {
  console.error('[Global Error]', err.message, err.stack);
  // 이미 응답이 시작됐으면 기본 핸들러에 위임
  if (res.headersSent) return _next(err);
  res.status(500).json({
    error: '서버 내부 오류가 발생했습니다.',
    detail: err.message || String(err),
  });
});

// ============================================================
// Start + RAG 자동 초기화
// ============================================================
const PORT = 3000;
// ============================================================
// 빌더 히스토리 북마크/공유 테이블 자동 마이그레이션
// ============================================================
async function ensureBookmarkShareTables() {
  try {
    // 1) builder_query_history에 user_id 컬럼 추가 (없으면)
    const [cols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'builder_query_history' AND COLUMN_NAME = 'user_id'`
    );
    if (cols.length === 0) {
      await pool.query(`ALTER TABLE builder_query_history ADD COLUMN user_id varchar(50) DEFAULT NULL COMMENT '작성자 로그인 ID' AFTER id`);
      await pool.query(`ALTER TABLE builder_query_history ADD INDEX idx_user_id (user_id)`);
      console.log('[Migration] builder_query_history에 user_id 컬럼 추가 완료');
    }

    // 2) builder_query_history에 is_bookmarked 컬럼 추가 (없으면)
    const [bmCols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'builder_query_history' AND COLUMN_NAME = 'is_bookmarked'`
    );
    if (bmCols.length === 0) {
      await pool.query(`ALTER TABLE builder_query_history ADD COLUMN is_bookmarked tinyint(1) NOT NULL DEFAULT 0 COMMENT '북마크 여부' AFTER error_message`);
      await pool.query(`ALTER TABLE builder_query_history ADD INDEX idx_bookmark (user_id, is_bookmarked)`);
      console.log('[Migration] builder_query_history에 is_bookmarked 컬럼 추가 완료');
    }

    // 2-1) builder_query_history에 domain_code 컬럼 추가 (없으면) — 도메인 배지 표시용
    const [bldDomainCols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'builder_query_history' AND COLUMN_NAME = 'domain_code'`
    );
    if (bldDomainCols.length === 0) {
      await pool.query(`ALTER TABLE builder_query_history ADD COLUMN domain_code varchar(20) DEFAULT NULL COMMENT '분석 영역 도메인 코드' AFTER is_bookmarked`);
      console.log('[Migration] builder_query_history에 domain_code 컬럼 추가 완료');
    }

    // 3) nl_query_history에 user_id 컬럼 추가 (없으면)
    const [nlCols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nl_query_history' AND COLUMN_NAME = 'user_id'`
    );
    if (nlCols.length === 0) {
      await pool.query(`ALTER TABLE nl_query_history ADD COLUMN user_id varchar(50) DEFAULT NULL COMMENT '작성자 로그인 ID' AFTER id`);
      await pool.query(`ALTER TABLE nl_query_history ADD INDEX idx_nl_user_id (user_id)`);
      console.log('[Migration] nl_query_history에 user_id 컬럼 추가 완료');
    }

    // 4) nl_query_history에 session_id 컨럼 추가 (없으면) — 채팅 세션 단위 그룹핑용
    const [nlSessionCols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nl_query_history' AND COLUMN_NAME = 'session_id'`
    );
    if (nlSessionCols.length === 0) {
      await pool.query(`ALTER TABLE nl_query_history ADD COLUMN session_id varchar(36) DEFAULT NULL COMMENT '채팅 세션 ID (UUID)' AFTER user_id`);
      await pool.query(`ALTER TABLE nl_query_history ADD INDEX idx_nl_session_id (user_id, session_id)`);
      console.log('[Migration] nl_query_history에 session_id 컨럼 추가 완료');
    }

    // 5-1) nl_query_history에 domain_code 컨럼 추가 (없으면) — 도메인별 이력 분리 및 배지 표시용
    const [nlDomainCols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nl_query_history' AND COLUMN_NAME = 'domain_code'`
    );
    if (nlDomainCols.length === 0) {
      await pool.query(`ALTER TABLE nl_query_history ADD COLUMN domain_code varchar(20) DEFAULT NULL COMMENT '분석 영역 도메인 코드' AFTER session_id`);
      await pool.query(`ALTER TABLE nl_query_history ADD INDEX idx_nl_domain (user_id, domain_code)`);
      console.log('[Migration] nl_query_history에 domain_code 컨럼 추가 완료');
    }

    // 5-2) nl_query_history에 is_bookmarked 컬럼 추가 (없으면) — 자연어 질의 이력 즐겨찾기용
    //   세션 단위 토글이지만 row 단위로 저장 (세션 내 모든 row가 동일 값)
    //   → MAX(is_bookmarked)로 세션 단위 즐겨찾기 여부 판정
    const [nlBmCols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nl_query_history' AND COLUMN_NAME = 'is_bookmarked'`
    );
    if (nlBmCols.length === 0) {
      await pool.query(`ALTER TABLE nl_query_history ADD COLUMN is_bookmarked tinyint(1) NOT NULL DEFAULT 0 COMMENT '즐겨찾기 여부 (세션 단위 토글)' AFTER domain_code`);
      await pool.query(`ALTER TABLE nl_query_history ADD INDEX idx_nl_bookmark (user_id, is_bookmarked)`);
      console.log('[Migration] nl_query_history에 is_bookmarked 컬럼 추가 완료');
    }

    // 5) shared_queries 테이블 생성 (없으면)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shared_queries (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        history_id      INT          NOT NULL              COMMENT '원본 builder_query_history.id',
        from_user_id    VARCHAR(50)  NOT NULL              COMMENT '공유한 사용자 ID',
        to_user_id      VARCHAR(50)  NOT NULL              COMMENT '공유받은 사용자 ID',
        title           VARCHAR(200) NOT NULL              COMMENT '쿼리 제목',
        fields_json     TEXT         NOT NULL              COMMENT '선택 필드 JSON (스냅샷)',
        conditions_json TEXT         DEFAULT NULL           COMMENT '필터 조건 JSON (스냅샷)',
        group_by_json   TEXT         DEFAULT NULL           COMMENT 'GROUP BY JSON (스냅샷)',
        order_by        VARCHAR(100) DEFAULT NULL,
        order_dir       VARCHAR(10)  DEFAULT 'DESC',
        limit_val       INT          DEFAULT 1000,
        prompt          TEXT         DEFAULT NULL           COMMENT '추가 프롬프트',
        generated_sql   TEXT         DEFAULT NULL           COMMENT '생성된 SQL',
        memo            VARCHAR(500) DEFAULT NULL           COMMENT '공유 메모',
        is_read         TINYINT(1)   NOT NULL DEFAULT 0    COMMENT '읽음 여부',
        created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_shared_to   (to_user_id, created_at DESC),
        INDEX idx_shared_from (from_user_id),
        INDEX idx_history_id  (history_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='쿼리 공유 테이블'
    `);
    console.log('[Migration] 북마크/공유 테이블 준비 완료');

    // ============================================================
    // ontology_column 에 type (원가/비용 구분) 컬럼 추가
    //   NULL  → 구분 없음 (기본)
    //   '원가' → 원가 항목 (ZAMT006, ZAMT007, ...)
    //   '비용' → 비용 항목 (ZAMT048, ZAMT049, ...)
    // 자연어질의에서 "원가항목/비용항목" 키워드 매칭 시 그룹 컬럼 목록 노출.
    // ============================================================
    const [typeCols] = await pool.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ontology_column' AND COLUMN_NAME = 'type'`
    );
    if (typeCols.length === 0) {
      await pool.query(`ALTER TABLE ontology_column ADD COLUMN type VARCHAR(10) DEFAULT NULL COMMENT '원가/비용 구분 (원가|비용|NULL)' AFTER is_active`);
      await pool.query(`CREATE INDEX idx_ontology_type ON ontology_column(type)`);
      console.log('[Migration] ontology_column 에 type 컬럼 추가 완료');
    }
  } catch (e) {
    console.error('[Migration] 북마크/공유 마이그레이션 실패:', e.message);
  }
}

// ============================================================
// 자주질문(즐겨찾기) 마이그레이션
// ============================================================
// - 사용자가 자연어 질의 말풍선의 하트 아이콘으로 저장한 질문을
//   사용자별로 보관 (사이드 메뉴 "자주질문" 탭에서 재사용)
// - 같은 사용자/같은 질문은 1건만 보관 (UNIQUE KEY)
//   → 동일 텍스트 중복 저장 방지, 토글 시점에 INSERT/DELETE 로 단순 처리
// - query_hash: SHA1(LOWER(TRIM(query_text))) → UNIQUE KEY로 사용 (긴 질문 인덱싱 회피)
// - domain_code: 저장 시점의 활성 도메인 (PS/HL/MGMT) — 다중 도메인 사용자가 구분하기 위함
async function ensureFavoriteQuestionsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_favorite_questions (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        user_id         VARCHAR(50)  NOT NULL              COMMENT '소유자 user_id',
        query_text      TEXT         NOT NULL              COMMENT '저장된 질문 본문',
        query_hash      CHAR(40)     NOT NULL              COMMENT 'SHA1(LOWER(TRIM(query_text))) — 중복 방지용',
        domain_code     VARCHAR(20)  DEFAULT NULL          COMMENT '저장 시점의 도메인 (PS/HL/MGMT)',
        query_mode      VARCHAR(20)  DEFAULT NULL          COMMENT '저장 시점의 모드 (aggregate/analysis)',
        last_used_at    TIMESTAMP    NULL DEFAULT NULL     COMMENT '최근 클릭/재사용 시각',
        use_count       INT          NOT NULL DEFAULT 0    COMMENT '클릭/재사용 횟수',
        created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_query (user_id, query_hash),
        INDEX idx_user_created   (user_id, created_at DESC),
        INDEX idx_user_lastused  (user_id, last_used_at DESC)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='자연어 질의 자주질문(즐겨찾기) 저장'
    `);
    console.log('[Migration] 자주질문 테이블 준비 완료');
  } catch (e) {
    console.error('[Migration] 자주질문 마이그레이션 실패:', e.message);
  }
}

const httpServer = app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 NLQ Server running on http://0.0.0.0:${PORT}`);

  // 배치관리 테이블 자동 생성
  await ensureBatchJobsTable();

  // 배치 스케줄러 시작 (once/daily/monthly 자동 실행)
  startScheduler();

  // RBAC 테이블 자동 생성 + 시드 데이터
  await ensureRbacTables();

  // 업무영역 권한 테이블 자동 생성 + 시드 데이터 + 마이그레이션
  //  - RBAC 뒤에 배치: sys_aimd_user_areas 는 users.user_id FK를 참조하므로
  //    RBAC의 users 컬럼 정리(레거시 role 컬럼 drop 등) 이후 안전하게 실행됨
  await ensureBusinessAreaTables();

  // [2026-07-30] 오류 접수 테이블 자동 생성 (자연어 질의 오류 카드의 [오류 접수] 버튼용)
  await ensureErrorReportsTable();

  // [2026-06-16] users.password 평문 → SHA-256 일괄 마이그레이션 (멱등성 보장)
  await migrateUserPasswordsToSha256();

  // 빌더 히스토리 북마크/공유 마이그레이션
  await ensureBookmarkShareTables();

  // 자주질문(즐겨찾기) 테이블 마이그레이션
  await ensureFavoriteQuestionsTable();

  // 서버 시작 시 RAG 인덱스 자동 빌드 (비동기, 서버 응답에 영향 없음)
  try {
    // rag_embeddings 테이블 존재 확인
    const [tables] = await pool.query(
      `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.TABLES 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'rag_embeddings'`
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
    console.error('[RAG] 초기화 실패 (폴백 모드로 계속):', e.message || e);
    if (e.stack) console.error('[RAG] 스택:', e.stack);
    if (e.code) console.error('[RAG] 에러코드:', e.code);
    if (e.errno) console.error('[RAG] errno:', e.errno);
    ragReady = false;
  }
});

// ════════════════════════════════════════════════════════════════════
// [2026-06-29 PR #196] HTTP 서버 timeout 명시적 설정
// [2026-07-21 hotfix] 110s → 600s: 분석질문(다단계 LLM 호출) 이 110s 벽에
//   먼저 걸려 self-fetch 가 'fetch failed' 로 abort 되던 문제 해결.
// [2026-07-22 PR #247] aggregate(현황집계) 경로의 nginx 60s 504 해결을 위해
//   전 계층 타임아웃을 재정렬. 각 값은 환경변수로 운영 중 조정 가능.
// --------------------------------------------------------------------
// timeout 위계 (안쪽이 항상 더 짧음):
//
//  [NLQ aggregate(현황집계) 경로]
//   ① NLQ DB 쿼리 statement timeout  90s   ← NLQ_DB_QUERY_TIMEOUT_MS (L~1400)
//   ② LLM(GPT) 개별 호출               60~90s ← 각 openai.chat.completions.create
//   ③ 프론트 fetch(aggregate)          180s   ← index.html L1737
//   ④ Nginx proxy_read_timeout         240s   ← 운영 nginx.conf (DEPLOYMENT.md 안내)
//   ⑤ Express requestTimeout           600s   ← 여기 (SERVER_TIMEOUT_MS)
//   ⑥ Undici headersTimeout/bodyTimeout 600s  ← L29-33 (UNDICI_TIMEOUT_MS)
//
//  [NLQ analysis(분석질문) 경로 — async job + 폴링]
//   ① NLQ DB 쿼리 statement timeout  90s   ← 동일 (base/prior SQL 별)
//   ② AnalysisPlan 파이프라인          ~5~8분 ← 계획+실행+재계획+최종답변 다단계
//   ③ self-fetch AbortController      10분  ← runNlqJobInBackground
//   ④ 프론트 폴링 max-wait             6분   ← NLQ_ASYNC_MAX_WAIT_MS
//   ⑤ Express requestTimeout           10분  ← 여기 (개별 폴링 request 는 짧음)
//
//  [사용자 취소(Stop 버튼) — 타임아웃과 완전히 분리]
//   프론트 handleCancel() → currentAbortController.abort() 즉시 실행.
//   fetch signal 이 발화 → AbortError 로 UI 즉시 반응. 서버단 DB 쿼리는
//   서버측 max_statement_time 90s 안에 자연스럽게 종료됨.
// ════════════════════════════════════════════════════════════════════
const SERVER_TIMEOUT_MS = parseInt(process.env.BUILDER_SERVER_TIMEOUT_MS || '600000', 10); // 10분
// requestTimeout: 단일 요청 전체 (헤더+바디+처리) 의 최대 시간
httpServer.requestTimeout = SERVER_TIMEOUT_MS;
// headersTimeout: 헤더 수신까지의 최대 시간. requestTimeout 보다 약간 더 크게 둬야
//   Node.js 가 정상 동작 (https://nodejs.org/api/http.html#serverheaderstimeout)
httpServer.headersTimeout = SERVER_TIMEOUT_MS + 5000;
// keepAliveTimeout: Nginx upstream keepalive 사용 시, 클라이언트가 재사용하는
//   소켓을 서버가 먼저 끊지 않도록 65s (Nginx 기본 60s 보다 살짝 크게)
httpServer.keepAliveTimeout = 65000;
// .setTimeout(): 소켓 무응답 차단 (legacy API — 호환성용으로 같이 지정)
httpServer.setTimeout(SERVER_TIMEOUT_MS);
console.log(`[Boot] HTTP server timeouts: request=${SERVER_TIMEOUT_MS}ms, headers=${httpServer.headersTimeout}ms, keepAlive=${httpServer.keepAliveTimeout}ms`);
