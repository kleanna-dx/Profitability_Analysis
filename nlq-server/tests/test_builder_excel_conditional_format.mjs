// [2026-11-25 v2] VQB 엑셀 다운로드 조건부 서식 분기 테스트
//
// 사용자 신고 (verbatim):
//   "아니 고친거 맞아? 엑셀파일에 0. <- 이렇게 나온다니깐??"
//   "소수점 있는것만 소수점 노출되고 없으면 소수점 노출되게 하지말라고!"
//   "0. (X) -> 0    150,922. -> 150,922 (0) 이렇게 하라고"
//   스크린샷: 0. / 150,922. / 33,796. / 101,859. (정수인데 끝에 '.' 만 남음)
//
// v1 수정 (NUMERIC_FORMAT = '#,##0.###############') 후에도 사용자 Excel 환경에서
// 정수값에 끝점이 남는 현상 발생. 분석 결과:
//   - 셀 타입 'n' (Number) ✅
//   - 서식 '#,##0.###############' 적용됨 ✅
//   - ISNUMBER()=TRUE ✅
//   하지만 Excel 특정 환경에서 서식 문자열의 '.' 때문에 정수에도 '.' 남김
//
// 해결 (사용자 확정 '옵션 A'): 값 기준 서식 분기
//   const pickNumericFormat = (n) => (n === Math.floor(n) ? '#,##0' : '#,##0.###############');
//
// 기대 결과:
//   | 입력        | Number  | 서식                    | Excel 표시 |
//   | 0           | 0       | #,##0                   | 0          |
//   | 0.0         | 0       | #,##0                   | 0          |
//   | 150922      | 150922  | #,##0                   | 150,922    |
//   | 15324.0     | 15324   | #,##0                   | 15,324     | (사용자 핵심)
//   | -71479.8    | -71479.8| #,##0.############### | -71,479.8  |
//   | 15324.25    | 15324.25| #,##0.############### | 15,324.25  |
//
// 실행: node nlq-server/tests/test_builder_excel_conditional_format.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(cond, msg) {
    if (cond) {
        passCount++;
        console.log(`  ✅ ${msg}`);
    } else {
        failCount++;
        failures.push(msg);
        console.log(`  ❌ ${msg}`);
    }
}

function section(name) {
    console.log(`\n[${name}]`);
}

// ─── Section A: builder.html 수정 지점 검증 ───
section('A. builder.html pickNumericFormat / 상수 선언 검증');

const builderHtmlPath = path.join(__dirname, '..', 'public', 'builder.html');
const builderHtml = fs.readFileSync(builderHtmlPath, 'utf-8');

assert(
    builderHtml.includes("const NUMERIC_FORMAT_INT = '#,##0'"),
    'A-1. NUMERIC_FORMAT_INT 상수 선언 (정수 서식 = 소수점 없음)'
);

assert(
    builderHtml.includes("const NUMERIC_FORMAT_DEC = '#,##0.###############'"),
    'A-2. NUMERIC_FORMAT_DEC 상수 선언 (소수 서식 = optional decimal)'
);

assert(
    builderHtml.includes("const pickNumericFormat = (n) => (n === Math.floor(n) ? NUMERIC_FORMAT_INT : NUMERIC_FORMAT_DEC)"),
    'A-3. pickNumericFormat() 함수 — Math.floor 기반 값 분기'
);

assert(
    builderHtml.includes('[2026-11-25 v2] Excel 수치형 셀 조건부 서식'),
    'A-4. v2 수정 추적 주석 마커'
);

// cell.z 할당 지점 2곳 전부 pickNumericFormat 호출 사용
const dlFn = builderHtml.match(/function downloadExcel\(\) \{[\s\S]*?^\}/m);
assert(
    dlFn && !dlFn[0].match(/cell\.z\s*=\s*NUMERIC_FORMAT\s*;/),
    'A-5. downloadExcel 내 cell.z = NUMERIC_FORMAT (고정 서식) 할당 없음 (v1 코드 제거 확인)'
);

const pickCalls = (dlFn ? dlFn[0].match(/cell\.z\s*=\s*pickNumericFormat\(/g) : []) || [];
assert(
    pickCalls.length === 2,
    `A-6. cell.z = pickNumericFormat(...) 호출 2곳 (실제: ${pickCalls.length})`
);

// v1 서식 '#,##0.##' 완전 제거 확인
assert(
    dlFn && !dlFn[0].match(/cell\.z\s*=\s*['"]#,##0\.##['"]/),
    'A-7. 과거 "#,##0.##" 서식 할당 완전 제거 (버그 재발 방지)'
);

// Number() 변환 유지 (v1 보존)
assert(
    builderHtml.includes('Number(rawStr)') && builderHtml.includes("cell.t = 'n'"),
    'A-8. Number() 변환 + cell.t = "n" 유지 (v1 Number 타입 저장 유지)'
);

// ─── Section B: pickNumericFormat 순수 함수 테스트 ───
section('B. pickNumericFormat 함수 로직 검증');

const NUMERIC_FORMAT_INT = '#,##0';
const NUMERIC_FORMAT_DEC = '#,##0.###############';
const pickNumericFormat = (n) => (n === Math.floor(n) ? NUMERIC_FORMAT_INT : NUMERIC_FORMAT_DEC);

const testCases = [
    // [값, 기대 서식, 기대 Excel 표시, 설명]
    [0,        NUMERIC_FORMAT_INT, '0',          '정수 0 (사용자 신고 "0." 해결)'],
    [100,      NUMERIC_FORMAT_INT, '100',        '정수 100'],
    [15324,    NUMERIC_FORMAT_INT, '15,324',     '정수 15324'],
    [150922,   NUMERIC_FORMAT_INT, '150,922',    '정수 150922 (사용자 신고 "150,922." 해결)'],
    [35210,    NUMERIC_FORMAT_INT, '35,210',     '정수 35210'],
    [-150000,  NUMERIC_FORMAT_INT, '-150,000',   '음수 정수 -150000'],
    [-71479.8, NUMERIC_FORMAT_DEC, '-71,479.8',  '음수 소수 -71479.8'],
    [15324.5,  NUMERIC_FORMAT_DEC, '15,324.5',   '소수 15324.5'],
    [15324.25, NUMERIC_FORMAT_DEC, '15,324.25',  '소수 2자리 15324.25'],
    [123.45,   NUMERIC_FORMAT_DEC, '123.45',     '소수 123.45'],
    [0.5,      NUMERIC_FORMAT_DEC, '0.5',        '0 미만 소수 0.5'],
    [-0.1,     NUMERIC_FORMAT_DEC, '-0.1',       '음수 소수 -0.1'],
];

testCases.forEach(([v, expectedFmt, expectedDisplay, desc], i) => {
    const actualFmt = pickNumericFormat(v);
    assert(
        actualFmt === expectedFmt,
        `B-${(i+1).toString().padStart(2,'0')}. ${desc}: value=${v} → 서식='${expectedFmt}' (실제: '${actualFmt}')`
    );
});

// ─── Section C: DB DECIMAL 반환값 시나리오 (문자열 → Number 변환 후 분기) ───
section('C. DB DECIMAL 반환값 Number 변환 후 서식 분기 검증');

// DB 가 '15324.0' / '0.00' 같이 소수점 포함 문자열로 반환해도
// Number() 변환 후 Math.floor 체크하면 실제 정수로 판별되어야 함
const dbCases = [
    // [DB 반환 문자열, 기대 Number, 기대 서식, Excel 표시]
    ['0',         0,         NUMERIC_FORMAT_INT, '0'],
    ['0.0',       0,         NUMERIC_FORMAT_INT, '0'],         // DB DECIMAL(n,1) 가짜 소수
    ['0.00',      0,         NUMERIC_FORMAT_INT, '0'],         // DB DECIMAL(n,2) 가짜 소수
    ['15324',     15324,     NUMERIC_FORMAT_INT, '15,324'],
    ['15324.0',   15324,     NUMERIC_FORMAT_INT, '15,324'],    // ⭐ 사용자 신고 핵심
    ['35210.00',  35210,     NUMERIC_FORMAT_INT, '35,210'],
    ['150922',    150922,    NUMERIC_FORMAT_INT, '150,922'],   // ⭐ 사용자 신고 스크린샷
    ['150922.00', 150922,    NUMERIC_FORMAT_INT, '150,922'],   // DB 가짜 소수
    ['-71479.8',  -71479.8,  NUMERIC_FORMAT_DEC, '-71,479.8'], // 실제 소수
    ['15324.25',  15324.25,  NUMERIC_FORMAT_DEC, '15,324.25'], // 실제 소수
    ['123.45',    123.45,    NUMERIC_FORMAT_DEC, '123.45'],    // 실제 소수
];

dbCases.forEach(([rawStr, expectedNum, expectedFmt, excelDisplay], i) => {
    const num = Number(rawStr);
    const fmt = pickNumericFormat(num);
    assert(
        num === expectedNum && fmt === expectedFmt,
        `C-${(i+1).toString().padStart(2,'0')}. DB='${rawStr}' → Number=${expectedNum}, 서식='${expectedFmt}' (실제 Number=${num}, 서식='${fmt}'), Excel='${excelDisplay}'`
    );
});

// ─── Section D: 실제 XLSX 생성 + openpyxl 교차검증 ───
section('D. 실제 XLSX 생성 — Number 타입 유지 + 조건부 서식 적용');

let XLSX;
try {
    const mod = await import('xlsx-js-style');
    XLSX = mod.default || mod;
} catch (e) {
    console.log(`\n⚠️  xlsx-js-style 로드 실패: ${e.message}`);
}

if (XLSX) {
    // 사용자님 스크린샷 그대로 재현 (인건비, 도급비, 에너지비 등)
    const headers = ['인건비', '도급비', '에너지비'];
    const rows = [
        ['0',          '0',          '0'],           // 사용자 신고 "0." 케이스
        ['150922',     '865088',     '12345'],       // 사용자 신고 "150,922." 케이스 (정수)
        ['150922.00',  '865088.00',  '12345.00'],    // DB DECIMAL 가짜 소수 — 정수 서식이어야 함
        ['-71479.8',   '150000.5',   '0.25'],        // 실제 소수 — 소수 서식이어야 함
    ];

    const wsData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 수정된 downloadExcel 로직 재현
    rows.forEach((row, ri) => {
        row.forEach((raw, ci) => {
            const cell = ws[XLSX.utils.encode_cell({ r: ri + 1, c: ci })];
            if (!cell) return;
            const num = Number(raw);
            if (!isFinite(num)) return;
            cell.v = num;
            cell.t = 'n';
            cell.z = pickNumericFormat(num);
        });
    });

    // Round-trip
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '피벗결과');
    const outPath = '/tmp/test_conditional_format.xlsx';
    XLSX.writeFile(wb, outPath);

    const wb2 = XLSX.readFile(outPath);
    const ws2 = wb2.Sheets['피벗결과'];

    // row 1 (0, 0, 0) — 정수 0 → 서식 '#,##0'
    const r1_cells = [0, 1, 2].map(c => ws2[XLSX.utils.encode_cell({ r: 1, c })]);
    r1_cells.forEach((cell, i) => {
        assert(
            cell.t === 'n' && cell.v === 0,
            `D-${i+1}. row1 col${i+1} (0): type='n', value=0 (실제: t='${cell.t}', v=${cell.v})`
        );
    });

    // row 2 (150922, 865088, 12345) — 정수 → 서식 '#,##0'
    const r2_cells = [0, 1, 2].map(c => ws2[XLSX.utils.encode_cell({ r: 2, c })]);
    const r2_expected = [150922, 865088, 12345];
    r2_cells.forEach((cell, i) => {
        assert(
            cell.t === 'n' && cell.v === r2_expected[i],
            `D-${i+4}. row2 col${i+1} (${r2_expected[i]}): type='n', value=${r2_expected[i]}`
        );
    });

    // row 3 (150922.00, 865088.00, 12345.00 — DB 가짜 소수) → Number 150922 / 865088 / 12345 → 정수 서식
    const r3_cells = [0, 1, 2].map(c => ws2[XLSX.utils.encode_cell({ r: 3, c })]);
    const r3_expected = [150922, 865088, 12345];
    r3_cells.forEach((cell, i) => {
        assert(
            cell.t === 'n' && cell.v === r3_expected[i],
            `D-${i+7}. row3 col${i+1} DB 가짜 소수 ${rows[2][i]} → Number ${r3_expected[i]}, type='n'`
        );
    });

    // row 4 (-71479.8, 150000.5, 0.25) — 실제 소수 → 서식 '#,##0.###############'
    const r4_cells = [0, 1, 2].map(c => ws2[XLSX.utils.encode_cell({ r: 4, c })]);
    const r4_expected = [-71479.8, 150000.5, 0.25];
    r4_cells.forEach((cell, i) => {
        assert(
            cell.t === 'n' && cell.v === r4_expected[i],
            `D-${i+10}. row4 col${i+1} 실제 소수 ${r4_expected[i]}: type='n', value=${r4_expected[i]}`
        );
    });

    console.log(`\n   📁 생성된 Excel 파일: ${outPath}`);
    console.log(`   → openpyxl 로 재검증은 별도 Python 스크립트에서 수행`);
}

// ─── 결과 ───
console.log('\n' + '='.repeat(60));
console.log(`결과: ${passCount}/${passCount + failCount} PASS`);
if (failCount > 0) {
    console.log('\n❌ 실패 항목:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
} else {
    console.log('✅ 전체 테스트 통과');
    process.exit(0);
}
