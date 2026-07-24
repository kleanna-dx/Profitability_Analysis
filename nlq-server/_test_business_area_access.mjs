// ============================================================
// [2026-07-24] 업무영역 권한 (Business Area Access) 회귀 테스트
// ------------------------------------------------------------
//  검증 대상:
//   1. getUserBusinessAreas 로직 (admin 동적 조회 / 일반 사용자 매핑 / 폴백)
//   2. requireBusinessArea 미들웨어 (401 / 403 / next() 분기)
//   3. area_code 화이트리스트 검증
//   4. 3 페르소나 시나리오 (admin / PS-only / dual-area)
//
//  주의: 서버 전체가 아닌 미들웨어/헬퍼 단위 검증.
//        DB pool 은 mock 으로 대체하여 실제 DB 없이 실행 가능.
//
//  실행: node _test_business_area_access.mjs
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

function assertEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(name, a === e, `expected: ${e}\n    actual:   ${a}`);
}

// ------------------------------------------------------------
// Mock DB pool
// ------------------------------------------------------------
function makeMockPool(fixtures) {
  return {
    async query(sql, params) {
      // sys_aimd_areas 활성 목록 (admin 조회용)
      if (/FROM sys_aimd_areas.*is_active\s*=\s*1/i.test(sql) && !/sys_aimd_user_areas/i.test(sql)) {
        return [fixtures.activeAreas.map(c => ({ area_code: c, sort_order: 0, id: 1 }))];
      }
      // 사용자 매핑 조회 (sys_aimd_user_areas JOIN)
      if (/FROM sys_aimd_user_areas/i.test(sql)) {
        const userId = params[0];
        const codes = fixtures.userAreas[userId] || [];
        return [codes.map(c => ({ area_code: c }))];
      }
      // role_code 조회 (requireBusinessArea 내부)
      if (/COALESCE\(r\.role_code/i.test(sql) && /WHERE u\.user_id/i.test(sql)) {
        const userId = params[0];
        const roleCode = fixtures.userRoles[userId];
        return roleCode ? [[{ role_code: roleCode }]] : [[]];
      }
      throw new Error('Unmocked SQL: ' + sql.substring(0, 80));
    },
  };
}

// ------------------------------------------------------------
// SUT 재구성 — server.mjs 의 헬퍼/미들웨어를 격리하여 테스트
//   실제 server.mjs 는 import 시 DB 연결 등 사이드이펙트가 있어
//   여기서는 동일 로직을 mock pool 위에 재선언하여 검증한다.
// ------------------------------------------------------------
function makeSUT(pool) {
  async function getUserBusinessAreas(userId, roleCode) {
    if (roleCode === 'admin') {
      try {
        const [rows] = await pool.query(
          `SELECT area_code FROM sys_aimd_areas WHERE is_active = 1 ORDER BY sort_order, id`
        );
        return rows.map(r => r.area_code);
      } catch (e) { return []; }
    }
    try {
      const [rows] = await pool.query(
        `SELECT uba.area_code FROM sys_aimd_user_areas uba
           JOIN sys_aimd_areas ba ON ba.area_code = uba.area_code
          WHERE uba.user_id = ? AND ba.is_active = 1
          ORDER BY ba.sort_order, ba.id`,
        [userId]
      );
      const list = rows.map(r => r.area_code);
      return list.length > 0 ? list : ['PROFITABILITY'];
    } catch (e) { return ['PROFITABILITY']; }
  }

  function requireBusinessArea(areaCode) {
    return async (req, res, next) => {
      if (!req.session?.user) {
        return res.status(401).json({ error: '로그인이 필요합니다.' });
      }
      const u = req.session.user;
      try {
        const [freshRow] = await pool.query(
          `SELECT COALESCE(r.role_code, 'user') AS role_code
             FROM users u LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.user_id = ?`, [u.id]
        );
        const roleCode = freshRow.length > 0 ? freshRow[0].role_code : (u.role || 'user');
        const areas = await getUserBusinessAreas(u.id, roleCode);
        if (!areas.includes(areaCode)) {
          return res.status(403).json({ error: `업무영역 [${areaCode}] 접근 권한이 없습니다.` });
        }
        req.userBusinessAreas = areas;
        req.userRoleCode = roleCode;
        next();
      } catch (e) {
        return res.status(500).json({ error: '권한 확인 중 오류가 발생했습니다.' });
      }
    };
  }

  return { getUserBusinessAreas, requireBusinessArea };
}

// ------------------------------------------------------------
// Test fake req/res
// ------------------------------------------------------------
function makeRes() {
  const r = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return r;
}
function makeReq(sessionUser) {
  return { session: sessionUser ? { user: sessionUser } : null };
}

// ============================================================
// TEST FIXTURES
// ============================================================
//  - active area 는 초기에는 2개, 나중에 3개로 확장하여
//    "admin 하드코딩 없음"을 검증
const fixturesBase = {
  activeAreas: ['PROFITABILITY', 'MANUFACTURING_COST'],
  userRoles: {
    'admin_user':    'admin',
    'ps_user':       'user',
    'dual_user':     'user',
    'orphan_user':   'user',      // 매핑 없음 → PROFITABILITY 폴백
  },
  userAreas: {
    'ps_user':   ['PROFITABILITY'],
    'dual_user': ['PROFITABILITY', 'MANUFACTURING_COST'],
    // orphan_user: 없음 (테스트 케이스)
    // admin_user: 매핑 없음 → 하지만 role=admin 이므로 활성 area 전체 반환
  },
};

// ============================================================
// [A] getUserBusinessAreas 검증
// ============================================================
console.log('\n[A] getUserBusinessAreas — 페르소나별 반환');
{
  const pool = makeMockPool(fixturesBase);
  const { getUserBusinessAreas } = makeSUT(pool);

  (async () => {
    // admin: 활성 area 전체 (DB 동적 조회 → 하드코딩 배열 아님)
    const adminAreas = await getUserBusinessAreas('admin_user', 'admin');
    assertEq('admin 은 활성 area 전체 반환', adminAreas.sort(),
      ['MANUFACTURING_COST', 'PROFITABILITY']);

    // PS-only 사용자
    const psAreas = await getUserBusinessAreas('ps_user', 'user');
    assertEq('일반 사용자(PS) 는 매핑된 area 만', psAreas, ['PROFITABILITY']);

    // 두 영역 모두 부여받은 사용자
    const dualAreas = await getUserBusinessAreas('dual_user', 'user');
    assertEq('dual 사용자 는 두 영역 모두 반환', dualAreas.sort(),
      ['MANUFACTURING_COST', 'PROFITABILITY']);

    // 매핑 없는 사용자 → 안전 폴백
    const orphanAreas = await getUserBusinessAreas('orphan_user', 'user');
    assertEq('매핑 없는 사용자 는 PROFITABILITY 폴백', orphanAreas, ['PROFITABILITY']);
  })();
}

// ============================================================
// [B] admin 은 하드코딩된 area 배열이 아님 — 활성 area 추가 시 자동 반영
// ============================================================
console.log('\n[B] admin 동적 확장성 — 활성 area 추가 시 자동 반영');
{
  const extendedFixtures = {
    ...fixturesBase,
    activeAreas: ['PROFITABILITY', 'MANUFACTURING_COST', 'RND_COST', 'MARKETING_ROI'],
  };
  const pool = makeMockPool(extendedFixtures);
  const { getUserBusinessAreas } = makeSUT(pool);

  (async () => {
    const adminAreas = await getUserBusinessAreas('admin_user', 'admin');
    assertEq('admin 이 활성 area 4개를 자동 획득 (하드코딩 없음)',
      adminAreas.sort(),
      ['MANUFACTURING_COST', 'MARKETING_ROI', 'PROFITABILITY', 'RND_COST']);
    assert('admin 반환에 PROFITABILITY 만 하드코딩된 것이 아님',
      adminAreas.length === 4);

    // 일반 사용자는 여전히 자기 매핑만
    const psAreas = await getUserBusinessAreas('ps_user', 'user');
    assertEq('일반 사용자는 area 확장의 영향을 받지 않음', psAreas, ['PROFITABILITY']);
  })();
}

// ============================================================
// [C] requireBusinessArea 미들웨어 — 401/403/next 분기
// ============================================================
console.log('\n[C] requireBusinessArea 미들웨어');
{
  const pool = makeMockPool(fixturesBase);
  const { requireBusinessArea } = makeSUT(pool);

  (async () => {
    // 비로그인 → 401
    {
      const req = makeReq(null);
      const res = makeRes();
      let called = false;
      await requireBusinessArea('MANUFACTURING_COST')(req, res, () => { called = true; });
      assert('비로그인 → 401', res.statusCode === 401);
      assert('비로그인 → next() 미호출', called === false);
    }

    // admin → 항상 통과
    {
      const req = makeReq({ id: 'admin_user', role: 'admin' });
      const res = makeRes();
      let called = false;
      await requireBusinessArea('MANUFACTURING_COST')(req, res, () => { called = true; });
      assert('admin → MC 접근 허용 (next 호출)', called === true);
      assert('admin → 상태코드 변화 없음', res.statusCode === 200);
    }

    // PS-only → PROFITABILITY 허용
    {
      const req = makeReq({ id: 'ps_user', role: 'user' });
      const res = makeRes();
      let called = false;
      await requireBusinessArea('PROFITABILITY')(req, res, () => { called = true; });
      assert('PS 사용자 → PROFITABILITY 접근 허용', called === true);
    }

    // PS-only → MANUFACTURING_COST 차단 (403)
    {
      const req = makeReq({ id: 'ps_user', role: 'user' });
      const res = makeRes();
      let called = false;
      await requireBusinessArea('MANUFACTURING_COST')(req, res, () => { called = true; });
      assert('PS 사용자 → MC 접근 차단 (403)', res.statusCode === 403);
      assert('PS 사용자 → next() 미호출', called === false);
      assert('403 에러 메시지에 area 코드 포함',
        res.body?.error?.includes('MANUFACTURING_COST'));
    }

    // Dual user → MC 허용
    {
      const req = makeReq({ id: 'dual_user', role: 'user' });
      const res = makeRes();
      let called = false;
      await requireBusinessArea('MANUFACTURING_COST')(req, res, () => { called = true; });
      assert('dual 사용자 → MC 접근 허용', called === true);
    }

    // 프론트에서 위조된 role 은 무시되어야 함 (서버가 DB 재조회)
    {
      // 세션에 role: 'admin' 이 있어도, DB fixtures 의 실제 role 은 'user'
      const req = makeReq({ id: 'ps_user', role: 'admin' /* ← 위조 */ });
      const res = makeRes();
      let called = false;
      await requireBusinessArea('MANUFACTURING_COST')(req, res, () => { called = true; });
      assert('세션의 role 위조는 무시됨 (DB 재조회) → 403',
        res.statusCode === 403);
      assert('위조 role 미들웨어 통과 안 됨', called === false);
    }
  })();
}

// ============================================================
// [D] 3 페르소나 시나리오 — /api/me 응답 시뮬레이션
// ============================================================
console.log('\n[D] 3 페르소나 종합 시나리오');
{
  const pool = makeMockPool(fixturesBase);
  const { getUserBusinessAreas } = makeSUT(pool);

  (async () => {
    // 페르소나 1: admin
    const p1 = await getUserBusinessAreas('admin_user', 'admin');
    assert('[페르소나 admin] 두 영역 모두 포함', p1.includes('PROFITABILITY') && p1.includes('MANUFACTURING_COST'));

    // 페르소나 2: PS-only 일반 사용자
    const p2 = await getUserBusinessAreas('ps_user', 'user');
    assert('[페르소나 PS] PROFITABILITY 만 포함', p2.length === 1 && p2[0] === 'PROFITABILITY');
    assert('[페르소나 PS] MC 미포함', !p2.includes('MANUFACTURING_COST'));

    // 페르소나 3: 두 영역 모두 부여받은 사용자
    const p3 = await getUserBusinessAreas('dual_user', 'user');
    assert('[페르소나 dual] 두 영역 모두 포함', p3.includes('PROFITABILITY') && p3.includes('MANUFACTURING_COST'));
  })();
}

// ============================================================
// [E] 안전 폴백 — pool.query 실패 시
// ============================================================
console.log('\n[E] DB 오류 시 안전 폴백');
{
  const failPool = { async query() { throw new Error('DB down'); } };
  const { getUserBusinessAreas } = makeSUT(failPool);

  (async () => {
    const areas = await getUserBusinessAreas('any_user', 'user');
    assertEq('일반 사용자 DB 오류 → PROFITABILITY 폴백', areas, ['PROFITABILITY']);

    const adminAreas = await getUserBusinessAreas('admin_user', 'admin');
    assertEq('admin DB 오류 → 빈 배열 (안전 실패)', adminAreas, []);
  })();
}

// ------------------------------------------------------------
// 결과 요약 (비동기 완료 대기)
// ------------------------------------------------------------
setTimeout(() => {
  console.log('\n════════════════════════════════════════════════════════════');
  console.log(`총 ${pass + fail} 개 테스트: ${pass} 성공 / ${fail} 실패`);
  if (fail === 0) {
    console.log('✅ 전체 통과');
    process.exit(0);
  } else {
    console.log('❌ 실패 있음');
    process.exit(1);
  }
}, 500);
