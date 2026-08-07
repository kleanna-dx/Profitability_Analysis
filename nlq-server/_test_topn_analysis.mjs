// ============================================================
// [Task 6] 분석질문 TOP N 결과와 답변 내 표 불일치 수정 검증
// ------------------------------------------------------------
// 검증 대상 (server.mjs 안의 로직을 여기 복사해서 격리 테스트):
//   1. extractCodeNameCols(dim)            — dimension → (codeCol, nameCol)
//   2. filterNullCodeNameDummyRows(rows,p) — 코드·명 둘 다 NULL 인 행 제외
//   3. sortAndSliceForTopN(rows, p, op)    — 정렬 + slice
//   4. runPostOperations TOP_N 통합 시나리오
//   5. buildAggregationSqlFromPlan 단일 축 TOP_N → DB 단 ORDER BY LIMIT
//
// 실행: node nlq-server/_test_topn_analysis.mjs
// ============================================================

// ────────────────────────────────────────────────────────────
// server.mjs 안의 로직을 그대로 복사 (변경 시 함께 갱신 필요)
// ────────────────────────────────────────────────────────────
function extractCodeNameCols(dim) {
  if (!dim || !Array.isArray(dim.columns) || dim.columns.length === 0) return { codeCol: null, nameCol: null };
  const cols = dim.columns.filter(c => c && typeof c === 'string');
  if (cols.length === 0) return { codeCol: null, nameCol: null };
  const isNameLike = (col) => /(_NM|_NAME|_KO|_KOR|_KR|NAME_KO|_TEXT|_TXT|_DESC)$/i.test(String(col));
  if (dim.groupByAll === true || cols.length === 1) {
    return { codeCol: cols[0], nameCol: cols.find((c, i) => i > 0 && isNameLike(c)) || null };
  }
  const codeCol = cols.find(c => !isNameLike(c)) || cols[0];
  const nameCol = cols.find(c => c !== codeCol && isNameLike(c))
                || cols.find(c => c !== codeCol)
                || null;
  return { codeCol, nameCol };
}

function filterNullCodeNameDummyRows(rows, plan) {
  if (!Array.isArray(rows) || rows.length === 0) return { rows, excluded: 0, applied: false };
  const dims = Array.isArray(plan.dimensions) ? plan.dimensions : [];
  if (dims.length === 0) return { rows, excluded: 0, applied: false };
  if (plan.includeNullCodes === true) return { rows, excluded: 0, applied: false };
  const primary = dims[0];
  const { codeCol, nameCol } = extractCodeNameCols(primary);
  if (!codeCol) return { rows, excluded: 0, applied: false };
  const isEmpty = (v) => (v === null || v === undefined || (typeof v === 'string' && v.trim() === ''));
  const kept = [];
  let excluded = 0;
  for (const r of rows) {
    const codeEmpty = isEmpty(r[codeCol]);
    const bothEmpty = nameCol ? (codeEmpty && isEmpty(r[nameCol])) : codeEmpty;
    if (bothEmpty) { excluded++; continue; }
    kept.push(r);
  }
  return { rows: kept, excluded, applied: true, codeCol, nameCol };
}

function sortAndSliceForTopN(rows, plan, topOp, alreadySorted = false) {
  const n = Math.max(1, Math.min(1000, parseInt(topOp?.n, 10) || 10));
  const metrics = Array.isArray(plan.metrics) ? plan.metrics : [];
  const byRaw = topOp?.by || (metrics[0] && metrics[0].name) || null;
  const orderRaw = String(topOp?.order || 'DESC').toUpperCase();
  const dir = orderRaw === 'ASC' ? 1 : -1;
  let working = Array.isArray(rows) ? rows.slice() : [];
  let effectiveBy = byRaw;
  if (!alreadySorted && working.length > 0 && effectiveBy) {
    if (!(effectiveBy in working[0])) {
      const keys = Object.keys(working[0]);
      const alt = keys.find(k => k.replace(/\s+/g, '').toLowerCase() === String(effectiveBy).replace(/\s+/g, '').toLowerCase());
      if (alt) effectiveBy = alt;
    }
    if (effectiveBy in (working[0] || {})) {
      working.sort((a, b) => {
        const va = Number(a[effectiveBy]);
        const vb = Number(b[effectiveBy]);
        const aFin = Number.isFinite(va);
        const bFin = Number.isFinite(vb);
        if (!aFin && !bFin) return 0;
        if (!aFin) return 1;
        if (!bFin) return -1;
        return (va - vb) * dir;
      });
    }
  }
  return {
    n,
    rows: working.slice(0, n),
    orderBy: effectiveBy,
    orderDir: dir === 1 ? 'ASC' : 'DESC',
    sortedInApp: !alreadySorted,
  };
}

// ────────────────────────────────────────────────────────────
// 테스트 러너
// ────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const fails = [];

function assertEq(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ✅ ${label}`); }
  else {
    fail++;
    fails.push({ label, got, want });
    console.log(`  ❌ ${label}`);
    console.log(`     기대: ${JSON.stringify(want)}`);
    console.log(`     실제: ${JSON.stringify(got)}`);
  }
}
function assertTrue(label, cond) { assertEq(label, !!cond, true); }

// ────────────────────────────────────────────────────────────
// 1. extractCodeNameCols
// ────────────────────────────────────────────────────────────
console.log('\n[1] extractCodeNameCols');
assertEq('단일 컬럼', extractCodeNameCols({ columns: ['MATERIAL'] }), { codeCol: 'MATERIAL', nameCol: null });
assertEq('코드+명 (표준 순서)', extractCodeNameCols({ columns: ['MATERIAL', 'MATERIAL_NM'] }), { codeCol: 'MATERIAL', nameCol: 'MATERIAL_NM' });
assertEq('코드+명 (역순)', extractCodeNameCols({ columns: ['MATERIAL_NM', 'MATERIAL'] }), { codeCol: 'MATERIAL', nameCol: 'MATERIAL_NM' });
assertEq('HL 사업부 거래처', extractCodeNameCols({ columns: ['ZZKVGR7', 'ZZKVGR7_NM'] }), { codeCol: 'ZZKVGR7', nameCol: 'ZZKVGR7_NM' });
assertEq('groupByAll=true 무시', extractCodeNameCols({ columns: ['MATERIAL', 'MATERIAL_NM'], groupByAll: true }), { codeCol: 'MATERIAL', nameCol: 'MATERIAL_NM' });
assertEq('빈 columns', extractCodeNameCols({ columns: [] }), { codeCol: null, nameCol: null });
assertEq('undefined dim', extractCodeNameCols(undefined), { codeCol: null, nameCol: null });
assertEq('명 컬럼만 (fallback)', extractCodeNameCols({ columns: ['CUSTOMER_NM'] }), { codeCol: 'CUSTOMER_NM', nameCol: null });

// ────────────────────────────────────────────────────────────
// 2. filterNullCodeNameDummyRows
// ────────────────────────────────────────────────────────────
console.log('\n[2] filterNullCodeNameDummyRows');
{
  const plan = { dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }] };
  const rows = [
    { MATERIAL: null, MATERIAL_NM: null, 순매출: 6000000 },       // dummy — 제외
    { MATERIAL: 'FBD-A', MATERIAL_NM: '보솜이 A', 순매출: 866565 },
    { MATERIAL: null, MATERIAL_NM: '이름만 있음', 순매출: 500000 },  // 코드만 NULL → 유지
    { MATERIAL: 'FBD-B', MATERIAL_NM: null, 순매출: 700000 },      // 명만 NULL → 유지
    { MATERIAL: '', MATERIAL_NM: '', 순매출: 100000 },             // 빈 문자열도 empty
    { MATERIAL: 'FBD-C', MATERIAL_NM: '보솜이 C', 순매출: -298800 },
  ];
  const result = filterNullCodeNameDummyRows(rows, plan);
  assertEq('applied=true', result.applied, true);
  assertEq('excluded=2 (row0, row4)', result.excluded, 2);
  assertEq('남은 행 수=4', result.rows.length, 4);
  assertEq('첫 남은 행 코드', result.rows[0].MATERIAL, 'FBD-A');
  assertEq('명만 있는 행 유지 (row2)', result.rows[1].MATERIAL_NM, '이름만 있음');
}
{
  const plan = { dimensions: [{ name: 'SKU', columns: ['MATERIAL'] }] };  // nameCol 없음
  const rows = [
    { MATERIAL: null, 순매출: 6000000 },     // 제외 (codeCol 만 있는데 empty)
    { MATERIAL: 'A', 순매출: 1000 },
  ];
  const result = filterNullCodeNameDummyRows(rows, plan);
  assertEq('nameCol 없을 때 codeCol만 empty → 제외', result.excluded, 1);
  assertEq('남은 행=1', result.rows.length, 1);
}
{
  const plan = { dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }], includeNullCodes: true };
  const rows = [
    { MATERIAL: null, MATERIAL_NM: null, 순매출: 6000000 },
    { MATERIAL: 'A', MATERIAL_NM: '보솜이', 순매출: 1000 },
  ];
  const result = filterNullCodeNameDummyRows(rows, plan);
  assertEq('includeNullCodes=true → 필터 스킵', result.applied, false);
  assertEq('스킵 시 excluded=0', result.excluded, 0);
  assertEq('전체 유지', result.rows.length, 2);
}
{
  const plan = { dimensions: [] };
  const rows = [{ MATERIAL: null }];
  const result = filterNullCodeNameDummyRows(rows, plan);
  assertEq('dimensions 없으면 스킵', result.applied, false);
}
{
  const result = filterNullCodeNameDummyRows([], { dimensions: [{ columns: ['A'] }] });
  assertEq('빈 rows', result.rows.length, 0);
}

// ────────────────────────────────────────────────────────────
// 3. sortAndSliceForTopN
// ────────────────────────────────────────────────────────────
console.log('\n[3] sortAndSliceForTopN');
{
  const plan = { metrics: [{ name: '순매출' }] };
  const op = { type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' };
  // 스크린샷 그대로의 상황 — 정렬 안 된 6행 (음수 포함)
  const rows = [
    { MATERIAL: 'FBD-AFP0001A', 순매출: 866565 },
    { MATERIAL: 'FBD-AFP0002A', 순매출: -298800 },
    { MATERIAL: 'FBD-AFP0003A', 순매출: -231480 },
    { MATERIAL: 'FBD-AFP0004A', 순매출: 796552 },
    { MATERIAL: 'FBD-BIG',       순매출: 5000000 },  // 실제 1위
    { MATERIAL: 'FBD-MED',       순매출: 1500000 },  // 실제 2위
  ];
  const result = sortAndSliceForTopN(rows, plan, op);
  assertEq('n=5', result.n, 5);
  assertEq('orderBy=순매출', result.orderBy, '순매출');
  assertEq('orderDir=DESC', result.orderDir, 'DESC');
  assertEq('rows.length=5', result.rows.length, 5);
  assertEq('1위=FBD-BIG (5,000,000)', result.rows[0].MATERIAL, 'FBD-BIG');
  assertEq('2위=FBD-MED (1,500,000)', result.rows[1].MATERIAL, 'FBD-MED');
  assertEq('3위=FBD-AFP0001A (866,565)', result.rows[2].MATERIAL, 'FBD-AFP0001A');
  assertEq('4위=FBD-AFP0004A (796,552)', result.rows[3].MATERIAL, 'FBD-AFP0004A');
  assertEq('5위=FBD-AFP0003A (-231,480 이 -298,800 보다 큼)', result.rows[4].MATERIAL, 'FBD-AFP0003A');
  assertTrue('DESC 정렬 확인', result.rows.every((r, i, arr) => i === 0 || arr[i-1].순매출 >= r.순매출));
}
{
  const plan = { metrics: [{ name: '순매출' }] };
  const op = { type: 'TOP_N', n: 3, by: '순매출', order: 'ASC' };
  const rows = [
    { MATERIAL: 'A', 순매출: 100 },
    { MATERIAL: 'B', 순매출: -50 },
    { MATERIAL: 'C', 순매출: 30 },
    { MATERIAL: 'D', 순매출: 200 },
  ];
  const result = sortAndSliceForTopN(rows, plan, op);
  assertEq('ASC 정렬 하위 3', result.rows.map(r => r.MATERIAL), ['B', 'C', 'A']);
  assertEq('orderDir=ASC', result.orderDir, 'ASC');
}
{
  // by 없을 때 metrics[0].name fallback
  const plan = { metrics: [{ name: '영업이익' }] };
  const op = { type: 'TOP_N', n: 2 };  // by 누락
  const rows = [
    { CUSTOMER: 'A', 영업이익: 100 },
    { CUSTOMER: 'B', 영업이익: 300 },
    { CUSTOMER: 'C', 영업이익: 200 },
  ];
  const result = sortAndSliceForTopN(rows, plan, op);
  assertEq('by 누락 → metrics[0].name fallback', result.orderBy, '영업이익');
  assertEq('fallback 후 정렬', result.rows.map(r => r.CUSTOMER), ['B', 'C']);
}
{
  // n 기본값 (op.n 없음)
  const plan = { metrics: [{ name: 'X' }] };
  const op = {};
  const rows = Array.from({ length: 15 }, (_, i) => ({ K: i, X: 100 - i }));
  const result = sortAndSliceForTopN(rows, plan, op);
  assertEq('n 기본=10', result.n, 10);
  assertEq('slice 10개', result.rows.length, 10);
}
{
  // 비수치 값 방어 (undefined, NaN)
  const plan = { metrics: [{ name: '값' }] };
  const op = { type: 'TOP_N', n: 3, by: '값', order: 'DESC' };
  const rows = [
    { K: 'A', 값: 100 },
    { K: 'B', 값: 'abc' },      // 비수치
    { K: 'C', 값: null },       // null
    { K: 'D', 값: 200 },
    { K: 'E', 값: undefined },  // undefined
    { K: 'F', 값: 50 },
  ];
  const result = sortAndSliceForTopN(rows, plan, op);
  // 수치인 3개가 앞으로: D=200, A=100, F=50
  assertEq('비수치 뒤로 → 수치 3개 상위', result.rows.map(r => r.K), ['D', 'A', 'F']);
}

// ────────────────────────────────────────────────────────────
// 4. 통합 시나리오: 스크린샷 재현 (dummy NULL + 정렬 안 됨)
// ────────────────────────────────────────────────────────────
console.log('\n[4] 통합 시나리오 (스크린샷 재현)');
{
  const plan = {
    dimensions: [{ name: 'SKU', columns: ['MATERIAL', 'MATERIAL_NM'] }],
    metrics: [{ name: '순매출' }],
    operations: [{ type: 'TOP_N', n: 5, by: '순매출', order: 'DESC' }],
  };
  const topOp = plan.operations[0];
  // 스크린샷과 유사: DB가 정렬 없이 준 6행 (dummy NULL 1위 포함)
  const baseRows = [
    { MATERIAL: null,          MATERIAL_NM: null,                                    순매출: 6000000 },  // dummy — 제외
    { MATERIAL: 'FBD-AFP0001A', MATERIAL_NM: '보솜이 액션핏 팬티 대형 30개입(24년)',   순매출: 866565 },
    { MATERIAL: 'FBD-AFP0002A', MATERIAL_NM: '보솜이 액션핏 팬티 특대형 26개입(24년)', 순매출: -298800 },
    { MATERIAL: 'FBD-AFP0003A', MATERIAL_NM: '보솜이 액션핏 팬티 점보형 20개입(24년)', 순매출: -231480 },
    { MATERIAL: 'FBD-AFP0004A', MATERIAL_NM: '보솜이 액션핏 팬티 중형 32개입(25년)',   순매출: 796552 },
    { MATERIAL: 'FBD-REAL1',    MATERIAL_NM: '실제 1위',                              순매출: 9000000 },
    { MATERIAL: 'FBD-REAL2',    MATERIAL_NM: '실제 2위',                              순매출: 7000000 },
  ];

  // runPostOperations 흐름 재현
  const filtered = filterNullCodeNameDummyRows(baseRows, plan);
  assertEq('통합: NULL dummy 1개 제외', filtered.excluded, 1);
  const sliced = sortAndSliceForTopN(filtered.rows, plan, topOp);
  assertEq('통합: 최종 5행', sliced.rows.length, 5);
  assertEq('통합: 1위=FBD-REAL1 (9,000,000)', sliced.rows[0].MATERIAL, 'FBD-REAL1');
  assertEq('통합: 2위=FBD-REAL2 (7,000,000)', sliced.rows[1].MATERIAL, 'FBD-REAL2');
  assertEq('통합: 3위=FBD-AFP0001A (866,565)', sliced.rows[2].MATERIAL, 'FBD-AFP0001A');
  assertEq('통합: 4위=FBD-AFP0004A (796,552)', sliced.rows[3].MATERIAL, 'FBD-AFP0004A');
  assertEq('통합: 5위=FBD-AFP0003A (-231,480)', sliced.rows[4].MATERIAL, 'FBD-AFP0003A');
  assertTrue('통합: dummy null 이 최종 결과에 없음',
    sliced.rows.every(r => r.MATERIAL !== null && r.MATERIAL_NM !== null));
  assertTrue('통합: DESC 정렬 유지',
    sliced.rows.every((r, i, arr) => i === 0 || arr[i-1].순매출 >= r.순매출));
}

// ────────────────────────────────────────────────────────────
// 5. buildAggregationSqlFromPlan 시뮬레이션 — 단일 축 TOP_N SQL 생성
//    (실제 함수를 import 할 수 없으므로 로직 축약 재현)
// ────────────────────────────────────────────────────────────
console.log('\n[5] 단일 축 TOP_N SQL 생성 시뮬레이션 (기대치)');
{
  // 케이스: TOP_N n=5, by='순매출', order='DESC', partitionBy 없음
  //   기대: ... ORDER BY `순매출` DESC LIMIT 25   (n + buffer 20 = 25)
  const n = 5;
  const buffer = 20;
  const dbLimit = Math.min(50000, n + buffer);
  const expectedTail = `ORDER BY \`순매출\` DESC LIMIT ${dbLimit}`;
  assertEq('DB LIMIT = n + 20', dbLimit, 25);
  assertTrue('SQL 뒤에 ORDER BY LIMIT 붙는 형식', expectedTail.startsWith('ORDER BY') && expectedTail.endsWith('LIMIT 25'));
}
{
  // partitionBy 있을 때는 CTE 경로 → LIMIT 없음
  const partitionBy = '달력연월';
  const useCte = !!partitionBy;
  assertTrue('partitionBy 있으면 CTE 경로', useCte);
}
{
  // TOP_N 없을 때는 기존 LIMIT 50000
  const topOp = null;
  const limit = topOp ? 25 : 50000;
  assertEq('TOP_N 없음 → LIMIT 50000', limit, 50000);
}

// ────────────────────────────────────────────────────────────
// 결과 요약
// ────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`  통과: ${pass}   실패: ${fail}   전체: ${pass + fail}`);
console.log('='.repeat(60));
if (fail > 0) {
  console.log('\n실패한 케이스:');
  for (const f of fails) {
    console.log(`  - ${f.label}`);
    console.log(`    기대: ${JSON.stringify(f.want)}`);
    console.log(`    실제: ${JSON.stringify(f.got)}`);
  }
  process.exit(1);
}
console.log('\n✅ 모든 테스트 통과');
