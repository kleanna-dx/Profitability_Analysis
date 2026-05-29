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
    // 도메인 결정: admin은 전체(null) 유지, 일반 사용자는 users.domain_code → 없으면 조직도 탐색
    let domainCode = null;
    try {
      const [uRow] = await pool.query('SELECT domain_code FROM users WHERE user_id=?', [user.user_id]);
      if (user.role_code === 'admin') {
        // admin: DB에 명시적으로 지정된 경우만 사용, 아니면 null (전체 영역)
        domainCode = uRow[0]?.domain_code || null;
      } else {
        // 일반 사용자: DB → 조직도 탐색 → 캐시
        domainCode = uRow[0]?.domain_code || await resolveDomainByOrg(user.user_id);
        if (domainCode && !uRow[0]?.domain_code) {
          await pool.query('UPDATE users SET domain_code=? WHERE user_id=?', [domainCode, user.user_id]);
        }
      }
    } catch(e) { console.error('[Login] domain 해석 실패:', e.message); }

    req.session.user = {
      id: user.user_id, name: user.name, role: user.role_code,
      domain_code: domainCode, active_domain: domainCode || 'PS',
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

    // 도메인 결정: admin은 전체(null) 유지, 일반 사용자는 DB → 조직도 탐색
    let domainCode = null;
    try {
      const [uDom] = await pool.query('SELECT domain_code FROM users WHERE user_id=?', [userId]);
      if (ssoUser.role_code === 'admin') {
        domainCode = uDom[0]?.domain_code || null;
      } else {
        domainCode = uDom[0]?.domain_code || await resolveDomainByOrg(userId);
        if (domainCode && !uDom[0]?.domain_code) {
          await pool.query('UPDATE users SET domain_code=? WHERE user_id=?', [domainCode, userId]);
        }
      }
    } catch(e) { console.error('[SSO] domain 해석 실패:', e.message); }

    // 세션 생성 (SSO 로그인 성공)
    req.session.user = {
      id: userId,
      name: ssoUser.name,
      role: ssoUser.role_code,
      domain_code: domainCode,
      active_domain: domainCode || 'PS',
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
// 도메인(영역) 해석 — 조직도 상위 탐색으로 사용자 domain_code 결정
// ============================================================
/**
 * 사용자의 group_id에서 조직도를 타고 올라가서 domain_code를 결정
 * user_group_info.group_id → group_info.parent_group_id 반복 탐색
 * → domain_group_mapping에 매칭되는 group_id를 찾으면 해당 domain_code 반환
 */
async function resolveDomainByOrg(userId) {
  try {
    // 1. user_group_info에서 사용자의 group_id 조회
    const [ugRows] = await pool.query(
      'SELECT group_id FROM user_group_info WHERE user_id = ? ORDER BY represent_group DESC LIMIT 1',
      [userId]
    );
    if (ugRows.length === 0) return null;

    let currentGroupId = ugRows[0].group_id;
    const visited = new Set();

    // 2. 조직도를 타고 올라가면서 domain_group_mapping 매칭
    while (currentGroupId && !visited.has(currentGroupId)) {
      visited.add(currentGroupId);

      // domain_group_mapping에서 매칭 체크
      const [mapRows] = await pool.query(
        'SELECT domain_code FROM domain_group_mapping WHERE group_id = ? LIMIT 1',
        [currentGroupId]
      );
      if (mapRows.length > 0) return mapRows[0].domain_code;

      // 상위 그룹으로 이동
      const [parentRows] = await pool.query(
        'SELECT parent_group_id FROM group_info WHERE group_id = ? LIMIT 1',
        [currentGroupId]
      );
      if (parentRows.length === 0 || !parentRows[0].parent_group_id) break;
      currentGroupId = parentRows[0].parent_group_id;
    }
    return null;
  } catch (e) {
    console.error('[Domain] 조직도 탐색 실패:', e.message);
    return null;
  }
}

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
app.post('/api/me/domain', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: '로그인 필요' });
  const { domain_code } = req.body;
  if (!domain_code) return res.status(400).json({ error: 'domain_code 필수' });
  req.session.user.active_domain = domain_code;
  res.json({ success: true, active_domain: domain_code });
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
// active_domain이 없으면 DB domain_code → 기본 'PS' 순서
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
  return 'PS'; // 기본값
}

// ============================================================
// 인증 미들웨어 — 로그인하지 않으면 /login으로 리다이렉트
// ============================================================
app.use(async (req, res, next) => {
  // 인증이 필요 없는 경로
  const publicPaths = ['/login', '/login.html', '/api/login', '/api/login/sendEncData', '/api/logout', '/api/me'];
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
 * Query: page(기본1), limit(기본50, 최대500), is_active(0|1), role, group_name, group_id, search
 */
app.get('/api/users', verifyApiKey, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);
    const offset = (page - 1) * limit;

    // 필터 조건 동적 빌드
    const whereParts = [];
    const params = [];

    if (req.query.is_active !== undefined) {
      whereParts.push('is_active = ?');
      params.push(parseInt(req.query.is_active));
    }
    if (req.query.role) {
      // role 문자열 → role_id 서브쿼리로 필터
      whereParts.push('role_id = (SELECT id FROM roles WHERE role_code = ? LIMIT 1)');
      params.push(req.query.role);
    }
    if (req.query.group_name) {
      whereParts.push('group_name = ?');
      params.push(req.query.group_name);
    }
    if (req.query.group_id) {
      whereParts.push('group_id = ?');
      params.push(req.query.group_id);
    }
    if (req.query.search) {
      whereParts.push('(user_id LIKE ? OR name LIKE ? OR email LIKE ?)');
      const kw = `%${req.query.search}%`;
      params.push(kw, kw, kw);
    }

    const whereClause = whereParts.length > 0 ? 'WHERE ' + whereParts.join(' AND ') : '';

    // 총 건수
    const [countRows] = await pool.query(`SELECT COUNT(*) AS total FROM users ${whereClause}`, params);
    const total = countRows[0].total;

    // 데이터 조회 (password 제외)
    const [rows] = await pool.query(
      `SELECT id, user_id, name, email, group_name, group_id, parent_group_id, tenant_id, phone, position, role, is_active, sso_yn, created_at, updated_at
       FROM users ${whereClause} ORDER BY id ASC LIMIT ? OFFSET ?`,
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
 */
app.get('/api/users/:userId', verifyApiKey, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, name, email, group_name, group_id, parent_group_id, tenant_id, phone, position, role, is_active, sso_yn, created_at, updated_at
       FROM users WHERE user_id = ?`,
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
 * Body: { users: [{ userId, name, email?, groupName?, groupId?, parentGroupId?, tenantId?, phone?, position?, role? }] }
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
            await conn.query(
              `UPDATE users SET name=?, email=?, group_name=?, group_id=?, parent_group_id=?, tenant_id=?, phone=?, position=?, role_id=?, is_active=1, sso_yn=1, updated_at=NOW() WHERE user_id=?`,
              [u.name, u.email || null, u.groupName || null, u.groupId || null, u.parentGroupId || null, u.tenantId || null, u.phone || null, u.position || null, reactivateRoleId, u.userId]
            );
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
        await conn.query(
          `INSERT INTO users (user_id, name, email, group_name, group_id, parent_group_id, tenant_id, phone, position, role_id, is_active, sso_yn) VALUES (?,?,?,?,?,?,?,?,?,?,1,1)`,
          [u.userId, u.name, u.email || null, u.groupName || null, u.groupId || null, u.parentGroupId || null, u.tenantId || null, u.phone || null, u.position || null, newRoleId]
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
 * Body: { users: [{ userId, name?, email?, groupName?, groupId?, parentGroupId?, tenantId?, phone?, position?, role? }] }
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
        if (u.role !== undefined) {
          // role 문자열 → role_id로 변환
          try {
            const [rr] = await conn.query('SELECT id FROM roles WHERE role_code=?', [u.role]);
            if (rr.length > 0) { updates.push('role_id=?'); vals.push(rr[0].id); }
          } catch(e) {}
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

// GPT 모델명 (환경변수로 변경 가능)
const GPT_MODEL = process.env.GPT_MODEL || 'gpt-5-mini';

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
ZDISTCHAN    | VARCHAR(5)  | 내수/수출구분자(사업장)
ZORG_TEAM    | VARCHAR(10) | 영업팀(사업장그룹) 코드
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
ZJPCODE      | VARCHAR(10)   | 지종/제품구분 코드 (예: SN, FT, WT)
ZJPCODE_NM   | VARCHAR(100) | 지종/제품구분명
ZBRAND       | VARCHAR(10)   | 브랜드1 코드 (예: BRH006, BRH002)
ZBRAND_NM    | VARCHAR(100) | 브랜드 1 명
ZSBRAND      | VARCHAR(10)   | 브랜드2 코드
ZSBRAND_NM   | VARCHAR(100) | 브랜드 2 명

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
ZKUNN2       | VARCHAR(20)   | 영업사원 코드
ZKUNN2_NM    | VARCHAR(100) | 영업사원 명
CUSTOMER     | VARCHAR(20)   | 고객 코드
CUSTOMER_NM  | VARCHAR(100)  | 고객 명
MATERIAL     | VARCHAR(30)   | 자재 코드 (예: FRT-NEE0004A)
MATERIAL_NM  | VARCHAR(100)  | 자재 명 (예: 깨끗한나라 2겹 화장지 45m 18롤)

-- 수량 단위 --
ZBOXUNIT     | VARCHAR(5)    | BOX단위
ZBAGUNIT     | VARCHAR(5)    | BAG단위
ZUNIT        | VARCHAR(5)    | 기준수량단위(KG/EA)
CURRENCY     | VARCHAR(5)    | 통화 (예: KRW)

-- 수량 --
ZQTY_BOX     | DECIMAL(18,3) | 수량(BOX)
ZQTY_BAG     | BIGINT        | 수량(BAG)
ZQTY_KE      | DECIMAL(18,3) | 수량(KG/EA)

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
- BOX수량 = SUM(ZQTY_BOX)
- BAG수량 = SUM(ZQTY_BAG)
- EA수량 = SUM(ZQTY_KE)
- 평균단가(BOX) = SUM(ZAMT001) / NULLIF(SUM(ZQTY_BOX),0)
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

[★★★ 최우선 규칙 — 컬럼명 사용 (절대 위반 금지) ★★★]

■ 허용되는 컬럼명 — 아래 목록에 있는 컬럼만 SQL에 사용할 수 있습니다:
SEQ, CALYEAR, CALMONTH, CALDAY, CO_AREA, CO_AREA_NM, PROFIT_CTR, PROFIT_CTR_NM,
DIVISION, DIVISION_NM, PLANT, PLANT_NM, DISTR_CHAN, DISTR_CHAN_NM, ZDISTCHAN,
ZORG_TEAM, SALES_OFF, SALES_OFF_NM, MATL_TYPE, MATL_TYPE_NM, MATL_GROUP, MATL_GROUP_NM,
PRODH1, PRODH1_NM, PRODH2, PRODH2_NM, PRODH3, PRODH3_NM, PRODH4, PRODH4_NM,
ZJPCODE, ZJPCODE_NM, ZBRAND, ZBRAND_NM, ZSBRAND, ZSBRAND_NM,
BILL_TYPE, BILL_TYPE_NM, INCOTERMS, INCOTERMS_NM, CUST_GROUP, CUST_GROUP_NM,
CUST_GRP1, CUST_GRP1_NM, COUNTRY, COUNTRY_NM, ZKUNN2, ZKUNN2_NM,
CUSTOMER, CUSTOMER_NM, MATERIAL, MATERIAL_NM,
ZBOXUNIT, ZBAGUNIT, ZUNIT, CURRENCY,
ZQTY_BOX, ZQTY_BAG, ZQTY_KE,
ZAMT001, ZAMT002, ZAMT003, ZAMT004, ZAMT005, ZAMT006, ZAMT007, ZAMT008,
ZAMT009, ZAMT010, ZAMT011, ZAMT012, ZAMT013, ZAMT014, ZAMT015, ZAMT016,
ZAMT017, ZAMT018, ZAMT019, ZAMT020, ZAMT021, ZAMT022, ZAMT023, ZAMT024,
ZAMT025, ZAMT026, ZAMT027, ZAMT028, ZAMT029, ZAMT030, ZAMT031, ZAMT032,
ZAMT033, ZAMT034, ZAMT035, ZAMT036, ZAMT037, ZAMT038, ZAMT039, ZAMT040,
ZAMT041, ZAMT042, ZAMT043, ZAMT044, ZAMT045, ZAMT046, ZAMT047, ZAMT048,
ZAMT049, ZAMT050, ZAMT051, ZAMT052, ZAMT053, ZAMT054, ZAMT055, ZAMT056,
ZAMT057, ZAMT058, ZAMT059, ZAMT060, ZAMT061, ZAMT062, ZAMT063, ZAMT064

■ 컬럼명 선택 우선순위:
1순위: 동의어 매칭 결과 중 [Metric 산식] 태그가 있으면 해당 산식을 최우선 사용 (단순 컬럼보다 항상 우선!)
2순위: 동의어 매칭 결과 중 일반 컬럼 매핑이 있으면 사용
3순위: 동의어 매칭이 없으면 위 허용 목록 + TABLE_SCHEMA 설명을 보고 가장 적합한 컬럼을 판단하여 사용

★ Metric 산식 우선 규칙: 학습관리의 Metric에 계산 산식(formula)이 정의된 지표는 반드시 해당 산식을 사용하세요.
  예) 매출총이익 → SUM(ZAMT035) ✗ → SUM(ZAMT003)-SUM(ZAMT034) ✓ (Metric 산식)
  예) 매출총이익률 → (SUM(ZAMT003)-SUM(ZAMT034))/NULLIF(SUM(ZAMT003),0)*100 ✓

■ 절대 금지 — 컬럼명 창작/조합:
- 위 허용 목록에 없는 컬럼명을 절대 만들지 마세요
- 컬럼명 일부를 합치거나 변형하지 마세요
- 설명에 나오는 단어(BOX, BAG, KG, EA 등)를 컬럼명에 붙이지 마세요
- 언더스코어(_) 위치, 대소문자를 정확히 지켜서 위 목록에 있는 그대로만 사용하세요

■ 자주 틀리는 컬럼명 예시 (왼쪽 ✗ 금지 → 오른쪽 ✓ 정답):
  ZQTYBOX ✗ → ZQTY_BOX ✓ (수량 BOX)
  ZQTYBAG ✗ → ZQTY_BAG ✓ (수량 BAG)
  ZQTYKE ✗ → ZQTY_KE ✓ (수량 KG/EA)
  ZQTYKGEA ✗ → ZQTY_KE ✓ (KG/EA 수량은 ZQTY_KE임!)
  ZQTY_KGEA ✗ → ZQTY_KE ✓
  ZQTY_KG ✗ → ZQTY_KE ✓
  ZQTY_EA ✗ → ZQTY_KE ✓
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
16. 브랜드: ZBRAND (브랜드1), ZSBRAND (브랜드2)
17. **학습 데이터 우선**: 아래 RAG 컨텍스트에 유사 질문의 검증된 SQL이 있으면 그 패턴을 최우선 참고

[날짜/기간 필터링 규칙 - 매우 중요!]
- **ZYEAR, ZMONTH, FISC_YEAR, FISC_PERIOD, YEAR, MONTH 등의 컬럼은 존재하지 않습니다! 절대 사용 금지!**
- 연도/월 필터: CALMONTH 컬럼 사용 (VARCHAR, YYYYMM 형식). 예: "2024년 5월" → WHERE CALMONTH = '202405'
- 연도만 필터: CALMONTH LIKE '2024%' 또는 LEFT(CALMONTH,4) = '2024'
- 일자 필터: CALDAY 컬럼 사용 (VARCHAR, YYYYMMDD 형식). 예: "2024년 5월 1일" → WHERE CALDAY = '20240501'
- 월 범위 필터: CALMONTH BETWEEN '202401' AND '202412'
- 일별 추이: GROUP BY CALDAY, ORDER BY CALDAY ASC
- 월별 추이: GROUP BY CALMONTH, ORDER BY CALMONTH ASC
- 현재 데이터는 CALMONTH='202604' (2026년 4월) 테스트 데이터 존재

[컬럼 최소화 원칙 - 매우 중요!]
- **질문에서 요청한 항목만 SELECT 하세요. 관련 있어 보이더라도 질문에 없는 항목은 절대 추가하지 마세요.**
- 예: "판매수량 합계"라고 하면 → BOX 수량(ZQTY_BOX) 하나만 사용. BAG수량, EA수량은 질문에 없으므로 포함 금지.
- 예: "총매출 합계"라고 하면 → SUM(ZAMT001) 하나만 사용. 순매출, 영업이익 등은 추가하지 마세요.
- 사용자가 "수량" 이라고만 하면 기본 단위는 BOX(ZQTY_BOX). BAG/EA는 사용자가 명시적으로 요청할 때만 포함.
- 사용자가 "모든 수량" 또는 "BOX, BAG, EA 수량"처럼 여러 단위를 명시한 경우에만 복수 수량 컬럼 사용.

[컬럼 별칭(alias) 작성 규칙]
- 별칭에는 단위를 괄호로 명시: 예) '판매수량 합계(BOX)', '총매출(원)', '영업이익률(%)'
- 집계 함수를 사용한 경우 "합계", "평균", "최대" 등을 별칭에 포함
- 예시: FORMAT(SUM(ZQTY_BOX), 0) AS '판매수량 합계(BOX)',  FORMAT(SUM(ZAMT001), 0) AS '총매출 합계(원)'

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
- 예시:
  - "현재 2026년 2월, 3월, 4월 데이터가 존재합니다."
  - "브랜드별 판매수량을 내림차순으로 조회했습니다. 깨끗한나라가 가장 많습니다."
  - "2026년 3월 총매출은 약 152억원입니다."
- explanation은 개발자/분석가용 기술 설명으로, SQL 탭에서만 보입니다.

chartType 기준: bar(카테고리 비교), line(시계열), pie(비율), table(상세 데이터)
`;

/**
 * 동의어 직접 매칭 (DB 조회 기반)
 * - RAG 임베딩 유사도 검색의 한계 보완
 * - 사용자 질문에 포함된 동의어를 DB에서 직접 찾아 컬럼 매핑 정보 반환
 * @param {string} query - 사용자 질문
 * @returns {Promise<Array<{synonym: string, column_name: string, description: string, data_type: string, source: string}>>}
 */
async function matchSynonymsDirectly(query, domainCode) {
  const matched = [];
  let filtered = [];  // try 블록 밖에서도 접근 가능하도록 선언
  const dc = domainCode || 'PS';
  try {
    // 1. Ontology 동의어 매칭 (domain_code 필터)
    const [ontSyns] = await pool.query(
      `SELECT s.synonym_text, c.column_name, c.description, c.data_type
       FROM ontology_synonym s
       JOIN ontology_column c ON s.column_id = c.id
       WHERE c.domain_code = ?`, [dc]
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

    // 2. Metric 동의어 매칭 (domain_code 필터)
    const [metSyns] = await pool.query(
      `SELECT s.synonym_text, m.metric_code, m.aggregation, m.formula, m.description
       FROM metric_synonym s
       JOIN metric m ON s.metric_id = m.id
       WHERE m.domain_code = ?`, [dc]
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

    // 3. Ontology 컬럼 설명(description) 자체도 매칭 (domain_code 필터)
    const [ontCols] = await pool.query(
      `SELECT column_name, description, data_type FROM ontology_column WHERE description IS NOT NULL AND description != '' AND domain_code = ?`, [dc]
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

    // 4. Metric 산식이 있는 항목은 같은 synonym의 ontology 단순 컬럼을 제거 (Metric 우선)
    const metricSynonyms = new Set(matched.filter(m => m.source === 'metric').map(m => m.synonym));
    filtered = matched.filter(m => {
      if (m.source !== 'metric' && metricSynonyms.has(m.synonym)) {
        console.log(`[Synonym] Metric 우선: "${m.synonym}" ontology(${m.column_name}) 제거 → Metric 산식 사용`);
        return false;
      }
      return true;
    });
    // Metric을 앞쪽에 배치 (우선순위 높음)
    filtered.sort((a, b) => (a.source === 'metric' ? -1 : 1) - (b.source === 'metric' ? -1 : 1));

    if (filtered.length > 0) {
      console.log(`[Synonym] 직접 매칭 ${filtered.length}건: ${filtered.map(m => `"${m.synonym}"→${m.column_name} [${m.source}]`).join(', ')}`);
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
    // Metric 산식 매칭과 일반 컬럼 매칭 분리
    const metricMatches = synonymMatches.filter(m => m.source === 'metric');
    const columnMatches = synonymMatches.filter(m => m.source !== 'metric');
    
    synonymContext = '\n[★ 동의어 매칭 결과 - 최우선 적용! 아래 매핑을 반드시 SQL에 사용하세요]\n';
    
    if (metricMatches.length > 0) {
      synonymContext += '\n🚨🚨🚨 [Metric 산식 — 반드시 아래 산식을 SQL에 그대로 사용! 다른 컬럼 대체 절대 금지!] 🚨🚨🚨\n';
      for (const m of metricMatches) {
        // Metric 산식에서 관련 단순 컬럼명 추출 (예: SUM(ZAMT003-ZAMT034) → ZAMT035 금지 안내)
        const formulaMatch = m.column_name.match(/^(\w+)\((.+)\)$/);
        synonymContext += `- "${m.synonym}" → SQL에 반드시 사용할 산식: ${m.column_name}\n`;
        // TOTAL_XXX 패턴에서 단순 컬럼 금지 안내 추출
        if (m.description) {
          synonymContext += `  ⚠️ 주의: SUM(ZAMT035) 같은 단순 컬럼 사용 금지! 반드시 위 산식을 사용하세요.\n`;
        }
      }
      synonymContext += '\n예시) 매출총이익 조회 시:\n';
      synonymContext += '  ✗ 틀린 SQL: SELECT SUM(ZAMT035) AS 매출총이익  ← 사용 금지!\n';
      synonymContext += '  ✓ 올바른 SQL: SELECT SUM(ZAMT003-ZAMT034) AS 매출총이익  ← 이것을 사용!\n';
      synonymContext += '  ✓ 또는: SELECT SUM(ZAMT003)-SUM(ZAMT034) AS 매출총이익  ← 이것도 가능\n';
    }
    if (columnMatches.length > 0) {
      synonymContext += '\n🔷 [컬럼 매핑]\n';
      for (const m of columnMatches) {
        synonymContext += `- 사용자가 말한 "${m.synonym}" → 컬럼: ${m.column_name} (${m.data_type}) - ${m.description}\n`;
      }
    }
    synonymContext += '\n위 매핑된 컬럼/산식을 SQL의 SELECT, WHERE, GROUP BY 등에 반드시 사용하세요.\n';
    synonymContext += '🚨 Metric 산식이 있는 항목은 해당 산식을 SQL에 그대로 포함하세요. 단순 컬럼(예: ZAMT035)으로 대체하면 0원 결과가 나옵니다!\n';
  }

  // ★ Metric 산식이 매칭된 컬럼 목록 수집 (RAG 컨텍스트에서 해당 단순 컬럼 제거용)
  const metricReplacedColumns = new Set();
  for (const m of synonymMatches.filter(x => x.source === 'metric')) {
    // SUM(ZAMT003-ZAMT034) 에서 metric_code가 TOTAL_ZAMT035 → ZAMT035를 필터링 대상으로
    try {
      const [metRows] = await pool.query(
        `SELECT metric_code FROM metric WHERE CONCAT(aggregation, '(', formula, ')') = ?`, [m.column_name]
      );
      for (const mr of metRows) {
        const match = mr.metric_code.match(/^TOTAL_(\w+)$/);
        if (match) metricReplacedColumns.add(match[1]); // e.g., ZAMT035
      }
    } catch(e) {}
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
      });
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
    const [metricRows] = await pool.query(
      `SELECT metric_code, aggregation, formula FROM metric WHERE aggregation = 'SUM' AND (formula LIKE '%-%' OR formula LIKE '%+%') AND domain_code = ?`, [dc]
    );
    let result = inputSql;
    for (const m of metricRows) {
      const codeMatch = m.metric_code.match(/^TOTAL_(\w+)$/);
      if (codeMatch) {
        const rawCol = codeMatch[1]; // e.g., ZAMT035
        const detectPattern = new RegExp(`SUM\\(${rawCol}\\)`, 'gi');
        if (detectPattern.test(result)) {
          // SUM(ZAMT035) → (SUM(ZAMT003)-SUM(ZAMT034))
          const replacement = `(SUM(${m.formula.replace(/-/g, ')-SUM(').replace(/\+/g, ')+SUM(')}))`;
          const replacePattern = new RegExp(`SUM\\(${rawCol}\\)`, 'gi');
          const before = result;
          result = result.replace(replacePattern, replacement);
          if (before !== result) {
            console.log(`[NLQ] Metric 자동 치환: SUM(${rawCol}) → ${replacement}`);
          }
        }
      }
    }
    return result;
  } catch (e) {
    console.error('[NLQ] Metric 자동 치환 실패 (무시):', e.message);
    return inputSql;
  }
}

// ============================================================
// API: 자연어 질의 실행
// ============================================================
app.post('/api/nlq', async (req, res) => {
  const { query, conversationContext, session_id } = req.body;
  if (!query || !query.trim()) {
    return res.status(400).json({ error: '질의를 입력하세요.' });
  }
  const activeDomain = await getActiveDomain(req);

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
      const { prompt: systemPrompt, ragContext } = await buildRAGSystemPrompt(query, activeDomain);
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

      // 대화 히스토리를 GPT messages에 주입 (후속 질문에서 이전 SQL 맥락 유지)
      const messages = [{ role: 'system', content: systemPrompt }];
      if (Array.isArray(conversationContext) && conversationContext.length > 0) {
        // 최근 5턴만 사용 (토큰 절약)
        const recentCtx = conversationContext.slice(-5);
        for (const turn of recentCtx) {
          messages.push({ role: 'user', content: turn.query });
          messages.push({ role: 'assistant', content: JSON.stringify({ sql: turn.sql }) });
        }
        console.log(`[NLQ] 대화 컨텍스트 ${recentCtx.length}턴 포함`);
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
        return res.status(500).json({ error: 'AI 응답 파싱 실패', raw });
      }

      sql = parsed.sql;
      // ★ GPT 생성 SQL에도 Metric 산식 자동 치환 적용 (GPT가 프롬프트를 무시하고 단순 컬럼 사용 시 안전장치)
      sql = await applyMetricFormulaReplacement(sql, activeDomain);
      // answer는 1단계에서 무시 — SQL 실행 후 결과 기반으로 4-A에서 생성
      explanation = parsed.explanation;
      chartType = parsed.chartType;
      chartConfig = parsed.chartConfig;
      analysisRequired = parsed.analysisRequired === true;
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

    // 4-A. SQL 결과 기반 사용자 친화적 answer 생성 (항상 결과 데이터를 보고 생성)
    try {
      const sampleData = rows.slice(0, 20);
      const sampleText = JSON.stringify(sampleData, (k, v) => typeof v === 'bigint' ? Number(v) : v);

      const answerCompletion = await openai.chat.completions.create({
        model: GPT_MODEL,
        messages: [
          {
            role: 'user',
            content: `아래 데이터 조회 결과를 보고, 질문에 대한 답변을 1~2문장의 자연스러운 한국어로 작성해주세요.
SQL/컬럼명/기술용어는 쓰지 마세요. 금액은 억/만 단위로 표현하세요.

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
      console.log(`[NLQ] Answer 최종: "${answer}"`);
    } catch (ansErr) {
      console.error('[NLQ] Answer 생성 실패:', ansErr.message);
    }

    // 4-B. 분석형 질문이면 2단계: GPT 텍스트 분석 답변 생성 (결과 0행이어도 생성)
    let analysis = null;
    if (analysisRequired) {
      try {
        console.log(`[NLQ] 분석형 질문 감지 — GPT 텍스트 분석 답변 생성 시작 (데이터 ${rows.length}행)`);

        let userContent;
        if (rows.length > 0) {
          const dataForAnalysis = rows.slice(0, 50);
          const dataText = JSON.stringify(dataForAnalysis, (key, val) =>
            typeof val === 'bigint' ? Number(val) : val
          , 2);
          userContent = `[사용자 질문]\n${query}\n\n[실행한 SQL]\n${sql}\n\n[조회된 데이터 (${rows.length}행)]\n${dataText}\n\n위 데이터를 기반으로 질문에 대한 전문적인 분석 답변을 작성해주세요.`;
        } else {
          userContent = `[사용자 질문]\n${query}\n\n[실행한 SQL]\n${sql}\n\n[조회 결과]: 0행 (데이터 없음)\n\nSQL 조회 결과가 0행입니다. 가능한 원인과 함께 질문에 대해 알려진 정보를 바탕으로 답변해주세요.`;
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

    const result = {
      success: true,
      query,
      sql,
      answer: answer || '',  // 사용자 친화적 답변 (상단 표시)
      explanation: explanation + (matchedSql ? ' 📚' : (ragReady ? ' 🔍 RAG' : '')),  // 기술적 설명 (SQL탭)
      chartType: chartType || 'table',
      chartConfig: chartConfig || {},
      data: rows,
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

    // 실패 이력도 저장
    const nlqUserId = req.session?.user?.id || null;
    saveHistory(nlqUserId, query, null, null, null, null, null, 0, 0, 'FAILED', msg, session_id || null, activeDomain)
      .catch(e => console.error('[History] 실패이력 저장 실패:', e.message));

    return res.status(500).json({ error: msg, query });
  }
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
    console.log('[GET /api/history] session user:', JSON.stringify(req.session?.user), '→ userId:', userId);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);

    if (!userId) {
      console.log('[GET /api/history] userId is null/undefined → returning empty array');
      return res.json([]);
    }

    // 세션 단위로 그룹핑하여 반환 (domain_code 포함 — 배지 표시용)
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
         MAX(domain_code) AS domain_code
       FROM nl_query_history h
       WHERE user_id = ?
       GROUP BY COALESCE(session_id, CONCAT('legacy_', id))
       ORDER BY last_time DESC
       LIMIT ?`,
      [userId, userId, limit]
    );
    console.log('[GET /api/history] userId:', userId, '→ sessions returned:', rows.length);
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/history] error:', err.message);
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
    res.json({ id: r.insertId, domain_code: dc, column_name, table_name: table_name || 'bw_profitability_data', description, data_type });
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
    const dc = await getActiveDomain(req);
    const [ontoCols] = await pool.query(`SELECT column_name, description, data_type FROM ontology_column WHERE domain_code = ?`, [dc]);
    const ontoMap = {};
    for (const o of ontoCols) {
      ontoMap[o.column_name.toUpperCase()] = o;
    }

    // 카테고리 분류
    const catMap = {
      'SEQ': 'system',
      'CALYEAR': 'period', 'CALMONTH': 'period', 'CALDAY': 'period',
      'CO_AREA': 'org', 'CO_AREA_NM': 'org', 'PROFIT_CTR': 'org', 'PROFIT_CTR_NM': 'org', 'DIVISION': 'org', 'DIVISION_NM': 'org', 'PLANT': 'org', 'PLANT_NM': 'org',
      'DISTR_CHAN': 'org', 'DISTR_CHAN_NM': 'org', 'ZDISTCHAN': 'org', 'ZORG_TEAM': 'org', 'SALES_OFF': 'org', 'SALES_OFF_NM': 'org',
      'MATL_TYPE': 'product', 'MATL_TYPE_NM': 'product', 'MATL_GROUP': 'product', 'MATL_GROUP_NM': 'product',
      'PRODH1': 'product', 'PRODH1_NM': 'product', 'PRODH2': 'product', 'PRODH2_NM': 'product', 'PRODH3': 'product', 'PRODH3_NM': 'product', 'PRODH4': 'product', 'PRODH4_NM': 'product',
      'ZJPCODE': 'product', 'ZJPCODE_NM': 'product', 'ZBRAND': 'product', 'ZBRAND_NM': 'product', 'ZSBRAND': 'product', 'ZSBRAND_NM': 'product',
      'MATERIAL': 'product', 'MATERIAL_NM': 'product',
      'BILL_TYPE': 'trade', 'BILL_TYPE_NM': 'trade', 'INCOTERMS': 'trade', 'INCOTERMS_NM': 'trade', 'CUST_GROUP': 'trade', 'CUST_GROUP_NM': 'trade',
      'CUST_GRP1': 'trade', 'CUST_GRP1_NM': 'trade', 'COUNTRY': 'trade', 'COUNTRY_NM': 'trade', 'ZKUNN2': 'trade', 'ZKUNN2_NM': 'trade', 'CUSTOMER': 'trade', 'CUSTOMER_NM': 'trade',
      'ZBOXUNIT': 'unit', 'ZBAGUNIT': 'unit', 'ZUNIT': 'unit', 'CURRENCY': 'unit',
      'ZQTY_BOX': 'quantity', 'ZQTY_BAG': 'quantity', 'ZQTY_KE': 'quantity',
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
        if (name.startsWith('ZQTY') || name.includes('ZQTY_')) category = 'quantity';
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
      if (!validCols.has(col)) return res.status(400).json({ error: `유효하지 않은 컬럼: ${col}` });
      let agg = f.aggregate;
      const alias = f.alias || col;

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
        curSelectParts.push(`${m.agg}(\`${m.col}\`) AS \`${m.col}_cur\``);
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
        prevSelectParts.push(`${m.agg}(\`${m.col}\`) AS \`${m.col}_prev\``);
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
    // 일반 모드 (비교 없음): 기존 로직 + CALMONTH 항상 첫 컬럼
    // ═══════════════════════════════════════════════
    } else {
      const selectParts = [];
      // CALMONTH 항상 첫 컬럼 자동 포함 (달력연도/월)
      if (!userFieldCols.includes('CALMONTH')) {
        selectParts.push('`CALMONTH` AS `달력연도/월`');
      }
      for (const f of fields) {
        const col = f.column;
        const agg = f.aggregate;
        const alias = f.alias || col;
        if (agg && ['SUM','COUNT','AVG','MAX','MIN'].includes(agg.toUpperCase())) {
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
      const groupParts = [];
      if (!userFieldCols.includes('CALMONTH') && group_by && group_by.length > 0) {
        groupParts.push('`CALMONTH`');
      }
      if (group_by && group_by.length > 0) {
        for (const g of group_by) {
          // CALMONTH 중복 방지 (이미 자동 추가된 경우 스킵)
          if (g === 'CALMONTH' && groupParts.includes('`CALMONTH`')) continue;
          // CALDAY는 GROUP BY에서 제외 (월단위 집계 기준)
          if (g === 'CALDAY') continue;
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
    await pool.query(`
      CREATE TABLE IF NOT EXISTS batch_jobs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        job_type VARCHAR(50) NOT NULL DEFAULT 'SAP_RFC_SYNC' COMMENT '작업유형',
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
        INDEX idx_batch_cmonth (cmonth)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='배치 작업 이력'
    `);
    console.log('[Batch] batch_jobs 테이블 준비 완료');
  } catch (e) {
    console.error('[Batch] batch_jobs 테이블 생성 실패:', e.message);
  }
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

  // 작업 레코드 생성
  const userId = req.session?.user?.id || 'unknown';
  let jobId;
  try {
    const [r] = await pool.query(
      `INSERT INTO batch_jobs (job_type, cmonth, mode, status, created_by)
       VALUES ('SAP_RFC_SYNC', ?, ?, 'pending', ?)`,
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
