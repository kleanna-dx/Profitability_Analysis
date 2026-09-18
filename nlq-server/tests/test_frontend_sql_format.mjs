/**
 * 프론트엔드 SQL 표시 포매터/하이라이터 검증
 * ===================================================================
 * 목적:
 *   [자연어질의 > 제조원가] SQL 표시 가독성 개선
 *   실행 SQL은 그대로 두고, 화면 표시 SQL만 formatter 를 통해 가독성 개선.
 *
 * 검증 대상 함수 (public/index.html):
 *   - formatSqlText(rawSql)         : SQL 텍스트 정형화
 *   - splitByCommaOutsideParens(str): 괄호 밖 콤마 분리
 *   - highlightSql(sql)              : 구문 강조 (HTML span 삽입)
 *   - formatAndHighlightSql(rawSql)  : 위 둘 조합
 *
 * 표시 규칙:
 *   1. SELECT 컬럼은 1개당 1줄 (4-space 들여쓰기)
 *   2. FROM / WHERE / GROUP BY / ORDER BY / HAVING / LIMIT / JOIN 등 새 줄
 *   3. WHERE 의 AND / OR 조건도 한 줄씩 분리
 *   4. GROUP BY / ORDER BY 컬럼 여러 개면 한 줄씩 분리
 *   5. CASE WHEN / ELSE / END 들여쓰기
 *   6. HTML span 태그가 텍스트로 노출되지 않음 (nested span 안전)
 *   7. 실행 SQL 의 의미/조건 변경 없음 (문자열/식별자 원문 그대로 보존)
 * ===================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '..', 'public', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// index.html 에서 함수 코드 추출 (중괄호 balance 로)
function grabFn(name) {
    const m = html.match(new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{'));
    if (!m) throw new Error(name + ' not found in index.html');
    const start = m.index;
    let i = start;
    while (html[i] !== '{') i++;
    let depth = 1; i++;
    while (i < html.length && depth > 0) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}') depth--;
        i++;
    }
    return html.substring(start, i);
}

// index.html 의 esc 는 브라우저 DOM API 를 사용하므로 (document.createElement)
// Node.js 테스트에서는 브라우저 textContent → innerHTML 과 동일한 동작을 하는 스텁으로 대체.
// 이 스텁은 < > & 만 escape 하고 ' 와 " 는 그대로 두어야 함 (실제 브라우저 동작과 동일).
const escStub = `function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}`;

const code =
    escStub + '\n\n' +
    grabFn('splitByCommaOutsideParens') + '\n\n' +
    grabFn('formatSqlText') + '\n\n' +
    grabFn('highlightSql') + '\n\n' +
    grabFn('formatAndHighlightSql');

// eval 로 함수 정의 (Node.js 최상위 eval 은 별도 스코프)
const wrapped = new Function(code + '\nreturn { esc, splitByCommaOutsideParens, formatSqlText, highlightSql, formatAndHighlightSql };');
const { esc, splitByCommaOutsideParens, formatSqlText, highlightSql, formatAndHighlightSql } = wrapped();

// ---- 테스트 프레임워크 ----
let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, name) {
    if (cond) { PASS++; }
    else { FAIL++; failures.push(name); console.error('FAIL:', name); }
}
function assertEqual(actual, expected, name) {
    const ok = actual === expected;
    if (!ok) {
        FAIL++;
        failures.push(name);
        console.error('FAIL:', name);
        console.error('  expected:', JSON.stringify(expected));
        console.error('  actual:  ', JSON.stringify(actual));
    } else {
        PASS++;
    }
}
function assertMatch(actual, re, name) {
    const ok = re.test(actual);
    if (!ok) {
        FAIL++;
        failures.push(name);
        console.error('FAIL:', name);
        console.error('  regex:  ', re);
        console.error('  actual: ', actual);
    } else {
        PASS++;
    }
}
function assertNotMatch(actual, re, name) {
    const ok = !re.test(actual);
    if (!ok) {
        FAIL++;
        failures.push(name);
        console.error('FAIL:', name);
        console.error('  regex(-):', re);
        console.error('  actual: ', actual);
    } else {
        PASS++;
    }
}

// ===================================================================
// A. 사용자 스크린샷 재현 SQL (한 줄)
// ===================================================================
const userSqlOneLine = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', PLANT AS '플랜트', MAX(PLANT_NM) AS '플랜트명', ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) AS '개당 단가(원)', SUM(TOTAL) AS '원가 총액(원)', SUM(LBKUM) AS '생산수량', MAX(BASE_UOM) AS '단위', SUM(KST001) AS '재료비-펄프 합계(원)', SUM(KST002) AS '재료비-고지 합계(원)', SUM(KST004) AS '재료비-패드 합계(원)' FROM sys_aimd_cot015 WHERE CALMONTH = '202608' AND ZCGUBUN = '실제원가' GROUP BY MATERIAL, PLANT ORDER BY SUM(TOTAL) DESC`;

const fmtA = formatSqlText(userSqlOneLine);
const linesA = fmtA.split('\n');

// A-1. SELECT 만 첫 줄
assertEqual(linesA[0].trim(), 'SELECT', 'A-1: SELECT 만 첫 줄');

// A-2. SELECT 다음부터 컬럼들이 각각 4-space 들여쓰기 + 1개당 1줄
assertMatch(linesA[1], /^    MATERIAL AS '자재코드',$/, 'A-2: 1번 컬럼 (MATERIAL)');
assertMatch(linesA[2], /^    MAX\(MATERIAL_NM\) AS '자재명',$/, 'A-3: 2번 컬럼 (MAX(MATERIAL_NM))');
assertMatch(linesA[3], /^    PLANT AS '플랜트',$/, 'A-4: 3번 컬럼 (PLANT)');
assertMatch(linesA[4], /^    MAX\(PLANT_NM\) AS '플랜트명',$/, 'A-5: 4번 컬럼');
assertMatch(linesA[5], /^    ROUND\(SUM\(TOTAL\) \/ NULLIF\(SUM\(LBKUM\), 0\), 0\) AS '개당 단가\(원\)',$/, 'A-6: ROUND 계산식 (괄호 안 콤마 보존)');
assertMatch(linesA[6], /^    SUM\(TOTAL\) AS '원가 총액\(원\)',$/, 'A-7: SUM 컬럼');

// A-3. 마지막 SELECT 컬럼은 콤마 없음
const lastSelectCol = linesA.find(l => l.includes('재료비-패드'));
assertMatch(lastSelectCol, /재료비-패드 합계\(원\)'$/, 'A-8: 마지막 SELECT 컬럼 뒤 콤마 없음');

// A-4. FROM 은 새 줄, 좌측 정렬 (들여쓰기 없음)
assertMatch(fmtA, /\nFROM sys_aimd_cot015/, 'A-9: FROM 새 줄 + 들여쓰기 없음');

// A-5. WHERE 새 줄, 좌측 정렬
assertMatch(fmtA, /\nWHERE CALMONTH = '202608'/, 'A-10: WHERE 새 줄');

// A-6. AND 새 줄 + 들여쓰기
assertMatch(fmtA, /\n    AND ZCGUBUN = '실제원가'/, 'A-11: AND 별도 줄 + 들여쓰기');

// A-7. GROUP BY 새 줄, 컬럼 2개이므로 각 컬럼 1줄
assertMatch(fmtA, /\nGROUP BY\n    MATERIAL,\n    PLANT\b/, 'A-12: GROUP BY 컬럼별 분리');

// A-8. ORDER BY 새 줄
assertMatch(fmtA, /\nORDER BY SUM\(TOTAL\) DESC/, 'A-13: ORDER BY 새 줄');

// A-9. 세미콜론 제거
assertNotMatch(fmtA, /;/, 'A-14: 세미콜론 없음');

// ===================================================================
// B. 이미 여러 줄로 개행된 SQL 도 동일하게 정형화
// ===================================================================
const userSqlMultiLine = `SELECT MATERIAL AS '자재코드',
       MAX(MATERIAL_NM) AS '자재명',
       PLANT AS '플랜트'
FROM sys_aimd_cot015
WHERE CALMONTH = '202608'
  AND ZCGUBUN = '실제원가'
GROUP BY MATERIAL, PLANT`;

const fmtB = formatSqlText(userSqlMultiLine);
assertMatch(fmtB, /^SELECT\n    MATERIAL AS '자재코드',\n    MAX\(MATERIAL_NM\) AS '자재명',\n    PLANT AS '플랜트'\n/, 'B-1: 이미 개행된 SELECT 도 정형화');
assertMatch(fmtB, /\nFROM sys_aimd_cot015\n/, 'B-2: 이미 개행된 FROM 유지');
assertMatch(fmtB, /\nWHERE CALMONTH = '202608'\n    AND ZCGUBUN = '실제원가'/, 'B-3: WHERE + AND 정형화');
assertMatch(fmtB, /\nGROUP BY\n    MATERIAL,\n    PLANT/, 'B-4: GROUP BY 컬럼별 분리');

// ===================================================================
// C. 사용자가 원하는 예시와 정확히 일치하는지 (규칙 1~5 종합)
// ===================================================================
const expectedShape = `SELECT
    MATERIAL AS '자재코드',
    MAX(MATERIAL_NM) AS '자재명',
    PLANT AS '플랜트',
    MAX(PLANT_NM) AS '플랜트명',
    ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) AS '개당 단가(원)',
    SUM(TOTAL) AS '원가 총액(원)',
    SUM(LBKUM) AS '생산수량',
    MAX(BASE_UOM) AS '단위',
    SUM(KST001) AS '재료비-펄프 합계(원)',
    SUM(KST002) AS '재료비-고지 합계(원)'
FROM sys_aimd_cot015
WHERE CALMONTH = '202608'
    AND ZCGUBUN = '실제원가'
GROUP BY
    MATERIAL,
    PLANT
ORDER BY SUM(TOTAL) DESC`;

const testSqlC = `SELECT MATERIAL AS '자재코드', MAX(MATERIAL_NM) AS '자재명', PLANT AS '플랜트', MAX(PLANT_NM) AS '플랜트명', ROUND(SUM(TOTAL) / NULLIF(SUM(LBKUM), 0), 0) AS '개당 단가(원)', SUM(TOTAL) AS '원가 총액(원)', SUM(LBKUM) AS '생산수량', MAX(BASE_UOM) AS '단위', SUM(KST001) AS '재료비-펄프 합계(원)', SUM(KST002) AS '재료비-고지 합계(원)' FROM sys_aimd_cot015 WHERE CALMONTH = '202608' AND ZCGUBUN = '실제원가' GROUP BY MATERIAL, PLANT ORDER BY SUM(TOTAL) DESC`;

assertEqual(formatSqlText(testSqlC), expectedShape, 'C-1: 사용자 예시와 완전 일치');

// ===================================================================
// D. splitByCommaOutsideParens : 괄호 안 콤마 분리 안 됨
// ===================================================================
assertEqual(splitByCommaOutsideParens("A, B, C").length, 3, 'D-1: 단순 콤마 3분리');
assertEqual(splitByCommaOutsideParens("A, FUNC(B, C), D").length, 3, 'D-2: 괄호 안 콤마 무시');
assertEqual(splitByCommaOutsideParens("ROUND(SUM(X) / NULLIF(SUM(Y), 0), 0) AS z").length, 1, 'D-3: nested 괄호 콤마 완전 무시');
assertEqual(splitByCommaOutsideParens("A, B").map(s=>s.trim()).join('|'), 'A|B', 'D-4: 결과 값 확인');

// ===================================================================
// E. highlightSql : HTML span 이 안전하게 생성됨 (nested 깨짐 없음)
// ===================================================================
const h = highlightSql(fmtA);

// E-1. SELECT / FROM / WHERE 등이 <span class="kw"> 로 감싸짐
assertMatch(h, /<span class="kw">SELECT<\/span>/, 'E-1: SELECT keyword span');
assertMatch(h, /<span class="kw">FROM<\/span>/, 'E-2: FROM keyword span');
assertMatch(h, /<span class="kw">WHERE<\/span>/, 'E-3: WHERE keyword span');
assertMatch(h, /<span class="kw">GROUP BY<\/span>/, 'E-4: GROUP BY keyword span');
assertMatch(h, /<span class="kw">ORDER BY<\/span>/, 'E-5: ORDER BY keyword span');
assertMatch(h, /<span class="kw">AND<\/span>/, 'E-6: AND keyword span');
assertMatch(h, /<span class="kw">AS<\/span>/, 'E-7: AS keyword span');

// E-2. 함수명 하이라이트
assertMatch(h, /<span class="fn">MAX<\/span>/, 'E-8: MAX function span');
assertMatch(h, /<span class="fn">SUM<\/span>/, 'E-9: SUM function span');
assertMatch(h, /<span class="fn">ROUND<\/span>/, 'E-10: ROUND function span');
assertMatch(h, /<span class="fn">NULLIF<\/span>/, 'E-11: NULLIF function span');

// E-3. 문자열 리터럴 하이라이트
assertMatch(h, /<span class="str">'자재코드'<\/span>/, 'E-12: 문자열 리터럴 span (자재코드)');
assertMatch(h, /<span class="str">'개당 단가\(원\)'<\/span>/, 'E-13: 괄호 포함 문자열 리터럴');
assertMatch(h, /<span class="str">'실제원가'<\/span>/, 'E-14: 한글 문자열 리터럴');
assertMatch(h, /<span class="str">'202608'<\/span>/, 'E-15: 숫자 문자열 리터럴 (전부 str)');

// E-4. alias 하이라이트: AS 뒤의 문자열 리터럴은 alias 로 랩핑됨
assertMatch(h, /<span class="kw">AS<\/span> <span class="alias"><span class="str">'자재코드'<\/span><\/span>/, 'E-16: AS + alias(str) nested span 정상');

// E-5. 🔴 회귀 방지 (핵심 버그 재발 방지):
//   - `&#39;` 또는 `&#` 같은 escape 시퀀스 안의 숫자가 <span class="num"> 으로 잘못 매칭되지 않아야 함
//   - `&#<span` 처럼 alias 정규식이 이상한 걸 잡아서 nested HTML 깨지는 현상 없어야 함
assertNotMatch(h, /&#<span/, 'E-17: 회귀 - &# 뒤 <span 없음 (nested 깨짐 방지)');
assertNotMatch(h, /&#\d*<span class="num">/, 'E-18: 회귀 - &# escape 내부 숫자가 num span 되지 않음');
assertNotMatch(h, /class="alias">&#/, 'E-19: 회귀 - alias 가 &# 을 잡지 않음');

// E-6. 식별자 안의 숫자(KST001)는 num 매칭에서 제외되어야 함
assertNotMatch(h, /KST<span class="num">001<\/span>/, 'E-20: 식별자 KST001 내부 숫자는 num 매칭 제외');
assertMatch(h, /KST001/, 'E-21: KST001 은 원본 그대로 표시');

// E-7. 독립된 숫자(0, 202608)는 num 매칭되어야 함
//     ('202608' 은 리터럴이라 str 로 감싸이므로 num 매칭 대상 아님. NULLIF 두번째 인자 0 만 검사)
assertMatch(h, /<span class="fn">NULLIF<\/span>\(<span class="fn">SUM<\/span>\(LBKUM\), <span class="num">0<\/span>\)/, 'E-22: NULLIF 두번째 인자 0 은 num');

// E-8. 태그 속성 문자열(`class="..."`)이 실행 결과에 텍스트로 노출되지 않음
//   (예: pre 안에서 브라우저가 렌더링했을 때 `class="str">자재코드'` 같은 게 텍스트로 안 보이도록,
//    최소한 우리 HTML 자체는 잘 형성되어야 함)
// span 태그가 서로 올바르게 nested 인지 검사 (열린 span 수 = 닫힌 span 수)
const openCount = (h.match(/<span/g) || []).length;
const closeCount = (h.match(/<\/span>/g) || []).length;
assertEqual(openCount, closeCount, `E-23: <span> 개수(${openCount}) === </span> 개수(${closeCount})`);

// E-9. 실행 SQL 불변성: 최종 렌더링 HTML 에서 tag 를 제거한 텍스트는 원본 SQL 과 (개행 무시하고) 동일
function stripTags(html) {
    return html.replace(/<[^>]+>/g, '');
}
const rendered = stripTags(h).replace(/\s+/g, ' ').trim();
const original = userSqlOneLine.replace(/\s+/g, ' ').trim();
// 키워드가 대문자로 통일되므로 (SELECT 등) 대소문자 무시하고 비교
assertEqual(rendered.toUpperCase(), original.toUpperCase(), 'E-24: 렌더링 텍스트 (태그 제거) === 원본 SQL (대소문자 무시)');

// ===================================================================
// F. formatAndHighlightSql: 조합 함수 검증
// ===================================================================
const combined = formatAndHighlightSql(userSqlOneLine);
assertMatch(combined, /^<span class="kw">SELECT<\/span>\n    /, 'F-1: 첫 라인 = <span class="kw">SELECT</span> + 개행');
assertMatch(combined, /\n<span class="kw">FROM<\/span>/, 'F-2: FROM 새 줄');
assertMatch(combined, /\n<span class="kw">WHERE<\/span>/, 'F-3: WHERE 새 줄');
assertMatch(combined, /\n    <span class="kw">AND<\/span>/, 'F-4: AND 별도 줄');
assertEqual(combined.split('\n').length >= 15, true, 'F-5: 총 라인 수 >= 15 (SELECT 컬럼 11개 + 나머지)');

// ===================================================================
// G. CASE WHEN / ELSE / END 정형화
// ===================================================================
const caseSql = `SELECT CASE WHEN A > 0 THEN 'positive' WHEN A < 0 THEN 'negative' ELSE 'zero' END AS sign FROM tbl`;
const fmtG = formatSqlText(caseSql);
assertMatch(fmtG, /WHEN A > 0 THEN 'positive'/, 'G-1: CASE WHEN 보존');
assertMatch(fmtG, /ELSE 'zero'/, 'G-2: ELSE 보존');
assertMatch(fmtG, /END/, 'G-3: END 보존');

// ===================================================================
// H. 빈 값 / falsy 안전성
// ===================================================================
assertEqual(formatSqlText(''), '', 'H-1: 빈 문자열 → 빈 문자열');
assertEqual(formatSqlText(null), '', 'H-2: null → 빈 문자열');
assertEqual(formatSqlText(undefined), '', 'H-3: undefined → 빈 문자열');
assertEqual(highlightSql(''), '', 'H-4: highlightSql 빈 문자열');
assertEqual(highlightSql(null), '', 'H-5: highlightSql null');

// ===================================================================
// I. 실행 SQL 의미 불변성 (규칙 6)
//   - 문자열 리터럴이 정확히 보존되는지
//   - 컬럼명/테이블명이 정확히 보존되는지
// ===================================================================
const complexSql = `SELECT a.id, b.name, COUNT(*) AS cnt FROM tbl_a a LEFT JOIN tbl_b b ON a.b_id = b.id WHERE a.status IN ('ACTIVE', 'PENDING') AND b.created_at >= '2025-01-01' GROUP BY a.id, b.name HAVING COUNT(*) > 5 ORDER BY cnt DESC LIMIT 100`;
const fmtI = formatSqlText(complexSql);
// 원본에 있던 모든 식별자/리터럴이 그대로 존재해야 함
for (const token of ['a.id', 'b.name', 'COUNT(*)', 'AS cnt', 'tbl_a', 'tbl_b', "'ACTIVE'", "'PENDING'", "'2025-01-01'", 'HAVING', 'LIMIT']) {
    assertMatch(fmtI, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `I-${token}: 토큰 보존`);
}

// LEFT JOIN / ON / HAVING / LIMIT 이 새 줄에 있어야 함
assertMatch(fmtI, /\nLEFT JOIN tbl_b b/, 'I-J1: LEFT JOIN 새 줄');
assertMatch(fmtI, /\nON a\.b_id = b\.id/, 'I-J2: ON 새 줄');
assertMatch(fmtI, /\nHAVING /, 'I-J3: HAVING 새 줄');
assertMatch(fmtI, /\nLIMIT 100/, 'I-J4: LIMIT 새 줄');

// ---- 리포트 ----
console.log('');
console.log('==================================================');
console.log(`FRONTEND SQL FORMAT TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    for (const f of failures) console.log('  -', f);
    process.exit(1);
}
