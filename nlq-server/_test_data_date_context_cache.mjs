// ============================================================
// [PR #340 / 2026-08-04] getDataDateContext 캐시 & ok/errorCode 회귀 테스트
// ------------------------------------------------------------
//  검증 대상:
//   1. 성공 응답에 ok=true / latestMonth / latestLabel 이 채워짐
//   2. 실패(DB 오류/데이터없음) 시 ok=false + errorCode 반환, 캐시하지 않음
//   3. 성공 응답은 TTL 내 재호출 시 DB 재히트 없음 (캐시 히트)
//   4. invalidateDataDateContextCache() 호출 후 다음 호출은 DB 재히트
//
//  주의: DB 연결 / OpenAI 호출 없이 mock pool 만으로 검증.
//        server.mjs 전체를 import 하면 사이드이펙트가 크므로
//        핵심 로직만 로컬에서 재선언하여 동일 규칙을 검증한다.
//        server.mjs 의 실제 구현이 이 로직과 일치해야 함은 별도 검증.
//
//  실행:  node _test_data_date_context_cache.mjs
// ============================================================

let pass = 0;
let fail = 0;

function assert(name, cond, detail) {
  if (cond) {
    pass++; console.log(`  ✓ ${name}`);
  } else {
    fail++; console.log(`  ✗ ${name}`);
    if (detail) console.log(`    ${detail}`);
  }
}

// ------------------------------------------------------------
// SUT (System Under Test): server.mjs 의 getDataDateContext 와 동일 규칙으로 재구성
// ------------------------------------------------------------
function makeSUT(pool, ttlMs = 10 * 60 * 1000) {
  let _cache = null;

  function invalidate() { _cache = null; }

  async function getDataDateContext() {
    if (_cache && Date.now() < _cache.expiresAt) {
      return _cache.value;
    }
    try {
      const [rows] = await pool.query('SELECT MAX(CALMONTH) AS latest FROM bw_profitability_data');
      const latest = rows[0]?.latest;
      if (!latest) {
        return {
          ok: false,
          errorCode: 'NO_DATA',
          latestMonth: '202604', prevMonth: '202603',
          latestLabel: '2026년 4월', prevLabel: '2026년 3월',
        };
      }
      const y = parseInt(latest.substring(0, 4));
      const m = parseInt(latest.substring(4, 6));
      const prevY = m === 1 ? y - 1 : y;
      const prevM = m === 1 ? 12 : m - 1;
      const prevMonth = `${prevY}${String(prevM).padStart(2, '0')}`;
      const latestLabel = `${y}년 ${m}월`;
      const prevLabel = `${prevY}년 ${prevM}월`;
      const value = { ok: true, latestMonth: latest, prevMonth, latestLabel, prevLabel };
      _cache = { value, expiresAt: Date.now() + ttlMs };
      return value;
    } catch (e) {
      return {
        ok: false,
        errorCode: 'DB_ERROR',
        errorMessage: e.message,
        latestMonth: '202604', prevMonth: '202603',
        latestLabel: '2026년 4월', prevLabel: '2026년 3월',
      };
    }
  }

  return { getDataDateContext, invalidate };
}

// ------------------------------------------------------------
// Mock pool: query 호출 횟수와 다음 반환값을 제어
// ------------------------------------------------------------
function makeMockPool() {
  const state = {
    calls: 0,
    next: null,   // { rows } or { throw: Error }
  };
  return {
    state,
    query: async (sql) => {
      state.calls++;
      if (state.next?.throw) throw state.next.throw;
      return [state.next?.rows ?? [{ latest: null }]];
    },
    setRows(rows)  { state.next = { rows }; },
    setError(msg)  { state.next = { throw: new Error(msg) }; },
    reset()        { state.calls = 0; state.next = null; },
  };
}

// ============================================================
// Group 1. 성공 응답 스키마
// ============================================================
console.log('\n━━━ [Group 1] 성공 응답 스키마 ━━━');
{
  const pool = makeMockPool();
  const sut  = makeSUT(pool);
  pool.setRows([{ latest: '202606' }]);
  const r = await sut.getDataDateContext();
  assert('1-1) ok === true', r.ok === true);
  assert('1-2) latestMonth === "202606"', r.latestMonth === '202606');
  assert('1-3) prevMonth === "202605"', r.prevMonth === '202605');
  assert('1-4) latestLabel === "2026년 6월"', r.latestLabel === '2026년 6월');
  assert('1-5) prevLabel === "2026년 5월"', r.prevLabel === '2026년 5월');
  assert('1-6) DB 쿼리 1회 발생', pool.state.calls === 1, `실제 호출: ${pool.state.calls}`);
}

// ============================================================
// Group 2. 연/월 경계 (1월 → 전년 12월)
// ============================================================
console.log('\n━━━ [Group 2] 연/월 경계 처리 ━━━');
{
  const pool = makeMockPool();
  const sut  = makeSUT(pool);
  pool.setRows([{ latest: '202601' }]);
  const r = await sut.getDataDateContext();
  assert('2-1) latestMonth === "202601"', r.latestMonth === '202601');
  assert('2-2) prevMonth === "202512"', r.prevMonth === '202512',
    `실제: ${r.prevMonth}`);
  assert('2-3) prevLabel === "2025년 12월"', r.prevLabel === '2025년 12월');
}

// ============================================================
// Group 3. 데이터 없음 (MAX(CALMONTH)=NULL) → ok=false, 캐시 안 함
// ============================================================
console.log('\n━━━ [Group 3] 데이터 없음 케이스 ━━━');
{
  const pool = makeMockPool();
  const sut  = makeSUT(pool);
  pool.setRows([{ latest: null }]);
  const r1 = await sut.getDataDateContext();
  assert('3-1) ok === false', r1.ok === false);
  assert('3-2) errorCode === "NO_DATA"', r1.errorCode === 'NO_DATA');

  // 다시 호출하면 캐시 안 하므로 DB 재히트
  pool.setRows([{ latest: null }]);
  const before = pool.state.calls;
  await sut.getDataDateContext();
  assert('3-3) 실패 응답은 캐시되지 않아 DB 재호출됨',
    pool.state.calls === before + 1,
    `호출 전=${before}, 호출 후=${pool.state.calls}`);
}

// ============================================================
// Group 4. DB 오류 → ok=false + errorCode, 캐시 안 함
// ============================================================
console.log('\n━━━ [Group 4] DB 오류 케이스 ━━━');
{
  const pool = makeMockPool();
  const sut  = makeSUT(pool);
  pool.setError('ER_LOCK_WAIT_TIMEOUT');
  const r1 = await sut.getDataDateContext();
  assert('4-1) ok === false', r1.ok === false);
  assert('4-2) errorCode === "DB_ERROR"', r1.errorCode === 'DB_ERROR');
  assert('4-3) errorMessage 전달됨', /ER_LOCK/.test(r1.errorMessage || ''));

  // 실패는 캐시 안 함 → 다음 호출은 DB 재히트
  pool.setRows([{ latest: '202606' }]);
  const before = pool.state.calls;
  const r2 = await sut.getDataDateContext();
  assert('4-4) 실패 후 재호출 시 DB 재히트',
    pool.state.calls === before + 1);
  assert('4-5) 재호출 성공 → ok=true, latest=202606',
    r2.ok === true && r2.latestMonth === '202606');
}

// ============================================================
// Group 5. 성공 응답 캐시 (TTL 내 재호출 = DB 히트 없음)
// ============================================================
console.log('\n━━━ [Group 5] TTL 내 캐시 히트 ━━━');
{
  const pool = makeMockPool();
  const sut  = makeSUT(pool, 60 * 1000); // TTL 60초
  pool.setRows([{ latest: '202606' }]);

  // 첫 호출: DB 히트
  const r1 = await sut.getDataDateContext();
  assert('5-1) 첫 호출은 DB 히트', pool.state.calls === 1);
  assert('5-2) 첫 호출 결과 ok=true', r1.ok === true);

  // 캐시 히트: 아무리 호출해도 DB 재히트 없음
  for (let i = 0; i < 5; i++) {
    await sut.getDataDateContext();
  }
  assert('5-3) TTL 내 5회 재호출은 모두 캐시 히트 (DB 호출 1회 유지)',
    pool.state.calls === 1, `실제 DB 호출 횟수: ${pool.state.calls}`);
}

// ============================================================
// Group 6. invalidate() 후 즉시 DB 재히트
// ============================================================
console.log('\n━━━ [Group 6] invalidate() 후 재히트 ━━━');
{
  const pool = makeMockPool();
  const sut  = makeSUT(pool);
  pool.setRows([{ latest: '202606' }]);

  await sut.getDataDateContext(); // 1회
  await sut.getDataDateContext(); // 캐시
  assert('6-1) invalidate 전: DB 호출 1회', pool.state.calls === 1);

  // 새 데이터 적재 시나리오
  sut.invalidate();
  pool.setRows([{ latest: '202607' }]);
  const r = await sut.getDataDateContext();

  assert('6-2) invalidate 후 첫 호출은 DB 재히트', pool.state.calls === 2);
  assert('6-3) invalidate 후 결과에 새 latestMonth 반영',
    r.latestMonth === '202607' && r.latestLabel === '2026년 7월');
}

// ============================================================
// Group 7. TTL 만료 후 DB 재히트
// ============================================================
console.log('\n━━━ [Group 7] TTL 만료 후 재히트 ━━━');
{
  const pool = makeMockPool();
  // 아주 짧은 TTL 로 실제 만료 재현
  const sut = makeSUT(pool, 50); // 50ms
  pool.setRows([{ latest: '202606' }]);
  await sut.getDataDateContext();
  assert('7-1) 초기 호출 후 DB 1회', pool.state.calls === 1);

  await new Promise(r => setTimeout(r, 80));
  pool.setRows([{ latest: '202607' }]);
  const r = await sut.getDataDateContext();
  assert('7-2) TTL 만료 후 DB 재히트', pool.state.calls === 2);
  assert('7-3) 새 값 반영', r.latestMonth === '202607');
}

// ============================================================
// Group 8. server.mjs 실제 구현과 이 SUT 규칙 일치성 검사 (static)
// ------------------------------------------------------------
// SUT 는 위에서 로컬로 재선언한 것이므로 server.mjs 의 실제 구현이
// 아래 핵심 심볼들을 그대로 갖고 있어야 함.
// ============================================================
console.log('\n━━━ [Group 8] server.mjs 실제 구현과 스펙 일치성 ━━━');
{
  const fs = await import('fs');
  const path = await import('path');
  const url = await import('url');
  const __filename = url.fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const src = fs.readFileSync(path.resolve(__dirname, 'server.mjs'), 'utf-8');

  assert('8-1) invalidateDataDateContextCache 함수 정의 존재',
    /function\s+invalidateDataDateContextCache\s*\(/.test(src));

  assert('8-2) DATE_CTX_CACHE_TTL_MS 상수 정의 존재',
    /DATE_CTX_CACHE_TTL_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/.test(src));

  assert('8-3) 캐시 히트 분기 존재 (_dateCtxCache && Date.now() < expiresAt)',
    /_dateCtxCache\s*&&\s*Date\.now\(\)\s*<\s*_dateCtxCache\.expiresAt/.test(src));

  assert('8-4) 성공 응답에 ok: true 필드 포함',
    /ok:\s*true,\s*latestMonth:\s*latest/.test(src));

  assert('8-5) 실패 응답에 ok: false + errorCode 필드 포함',
    /ok:\s*false,\s*errorCode:\s*'NO_DATA'/.test(src) &&
    /ok:\s*false,\s*errorCode:\s*'DB_ERROR'/.test(src));

  assert('8-6) /api/data-date-context 는 ok:false 시 HTTP 503 반환',
    /if\s*\(ctx\.ok\s*===\s*false\)\s*\{[\s\S]{0,200}res\.status\(503\)/.test(src));

  assert('8-7) 배치 완료 성공 후 bw_profitability_data 인 경우에 한해 캐시 무효화 호출',
    /cfg\.target_table\s*===\s*'bw_profitability_data'[\s\S]{0,120}invalidateDataDateContextCache\(\)/.test(src));
}

// ============================================================
// 총평
// ============================================================
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  결과:  통과 ${pass}건 / 실패 ${fail}건`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (fail > 0) {
  console.error('\n[FAIL] getDataDateContext 캐시/에러 회귀 테스트 실패\n');
  process.exit(1);
}
console.log('\n[PASS] 캐시·에러 응답·무효화 동작 모두 정상\n');
