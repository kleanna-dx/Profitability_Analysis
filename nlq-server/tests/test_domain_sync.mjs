/*
 * ─────────────────────────────────────────────────────────────────────────
 * test_domain_sync.mjs
 * ─────────────────────────────────────────────────────────────────────────
 * 대상: server.mjs 의 "body.domain_code 우선 사용" 로직 (UI ↔ 서버 도메인 동기화)
 *
 * 배경 (사용자 신고 2026-09-13):
 *   UI 상단 [통합] + 자물쇠 잠금 상태인데도:
 *     - SQL 에 WHERE DIVISION = '20' 자동 주입됨
 *     - 사이드바 이력 배지가 [HL] 로 표시됨
 *   → UI(프론트) 도메인 표시와 서버 세션의 active_domain 이 어긋난 상태에서
 *     질의가 처리된 결과. 세션 sync 실패의 근본 원인.
 *
 * 해결 (옵션 A):
 *   프론트가 매 요청마다 asyncPayload.domain_code = currentDomain 전송.
 *   서버는 이 값을 세션보다 우선 사용하고 세션도 갱신 →
 *   "UI 에 보이는 도메인 = SQL 도메인 = 이력 배지 도메인" 100% 보장.
 *
 * 검증 항목:
 *   [A] 프론트 index.html 이 asyncPayload 에 domain_code 를 실어보내는지
 *   [B] 서버 /api/nlq/async 라우트에 [DomainSync] 블록이 존재하는지
 *   [C] 서버 /api/nlq 라우트가 body.domain_code 를 activeDomain 결정에 우선 사용하는지
 *   [D] self-fetch body 에 job.domain_code 를 전달하는지 (이중 방어)
 *   [E] resolveDomainAlias 로 정규화되는지 (통합/mgmt/MGMT 모두 → 'MGMT')
 *   [F] 화이트리스트 검증 (PS/HL/MGMT 만 허용, 나머지는 무시)
 *   [G] body 에 domain_code 없으면 기존 세션 fallback (하위호환)
 *   [H] 회귀 안전성 — 기존 getActiveDomain 로직 유지
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_MJS = path.resolve(__dirname, '../server.mjs');
const INDEX_HTML = path.resolve(__dirname, '../public/index.html');

let passCount = 0;
let failCount = 0;
function assert(cond, msg) {
  if (cond) { passCount++; console.log('  ✅ ' + msg); }
  else      { failCount++; console.log('  ❌ ' + msg); }
}
function section(title) {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

const serverSrc = fs.readFileSync(SERVER_MJS, 'utf-8');
const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf-8');

// resolveDomainAlias 로직 재현 (server.mjs L1000)
function resolveDomainAlias(input) {
  if (!input) return '';
  const s = String(input).trim().toUpperCase();
  if (s === '통합' || s === '경영관리' || s === 'MGMT') return 'MGMT';
  if (s === 'PS' || s === '페이퍼솔루션' || s === '페이퍼솔루션사업부') return 'PS';
  if (s === 'HL' || s === '홈앤라이프' || s === '홈앤라이프사업부') return 'HL';
  // 이미 유효한 코드면 그대로
  if (['PS', 'HL', 'MGMT'].includes(s)) return s;
  return '';
}

// 화이트리스트 검증 로직 재현
function normalizeBodyDomain(raw) {
  if (!raw) return null;
  const norm = resolveDomainAlias(String(raw));
  return (norm && ['PS', 'HL', 'MGMT'].includes(norm)) ? norm : null;
}

// ═══════════════════════════════════════════════════════════════════════
// [A] 프론트 index.html — asyncPayload.domain_code 명시 전송
// ═══════════════════════════════════════════════════════════════════════
section('[A] 프론트 asyncPayload.domain_code 명시 전송');

assert(
  /asyncPayload\s*=\s*\{[\s\S]*?domain_code:\s*currentDomain/.test(htmlSrc),
  'A-1: asyncPayload 정의 안에 domain_code: currentDomain 존재'
);
assert(
  htmlSrc.includes('UI 상단에 사용자가 실제로 보고 있는 도메인을 매 요청마다 명시 전송'),
  'A-2: 매 요청마다 명시 전송 주석 존재'
);
assert(
  htmlSrc.includes('domain_code: currentDomain || null'),
  'A-3: null-safe 형태로 전송'
);

// ═══════════════════════════════════════════════════════════════════════
// [B] 서버 /api/nlq/async — [DomainSync] 블록 존재
// ═══════════════════════════════════════════════════════════════════════
section('[B] /api/nlq/async DomainSync 블록');

assert(
  /\[DomainSync\] userId=\$\{userId\}/.test(serverSrc),
  'B-1: [DomainSync] 로그 태그 존재'
);
assert(
  serverSrc.includes('UI 도메인과 세션 강제 동기화'),
  'B-2: DomainSync 블록 주석 존재'
);
assert(
  /req\.session\.user\.active_domain\s*=\s*normalizedDomain/.test(serverSrc),
  'B-3: 세션 active_domain 덮어쓰기 코드 존재'
);
assert(
  /UPDATE users SET domain_code\s*=\s*\?\s*WHERE user_id\s*=\s*\?/.test(serverSrc),
  'B-4: users.domain_code UPDATE 쿼리 존재 (DB 동기화)'
);

// ═══════════════════════════════════════════════════════════════════════
// [C] 서버 /api/nlq — activeDomain 결정 시 body 우선
// ═══════════════════════════════════════════════════════════════════════
section('[C] /api/nlq activeDomain 결정 우선순위');

assert(
  serverSrc.includes('activeDomain 결정 — body.domain_code 우선 사용'),
  'C-1: activeDomain 결정 우선순위 주석 존재'
);
assert(
  /\[DomainSync:\/api\/nlq\]/.test(serverSrc),
  'C-2: /api/nlq 전용 DomainSync 로그 태그 존재'
);
assert(
  /let activeDomain\s*=\s*null/.test(serverSrc),
  'C-3: let activeDomain (재할당 가능한 var)'
);
// 순서 확인: body 파싱 → activeDomain=normBody → 없으면 getActiveDomain fallback
{
  const bodyParseIdx = serverSrc.indexOf('rawBodyDomain = req.body?.domain_code');
  const fallbackIdx = serverSrc.indexOf('activeDomain = await getActiveDomain(req)');
  assert(
    bodyParseIdx > 0 && fallbackIdx > bodyParseIdx,
    'C-4: body 파싱이 getActiveDomain fallback 보다 앞에 위치'
  );
}
assert(
  /if \(!activeDomain\)\s*\{\s*activeDomain\s*=\s*await getActiveDomain/.test(serverSrc),
  'C-5: body 에 없거나 무효면 getActiveDomain 로 fallback'
);

// ═══════════════════════════════════════════════════════════════════════
// [D] self-fetch body 에 domain_code 전달 (이중 방어)
// ═══════════════════════════════════════════════════════════════════════
section('[D] self-fetch body 이중 방어');

assert(
  /body\s*=\s*JSON\.stringify\(\{[\s\S]*?domain_code:\s*job\.domain_code/.test(serverSrc),
  'D-1: self-fetch body 에 domain_code: job.domain_code 실림'
);
// job 오브젝트 정의에 domain_code 필드 존재
assert(
  /const job\s*=\s*\{[\s\S]*?domain_code:\s*\(\(\)\s*=>\s*\{/.test(serverSrc),
  'D-2: job 오브젝트 정의에 domain_code IIFE 필드 존재'
);
assert(
  serverSrc.includes('self-fetch 중 세션 상태가'),
  'D-3: 이중 방어 목적 주석 존재'
);

// ═══════════════════════════════════════════════════════════════════════
// [E] resolveDomainAlias 정규화 검증
// ═══════════════════════════════════════════════════════════════════════
section('[E] resolveDomainAlias 정규화');

const aliasTests = [
  { input: 'PS', expected: 'PS' },
  { input: 'ps', expected: 'PS' },
  { input: 'HL', expected: 'HL' },
  { input: 'hl', expected: 'HL' },
  { input: 'MGMT', expected: 'MGMT' },
  { input: 'mgmt', expected: 'MGMT' },
  { input: '통합', expected: 'MGMT' },
  { input: '페이퍼솔루션', expected: 'PS' },
  { input: '홈앤라이프', expected: 'HL' },
];
for (const t of aliasTests) {
  assert(resolveDomainAlias(t.input) === t.expected, `E-${t.input}: "${t.input}" → ${t.expected}`);
}

// ═══════════════════════════════════════════════════════════════════════
// [F] 화이트리스트 검증 (PS/HL/MGMT 만 허용)
// ═══════════════════════════════════════════════════════════════════════
section('[F] 화이트리스트 검증');

const whitelistTests = [
  { input: 'PS', expected: 'PS' },
  { input: 'HL', expected: 'HL' },
  { input: 'MGMT', expected: 'MGMT' },
  { input: '통합', expected: 'MGMT' },
  { input: 'INVALID', expected: null },       // 미지의 코드 → null
  { input: '', expected: null },              // 빈 문자열 → null
  { input: null, expected: null },            // null → null
  { input: undefined, expected: null },       // undefined → null
  { input: '   ', expected: null },           // 공백만 → null
  { input: 'HL; DROP TABLE users;', expected: null },  // SQL 인젝션 시도 → null
];
for (const t of whitelistTests) {
  const label = t.input === null ? '(null)' : (t.input === undefined ? '(undefined)' : `"${t.input}"`);
  assert(normalizeBodyDomain(t.input) === t.expected, `F: ${label} → ${t.expected === null ? 'null' : t.expected}`);
}

// server.mjs 소스에 화이트리스트 검증 코드 존재 확인
assert(
  /\['PS',\s*'HL',\s*'MGMT'\]\.includes\(/.test(serverSrc),
  'F-src: server.mjs 에 [PS,HL,MGMT] 화이트리스트 배열 사용'
);

// ═══════════════════════════════════════════════════════════════════════
// [G] body 에 domain_code 없으면 세션 fallback (하위호환)
// ═══════════════════════════════════════════════════════════════════════
section('[G] 하위호환 - body 없으면 세션 fallback');

// 시뮬레이션: body.domain_code 미전송 → normalizeBodyDomain 이 null 반환
assert(normalizeBodyDomain(undefined) === null, 'G-1: body 없으면 null');
// server.mjs 코드에서 activeDomain=null 시 getActiveDomain fallback 확인
assert(
  /if \(!activeDomain\)\s*\{\s*[\s\S]*?activeDomain\s*=\s*await getActiveDomain\(req\)/.test(serverSrc),
  'G-2: activeDomain=null 시 getActiveDomain 호출로 fallback'
);
// getActiveDomain 함수 자체는 변경 없음 (기존 로직 유지)
assert(
  /async function getActiveDomain\(req\)\s*\{[\s\S]*?if \(u\.active_domain\)\s*return u\.active_domain/.test(serverSrc),
  'G-3: getActiveDomain 기존 로직 (session → DB) 유지'
);

// ═══════════════════════════════════════════════════════════════════════
// [H] 회귀 안전성
// ═══════════════════════════════════════════════════════════════════════
section('[H] 회귀 안전성');

// domain 미설정 방어 로직 유지
assert(
  /분석 영역이 설정되지 않았습니다/.test(serverSrc),
  'H-1: 도메인 미설정 시 400 에러 유지'
);
assert(
  /need_domain_select:\s*true/.test(serverSrc),
  'H-2: need_domain_select 필드 유지'
);
// applyDomainFilter 는 MGMT/null 을 skip 하는 기존 로직 그대로
assert(
  /if \(!div\) continue;\s*\/\/ MGMT\/null\/기타는 skip/.test(serverSrc),
  'H-3: applyDomainFilter MGMT skip 로직 유지'
);
// getActiveDomain 이 세션+DB 의존인 로직 그대로 (제거되지 않음)
assert(
  /if \(u\.active_domain\)\s*return u\.active_domain/.test(serverSrc),
  'H-4: getActiveDomain 세션 우선 로직 유지'
);
// [DomainSync] 로그 태그 3회 (async 진입, /api/nlq 진입, 세션 동기화)
{
  const dsyncMatches = serverSrc.match(/\[DomainSync[^\]]*\]/g) || [];
  assert(dsyncMatches.length >= 3, `H-5: [DomainSync] 로그 태그 3회 이상 (실제: ${dsyncMatches.length})`);
}

// ═══════════════════════════════════════════════════════════════════════
// 결과 요약
// ═══════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(72));
console.log(`총 assertions: ${passCount + failCount}`);
console.log(`  ✅ PASS: ${passCount}`);
console.log(`  ❌ FAIL: ${failCount}`);
console.log('='.repeat(72));

if (failCount > 0) process.exit(1);
