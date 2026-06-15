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
app.use(express.urlencoded({ extended: true }));

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
    if (user.password !== password) {
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

    return res.json({
      loggedIn: true,
      user: u.id,
      name: u.name,
      role: roleCode,
      domain_code: latestDomainCode || null,
      active_domain: u.active_domain || latestDomainCode || null,
      menus: allowedMenus,
    });
  }
  return res.json({ loggedIn: false });
});

// 도메인 전환 API (모든 사용자가 분석 영역 전환 가능)
// ★ 세션 active_domain 변경 + users.domain_code 에도 영구저장 (최초 선택 후 재접속 시 자동 진입)
app.post('/api/me/domain', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: '로그인 필요' });
  const { domain_code } = req.body;
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

// 도메인 목록 API
app.get('/api/domains', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT domain_code, domain_name, sort_order FROM domain_master WHERE is_active = 1 ORDER BY sort_order');
    res.json(rows);
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
            if (u.password && String(u.password).trim()) {
              await conn.query(
                `UPDATE users SET name=?, password=?, email=?, group_name=?, group_id=?, parent_group_id=?, tenant_id=?, phone=?, position=?, role_id=?, is_active=1, sso_yn=1, updated_at=NOW() WHERE user_id=?`,
                [u.name, String(u.password).trim(), u.email || null, u.groupName || null, u.groupId || null, u.parentGroupId || null, u.tenantId || null, u.phone || null, u.position || null, reactivateRoleId, u.userId]
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
        const newPassword = (u.password && String(u.password).trim()) ? String(u.password).trim() : 'kleannara1!';
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
        if (u.password !== undefined && u.password !== null && String(u.password).trim() !== '') {
          updates.push('password=?'); vals.push(String(u.password).trim());
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
CO_AREA_NM   | VARCHAR(100)  | 관리회계 영역명
PROFIT_CTR   | VARCHAR(20)   | 손익 센터 (10자리, 선행0 포함. 예: 0000002000=제지사업부, 0000001000=생활용품사업부)
PROFIT_CTR_NM| VARCHAR(100)  | 손익센터명
DIVISION     | VARCHAR(5)    | 제품군 코드 (예: 10=PS, 20=HL)
DIVISION_NM  | VARCHAR(100)  | 제품군명
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
COUNTRY      | VARCHAR(5)    | 국가 코드 (예: KR)
COUNTRY_NM   | VARCHAR(100)  | 국가 명
BIC_ZKUNN2       | VARCHAR(20)   | 영업사원 코드
BIC_ZKUNN2_NM    | VARCHAR(100) | 영업사원 명
CUSTOMER     | VARCHAR(20)   | 고객 코드
CUSTOMER_NM  | VARCHAR(100)  | 고객 명
MATERIAL     | VARCHAR(30)   | 자재 코드 (예: FRT-NEE0004A)
MATERIAL_NM  | VARCHAR(100)  | 자재 명 (예: 깨끗한나라 2겹 화장지 45m 18롤)

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
// Metric Dictionary (AI가 수식을 창작하지 않고 이 사전만 참조)
// ============================================================
const METRIC_DICTIONARY = `
계산 지표 사전 (Metric Dictionary):
- 총매출 = SUM(ZAMT001)
- 판매장려금 = SUM(ZAMT002)
- 순매출 = SUM(ZAMT003)  [또는 SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004)]
- 매출원가 = SUM(ZAMT034)
- 매출총이익 = SUM(ZAMT003) - SUM(ZAMT034)  ★ [Metric 산식: 순매출 - 매출원가 계] (ZAMT035 단순 컬럼 대신 이 산식 사용!)
- 매출총이익률 = (SUM(ZAMT003) - SUM(ZAMT034)) / NULLIF(SUM(ZAMT003),0) * 100
- 판매관리비 = SUM(ZAMT036)
- 영업이익 = SUM(ZAMT055)
- 영업이익률 = SUM(ZAMT055) / NULLIF(SUM(ZAMT003),0) * 100
- 경상이익 = SUM(ZAMT064)
- BOX수량 = SUM(BIC_ZQTY_BOX)
- BAG수량 = SUM(BIC_ZQTY_BAG)
- EA수량 = SUM(BIC_ZQTY_KE)
- 평균단가(BOX) = SUM(ZAMT001) / NULLIF(SUM(BIC_ZQTY_BOX),0)
- 재료비합계 = SUM(ZAMT006)+SUM(ZAMT007)+SUM(ZAMT008)+SUM(ZAMT009)+SUM(ZAMT010)+SUM(ZAMT011)
- 인건비합계 = SUM(ZAMT012)+SUM(ZAMT013)+SUM(ZAMT014)
- 마케팅비합계 = SUM(ZAMT047)+SUM(ZAMT048)+SUM(ZAMT049)+SUM(ZAMT050)+SUM(ZAMT051)+SUM(ZAMT052)+SUM(ZAMT053)+SUM(ZAMT054)
`;

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
// System Prompt (RAG 기반 동적 생성)
// ============================================================
// 핵심 규칙만 포함한 경량 기본 프롬프트 (RAG 컨텍스트가 동적으로 추가됨)
const BASE_SYSTEM_PROMPT = `당신은 수익성 분석 데이터베이스 전문가입니다.
사용자의 자연어 질문을 MariaDB SQL로 변환합니다.

[★★★ 최우선 규칙 — 컬럼명 사용 (절대 위반 금지) ★★★]

■ 허용되는 컬럼명 — 아래 목록에 있는 컬럼만 SQL에 사용할 수 있습니다:
SEQ, CALYEAR, CALMONTH, CALDAY, CO_AREA, CO_AREA_NM, PROFIT_CTR, PROFIT_CTR_NM,
DIVISION, DIVISION_NM, PLANT, PLANT_NM, DISTR_CHAN, DISTR_CHAN_NM, BIC_ZDISTCHAN,
BIC_ZORG_TEAM, SALES_OFF, SALES_OFF_NM, MATL_TYPE, MATL_TYPE_NM, MATL_GROUP, MATL_GROUP_NM,
PRODH1, PRODH1_NM, PRODH2, PRODH2_NM, PRODH3, PRODH3_NM, PRODH4, PRODH4_NM,
BIC_ZJPCODE, BIC_ZJPCODE_NM, BIC_ZBRAND, BIC_ZBRAND_NM, BIC_ZSBRAND, BIC_ZSBRAND_NM,
BILL_TYPE, BILL_TYPE_NM, INCOTERMS, INCOTERMS_NM, CUST_GROUP, CUST_GROUP_NM,
CUST_GRP1, CUST_GRP1_NM, COUNTRY, COUNTRY_NM, BIC_ZKUNN2, BIC_ZKUNN2_NM,
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
  예) 매출총이익 → SUM(ZAMT035) ✗ → SUM(ZAMT003)-SUM(ZAMT034) ✓ (Metric 산식)
  예) 매출총이익률 → (SUM(ZAMT003)-SUM(ZAMT034))/NULLIF(SUM(ZAMT003),0)*100 ✓
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
4. 결과 행은 최대 1000행 (LIMIT 1000)
5. **금액 표시**: FORMAT(SUM(ZAMT***), 0) AS 별칭. **ORDER BY에는 FORMAT 별칭 사용 금지!** → ORDER BY SUM(ZAMT***) DESC 사용
6. 비율: ROUND(..., 1), 소수점 1자리
7. GROUP BY 시 반드시 집계 함수 사용
8. 컬럼 alias는 한글, 사용자가 이해하기 쉬운 의미 있는 이름 사용
9. 정렬: 금액 DESC, 코드 ASC
10. NULL 값 처리: 데이터가 없는 컬럼은 NULL 그대로 표시 (COALESCE/IFNULL로 '미상','Unknown' 등 문자열 치환 금지). 단, 금액/수량 집계에서 NULL→0 변환은 허용
11. _NM 명칭 컬럼 활용: 코드 컬럼 옆에 대응하는 _NM 컬럼이 있으면 함께 SELECT (CASE WHEN 불필요)
12. 코드매핑 컬럼은 GROUP BY 코드컬럼 + _NM 컬럼 함께 SELECT
13. 명칭으로 질문 시 코드값으로 WHERE
14. PROFIT_CTR: 10자리 선행0 (예: '0000002000')
15. 자재명: MATERIAL_NM (자재 명 컬럼)
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

[컬럼 최소화 원칙 - 매우 중요!]
- **질문에서 요청한 항목만 SELECT 하세요. 관련 있어 보이더라도 질문에 없는 항목은 절대 추가하지 마세요.**
- 예: "판매수량 합계"라고 하면 → BOX 수량(BIC_ZQTY_BOX) 하나만 사용. BAG수량, EA수량은 질문에 없으므로 포함 금지.
- 예: "총매출 합계"라고 하면 → SUM(ZAMT001) 하나만 사용. 순매출, 영업이익 등은 추가하지 마세요.
- 사용자가 "수량" 이라고만 하면 기본 단위는 BOX(BIC_ZQTY_BOX). BAG/EA는 사용자가 명시적으로 요청할 때만 포함.
- 사용자가 "모든 수량" 또는 "BOX, BAG, EA 수량"처럼 여러 단위를 명시한 경우에만 복수 수량 컬럼 사용.

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
  ✗ 금지: SELECT MATERIAL, MATERIAL_NM, FORMAT(SUM(ZAMT001),0) AS '총매출 합계(원)'
  ✓ 정답: SELECT MATERIAL AS '자재코드', MATERIAL_NM AS '자재명', FORMAT(SUM(ZAMT001),0) AS '총매출 합계(원)'
- 별칭에 적절한 단어가 떠오르지 않으면 DB COMMENT/학습관리 동의어 의미를 추론하여 한국어로 부여하세요 (예: PROFIT_CTR → '손익센터', CALMONTH → '연월', DISTR_CHAN_NM → '유통경로명').
- 예시 (전형적인 형태):
  SELECT MATERIAL AS '자재코드', MATERIAL_NM AS '자재명',
         FORMAT(SUM(BIC_ZQTY_BOX), 0) AS '판매수량 합계(BOX)',
         FORMAT(SUM(ZAMT001), 0) AS '총매출 합계(원)'

[★ 동일 키워드가 여러 컬럼에 매칭된 경우 — 매우 중요!]
- 사용자가 입력한 단어가 여러 컬럼에 매핑되어 있는 경우가 있습니다:
  • 동의어 다중 등록: "지급수수료" → ZAMT040(지급수수료(변동)) + ZAMT044(지급수수료(고정))
  • 동의어 + description 부분 일치: "소모품비" → ZAMT049(소모품비, 동의어매칭) + ZAMT019(수선/소모품비, description 부분포함)
  • 변동/고정 분리: "급여" → ZAMT037(급여(변동)) + ZAMT043(급여(고정))
- 이 경우 임의로 하나만 선택하면 안 되며, **매칭된 활성 컬럼을 모두 SELECT에 개별 컬럼으로 포함**해야 합니다.
- 각 컬럼의 AS 별칭은 **반드시 해당 컬럼의 description(학습관리 등록 설명)을 그대로 사용**하세요.
  사용자가 입력한 키워드("소모품비")를 별칭의 기준으로 쓰지 마세요. 각 컬럼의 등록 description이 기준입니다.

  ✗ 금지: SELECT FORMAT(SUM(ZAMT049),0) AS '소모품비 합계(원)'  → ZAMT019 누락
  ✗ 금지: SELECT FORMAT(SUM(ZAMT049)+SUM(ZAMT019),0) AS '소모품비 합계(원)'  → 통합 별칭 금지
  ✓ 정답: SELECT
            FORMAT(SUM(ZAMT049),0) AS '소모품비 합계(원)',          -- ZAMT049의 description "소모품비"
            FORMAT(SUM(ZAMT019),0) AS '수선/소모품비 합계(원)'      -- ZAMT019의 description "수선/소모품비"

  ✗ 금지: SELECT FORMAT(SUM(ZAMT040)+SUM(ZAMT044),0) AS '지급수수료 합계(원)'
  ✓ 정답: SELECT
            FORMAT(SUM(ZAMT040),0) AS '지급수수료(변동) 합계(원)',
            FORMAT(SUM(ZAMT044),0) AS '지급수수료(고정) 합계(원)'

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
     FORMAT(SUM(ZAMT001), 0) AS '총매출',
     FORMAT(SUM(ZAMT003), 0) AS '순매출',
     FORMAT(SUM(ZAMT005), 0) AS '매출원가',
     ...
   FROM bw_profitability_data
   WHERE 기준연월='2026-04'   -- WHERE에는 일반 컬럼 조건만!
   - 차원별로 보고 싶으면 GROUP BY 명시:
   SELECT 제품군, FORMAT(SUM(ZAMT001), 0) AS '매출'
   FROM bw_profitability_data
   WHERE 기준연월='2026-04'
   GROUP BY 제품군

4. FORMAT() 함수는 반드시 2개 인자: FORMAT(숫자표현, 소수자리수)
   ❌ 금지: FORMAT(SUM(ZAMT001))    → 인자 부족 에러
   ✅ 올바름: FORMAT(SUM(ZAMT001), 0)  ← 마지막 0 필수

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
      for (const m of metricMatches) {
        // column_name이 "CALC(...)" 또는 "SUM(...)" 형태이므로 괄호 내부만 추출하여 LLM에게 권장
        const formulaMatch = m.column_name.match(/^(\w+)\((.+)\)$/);
        const innerFormula = formulaMatch ? formulaMatch[2] : m.column_name;
        synonymContext += `- "${m.synonym}" (metric_code: ${m.metric_code || '?'})\n`;
        synonymContext += `  ▶ 반드시 사용할 SQL 표현식: ${innerFormula}\n`;
        synonymContext += `  ▶ FORMAT()이나 ORDER BY 등에도 동일하게 위 표현식을 그대로 복사해 사용하세요.\n`;
      }
      if (allRefCodes.size > 0) {
        synonymContext += `\n⛔ 절대 사용 금지 컬럼 (위 산식의 구성 요소 또는 매칭된 metric_code):\n`;
        synonymContext += `   ${[...allRefCodes].join(', ')}\n`;
        synonymContext += `   → 이 코드들을 SUM(코드) 또는 SUM(코드)±SUM(코드) 형태로 단순 합산하면 안 됩니다.\n`;
        synonymContext += `   → 반드시 위에 제시된 산식 표현식 전체를 그대로 SELECT 절에 넣으세요.\n`;
      }
      synonymContext += `\n예시) 매출총이익 산식이 "(SUM(ZAMT001)-SUM(ZAMT002)-SUM(ZAMT004))-(ZAMT026+SUM(ZAMT025)+ZAMT005)" 로 제공되면:\n`;
      synonymContext += `  ✗ 금지: SELECT SUM(ZAMT035)\n`;
      synonymContext += `  ✗ 금지: SELECT SUM(ZAMT003)-SUM(ZAMT034)\n`;
      synonymContext += `  ✗ 금지: SELECT SUM(ZAMT003-ZAMT034)\n`;
      synonymContext += `  ✓ 정답: SELECT (SUM(ZAMT001)-SUM(ZAMT002)-SUM(ZAMT004))-(SUM(ZAMT026)+SUM(ZAMT025)+SUM(ZAMT005))\n`;
      synonymContext += `         (제공된 산식 표현식을 그대로 복사하되, 산식 안에 SUM()으로 감싸지 않은 원시 컬럼이 있다면 SUM()으로 감싸도 됩니다)\n`;
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
              synonymContext += `     FORMAT(SUM(${m.column_name}), 0) AS '${safeAlias} 합계(원)'\n`;
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
  const domainNames = { PS: '생활용품사업부(PS)', HL: '홈앤라이프사업부(HL)', MGMT: '경영관리(MGMT)' };
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
    prompt = BASE_SYSTEM_PROMPT + domainCtx + synonymContext + '\n' + TABLE_SCHEMA + '\n' + METRIC_DICTIONARY
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
// Helper: Metric 산식 자동 치환 (SUM(단순컬럼) → Metric 산식)
// 학습 데이터 경로 + GPT 생성 경로 양쪽에서 재사용
// ============================================================
async function applyMetricFormulaReplacement(inputSql, domainCode) {
  if (!inputSql) return inputSql;
  try {
    const dc = domainCode || 'PS';
    // 도메인의 모든 CALC/SUM 산식 metric 로드 (TOTAL_XXX 패턴 제한 제거 — 운영은 ZAMT### 형태)
    const metricMap = await loadMetricMap(dc);
    if (!metricMap || Object.keys(metricMap).length === 0) return inputSql;

    let result = inputSql;
    const replacedCodes = [];

    // ★ [2026-06-15 정책] 산식 내부 재치환 방지
    // - 한 metric을 산식으로 치환한 직후, 그 산식 안에 또 다른 metric_code (예: ZAMT047) 가
    //   들어있더라도 후속 순회에서 다시 치환되지 않도록 placeholder 로 마스킹한다.
    // - 학습관리에 등록된 산식을 "그대로" SQL 에 반영하는 것이 정책.
    const protectedFormulas = [];
    const protectFormula = (expanded) => {
      const idx = protectedFormulas.length;
      protectedFormulas.push(`(${expanded})`);
      return `__MFR_PROT_${idx}__`;
    };

    // ★ [2026-06-15 추가 보강] raw DB 컬럼명을 metric_code 로 등록한 항목은 자동 치환 제외
    //   배경: 학습관리에 metric_code='ZAMT047' (raw 컬럼명과 동일) + formula='SUM(ZAMT048)+...+SUM(ZAMT054)' 를
    //         등록한 경우, 다른 metric (예: 영업이익) 산식 안의 SUM(ZAMT047) 까지 마케팅비 산식으로
    //         치환되어 거대 산식이 만들어지는 부작용 발생.
    //   정책: "사용자가 등록한 산식을 그대로 사용"하는 PR #154 정책의 자연스러운 확장 —
    //         산식 안의 ZAMT### 토큰은 항상 raw DB 컬럼으로 취급하므로,
    //         metric_code 가 ZAMT### 형식이어도 그 코드 자체를 산식으로 치환하지 않는다.
    //   영향: ZAMT### 형식의 metric_code 는 SUM(ZAMTxxx) → SUM(ZAMTxxx) 그대로 유지.
    //         일반 metric_code (OPERATING_PROFIT, MARKETING_COST 등) 는 정상 치환됨.
    const RAW_COLUMN_CODE_PATTERN = /^ZAMT\d+$/i;

    // 각 metric_code에 대해 SQL 안에서 단순 합산 패턴을 찾아 등록된 산식으로 치환
    // (산식 내부의 다른 metric_code 는 재귀 확장하지 않음 — expandMetricFormula 비-재귀화)
    for (const [code, meta] of Object.entries(metricMap)) {
      if (!meta || !meta.formula) continue;
      // ★ raw DB 컬럼명을 그대로 metric_code 로 등록한 항목은 자동 치환 제외
      if (RAW_COLUMN_CODE_PATTERN.test(code)) {
        console.log(`[NLQ] Metric 자동 치환 제외 (raw 컬럼 패턴): ${code} → SUM(${code}) 그대로 유지`);
        continue;
      }
      // 학습관리에 등록된 산식 그대로 (재귀 확장 없음)
      const expanded = expandMetricFormula(meta.formula, metricMap, new Set([code]), 0);
      if (!expanded || expanded === code) continue;

      // 패턴 1: SUM(METRIC_CODE) 같은 단순 합산 형태 → 등록된 산식으로 치환
      const sumPattern = new RegExp(`SUM\\s*\\(\\s*${code}\\s*\\)`, 'gi');
      if (sumPattern.test(result)) {
        const before = result;
        // 치환 후 즉시 placeholder 로 보호하여 후속 metric 순회 영향 차단
        result = result.replace(sumPattern, () => protectFormula(expanded));
        if (before !== result) {
          replacedCodes.push(`SUM(${code})`);
        }
      }

      // 패턴 2: 단독 토큰 형태 (예: SELECT METRIC_CODE ... 또는 FORMAT(METRIC_CODE, 0))
      // — 다른 metric_code의 부분 문자열로 매칭되지 않도록 \b 사용
      const bareTokenPattern = new RegExp(`\\b${code}\\b(?!\\s*\\()`, 'g');
      // SUM(...) 안의 코드는 위 패턴1에서 처리됐으므로 여기선 SUM 바깥의 것만 잡음
      if (bareTokenPattern.test(result)) {
        const before = result;
        // 남은 토큰을 등록된 산식으로 치환 후 placeholder 로 보호
        result = result.replace(bareTokenPattern, () => protectFormula(expanded));
        if (before !== result) {
          replacedCodes.push(code);
        }
      }
    }

    // placeholder 복원 — 보호된 산식을 원형 그대로 되돌림
    result = result.replace(/__MFR_PROT_(\d+)__/g, (_, i) => protectedFormulas[Number(i)] || '');

    if (replacedCodes.length > 0) {
      console.log(`[NLQ] Metric 자동 치환 적용: ${replacedCodes.join(', ')}`);
    }

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
- 거래처/고객은 CUSTOMER / CUSTOMER_NM, 영업사원은 ZKUNN2 / ZKUNN2_NM.
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
  if (/\bDIVISION\b\s*(=|<>|!=|<|>|\sIN\b|\sLIKE\b|\sBETWEEN\b)/i.test(inputSql)) {
    return inputSql;
  }

  // WHERE 절이 있는지 검사. 첫 번째 WHERE의 기존 조건을 괄호로 감싸고
  // 앞에 DIVISION = '<val>' AND 를 삽입.
  // WHERE의 종료 지점은 GROUP BY / HAVING / ORDER BY / LIMIT / UNION / 서브쿼리 끝 ')' / 세미콜론 / SQL 끝
  const whereTerminator = /(\bGROUP\s+BY\b|\bHAVING\b|\bORDER\s+BY\b|\bLIMIT\b|\bUNION\b|\)|;|$)/i;
  const whereRegex = /\bWHERE\b\s+/i;
  const whereMatch = whereRegex.exec(inputSql);

  let result;
  if (whereMatch) {
    const before = inputSql.slice(0, whereMatch.index + whereMatch[0].length);
    const rest = inputSql.slice(whereMatch.index + whereMatch[0].length);
    // rest 안에서 WHERE 종료 지점을 찾는다
    whereTerminator.lastIndex = 0;
    const termMatch = whereTerminator.exec(rest);
    let cond, tail;
    if (termMatch && termMatch[0]) {
      cond = rest.slice(0, termMatch.index).trim();
      tail = rest.slice(termMatch.index);
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
    whereTerminator.lastIndex = 0;
    const termMatch = whereTerminator.exec(rest);
    if (termMatch && termMatch.index > 0) {
      const head = rest.slice(0, termMatch.index);
      const tail = rest.slice(termMatch.index);
      result = `${before}${head} WHERE DIVISION = '${targetDivision}' ${tail}`;
    } else if (termMatch && termMatch.index === 0) {
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
app.post('/api/nlq', async (req, res) => {
  const { query, conversationContext, session_id, queryMode } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: '질의를 입력하세요.' });
  }
  const activeDomain = await getActiveDomain(req);
  // ★ 도메인 미설정 방어: users.domain_code가 NULL이고 세션에도 active_domain이 없으면
  //   프론트엔드에서 분석 영역 선택 모달을 띄우도록 안내 (조직도 자동매핑 제거 정책)
  if (!activeDomain) {
    return res.status(400).json({
      error: '분석 영역이 설정되지 않았습니다. PS / HL / MGMT 중 하나를 먼저 선택해 주세요.',
      need_domain_select: true,
    });
  }
  // ★ 질문 유형: 'aggregate'(현황집계: 표+SQL) | 'analysis'(분석질문: 텍스트만)
  //   기본값 'aggregate' — 프론트엔드 라디오에서 명시적으로 선택 (기존 자동 키워드 감지보다 우선)
  const userQueryMode = (queryMode === 'analysis') ? 'analysis' : 'aggregate';

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
      console.log(`[NLQ] 🧠 분석형 질문 처리 → 의도 분류 → 경로 분기`);
      try {
        // ============================================================
        // ★ 의도 분류: 사용자 질문이 개념설명 / 데이터분석 / 해석 중 무엇인지 판단
        // ============================================================
        const intent = await classifyAnalysisIntent(query, openai, GPT_MODEL);

        // ─────────────────────────────────────────────────────────
        // 경로 1: 개념/용어 설명 (concept) — DB 조회 없이 정의만
        // ─────────────────────────────────────────────────────────
        if (intent === 'concept') {
          console.log(`[NLQ] 분석경로 → concept (개념설명, DB 조회 생략)`);

          const conceptCompletion = await openai.chat.completions.create({
            model: GPT_MODEL,
            messages: [
              {
                role: 'system',
                content: `당신은 기업 수익성·재무 데이터 도메인 전문가입니다.
사용자가 용어나 개념의 정의를 물었습니다. 데이터 조회 없이 **개념/용어 정의만** 간결하게 설명하세요.

[답변 작성 규칙]
1. 정의를 한두 문장으로 명확하게 제시
2. 필요 시 예시 1~2개를 짧게 추가 (괄호 안 또는 한 줄)
3. **KPI 수치, 데이터 분석, 시사점, 제언은 절대 포함하지 말 것**
4. **"긍정적 시사점", "부정적 시사점", "제언" 같은 섹션 금지**
5. 한국어, 친절하고 전문적인 톤
6. 200~400자 이내로 핵심만
7. 마크다운 굵게(**)는 핵심 용어에만 최소한으로 사용
8. 데이터에 없는 내용 추측 금지
9. 모든 문장은 완결된 형태로 종료`,
              },
              { role: 'user', content: query },
            ],
            temperature: 0.2,
            max_tokens: 800,
          });

          let conceptAnswer = conceptCompletion.choices[0].message.content.trim();

          // ★ 후처리: 년월 굵게 (LLM이 빠뜨려도 보장)
          conceptAnswer = boldYearMonth(conceptAnswer);

          // 이력 저장 (SQL 없음)
          const nlqUserIdConcept = req.session?.user?.id || null;
          saveHistory(
            nlqUserIdConcept, query, null,
            conceptAnswer,
            'analysis',
            {},
            [],
            0, 0, 'SUCCESS', null, session_id || null, activeDomain
          ).catch(e => console.error('[History] 저장 실패:', e.message));

          return res.json({
            success: true,
            isAnalysisAnswer: true,
            answerType: 'concept',  // ★ 의도 유형 표기
            answer: conceptAnswer,
            analysis: conceptAnswer,
            rows: [],
            rowCount: 0,
            sql: null,
            explanation: null,
            chartType: 'analysis',
            chartConfig: {},
          });
        }

        // ─────────────────────────────────────────────────────────
        // 경로 2/3: data_analysis 또는 interpretation — DB 조회 필요
        // ─────────────────────────────────────────────────────────
        const dc = await getDataDateContext();
        dateContext = dc;
        const calmonth = extractCalmonthFromQuery(query, dc);
        const analysisSql = await buildAnalysisSQL(activeDomain, calmonth);
        console.log(`[NLQ] 분석경로 → ${intent} (CALMONTH=${calmonth})`);

        // 도메인 필터 자동 주입
        let finalSql = applyDomainFilter(analysisSql, activeDomain);
        // ※ Dummy 제외 SQL 자동주입 제거 — filterDummyRows() 후필터로만 처리

        // DB 실행 — 전체 KPI(overview)
        const startTime = Date.now();
        let rows;
        try {
          const r = await pool.query(finalSql);
          rows = filterDummyRows(r[0]);
        } catch (e) {
          console.warn('[NLQ] 전체 KPI 조회 실패 → 빈 결과로 진행:', e.message);
          rows = [];
        }
        const execTime = Date.now() - startTime;
        console.log(`[NLQ] 분석용 KPI SQL 실행: ${execTime}ms, ${rows.length}행`);

        // ★ NEW: 사용자 질문의 구체 대상을 좁혀 원인 분석용 보조 SQL을 LLM으로 생성·실행
        //   "왜 Blanq-Bright ... 매출이 갑자기 증가됐어?" 같은 질문에서
        //   품목/거래처/채널/단가/수량 등 다각도 데이터를 확보한다.
        let detailQueries = [];
        let detailResults = [];
        try {
          detailQueries = await generateAnalysisSqls(query, activeDomain, dc, conversationContext);
          if (detailQueries.length > 0) {
            console.log(`[NLQ] 원인분석 보조 SQL ${detailQueries.length}개 실행`);
            detailResults = await runAnalysisSqls(detailQueries);
          } else {
            console.log('[NLQ] 원인분석 보조 SQL 생성 결과 0개 (질문에서 구체 대상 식별 실패)');
          }
        } catch (e) {
          console.warn('[NLQ] 원인분석 보조 SQL 단계 전체 실패 (스킵):', e.message);
        }

        // LLM 분석 답변 생성
        const dateInfo = `[기간 참고] 당월=${dc.latestLabel}, 전월=${dc.prevLabel}. "당월", "이번달", "전월" 등 상대적 기간 표현 시 반드시 실제 년월을 괄호로 병기.`;
        // ★ 답변 출력 규칙 (전역 규칙) — analysis 경로
        const analysisFormatRule = `[답변 출력 규칙]\n- "YYYY년 M월" 형태의 년월 표현은 반드시 **굵게(마크다운 **)** 강조하세요. 예: **2026년 5월**\n- 조회 결과에 'Dummy' 값이 있으면 본문에 언급하지 마세요. (사용자에게 노출되지 않습니다)`;

        // ★ Metric(학습관리 산식) 정의 — 답변에서 지표명을 언급할 때 이 정의를 따르도록 LLM에 전달
        //   사용자가 학습관리에서 영업이익/매출총이익 등의 산식을 수정하면 즉시 반영됨.
        let metricDefinitionsBlock = '';
        try {
          const answerMetricMap = await loadMetricMap(activeDomain);
          const lines = [];
          for (const [code, meta] of Object.entries(answerMetricMap)) {
            if (!meta || !meta.description) continue;
            const expanded = expandMetricFormula(meta.formula, answerMetricMap, new Set([code]), 0);
            let sqlExpr;
            if (meta.aggregation === 'CALC') sqlExpr = expanded;
            else if (meta.aggregation === 'SUM') sqlExpr = `SUM(${expanded})`;
            else if (['AVG','COUNT','MAX','MIN'].includes(meta.aggregation)) sqlExpr = `${meta.aggregation}(${expanded})`;
            else sqlExpr = expanded;
            lines.push(`- **${meta.description}** = \`${sqlExpr}\``);
          }
          if (lines.length > 0) {
            metricDefinitionsBlock = `[★ 학습관리 등록 지표 정의 — 답변에서 아래 지표를 언급할 때 이 정의 그대로 따를 것]\n${lines.join('\n')}\n\n` +
              `※ 위 정의는 사용자가 학습관리 화면에서 등록한 산식입니다. 답변에서 영업이익/매출총이익 등의 수치를 인용할 때, 보조 조회 SQL이 위 정의대로 계산되었는지 확인하고 인용하세요. 만약 raw 컬럼(예: ZAMT055)을 단순 SUM한 결과를 가져왔는데 위 산식과 다르면, **그 수치를 답변에 그대로 옮기지 말고** "해당 지표는 학습관리 산식 기준으로 재계산이 필요합니다"로 안내하세요.`;
          }
        } catch (e) {
          console.warn('[NLQ] 답변용 metric 정의 로드 실패:', e.message);
        }

        const dataForAnalysis = rows.slice(0, 50);
        const overviewText = JSON.stringify(dataForAnalysis, (key, val) =>
          typeof val === 'bigint' ? Number(val) : val
        , 2);

        // 상세 분석 결과 직렬화
        const detailText = detailResults.length > 0
          ? detailResults.map((d, i) => {
              const rowsJson = JSON.stringify(d.rows, (k, v) => typeof v === 'bigint' ? Number(v) : v, 2);
              return `### 보조 조회 ${i+1}: ${d.label}\n[SQL]\n${d.sql}\n[결과 ${d.rowCount}행${d.error ? ` — 실행 오류: ${d.error}` : ''}]\n${rowsJson}`;
            }).join('\n\n')
          : '';

        const cmLabel = calmonth ? `${calmonth.substring(0,4)}년 ${parseInt(calmonth.substring(4,6))}월` : dc.latestLabel;

        // ─────────────────────────────────────────────────────────
        // 의도별 시스템 프롬프트 분기
        //   ★ 변경 핵심:
        //   - 고정 KPI 멘트/고정 섹션 강제 금지
        //   - 실제 조회 결과의 수치만으로 근거 작성
        //   - 데이터 부족 시 "최대한 추측 + 확정 불가" 명시
        // ─────────────────────────────────────────────────────────
        const commonRules = `[엄수 규칙 — 데이터 기반 답변]
- 답변은 반드시 아래 제공된 **실제 조회 결과의 수치**에 기반해서 작성하세요.
- "전체 KPI 기준", "일반적으로", "통상적으로" 같은 **고정 멘트/일반론 문구를 사용하지 마세요**.
- 데이터에 해당 수치가 있으면 **반드시 원문 그대로 인용**하세요 (예: "당월 순매출 12,345,678원").
- 상위/하위, 증가/감소, 비중 등을 말할 때 반드시 데이터의 구체 행을 근거로 들것.
- **고정된 "긍정 시사점/부정 시사점/제언" 섹션 구조를 기계적으로 붙이지 마세요.** 질문이 요구하는 답변에 집중하세요.
- 데이터에서 원인을 충분히 판단할 수 없으면, **현재 가용 데이터로 가능한 추측을 먼저 제시**한 뒤
  마지막에 한 줄로 "**현재 데이터만으로는 원인 확정이 어렵다**"고 명시하고, 어떤 추가 데이터가 있으면
  확정 가능한지(예: 거래처별 마진, 마케팅 캠페인 이력 등)를 1~2가지 제안하세요.
- 금액은 억/만 단위로 변환 (예: 45,409,440,210원 → 약 454억원). 단, 원본 숫자가 작으면 그대로 표기.
- 마크다운 형식(제목·볼드·리스트). 모든 문장은 완결되게 종료. 700자 내외.

[★ 지표 인용 규칙 — 학습관리 산식 준수]
- 영업이익, 매출총이익, 매출원가, 판매관리비, 마케팅비, 순매출 등 **학습관리에 등록된 지표**를 답변에서 언급할 때,
  사용자 메시지에 함께 제공된 [학습관리 등록 지표 정의]의 산식을 기준으로만 해석·인용하세요.
- 보조 조회 SQL이 지표 정의와 다르게(예: 등록된 산식은 \`SUM(ZAMT035)-SUM(ZAMT036)-...\` 인데 보조 조회는 \`SUM(ZAMT055)\` 만 사용) 계산된 경우,
  **그 수치를 답변에 그대로 옮기지 말고** "해당 지표는 학습관리 산식 기준으로 재계산이 필요합니다"로 안내하세요.
- 임의로 지표 산식을 추측해서 새로 만들어 인용하지 마세요. 등록된 정의에 없는 지표는 raw 데이터로만 설명하세요.`;

        let analysisSystemPrompt;
        if (intent === 'data_analysis') {
          analysisSystemPrompt = `당신은 기업 수익성 분석 전문 컨설턴트입니다.
사용자가 **특정 데이터의 조회/분석**을 요청했습니다. 데이터 수치를 정확히 인용해 답변하세요.

${commonRules}

[추가 지침]
- 사용자가 묻는 항목의 수치를 먼저 명확히 제시한 뒤, 보조 데이터로 맥락을 더하세요.
- 시사점/제언은 사용자가 명시적으로 요청했을 때만 1~2줄.`;
        } else {
          // interpretation: 원인·시사점·제언
          analysisSystemPrompt = `당신은 기업 수익성 분석 전문 컨설턴트입니다.
사용자가 **원인 분석/시사점/해석**을 요청했습니다. 제공된 데이터에 입각해 원인을 추적·설명하세요.

${commonRules}

[원인 분석 접근 방식 — 가능한 한 다음 관점을 데이터로 확인]
1. 전월/당월 수치 비교 (절대값·증가액·증가율)
2. 판매수량 변동 vs 단가 변동 (수량 효과 vs 가격 효과)
3. 거래처/채널/플랜트/손익센터별 기여도 (특정 거래처가 견인했는가?)
4. 신규 매출(전월 0)인지 vs 기존 거래처 반복 매출의 확대인지
5. 일회성 대량 거래의 가능성

각 관점 중 **데이터로 확인 가능한 것만** 짧게 근거 인용. 확인 불가한 관점은 가설로 1~2가지 제안.`;
        }

        const hasAnyData = (rows && rows.length > 0) || detailResults.some(d => d.rowCount > 0);
        const metricBlockForUser = metricDefinitionsBlock ? `${metricDefinitionsBlock}\n\n` : '';
        const userContent = hasAnyData
          ? `${dateInfo}\n\n${analysisFormatRule}\n\n${metricBlockForUser}[사용자 질문]\n${query}\n\n[분석 대상 기간] ${cmLabel}\n\n` +
            (rows.length > 0
              ? `[참고용 — 도메인 전체 KPI 합계 (단일 행)]\n${overviewText}\n\n`
              : '') +
            (detailText
              ? `[★ 원인 분석용 상세 조회 결과 — 이 데이터를 핵심 근거로 답변하세요]\n${detailText}\n\n`
              : `[원인 분석용 상세 조회 결과 없음]\n질문에서 구체 대상(품목/거래처 등)을 식별하지 못했거나 조회 결과가 0행입니다. 가용 데이터만으로 답하되, 마지막에 "현재 데이터만으로는 원인 확정이 어렵다"고 명시하세요.\n\n`) +
            `위 데이터에 입각해 사용자 질문에 답하세요. 고정 KPI 멘트나 일반론은 절대 쓰지 마세요. 영업이익/매출총이익/매출원가 등 학습관리에 등록된 지표는 위 [학습관리 등록 지표 정의]의 산식 기준으로만 인용하세요.`
          : `${dateInfo}\n\n${analysisFormatRule}\n\n${metricBlockForUser}[사용자 질문]\n${query}\n\n[분석 대상 기간] ${cmLabel}\n\n[조회 결과]: 0행 (전체 KPI·보조 조회 모두 결과 없음)\n\n해당 기간/대상의 데이터가 없습니다. 사용자에게 가능한 원인(미적재/대상명 불일치 등)을 친절히 안내하고, "**현재 데이터만으로는 원인 확정이 어렵다**"로 마무리하세요.`;

        const analysisCompletion = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            { role: 'system', content: analysisSystemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
          max_tokens: 3000,
        });

        let analysis = analysisCompletion.choices[0].message.content.trim();
        const analysisFinishReason = analysisCompletion.choices[0].finish_reason;
        if (analysisFinishReason === 'length' && analysis.length > 0) {
          const lastCleanEnd = Math.max(
            analysis.lastIndexOf('다.'),
            analysis.lastIndexOf('요.'),
            analysis.lastIndexOf('세요.'),
            analysis.lastIndexOf('니다.'),
            analysis.lastIndexOf('시오.'),
          );
          if (lastCleanEnd > analysis.length * 0.5) {
            const cutPos = analysis.indexOf('.', lastCleanEnd) + 1;
            analysis = analysis.substring(0, cutPos).trim();
          }
        }

        // ★ 후처리: 년월 굵게 (LLM이 빠뜨려도 보장)
        analysis = boldYearMonth(analysis);

        // 이력 저장 (분석형은 표·차트 없이; 분석 본문은 explanation 필드에 저장)
        const nlqUserIdAnalysis = req.session?.user?.id || null;
        saveHistory(
          nlqUserIdAnalysis, query, finalSql,
          analysis,        // ★ explanation 필드에 분석 본문 저장 (history 복원 시 사용)
          'analysis',      // chartType
          {},               // chartConfig
          [],               // result_data: 분석형은 표 표시 안 하므로 비움
          rows.length, execTime, 'SUCCESS', null, session_id || null, activeDomain
        ).catch(e => console.error('[History] 저장 실패:', e.message));

        // 응답: 표·차트·SQL 모두 노출하지 않고 텍스트 분석만 노출
        return res.json({
          success: true,
          isAnalysisAnswer: true,        // ★ 프론트에서 표/SQL 탭을 숨길 수 있도록 표식
          answerType: intent,             // ★ 의도 유형 표기 (data_analysis | interpretation)
          answer: analysis,
          analysis: analysis,             // 호환성 위해 양쪽으로 제공
          rows: [],                       // 표 데이터 비움
          rowCount: 0,
          sql: null,                      // SQL 노출 안 함
          explanation: null,
          chartType: 'analysis',
          chartConfig: {},
        });
      } catch (analysisErr) {
        // ★ 분석 경로 실패 시: 친절한 안내 + 진단용 상세 에러 정보 함께 반환
        //   클라이언트의 "오류 상세보기" 토글에서 원인을 직접 확인할 수 있도록.
        console.error('[NLQ] 분석 경로 실패:', analysisErr);
        const errMsg = analysisErr?.sqlMessage || analysisErr?.message || String(analysisErr);
        const errStack = analysisErr?.stack ? String(analysisErr.stack).split('\n').slice(0, 5).join('\n') : '';
        const errCode = analysisErr?.code || analysisErr?.errno || analysisErr?.status || '';
        return res.json({
          success: false,
          isAnalysisAnswer: true,
          answer: '죄송합니다. 분석 답변을 생성하는 중 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
          rows: [],
          rowCount: 0,
          sql: null,
          error_user_friendly: true,
          // ★ 상세 진단 정보 (클라이언트 "오류 상세보기"에서 표시)
          error_detail: {
            stage: 'analysis_path',
            phase: 'analysis_path',     // (deprecated alias)
            message: errMsg,
            code: errCode || null,
            stack: errStack || null,
            query,
            queryMode: userQueryMode,
            intent: typeof intent !== 'undefined' ? intent : null,
            calmonth: typeof calmonth !== 'undefined' ? calmonth : null,
            domain: activeDomain,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    if (matchedSql) {
      // 학습 데이터 매칭 → AI 호출 없이 직접 사용
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
      // ★ GPT 생성 SQL에도 Metric 산식 자동 치환 적용 (GPT가 프롬프트를 무시하고 단순 컬럼 사용 시 안전장치)
      sql = await applyMetricFormulaReplacement(sql, activeDomain);
      // answer는 1단계에서 무시 — SQL 실행 후 결과 기반으로 4-A에서 생성
      explanation = parsed.explanation;
      chartType = parsed.chartType;
      chartConfig = parsed.chartConfig;
      analysisRequired = parsed.analysisRequired === true;
      // ★ 사용자가 '현황집계' 라디오 선택 시 GPT가 analysisRequired:true로 응답해도 강제 false
      //   → 표+SQL만 노출, 분석 답변 생성 단계(4-B) 우회
      if (userQueryMode === 'aggregate' && analysisRequired) {
        console.log(`[NLQ] 사용자 '현황집계' 선택 — GPT의 analysisRequired:true 무시 (강제 false)`);
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
    sql = applyDomainFilter(sql, activeDomain);
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
          sql = applyDomainFilter(sql, activeDomain);
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
    const startTime = Date.now();
    let rows;
    try {
      [rows] = await pool.query(sql);
      // ★ Dummy 행 후필터 (SQL 자동주입이 안 닿은 케이스 안전망)
      rows = filterDummyRows(rows);
    } catch (dbErr) {
      // DB 실행 실패 시에도 친절한 메시지로 변환
      const errMsg = dbErr.sqlMessage || dbErr.message || '';
      console.error(`[NLQ] DB 실행 실패: ${errMsg}`);
      console.error(`[NLQ] 실패 SQL: ${sql}`);

      // 사용자 친화적 에러 메시지로 변환
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

      // 실패 이력 저장
      const failUserId = req.session?.user?.id || null;
      saveHistory(failUserId, query, sql, null, null, null, null, 0, 0, 'FAILED', errMsg, session_id || null, activeDomain)
        .catch(e => console.error('[History] 실패이력 저장 실패:', e.message));

      return res.json({
        success: false,
        sql,
        rows: [],
        rowCount: 0,
        answer: friendly,
        explanation: `DB 실행 오류: ${errMsg}`,
        error_user_friendly: true,
      });
    }
    const execTime = Date.now() - startTime;

    console.log(`[NLQ] SQL 실행: ${execTime}ms, ${rows.length}행`);

    // 4-A. SQL 결과 기반 사용자 친화적 answer 생성 (항상 결과 데이터를 보고 생성)
    try {
      const sampleData = rows.slice(0, 20);
      const sampleText = JSON.stringify(sampleData, (k, v) => typeof v === 'bigint' ? Number(v) : v);

      // 날짜 컨텍스트 (dateContext가 없으면 폴백)
      const dc = dateContext || await getDataDateContext();
      const dateHint = `[기간 참고] 당월=${dc.latestLabel}, 전월=${dc.prevLabel}. "당월","이번달","전월" 등의 표현에는 반드시 실제 년월을 괄호로 병기하세요. 예: "당월(${dc.latestLabel})", "전월(${dc.prevLabel})"`;
      // ★ 답변 출력 규칙 (전역 규칙)
      const formatRule = `[답변 출력 규칙]\n- "YYYY년 M월" 형태의 년월 표현은 반드시 **굵게(마크다운 **)** 강조하세요. 예: **2026년 5월**\n- 조회 결과에 'Dummy' 값이 있으면 본문에 언급하지 마세요. (사용자에게 노출되지 않습니다)`;

      const answerCompletion = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          {
            role: 'user',
            content: `아래 데이터 조회 결과를 보고, 질문에 대한 답변을 1~2문장의 자연스러운 한국어로 작성해주세요.
SQL/컬럼명/기술용어는 쓰지 마세요. 금액은 억/만 단위로 표현하세요.
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
2. 핵심 수치 인용 (예: "총매출 454억원")
3. 긍정/부정 시사점 균형 제시
4. 실행 가능한 제언 1~3개
5. 금액은 억/만 단위 (예: 45,409,440,210원 → 약 454억원)
6. 한국어 답변
7. 데이터에 없는 내용 추측 금지
8. 조회 결과 0행: 원인과 대안을 간단히 제안
9. "당월", "전월", "이번달" 등 상대적 기간 표현 시 반드시 실제 년월을 괄호로 병기 (예: "당월(2026년 4월)")

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
      rowCount: rows.length,
      executionTimeMs: execTime,
      ragEnabled: ragReady,
      ragInfo: ragInfo,
      analysis: analysis,  // 분석형 질문이면 텍스트 답변 포함
    };

    // 5. 이력 저장 (비동기, 실패해도 응답에 영향 없음)
    const nlqUserId = req.session?.user?.id || null;
    saveHistory(nlqUserId, query, sql, explanation, chartType || 'table', chartConfig || {}, rows, rows.length, execTime, 'SUCCESS', null, session_id || null, activeDomain)
      .catch(e => console.error('[History] 저장 실패:', e.message));

    return res.json(result);
  } catch (err) {
    console.error('[NLQ] Error:', err);
    const msg = err.sqlMessage || err.message || String(err);
    const errStack = err?.stack ? String(err.stack).split('\n').slice(0, 5).join('\n') : '';
    const errCode = err?.code || err?.errno || err?.status || '';

    // 실패 이력도 저장
    const nlqUserId = req.session?.user?.id || null;
    saveHistory(nlqUserId, query, null, null, null, null, null, 0, 0, 'FAILED', msg, session_id || null, activeDomain)
      .catch(e => console.error('[History] 실패이력 저장 실패:', e.message));

    // ★ 상세 진단 정보 함께 반환 (클라이언트 "오류 상세보기"에서 표시)
    return res.status(500).json({
      error: msg,
      query,
      error_detail: {
        stage: 'top_level',
        phase: 'top_level',
        message: msg,
        code: errCode || null,
        stack: errStack || null,
        query,
        queryMode: userQueryMode,
        domain: activeDomain,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

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
// ============================================================
async function saveHistory(userId, queryText, sql, explanation, chartType, chartConfig, resultData, rowCount, execTime, status, errorMsg, sessionId, domainCode) {
  // result_data는 최대 100행만 저장 (DB 용량 절약)
  const trimmedData = resultData ? JSON.stringify(resultData.slice(0, 100)) : null;
  const configJson = chartConfig ? JSON.stringify(chartConfig) : null;
  await pool.query(
    `INSERT INTO nl_query_history (user_id, session_id, domain_code, query_text, generated_sql, explanation, chart_type, chart_config, result_data, row_count, execution_time_ms, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId || null, sessionId || null, domainCode || null, queryText, sql, explanation, chartType, configJson, trimmedData, rowCount, execTime, status, errorMsg]
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
    const result = rows.map(r => ({
      ...r,
      chart_config: r.chart_config ? JSON.parse(r.chart_config) : null,
      result_data: r.result_data ? JSON.parse(r.result_data) : null,
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

// 추가
app.post('/api/ontology', requireAdmin, async (req, res) => {
  const { column_name, table_name, description, data_type } = req.body;
  const dc = req.body.domain_code || await getActiveDomain(req);
  if (!column_name) return res.status(400).json({ error: 'column_name 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO ontology_column (domain_code, column_name, table_name, description, data_type) VALUES (?,?,?,?,?)',
      [dc, column_name, table_name || 'bw_profitability_data', description || '', data_type || '']
    );
    // is_active 는 DB DEFAULT 1 로 자동 활성화됨
    res.json({ id: r.insertId, domain_code: dc, column_name, table_name: table_name || 'bw_profitability_data', description, data_type, is_active: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정
app.put('/api/ontology/:id', requireAdmin, async (req, res) => {
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

app.post('/api/metric', requireAdmin, async (req, res) => {
  const { metric_code, aggregation, formula, table_name, description } = req.body;
  const dc = req.body.domain_code || await getActiveDomain(req);
  if (!metric_code || !formula) return res.status(400).json({ error: 'metric_code, formula 필수' });
  try {
    const [r] = await pool.query(
      'INSERT INTO metric (domain_code, metric_code, aggregation, formula, table_name, description) VALUES (?,?,?,?,?,?)',
      [dc, metric_code, aggregation || 'SUM', formula, table_name || 'bw_profitability_data', description || '']
    );
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
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/metric/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM metric_synonym WHERE metric_id=?', [req.params.id]);
    await pool.query('DELETE FROM metric WHERE id=?', [req.params.id]);
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
    res.json({ id: r.insertId, synonym_text });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/metric/synonym/:synId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM metric_synonym WHERE id=?', [req.params.synId]);
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
    const finalSql = feedback_type === 'correct' ? original_sql : (corrected_sql || original_sql);
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
      'CUST_GRP1': 'trade', 'CUST_GRP1_NM': 'trade', 'COUNTRY': 'trade', 'COUNTRY_NM': 'trade', 'BIC_ZKUNN2': 'trade', 'BIC_ZKUNN2_NM': 'trade', 'CUSTOMER': 'trade', 'CUSTOMER_NM': 'trade',
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
app.get('/api/builder/values/:columnName', async (req, res) => {
  const { columnName } = req.params;
  try {
    // 화이트리스트 검증
    const [check] = await pool.query(`
      SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bw_profitability_data' AND COLUMN_NAME = ?
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
  const { fields, conditions, group_by, order_by, order_dir, limit: limitStr, prompt,
          date_start, date_end, compare_yoy, compare_mom, compare_dims, history_id } = req.body;

  console.log(`[Builder] 요청: fields=${fields?.length}, compare_mom=${compare_mom}, compare_yoy=${compare_yoy}, date=${date_start}~${date_end}, compare_dims=${JSON.stringify(compare_dims)}`);

  if (!fields || fields.length === 0) {
    return res.status(400).json({ error: '조회할 필드를 하나 이상 선택해주세요.' });
  }

  // 날짜 조건 필수 검증
  if (!date_start || !date_end || date_start.length !== 6 || date_end.length !== 6) {
    return res.status(400).json({ error: '날짜 조건(시작/종료 년월)을 설정해주세요.' });
  }

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
          resolved = resolved.replace(/\b([A-Z][A-Z0-9_]+)\b(?!\s*\()/g, (match) => {
            // SQL 키워드/함수는 제외
            if (['SUM','AVG','COUNT','MAX','MIN','NULLIF','COALESCE','CASE','WHEN','THEN','ELSE','END','AND','OR','NOT','NULL','AS'].includes(match)) return match;
            // 이미 SUM()등으로 감싸져 있으면 스킵 (lookbehind는 위 regex에서 처리)
            return `SUM(\`${match}\`)`;
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
      } catch (metErr) {
        console.error('[Builder] Metric formula 조회 오류:', metErr.message);
      }
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
          if (['=','!=','>','>=','<','<='].includes(op)) {
            clause = `\`${col}\` ${op} ?`; paramArr.push(val);
          } else if (op === 'LIKE') {
            clause = `\`${col}\` LIKE ?`; paramArr.push(`%${val}%`);
          } else if (op === 'NOT LIKE') {
            clause = `\`${col}\` NOT LIKE ?`; paramArr.push(`%${val}%`);
          } else if (op === 'IN') {
            const inVals = String(val).split(',').map(v => v.trim()).filter(v => v);
            if (inVals.length === 0) continue;
            clause = `\`${col}\` IN (${inVals.map(() => '?').join(',')})`;
            paramArr.push(...inVals);
          } else if (op === 'IS NULL') { clause = `\`${col}\` IS NULL`;
          } else if (op === 'IS NOT NULL') { clause = `\`${col}\` IS NOT NULL`;
          } else if (op === 'BETWEEN') {
            const bVals = String(val).split(',').map(v => v.trim());
            if (bVals.length !== 2) continue;
            clause = `\`${col}\` BETWEEN ? AND ?`; paramArr.push(bVals[0], bVals[1]);
          } else { clause = `\`${col}\` = ?`; paramArr.push(val); }
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

    // ═══════════════════════════════════════════════
    // 일반 모드 (비교 없음): 사용자가 명시 선택한 필드만 SELECT/GROUP BY
    // (이전: CALMONTH 자동 첫 컬럼 추가 → 정책 변경: 사용자 명시 선택만 처리)
    // 프론트엔드에서 기간 필드(CALMONTH/CALDAY) 미선택 시 피벗 실행 차단
    // ═══════════════════════════════════════════════
    } else {
      const selectParts = [];
      for (const f of fields) {
        const col = f.column;
        const agg = f.aggregate;
        const alias = f.alias || col;
        const isMetric = col.startsWith('METRIC__') && metricFormulaMap[col];
        if (isMetric) {
          // Metric: 산식 그대로 사용 (SUM 등이 이미 포함됨)
          selectParts.push(`(${metricFormulaMap[col].formula}) AS \`${alias}\``);
        } else if (agg && ['SUM','COUNT','AVG','MAX','MIN'].includes(agg.toUpperCase())) {
          selectParts.push(`${agg.toUpperCase()}(\`${col}\`) AS \`${alias}\``);
        } else {
          selectParts.push(`\`${col}\` AS \`${alias}\``);
        }
      }

      const whereParts = [];
      finalParams = [];

      if (date_start === date_end) {
        whereParts.push('`CALMONTH` = ?');
        finalParams.push(date_start);
      } else {
        whereParts.push('`CALMONTH` BETWEEN ? AND ?');
        finalParams.push(date_start, date_end);
      }
      const userWhere = buildUserConditions(finalParams);
      if (userWhere) whereParts.push(userWhere);

      // GROUP BY
      // 정책: 사용자가 명시 선택한 group_by 필드만 처리 (CALMONTH/CALDAY 자동 추가 없음)
      // 프론트엔드에서 기간 필드(CALMONTH/CALDAY) 미선택 시 피벗 실행이 차단됨
      const groupParts = [];
      if (group_by && group_by.length > 0) {
        for (const g of group_by) {
          // Metric 필드는 GROUP BY에서 제외 (산식이므로)
          if (g.startsWith('METRIC__')) continue;
          if (validCols.has(g)) groupParts.push(`\`${g}\``);
        }
      }

      let orderClause = '';
      if (order_by) {
        const dir = (order_dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        orderClause = `ORDER BY \`${order_by}\` ${dir}`;
      }

      sql = `SELECT ${selectParts.join(', ')} FROM bw_profitability_data`;
      if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(' ')}`;
      if (groupParts.length > 0) sql += ` GROUP BY ${groupParts.join(', ')}`;
      if (orderClause) sql += ` ${orderClause}`;
      sql += ` LIMIT ${safeLimit}`;
    }

    // GPT SQL 보완: 추가 프롬프트가 있을 때만 사용
    const needGpt = prompt && prompt.trim();
    if (needGpt) {
      try {
        let resolvedSql = sql;
        let paramIdx = 0;
        resolvedSql = resolvedSql.replace(/\?/g, () => {
          const v = finalParams[paramIdx++];
          if (v === null || v === undefined) return 'NULL';
          if (typeof v === 'number') return String(v);
          return `'${String(v).replace(/'/g, "''")}'`;
        });
        const userPromptText = `\n\n[추가 요청]\n${prompt}`;
        const gptPrompt = `[테이블 스키마]\n${TABLE_SCHEMA}\n\n[기본 SQL]\n${resolvedSql}${userPromptText}\n\n위 기본 SQL을 기반으로 요청사항을 반영한 완성된 SELECT 문을 작성해주세요.\n반드시 위 스키마에 존재하는 컬럼명만 사용하세요.\nWHERE 조건의 값은 반드시 리터럴 값으로 직접 작성하세요 (? 파라미터 바인딩 사용 금지).\nSELECT 문만 작성하고 JSON 형식이 아닌 순수 SQL만 반환하세요.`;
        const completion = await openai.chat.completions.create({
          model: GPT_MODEL,
          messages: [
            { role: 'system', content: '당신은 SQL 전문가입니다. 주어진 기본 SQL을 기반으로 요청사항을 반영한 SELECT 문만 작성하세요.\n중요 규칙:\n1. 반드시 제공된 테이블 스키마에 존재하는 컬럼명만 사용하세요.\n2. "매출"은 ZAMT001(총매출), "순매출"은 ZAMT003 등 스키마의 한국어 설명을 참고하여 올바른 컬럼을 매핑하세요.\n3. 존재하지 않는 컬럼명을 임의로 생성하지 마세요.\n4. SELECT 문 이외의 DML(INSERT, UPDATE, DELETE) 및 DDL(DROP, ALTER, CREATE, TRUNCATE)은 절대 생성하지 마세요.\n5. 결과 컬럼에 한글 alias를 사용하세요.\n6. WHERE 조건의 CALMONTH 범위를 절대 변경하지 마세요.' },
            { role: 'user', content: gptPrompt },
          ],
          temperature: 0.1,
        });
        let gptSql = completion.choices[0].message.content.trim();
        gptSql = gptSql.replace(/```sql\s*/gi, '').replace(/```\s*/g, '').trim();
        const forbidden = ['INSERT','UPDATE','DELETE','DROP','ALTER','TRUNCATE','CREATE'];
        const isSafe = !forbidden.some(w => new RegExp('\\b' + w + '\\b', 'i').test(gptSql));
        if (isSafe && /^SELECT/i.test(gptSql)) {
          sql = gptSql;
          finalParams = [];
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

    // 실행 시간 계산
    const startTime = Date.now();
    // (이미 위에서 쿼리 실행 완료됨, execTime은 대략적 값)

    // 히스토리 자동 저장 (비동기, 실패해도 응답에 영향 없음)
    const histUserId = req.session?.user?.id || null;
    const activeDomain = await getActiveDomain(req);
    const savedId = saveBuilderHistory(histUserId, fields, conditions, group_by, order_by, order_dir, limitStr, prompt, sql, clean.length, 0, 'SUCCESS', null, history_id || null, activeDomain)
      .catch(e => { console.error('[Builder History] 저장 실패:', e.message); return null; });

    // 비교모드일 때 compare_info 포함
    const hid = await savedId;
    const responseObj = { success: true, sql, columns: cols, rows: clean, row_count: clean.length, chart, history_id: hid || null };
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
    res.json(responseObj);
  } catch (err) {
    console.error('[Builder] query error:', err.message);
    // 실패 이력도 저장
    const histUserId = req.session?.user?.id || null;
    const activeDomain = await getActiveDomain(req);
    saveBuilderHistory(histUserId, fields, conditions, group_by, order_by, order_dir, limitStr, prompt, null, 0, 0, 'FAILED', err.message, null, activeDomain)
      .catch(e => console.error('[Builder History] 실패이력 저장 실패:', e.message));
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
// ============================================================
app.patch('/api/builder/history/:id/bookmark', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: '로그인이 필요합니다.' });
    // 현재 상태 조회 후 토글
    const [rows] = await pool.query('SELECT is_bookmarked FROM builder_query_history WHERE id=?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '이력을 찾을 수 없습니다.' });
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
// 전체 사용자 목록 (조직도 경로 포함 + RBAC role_id)
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.user_id, u.name, u.group_name, u.group_id, u.role_id, u.domain_code, u.is_active,
              COALESCE(r.role_code, 'user') AS role_code, r.role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.id`
    );
    // 각 사용자의 조직도 경로 구성
    const result = [];
    for (const row of rows) {
      let orgPath = '';
      if (row.group_id) {
        try { orgPath = await buildOrgPath(row.group_id); } catch(e) { /* 무시 */ }
      }
      result.push({ ...row, org_path: orgPath });
    }
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (e) {
    console.error('[Migration] 북마크/공유 마이그레이션 실패:', e.message);
  }
}

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 NLQ Server running on http://0.0.0.0:${PORT}`);

  // 배치관리 테이블 자동 생성
  await ensureBatchJobsTable();

  // 배치 스케줄러 시작 (once/daily/monthly 자동 실행)
  startScheduler();

  // RBAC 테이블 자동 생성 + 시드 데이터
  await ensureRbacTables();

  // 빌더 히스토리 북마크/공유 마이그레이션
  await ensureBookmarkShareTables();

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
