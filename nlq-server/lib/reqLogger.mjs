// ============================================================
// nlq-server 요청 추적 로거 (Request-scoped Logger)
// ------------------------------------------------------------
// 목적:
//   /api/builder/* 엔드포인트의 timeout/오류 원인을 추적하기 위해
//   요청 단위(requestId)로 단계별 로그를 nlq-server 전용 파일에 기록.
//
// 사용자 요청 요약:
//   1) 로그 파일 위치: /data/analytics/logs/nlq-server.log (운영)
//      - 운영 디렉토리가 없는 환경(샌드박스/로컬)에서는 자동으로
//        $CWD/logs/nlq-server.log 로 fallback.
//      - 환경변수 NLQ_LOG_DIR 로 override 가능.
//   2) /api/builder/values/{field} : LLM 미사용 (llm_used=false), 단계 로그
//   3) /api/builder/query : 11개 stage 단계별 로그 (요청 수신 ~ 응답 반환)
//   4) Nginx 의 X-Request-Id 헤더가 있으면 그걸 사용, 없으면 자체 생성
//      → res.setHeader('X-Request-Id', ...) 로 응답 헤더에도 노출.
//
// 로그 형식: JSON 한 줄 (pino 표준)
//   → 운영팀이 `grep '"requestId":"abc"' nlq-server.log` 한 줄로 추적 가능
//   → jq 로 사람-친화적 추출 가능
// ============================================================

import fs from 'fs';
import path from 'path';
import pino from 'pino';

// ─── 로그 경로 결정 ────────────────────────────────────────
//
//   1순위: 환경변수 NLQ_LOG_DIR (운영팀이 명시 override 시)
//   2순위: /data/analytics/logs (운영 표준 경로 — 디렉토리 존재 + 쓰기 가능 시)
//   3순위: <cwd>/logs (샌드박스/로컬 fallback)
//
function resolveLogDir() {
  const candidates = [];
  if (process.env.NLQ_LOG_DIR) candidates.push(process.env.NLQ_LOG_DIR);
  candidates.push('/data/analytics/logs');
  candidates.push(path.join(process.cwd(), 'logs'));

  for (const dir of candidates) {
    try {
      // 디렉토리가 존재하고 쓰기 가능한지 검사
      if (fs.existsSync(dir)) {
        fs.accessSync(dir, fs.constants.W_OK);
        return { dir, source: dir === process.env.NLQ_LOG_DIR ? 'env' : (dir === '/data/analytics/logs' ? 'prod' : 'fallback') };
      }
    } catch (_) {
      // 권한 없음 → 다음 후보로
      continue;
    }
  }

  // 끝까지 못 찾으면 fallback 디렉토리 직접 생성
  const fallback = path.join(process.cwd(), 'logs');
  try {
    fs.mkdirSync(fallback, { recursive: true });
    return { dir: fallback, source: 'created' };
  } catch (e) {
    // 정말 마지막 보루: /tmp
    return { dir: '/tmp', source: 'tmp' };
  }
}

const { dir: LOG_DIR, source: LOG_DIR_SOURCE } = resolveLogDir();
const LOG_FILE = path.join(LOG_DIR, 'nlq-server.log');

// ─── pino 인스턴스 생성 (파일 append) ────────────────────────
//   - sync: false → 성능 영향 최소화 (배치 flush)
//   - 매 줄이 JSON 한 줄로 떨어짐 (Node-style 표준)
let _pinoLogger;
try {
  // 파일이 없으면 미리 생성 (touch) — 권한 문제 조기 감지
  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', { flag: 'a' });
  }
  const dest = pino.destination({ dest: LOG_FILE, sync: false, mkdir: false });
  _pinoLogger = pino({
    base: { service: 'nlq-server', pid: process.pid },
    timestamp: () => `,"ts":"${new Date().toISOString()}"`,
    formatters: {
      level: (label) => ({ level: label }),
    },
  }, dest);
} catch (initErr) {
  // 파일 쓰기 실패 시 stdout fallback (PM2 로그로 흘러감)
  console.error(`[reqLogger] 파일 로거 초기화 실패 → stdout fallback: ${initErr.message}`);
  _pinoLogger = pino({ base: { service: 'nlq-server', pid: process.pid } });
}

// 부팅 시 1회 — 로그 위치 자기 자신을 stdout 에도 알림 (PM2 로그에 1줄)
console.log(`[reqLogger] 로그 파일: ${LOG_FILE} (source=${LOG_DIR_SOURCE})`);
_pinoLogger.info({ stage: 'logger_init', log_file: LOG_FILE, log_dir_source: LOG_DIR_SOURCE }, 'reqLogger initialized');

// ─── requestId 생성 헬퍼 ────────────────────────────────────
//   12자 base36 (예: k7f3zq8a2x9m) — 충돌 가능성 무시 가능
function genReqId() {
  // crypto.randomUUID() 도 가능하지만 짧은 형태 선호 (로그 가독성)
  const t = Date.now().toString(36);                 // 시간 prefix (정렬 친화적)
  const r = Math.random().toString(36).slice(2, 10); // 8자 랜덤
  return (t + r).slice(0, 12);
}

// ─── Express 미들웨어: 모든 /api/* 요청에 requestId 부여 ──────
//   - Nginx 가 X-Request-Id 헤더로 보냈으면 그걸 사용 (요청 단위 연동)
//   - 없으면 자체 생성
//   - 응답에도 X-Request-Id 헤더 노출 (프론트에서 확인 가능)
export function requestIdMiddleware(req, res, next) {
  const headerId = (req.headers['x-request-id'] || '').toString().trim();
  // 화이트리스트: 영숫자/하이픈/언더스코어만 허용, 64자 이하 (헤더 인젝션 방어)
  const isSafe = /^[A-Za-z0-9_\-]{1,64}$/.test(headerId);
  req.requestId = isSafe ? headerId : genReqId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

// ─── 요청 단위 logger 팩토리 ────────────────────────────────
//   사용 예:
//     const log = createReqLogger(req, '/api/builder/query', { domain: 'PS' });
//     log.stage('request_received', { fields_count: 5 });
//     log.stage('llm_call_start', { timeout_ms: 20000 });
//     log.error('llm_call_timeout', err, { timeout_ms: 20000 });
//     log.stage('response_sent', { success: true });
//
export function createReqLogger(req, apiUrl, extra = {}) {
  const requestId = req.requestId || genReqId();
  const userId = (req.session && req.session.user && req.session.user.id) || null;
  const t0 = Date.now();

  const ctx = {
    requestId,
    api: apiUrl,
    userId,
    ...extra,
  };

  const stage = (name, data = {}) => {
    const elapsed_ms = Date.now() - t0;
    _pinoLogger.info({ stage: name, elapsed_ms, ...ctx, ...data });
  };

  const error = (name, err, data = {}) => {
    const elapsed_ms = Date.now() - t0;
    const exception = err && err.message ? err.message : (err ? String(err) : 'unknown');
    const stack = err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : null;
    _pinoLogger.error({ stage: name, elapsed_ms, exception, stack, ...ctx, ...data });
  };

  // 추가 컨텍스트를 나중에 누적할 수 있도록 with() 제공
  const withCtx = (more) => {
    Object.assign(ctx, more);
  };

  return { requestId, stage, error, withCtx, t0 };
}

// ─── 외부에서 직접 임시 로그를 찍고 싶을 때 ────────────────────
export const reqLogger = _pinoLogger;
export const LOG_FILE_PATH = LOG_FILE;
