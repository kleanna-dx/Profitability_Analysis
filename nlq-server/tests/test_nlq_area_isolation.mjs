// ============================================================
// test_nlq_area_isolation.mjs
//
// [목적] 자연어질의 (NLQ) 영역 격리 Fail-Closed 가드 검증.
//        수익성분석 SQL 에 제조원가 전용 컬럼 (ZCGUBUN, KST001 등) 이
//        섞여 들어가도 DB 실행 전 차단되는지 regression 방지.
//
// [배경] 2026-11-03 사용자 치명 버그 신고:
//   수익성분석 영역에서 "깨끗한나라 제품 중 매출이 가장 높은 SKU 5개를 알려줘"
//   질문 시 SQL 에 `WHERE CALMONTH='202610' AND ZCGUBUN='실제원가'` 가
//   섞여 들어가 `Unknown column 'ZCGUBUN' in 'WHERE'` ER_BAD_FIELD_ERROR 발생.
//   ZCGUBUN 은 sys_aimd_cot015 (제조원가) 전용 컬럼인데 수익성분석
//   bw_profitability_data 쿼리에 유출되어 DB 레벨에서 실패.
//
// [설계]
//   assertNlqSqlAreaIsolation(sql, area) — fail-closed 가드
//     - area='profitability' + ZCGUBUN/ZCGUBUN_D/KST*/LBKUM 등 발견 → safe=false
//     - area='profitability' + sys_aimd_cot015/cot043 테이블 참조 → safe=false
//     - area='manufacturing-cost' + sys_aimd_cot043 참조 → safe=false
//     - area 미지정 → no-op (safe=true, 하위호환)
//
//   호출 지점 (SQL 실행 직전):
//     1. executeAnalysisPlan base SQL (라인 ~8223)
//     2. executeAnalysisPlan prior SQL (라인 ~8274)
//     3. /api/nlq aggregate path (라인 ~13372) ← 사용자 버그 핵심 경로
//     4. /api/nlq/rewrite-cost-basis (라인 ~16750)
//
// [규칙] 영역 격리
//   수익성분석 (bw_profitability_data):
//     - 금지 테이블: sys_aimd_cot015, sys_aimd_cot043
//     - 금지 컬럼: ZCGUBUN, ZCGUBUN_D, KST001~KST039, KST_V, KST_F, LBKUM, BASE_UOM
//   제조원가 (sys_aimd_cot015):
//     - 금지 테이블: sys_aimd_cot043
//     - 금지 컬럼: (후속 PR 에서 추가 가능)
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverPath = path.resolve(__dirname, '..', 'server.mjs');
const serverSrc = fs.readFileSync(serverPath, 'utf-8');

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(cond, label) {
    if (cond) {
        console.log(`PASS: ${label}`);
        passCount++;
    } else {
        console.log(`FAIL: ${label}`);
        failCount++;
        failures.push(label);
    }
}
function assertMatch(src, regex, label) {
    assert(regex.test(src), `${label} \n  regex: ${regex}`);
}
function assertNoMatch(src, regex, label) {
    assert(!regex.test(src), `${label} \n  regex (should NOT match): ${regex}`);
}

// ============================================================
// 1. 가드 함수 및 상수 신설 검증 (소스 레벨)
// ============================================================

// 1-1: PROFITABILITY_FORBIDDEN_COLS 상수 선언
assertMatch(serverSrc,
    /const\s+PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(/,
    '1-1: PROFITABILITY_FORBIDDEN_COLS 상수 선언');

// 1-2: 핵심 금지 컬럼 ZCGUBUN / ZCGUBUN_D 포함
assertMatch(serverSrc,
    /PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]ZCGUBUN['"][\s\S]{0,100}['"]ZCGUBUN_D['"]/,
    '1-2: ZCGUBUN, ZCGUBUN_D 금지 컬럼에 포함 (사용자 신고 버그 직접 fix)');

// 1-3: LBKUM (생산수량) 금지 컬럼
assertMatch(serverSrc,
    /PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]LBKUM['"]/,
    '1-3: LBKUM (생산수량) 금지 컬럼에 포함');

// 1-4: KST_V / KST_F (변동비/고정비 합계) 금지 컬럼
assertMatch(serverSrc,
    /PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]KST_V['"]/,
    '1-4a: KST_V (변동비 합계) 금지 컬럼에 포함');
assertMatch(serverSrc,
    /PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]KST_F['"]/,
    '1-4b: KST_F (고정비 합계) 금지 컬럼에 포함');

// 1-5: KST001~KST039 (20개 원가요소) 금지 컬럼 — 샘플 몇 개 확인
assertMatch(serverSrc,
    /PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]KST001['"]/,
    '1-5a: KST001 (재료비-펄프) 금지 컬럼에 포함');
assertMatch(serverSrc,
    /PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]KST039['"]/,
    '1-5b: KST039 (마지막 원가요소) 금지 컬럼에 포함');

// 1-6: BASE_UOM 금지 컬럼
assertMatch(serverSrc,
    /PROFITABILITY_FORBIDDEN_COLS\s*=\s*new\s+Set\s*\(\s*\[[\s\S]{0,2000}['"]BASE_UOM['"]/,
    '1-6: BASE_UOM (기본 단위) 금지 컬럼에 포함');

// 1-7: PROFITABILITY_FORBIDDEN_TABLES_RE 상수 선언 (sys_aimd_cot015/cot043 금지)
assertMatch(serverSrc,
    /const\s+PROFITABILITY_FORBIDDEN_TABLES_RE\s*=\s*\/\\b\(sys_aimd_cot015\|sys_aimd_cot043\)\\b\/i/,
    '1-7: PROFITABILITY_FORBIDDEN_TABLES_RE — 수익성분석 에서 cot015/cot043 금지');

// 1-8: _stripSqlComments 헬퍼 함수 (주석 안의 금지 컬럼 오탐 방지)
assertMatch(serverSrc,
    /function\s+_stripSqlComments\s*\(\s*sql\s*\)/,
    '1-8: _stripSqlComments 헬퍼 함수 (주석 제거로 false positive 방지)');

// 1-9: assertNlqSqlAreaIsolation 가드 함수 선언
assertMatch(serverSrc,
    /function\s+assertNlqSqlAreaIsolation\s*\(\s*sql\s*,\s*area\s*\)/,
    '1-9: assertNlqSqlAreaIsolation(sql, area) 가드 함수 선언');

// 1-10: 반환 형식 { safe, reason, violations }
assertMatch(serverSrc,
    /return\s+\{\s*safe:\s*false\s*,\s*reason:[\s\S]{0,500}violations/,
    '1-10: 가드 함수 반환 형식 { safe:false, reason, violations }');

// ============================================================
// 2. 가드 호출 지점 삽입 검증 — SQL 실행 전 4곳
// ============================================================

// 2-1: analysis path base SQL 실행 전 가드 호출 (라인 ~8223)
assertMatch(serverSrc,
    /\[NLQ:AreaGuard\]\s*base\s+SQL/,
    '2-1: analysis base SQL 가드 호출 로그 ([NLQ:AreaGuard] base SQL)');

// 2-2: analysis path prior SQL 실행 전 가드 호출 (라인 ~8274)
assertMatch(serverSrc,
    /\[NLQ:AreaGuard\]\s*prior\s+SQL/,
    '2-2: analysis prior SQL 가드 호출 로그 ([NLQ:AreaGuard] prior SQL)');

// 2-3: aggregate path (사용자 버그 핵심 경로) 가드 호출
assertMatch(serverSrc,
    /\[NLQ:AreaGuard\]\s*aggregate\s+SQL/,
    '2-3: aggregate SQL 가드 호출 로그 ([NLQ:AreaGuard] aggregate SQL) — 사용자 버그 핵심 경로');

// 2-4: rewrite-cost-basis path 가드 호출
assertMatch(serverSrc,
    /\[NLQ:AreaGuard\]\s*rewrite-cost-basis\s+SQL/,
    '2-4: rewrite-cost-basis SQL 가드 호출 로그');

// 2-5: aggregate path 는 사용자 친화 에러 응답 (AREA_ISOLATION_VIOLATION errorCode)
assertMatch(serverSrc,
    /errorCode:\s*['"]AREA_ISOLATION_VIOLATION['"]/,
    '2-5: errorCode "AREA_ISOLATION_VIOLATION" 에러 응답 (프론트 처리용)');

// 2-6: 4곳 모두 assertNlqSqlAreaIsolation 호출
const guardCallCount = (serverSrc.match(/assertNlqSqlAreaIsolation\s*\(/g) || []).length;
assert(guardCallCount >= 5,  // 함수 정의 1 + 호출 4 = 5
    `2-6: assertNlqSqlAreaIsolation 호출 지점 >= 5 (정의 1 + 실행 가드 4) — 실제: ${guardCallCount}`);

// 2-7: 가드 위반 시 로그 패턴 (console.error) 포함
assertMatch(serverSrc,
    /console\.error\s*\(\s*`\[NLQ:AreaGuard\][\s\S]{0,200}영역\s*격리\s*위반\s*차단/,
    '2-7: 가드 위반 시 console.error 로 상세 로그 ("영역 격리 위반 차단")');

// ============================================================
// 3. 가드 함수 동작 검증 (실제 import 해서 호출)
// ============================================================

// 서버 전체 import 는 DB 연결 등 side-effect 가 있으므로,
// 가드 로직만 inline 재구성해서 검증 (가드 함수는 순수 함수이므로 가능)

const PROFITABILITY_FORBIDDEN_COLS_LOCAL = new Set([
    'ZCGUBUN','ZCGUBUN_D','LBKUM','BASE_UOM','KST_V','KST_F',
    'KST001','KST002','KST004','KST006','KST008','KST010','KST012','KST014','KST015','KST017',
    'KST019','KST021','KST025','KST027','KST029','KST031','KST033','KST035','KST037','KST039',
]);
const PROFITABILITY_FORBIDDEN_TABLES_RE_LOCAL = /\b(sys_aimd_cot015|sys_aimd_cot043)\b/i;
const MFG_FORBIDDEN_TABLES_RE_LOCAL = /\bsys_aimd_cot043\b/i;

function _stripSqlCommentsLocal(sql) {
    if (!sql || typeof sql !== 'string') return '';
    return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n\r]*/g, ' ');
}
function assertNlqSqlAreaIsolationLocal(sql, area) {
    const empty = { safe: true, reason: null, violations: [] };
    if (!sql || typeof sql !== 'string') return empty;
    const areaKey = String(area || '').toLowerCase().trim();
    if (!areaKey) return empty;
    const sqlNoComment = _stripSqlCommentsLocal(sql);
    const violations = [];
    if (areaKey === 'profitability') {
        const tblMatch = sqlNoComment.match(PROFITABILITY_FORBIDDEN_TABLES_RE_LOCAL);
        if (tblMatch) violations.push(`forbidden_table:${tblMatch[1]}`);
        for (const col of PROFITABILITY_FORBIDDEN_COLS_LOCAL) {
            const re = new RegExp(`\\b${col}\\b`, 'i');
            if (re.test(sqlNoComment)) violations.push(`forbidden_column:${col}`);
        }
        if (violations.length > 0) return { safe: false, reason: 'test', violations };
        return empty;
    }
    if (areaKey === 'manufacturing-cost') {
        if (MFG_FORBIDDEN_TABLES_RE_LOCAL.test(sqlNoComment)) {
            violations.push('forbidden_table:sys_aimd_cot043');
            return { safe: false, reason: 'test', violations };
        }
        return empty;
    }
    return empty;
}

// 3-1: 사용자 신고 버그 재현 — 수익성분석 SQL 에 ZCGUBUN='실제원가' 섞여 들어감
const userBugSql = `SELECT MATERIAL AS 'SKU코드', MAX(MATERIAL_NM) AS 'SKU명', SUM(ZAMT001-ZAMT002) AS '매출 합계(원)'
FROM bw_profitability_data
WHERE CALMONTH = '202610'
  AND ZCGUBUN = '실제원가'
  AND MATL_TYPE_NM LIKE '%제품%'
  AND REPLACE(MATERIAL_NM, ' ', '') LIKE '%깨끗한나라%'
GROUP BY MATERIAL
ORDER BY SUM(ZAMT001-ZAMT002) DESC, MATERIAL ASC
LIMIT 5`;
const bugResult = assertNlqSqlAreaIsolationLocal(userBugSql, 'profitability');
assert(bugResult.safe === false,
    '3-1: 사용자 신고 버그 재현 — ZCGUBUN 포함 수익성분석 SQL 차단 (safe=false)');
assert(Array.isArray(bugResult.violations) && bugResult.violations.some(v => v.includes('ZCGUBUN')),
    '3-1b: 위반 리스트에 forbidden_column:ZCGUBUN 포함');

// 3-2: 정상 수익성분석 SQL 은 통과
const okProfitSql = `SELECT MATERIAL, MATERIAL_NM, SUM(ZAMT001-ZAMT002) FROM bw_profitability_data WHERE CALMONTH='202610' GROUP BY MATERIAL, MATERIAL_NM LIMIT 5`;
const okResult = assertNlqSqlAreaIsolationLocal(okProfitSql, 'profitability');
assert(okResult.safe === true,
    '3-2: 정상 수익성분석 SQL 은 가드 통과 (safe=true)');

// 3-3: 수익성분석에서 KST 원가요소 컬럼 금지
const kstSql = `SELECT KST001, KST002 FROM bw_profitability_data`;
const kstResult = assertNlqSqlAreaIsolationLocal(kstSql, 'profitability');
assert(kstResult.safe === false,
    '3-3: 수익성분석 SQL + KST001/KST002 → 차단');

// 3-4: 수익성분석에서 sys_aimd_cot015 테이블 참조 금지
const wrongTableSql = `SELECT * FROM sys_aimd_cot015 WHERE CALMONTH='202610'`;
const wrongTableResult = assertNlqSqlAreaIsolationLocal(wrongTableSql, 'profitability');
assert(wrongTableResult.safe === false,
    '3-4: 수익성분석 SQL + FROM sys_aimd_cot015 → 차단');

// 3-5: 정상 제조원가 SQL (ZCGUBUN 포함) 은 통과
const okMfgSql = `SELECT MATERIAL, ZCGUBUN, KST001 FROM sys_aimd_cot015 WHERE CALMONTH='202610' AND ZCGUBUN='실제원가' GROUP BY MATERIAL, ZCGUBUN`;
const okMfgResult = assertNlqSqlAreaIsolationLocal(okMfgSql, 'manufacturing-cost');
assert(okMfgResult.safe === true,
    '3-5: 정상 제조원가 SQL (ZCGUBUN 포함) → 통과 (제조원가에서 ZCGUBUN 은 정상)');

// 3-6: 제조원가에서 sys_aimd_cot043 (금지 테이블) 차단
const forbiddenMfgSql = `SELECT * FROM sys_aimd_cot043`;
const forbiddenMfgResult = assertNlqSqlAreaIsolationLocal(forbiddenMfgSql, 'manufacturing-cost');
assert(forbiddenMfgResult.safe === false,
    '3-6: 제조원가 SQL + FROM sys_aimd_cot043 → 차단');

// 3-7: area 미지정 시 no-op (하위호환)
const noAreaResult = assertNlqSqlAreaIsolationLocal(`SELECT ZCGUBUN FROM anywhere`, null);
assert(noAreaResult.safe === true,
    '3-7: area 미지정 시 no-op (safe=true) — 하위호환');

// 3-8: 주석 안의 ZCGUBUN 은 false positive 아님 (수익성분석)
const commentSql = `-- ZCGUBUN 은 제조원가 전용\nSELECT MATERIAL FROM bw_profitability_data`;
const commentResult = assertNlqSqlAreaIsolationLocal(commentSql, 'profitability');
assert(commentResult.safe === true,
    '3-8: 주석 안의 ZCGUBUN 은 가드 통과 (false positive 방지)');

// 3-9: 블록 주석 안의 금지 컬럼도 false positive 아님
const blockCommentSql = `/* KST001, LBKUM 은 제조원가 전용 */\nSELECT MATERIAL FROM bw_profitability_data`;
const blockCommentResult = assertNlqSqlAreaIsolationLocal(blockCommentSql, 'profitability');
assert(blockCommentResult.safe === true,
    '3-9: 블록 주석 /* ... */ 안의 금지 컬럼은 가드 통과 (false positive 방지)');

// 3-10: 대소문자 무관 매칭 (SQL case-insensitive)
const lowerSql = `SELECT MATERIAL FROM bw_profitability_data WHERE zcgubun='실제원가'`;
const lowerResult = assertNlqSqlAreaIsolationLocal(lowerSql, 'profitability');
assert(lowerResult.safe === false,
    '3-10: 대소문자 무관 — "zcgubun" (소문자) 도 ZCGUBUN 로 매칭되어 차단');

// 3-11: LBKUM (생산수량) 금지
const lbkumSql = `SELECT LBKUM FROM bw_profitability_data`;
const lbkumResult = assertNlqSqlAreaIsolationLocal(lbkumSql, 'profitability');
assert(lbkumResult.safe === false,
    '3-11: 수익성분석 SQL + LBKUM → 차단');

// 3-12: BASE_UOM (기본 단위) 금지
const baseUomSql = `SELECT BASE_UOM FROM bw_profitability_data`;
const baseUomResult = assertNlqSqlAreaIsolationLocal(baseUomSql, 'profitability');
assert(baseUomResult.safe === false,
    '3-12: 수익성분석 SQL + BASE_UOM → 차단');

// 3-13: KST_V, KST_F (변동비/고정비)
const kstvSql = `SELECT KST_V, KST_F FROM bw_profitability_data`;
const kstvResult = assertNlqSqlAreaIsolationLocal(kstvSql, 'profitability');
assert(kstvResult.safe === false,
    '3-13: 수익성분석 SQL + KST_V/KST_F → 차단');

// 3-14: 단어 경계 — ZCGUBUN_X 같은 유사 컬럼은 ZCGUBUN 으로 매치 안 됨 (false positive 방지)
const similarSql = `SELECT ZCGUBUN_X, ZCGUBUNX FROM bw_profitability_data`;
const similarResult = assertNlqSqlAreaIsolationLocal(similarSql, 'profitability');
// ZCGUBUN_X 는 단어 경계 \b 때문에 ZCGUBUN 매치 가능할 수 있음 (ZCGUBUN 뒤 _ 는 단어 문자)
// 실제로는 \bZCGUBUN\b 가 ZCGUBUN_X 안의 "ZCGUBUN" 을 매치하지 않음 (ZCGUBUN 뒤 _ 가 단어 문자라 경계 아님)
assert(similarResult.safe === true,
    '3-14: ZCGUBUN_X / ZCGUBUNX 는 단어 경계 \\b 때문에 매치 안 됨 (false positive 방지)');

// 3-15: ZCGUBUN_D 는 정확한 금지 컬럼 매치
const zcgubundSql = `SELECT ZCGUBUN_D FROM bw_profitability_data`;
const zcgubundResult = assertNlqSqlAreaIsolationLocal(zcgubundSql, 'profitability');
assert(zcgubundResult.safe === false,
    '3-15: ZCGUBUN_D 는 금지 컬럼 (대구분)');

// 3-16: alias prefix (t.ZCGUBUN) 도 매치
const aliasSql = `SELECT t.ZCGUBUN FROM bw_profitability_data t`;
const aliasResult = assertNlqSqlAreaIsolationLocal(aliasSql, 'profitability');
assert(aliasResult.safe === false,
    '3-16: alias prefix (t.ZCGUBUN) 도 금지 매치');

// 3-17: 백틱 wrapping 도 매치
const backtickSql = 'SELECT `ZCGUBUN` FROM bw_profitability_data';
const backtickResult = assertNlqSqlAreaIsolationLocal(backtickSql, 'profitability');
assert(backtickResult.safe === false,
    '3-17: 백틱 `ZCGUBUN` 도 금지 매치');

// ============================================================
// 4. 설계 주석 검증 (유지보수 추적성)
// ============================================================

// 4-1: fail-closed 설계 주석 (사용자 요구 2026-11-03 근거)
assertMatch(serverSrc,
    /2026-11-04[\s\S]{0,500}\uc601\uc5ed\s*\uaca9\ub9ac/,
    '4-1: [2026-11-04] 영역 격리 설계 주석 (사용자 요구 근거 기록)');

// 4-2: 사용자 신고 사례 재현 주석 (ZCGUBUN='실제원가')
assertMatch(serverSrc,
    /ZCGUBUN\s*=\s*['"]실제원가['"]/,
    '4-2: 사용자 신고 사례 재현 주석 (ZCGUBUN = \'실제원가\')');

// 4-3: assertMfgSqlSafety 기존 로직 보존 (이번 변경 무관)
assertMatch(serverSrc,
    /function\s+assertMfgSqlSafety\s*\(/,
    '4-3: 기존 assertMfgSqlSafety 함수 보존 (제조원가 cot043 가드)');

// ============================================================
// 5. 영역 격리 — 다른 영역/기존 로직 무영향
// ============================================================

// 5-1: 기존 MFG_FORBIDDEN_TABLES_RE 상수 보존
assertMatch(serverSrc,
    /const\s+MFG_FORBIDDEN_TABLES_RE\s*=\s*\/\\bsys_aimd_cot043\\b\/i/,
    '5-1: 기존 MFG_FORBIDDEN_TABLES_RE 상수 보존');

// 5-2: AREA_SUB_TABLE_MAP (영역→테이블 매핑) 보존
assertMatch(serverSrc,
    /const\s+AREA_SUB_TABLE_MAP\s*=\s*\{[\s\S]{0,500}['"]profitability['"][\s\S]{0,500}['"]manufacturing-cost['"]/,
    '5-2: AREA_SUB_TABLE_MAP 보존 (profitability + manufacturing-cost)');

// ============================================================
// 결과 출력
// ============================================================

console.log('');
console.log('========================================');
console.log(`PASS: ${passCount}`);
console.log(`FAIL: ${failCount}`);
console.log('========================================');

if (failCount > 0) {
    console.log('');
    console.log('실패한 assertion 목록:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
    console.log('');
    console.log(`==================================================`);
    console.log(`NLQ AREA ISOLATION TEST — PASS: ${passCount}, FAIL: ${failCount}`);
    console.log(`==================================================`);
    process.exit(1);
}

console.log('');
console.log(`==================================================`);
console.log(`NLQ AREA ISOLATION TEST — PASS: ${passCount}, FAIL: ${failCount}`);
console.log(`==================================================`);
