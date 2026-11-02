// ============================================================
// test_mfg_auto_order_by.mjs
// ------------------------------------------------------------
// 사용자 요구 (PR #552, 2026-11-02):
//   비주얼쿼리빌더에서 피벗 SQL 생성 시 제조원가 영역에서만,
//   SELECT 조회필드에 PLANT + ZCGUBUN_D + ZCGUBUN 3개가 모두 포함된 경우,
//   아래 ORDER BY 를 자동 추가:
//
//     ORDER BY
//       PLANT,
//       CASE
//         WHEN ZCGUBUN_D = '입고-생산' THEN 1
//         WHEN ZCGUBUN_D = '소비-소비' THEN 2
//         ELSE 99
//       END,
//       CASE
//         WHEN ZCGUBUN_D = '입고-생산' AND ZCGUBUN = '실제원가' THEN 1
//         WHEN ZCGUBUN_D = '입고-생산' AND ZCGUBUN = '표준원가' THEN 2
//         WHEN ZCGUBUN_D = '소비-소비' AND ZCGUBUN = '매출원가' THEN 1
//         WHEN ZCGUBUN_D = '소비-소비' AND ZCGUBUN = '표준원가' THEN 2
//         ELSE 99
//       END
//
//   최종 결과 순서 (플랜트별):
//     1. 입고-생산 / 실제원가
//     2. 입고-생산 / 표준원가
//     3. 소비-소비 / 매출원가
//     4. 소비-소비 / 표준원가
//
//   사용자 승인 설계 조합:
//     Q1: 서버 쪽 SQL 생성 (/api/builder/query 라우트)
//     Q2(a): 사용자가 order_by 지정하면 자동 skip (사용자 정렬 우선)
//     Q4(A, 재확인): 엄격 매칭 — PLANT + ZCGUBUN_D + ZCGUBUN 3개 모두
//     Q5(a): SQL 주석 없이 조용히 추가
//     Q6: 설정 테이블 패턴 — _MFG_AUTO_ORDER_RULES 상수 1곳
//
// 설계 (설정 테이블 패턴, PR #542/#544/#546/#549/#550/#551 과 통일):
//   - const _MFG_AUTO_ORDER_RULES = { required_columns, order_by_sql }
//   - const _mfgAutoOrderBySql = (userOrderBy, fieldsArr) => string | null
//   - 영역 가드: isMfgArea === true 전용
//   - 사용자 정렬 우선: userOrderBy 가 있으면 null 반환 (skip)
//   - 엄격 매칭: required_columns 3개 모두 SELECT 에 있어야 적용
//
// 영역 격리:
//   - 제조원가 (manufacturing-cost) 영역만 적용
//   - 수익성분석 (profitability) 영역: isMfgArea=false → 완전 무영향
//   - 사용자 정렬 지정 시: 100% 사용자 정렬 우선 (자동 skip)
// ============================================================

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, '../server.mjs');
const serverSrc = readFileSync(SERVER_PATH, 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, msg) {
    if (cond) { PASS++; }
    else { FAIL++; failures.push(msg); console.log('FAIL:', msg); }
}
function assertMatch(src, re, msg) {
    const ok = re.test(src);
    if (ok) { PASS++; }
    else { FAIL++; failures.push(`${msg}\n  regex: ${re}`); console.log('FAIL:', msg, '\n  regex:', re); }
}
function assertNoMatch(src, re, msg) {
    const ok = !re.test(src);
    if (ok) { PASS++; }
    else { FAIL++; failures.push(`${msg}\n  regex: ${re}`); console.log('FAIL:', msg, '\n  regex:', re); }
}

// ============================================================
// 1. _MFG_AUTO_ORDER_RULES 상수 신설 (설정 테이블 패턴)
// ============================================================

// 1-1: 상수 선언 존재
assertMatch(serverSrc,
    /const\s+_MFG_AUTO_ORDER_RULES\s*=\s*\{/,
    '1-1: const _MFG_AUTO_ORDER_RULES = { ... } 상수 선언됨');

// 1-2: required_columns 가 PLANT + ZCGUBUN_D + ZCGUBUN 3개 (엄격 매칭, Q4(A))
assertMatch(serverSrc,
    /_MFG_AUTO_ORDER_RULES[\s\S]{0,500}required_columns\s*:\s*\[\s*['"]PLANT['"]\s*,\s*['"]ZCGUBUN_D['"]\s*,\s*['"]ZCGUBUN['"]\s*\]/,
    '1-2: required_columns = [PLANT, ZCGUBUN_D, ZCGUBUN] 엄격 매칭 (Q4(A) 승인)');

// 1-3: order_by_sql 존재
assertMatch(serverSrc,
    /_MFG_AUTO_ORDER_RULES[\s\S]{0,2000}order_by_sql/,
    '1-3: _MFG_AUTO_ORDER_RULES.order_by_sql 속성 존재');

// 1-4: order_by_sql 안에 PLANT 가 맨 앞 (1차 정렬 키)
const rulesBlockMatch = serverSrc.match(/_MFG_AUTO_ORDER_RULES\s*=\s*\{[\s\S]*?\n\s*\}/);
assert(!!rulesBlockMatch, '1-4a: _MFG_AUTO_ORDER_RULES 블록 추출됨');
const rulesSrc = rulesBlockMatch ? rulesBlockMatch[0] : '';
assertMatch(rulesSrc,
    /order_by_sql[\s\S]{0,100}['"`]\s*PLANT\s*,/,
    '1-4b: order_by_sql 가 "PLANT, ..." 로 시작 (1차 정렬 키)');

// 1-5: 1차 CASE WHEN — ZCGUBUN_D 분기 (입고-생산 THEN 1, 소비-소비 THEN 2)
assertMatch(rulesSrc,
    /CASE[\s\S]{0,500}WHEN\s+ZCGUBUN_D\s*=\s*['"]\uc785\uace0-\uc0dd\uc0b0['"][\s\S]{0,100}THEN\s*1/,
    "1-5a: 1차 CASE WHEN ZCGUBUN_D = '입고-생산' THEN 1");
assertMatch(rulesSrc,
    /CASE[\s\S]{0,500}WHEN\s+ZCGUBUN_D\s*=\s*['"]\uc18c\ube44-\uc18c\ube44['"][\s\S]{0,100}THEN\s*2/,
    "1-5b: 1차 CASE WHEN ZCGUBUN_D = '소비-소비' THEN 2");
assertMatch(rulesSrc,
    /CASE[\s\S]{0,1500}ELSE\s*99/,
    '1-5c: CASE WHEN ... ELSE 99 (fallback 지정)');

// 1-6: 2차 CASE WHEN — 입고-생산 AND 실제원가 THEN 1, 입고-생산 AND 표준원가 THEN 2
assertMatch(rulesSrc,
    /WHEN\s+ZCGUBUN_D\s*=\s*['"]\uc785\uace0-\uc0dd\uc0b0['"]\s+AND\s+ZCGUBUN\s*=\s*['"]\uc2e4\uc81c\uc6d0\uac00['"][\s\S]{0,50}THEN\s*1/,
    "1-6a: 2차 WHEN ZCGUBUN_D = '입고-생산' AND ZCGUBUN = '실제원가' THEN 1");
assertMatch(rulesSrc,
    /WHEN\s+ZCGUBUN_D\s*=\s*['"]\uc785\uace0-\uc0dd\uc0b0['"]\s+AND\s+ZCGUBUN\s*=\s*['"]\ud45c\uc900\uc6d0\uac00['"][\s\S]{0,50}THEN\s*2/,
    "1-6b: 2차 WHEN ZCGUBUN_D = '입고-생산' AND ZCGUBUN = '표준원가' THEN 2");

// 1-7: 2차 CASE WHEN — 소비-소비 AND 매출원가 THEN 1, 소비-소비 AND 표준원가 THEN 2
assertMatch(rulesSrc,
    /WHEN\s+ZCGUBUN_D\s*=\s*['"]\uc18c\ube44-\uc18c\ube44['"]\s+AND\s+ZCGUBUN\s*=\s*['"]\ub9e4\ucd9c\uc6d0\uac00['"][\s\S]{0,50}THEN\s*1/,
    "1-7a: 2차 WHEN ZCGUBUN_D = '소비-소비' AND ZCGUBUN = '매출원가' THEN 1");
assertMatch(rulesSrc,
    /WHEN\s+ZCGUBUN_D\s*=\s*['"]\uc18c\ube44-\uc18c\ube44['"]\s+AND\s+ZCGUBUN\s*=\s*['"]\ud45c\uc900\uc6d0\uac00['"][\s\S]{0,50}THEN\s*2/,
    "1-7b: 2차 WHEN ZCGUBUN_D = '소비-소비' AND ZCGUBUN = '표준원가' THEN 2");

// 1-8: 상수 선언 위쪽 주석에 설계 메모 (PR #552 / 사용자 승인 / 영역 가드)
const _declIdx = serverSrc.indexOf('const _MFG_AUTO_ORDER_RULES');
const _declPrelude = _declIdx >= 0 ? serverSrc.substring(Math.max(0, _declIdx - 3000), _declIdx) : '';
assertMatch(_declPrelude,
    /PR #552|\uc124\uc815 \ud14c\uc774\ube14|manufacturing-cost|\uc601\uc5ed \uac00\ub4dc/,
    '1-8: _MFG_AUTO_ORDER_RULES 선언 위쪽 주석에 설계 메모 (PR #552 / 설정 테이블 / 영역 가드)');

// ============================================================
// 2. _mfgAutoOrderBySql 헬퍼 함수 신설
// ============================================================

// 2-1: 함수 선언 존재
assertMatch(serverSrc,
    /const\s+_mfgAutoOrderBySql\s*=\s*\(/,
    '2-1: const _mfgAutoOrderBySql = (userOrderBy, fieldsArr) => ... 헬퍼 함수 선언됨');

// 함수 블록 추출
const fnMatch = serverSrc.match(/const\s+_mfgAutoOrderBySql\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n\s*\};/);
assert(!!fnMatch, '2-2: _mfgAutoOrderBySql 함수 블록 추출됨');
const fnSrc = fnMatch ? fnMatch[0] : '';

// 2-3: 영역 가드 — isMfgArea 체크
assertMatch(fnSrc,
    /if\s*\(\s*!\s*isMfgArea\s*\)\s*return\s+null/,
    '2-3: 영역 가드 "if (!isMfgArea) return null" — 수익성분석 영역 완전 무영향');

// 2-4: 사용자 정렬 우선 — userOrderBy 가 비어있지 않으면 null 반환 (Q2(a))
assertMatch(fnSrc,
    /if\s*\(\s*userOrderStr\s*\)\s*return\s+null/,
    '2-4: 사용자 정렬 우선 "if (userOrderStr) return null" (Q2(a) 승인)');

// 2-5: 엄격 매칭 — required_columns 3개 모두 있어야 함 (Q4(A))
assertMatch(fnSrc,
    /_MFG_AUTO_ORDER_RULES\.required_columns\.every/,
    '2-5: required_columns.every() 엄격 매칭 (Q4(A) 승인 — 3개 모두 있어야)');

// 2-6: 반환값 — _MFG_AUTO_ORDER_RULES.order_by_sql
assertMatch(fnSrc,
    /return\s+_MFG_AUTO_ORDER_RULES\.order_by_sql/,
    '2-6: 조건 충족 시 _MFG_AUTO_ORDER_RULES.order_by_sql 반환 (설정 테이블 1곳 참조)');

// 2-7: fields 배열 안전 체크 (fields 가 undefined/null 이거나 빈 배열이면 null)
assertMatch(fnSrc,
    /!Array\.isArray\s*\(\s*fieldsArr\s*\)\s*\|\|\s*fieldsArr\.length\s*===\s*0/,
    '2-7: fieldsArr 안전 체크 (undefined/null/빈 배열 → null)');

// 2-8: SELECT 컬럼명을 toUpperCase 로 정규화 (대소문자 혼용 방어)
assertMatch(fnSrc,
    /toUpperCase/,
    '2-8: SELECT 컬럼명 toUpperCase 정규화 (대소문자 혼용 방어)');

// ============================================================
// 3. 3개 ORDER BY 조립 지점에 자동 ORDER BY 로직 삽입 확인
// ============================================================

// 3-1: compare 모드 (17894번 지점) — _mfgAutoOrderBySql 호출
assertMatch(serverSrc,
    /path:\s*['"]compare_mode['"]\s*,\s*rule:\s*['"]PR#552['"]/,
    "3-1: compare 모드 분기에 _mfgAutoOrderBySql 호출 (log.stage path='compare_mode')");

// 3-2: 메인 경로 (18047번 지점) — _mfgAutoOrderBySql 호출
assertMatch(serverSrc,
    /path:\s*['"]main_route['"]\s*,\s*rule:\s*['"]PR#552['"]/,
    "3-2: 메인 경로 분기에 _mfgAutoOrderBySql 호출 (log.stage path='main_route')");

// 3-3: 월별 비교 분기 (18289번 지점) — _mfgAutoOrderBySql 호출
assertMatch(serverSrc,
    /path:\s*['"]month_compare_branch['"]\s*,\s*rule:\s*['"]PR#552['"]/,
    "3-3: 월별 비교 분기에 _mfgAutoOrderBySql 호출 (log.stage path='month_compare_branch')");

// 3-4: 3개 지점 모두 _mfgAutoOrderBySql 호출 횟수 확인 (헬퍼 선언 1 + 호출 3 = 4회)
const helperRefs = [...serverSrc.matchAll(/_mfgAutoOrderBySql/g)];
assert(helperRefs.length === 4,
    `3-4: _mfgAutoOrderBySql 참조 총 4회 (선언 1 + 호출 3) — 실제: ${helperRefs.length}`);

// 3-5: 3곳 모두 "if (order_by)" 뒤의 else 분기에서 호출 (사용자 정렬 우선, Q2(a))
//      → 호출 지점(_mfgAutoOrderBySql) 바로 앞 넉넉한 window 에서 아래 패턴 확인:
//        (1) "} else {" 가 반드시 등장 (호출 직전에)
//        (2) 그 else 가 속한 if 문이 order_by 를 검사
//      월별 비교 분기(18394) 는 설명 주석이 길어 window 를 3000자로 넉넉하게 설정.
helperRefs.forEach((m, i) => {
    if (i === 0) return; // 선언 위치는 skip
    const idx = m.index;
    const prelude = serverSrc.substring(Math.max(0, idx - 3000), idx);
    // (1) 호출 직전에 "} else {" 가 등장해야 함 (호출 지점에서 가장 가까운 쪽)
    //     → 즉 호출 ~ 앞쪽으로 올라가면서 처음 만나는 "{" 기호가 "else {" 이어야 함
    const hasElseBeforeCall = /}\s*else\s*\{[^{}]*$/.test(prelude);
    // (2) prelude 전체에서 if (...order_by...) 패턴 등장
    const hasOrderByIf = /if\s*\([^)]*order_by[^)]*\)/.test(prelude);
    assert(hasElseBeforeCall && hasOrderByIf,
        `3-5-${i}: 호출 ${i} 위치 앞 3000자에 "if (...order_by...) { ... } else { ... [호출]" 구조 존재 (사용자 order_by 미지정 분기에서만 자동 적용) — elseBeforeCall=${hasElseBeforeCall}, orderByIf=${hasOrderByIf}`);
});

// ============================================================
// 4. 영역 격리 — 수익성분석 완전 무영향 재검증
// ============================================================

// 4-1: _MFG_AUTO_ORDER_RULES 와 _mfgAutoOrderBySql 는 /api/builder/query 라우트 블록 안에만 선언
//      → 글로벌 상수가 아니므로 다른 라우트/함수에서 참조 불가 (범위 격리)
const routeStartIdx = serverSrc.indexOf("app.post('/api/builder/query'");
assert(routeStartIdx >= 0, '4-1a: /api/builder/query 라우트 시작 위치 찾음');
const declIdx = serverSrc.indexOf('const _MFG_AUTO_ORDER_RULES');
assert(declIdx > routeStartIdx,
    '4-1b: _MFG_AUTO_ORDER_RULES 선언이 /api/builder/query 라우트 블록 안에 있음 (글로벌 상수 아님)');

const helperDeclIdx = serverSrc.indexOf('const _mfgAutoOrderBySql');
assert(helperDeclIdx > routeStartIdx,
    '4-1c: _mfgAutoOrderBySql 선언이 /api/builder/query 라우트 블록 안에 있음 (글로벌 함수 아님)');

// 4-2: 영역 가드가 isMfgArea 를 참조 (라우트 상단에서 선언된 플래그)
assertMatch(fnSrc,
    /isMfgArea/,
    '4-2: _mfgAutoOrderBySql 가 isMfgArea 참조 (라우트 상단 플래그 재사용)');

// 4-3: isMfgArea 선언 위치가 _MFG_AUTO_ORDER_RULES 선언보다 앞 (closure scope 안전성)
const mfgAreaDeclIdx = serverSrc.indexOf('const isMfgArea');
assert(mfgAreaDeclIdx > 0 && mfgAreaDeclIdx < declIdx,
    `4-3: isMfgArea 선언(${mfgAreaDeclIdx}) 이 _MFG_AUTO_ORDER_RULES 선언(${declIdx}) 보다 앞 — closure scope 참조 안전`);

// ============================================================
// 5. SQL 주석 없이 조용히 추가 (Q5(a) 승인) — 생성된 SQL 에 하드코딩 주석 없음
// ============================================================

// 5-1: order_by_sql 안에 "-- 자동 정렬" 등의 SQL 주석 하드코딩이 없음 (Q5(a) 승인)
assertNoMatch(rulesSrc,
    /--\s*(\uc790\ub3d9|\uc815\ub82c|auto|AUTO)/,
    '5-1: order_by_sql 안에 "-- 자동 정렬" 등의 SQL 주석 하드코딩 없음 (Q5(a) 조용히 추가)');

// 5-2: SQL 주석을 ORDER BY 앞에 삽입하지 않음 (3곳 모두 "ORDER BY" 로만 시작)
//      → log.stage 는 서버 로그이지 SQL 문자열에 들어가는 게 아님
const orderByInsertRefs = [...serverSrc.matchAll(/sql\s*\+?=\s*`?\s*(?:\$\{[^}]+\}\s*)?ORDER BY\s*\$\{_autoOrder/g)];
// 삽입 패턴 확인은 느슨하게 — 3곳 모두 "ORDER BY ${_autoOrder..." 패턴 존재
const orderByAutoInserts = [...serverSrc.matchAll(/ORDER BY\s*\$\{_autoOrder/g)];
assert(orderByAutoInserts.length >= 2,
    `5-2: "ORDER BY \${_autoOrder..." SQL 삽입 패턴 2회 이상 존재 (compare + main, month_compare 는 변수에 할당) — 실제: ${orderByAutoInserts.length}`);

// ============================================================
// 결과 출력
// ============================================================
console.log('');
console.log('==================================================');
console.log(`MFG AUTO ORDER BY TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
}
process.exit(0);
