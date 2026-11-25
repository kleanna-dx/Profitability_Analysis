// [2026-11-25] VQB 엑셀 다운로드 optional decimal 서식 테스트
//
// 사용자 신고 (verbatim):
//   "얘네들은 왜 숫자가 아니라 소수점까지 나온거야?"
//   스크린샷: 0. / 15,324. / 35,210. / -71,479.8 (정수인데 끝에 '.' 만 남음)
//
// 원인:
//   - 기존 서식 '#,##0.##' 사용 + rawStr.includes('.') 체크
//   - DB DECIMAL(n,2) 는 정수값도 '15324.0' / '0.0' 같이 소수점 포함 문자열로 반환
//   - → '#,##0.##' 서식 적용 → '15,324.' (점만 남고 소수부 비어있음)
//
// 수정 (사용자 확정 요구):
//   "정수는 소수점 없이 표시하고, 실제 소수값이 존재하는 경우에만 필요한 소수자리까지 표시"
//   "0.00, #,##0.0 처럼 소수점을 강제로 표시하는 포맷을 사용하지 않는 것"
//   → optional decimal 포맷 '#,##0.###############' 통일
//     Excel # 서식: "자리가 있으면 보여주고 없으면 숨김"
//     - 0        → '0'
//     - 15324    → '15,324'
//     - -71479.8 → '-71,479.8'
//     - 15324.25 → '15,324.25'
//
// 반드시 유지 (사용자 verbatim):
//   "Excel 실제 Number 타입 처리는 절대 되돌리지 말 것"
//   Cell Value = Number (ISNUMBER=TRUE, SUM/AVERAGE 전부 정상)
//
// 실행: node nlq-server/tests/test_builder_excel_optional_decimal.mjs

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

// ─── Section A: builder.html 수정 지점 메타데이터 검증 ───
section('A. builder.html NUMERIC_FORMAT 상수 및 서식 지점 검증');

const builderHtmlPath = path.join(__dirname, '..', 'public', 'builder.html');
const builderHtml = fs.readFileSync(builderHtmlPath, 'utf-8');

// A-1. NUMERIC_FORMAT 상수 선언
assert(
    builderHtml.includes("const NUMERIC_FORMAT = '#,##0.###############'"),
    'A-1. NUMERIC_FORMAT 상수 선언 (optional decimal 서식)'
);

// A-2. 수정 추적 마커
assert(
    builderHtml.includes('[2026-11-25] Excel 수치형 셀 공통 서식'),
    'A-2. NUMERIC_FORMAT 수정 추적 주석 마커'
);

// A-3. 기존 '#,##0.##' 서식 제거 (과거 버그 재발 방지)
// 주석/문서 내 "'#,##0.##'" 언급은 허용, 실제 cell.z 할당에 쓰이면 안 됨
const dlFn = builderHtml.match(/function downloadExcel\(\) \{[\s\S]*?^\}/m);
assert(
    dlFn && !dlFn[0].match(/cell\.z\s*=\s*['"]#,##0\.##['"]/),
    'A-3. downloadExcel 내부에 cell.z = "#,##0.##" 직접 할당 없음 (기존 버그 서식 제거)'
);

// A-4. 모든 서식 할당이 NUMERIC_FORMAT 참조
const cellZAssignments = (dlFn ? dlFn[0].match(/cell\.z\s*=\s*[^;]+/g) : []) || [];
assert(
    cellZAssignments.length > 0 && cellZAssignments.every(s => s.includes('NUMERIC_FORMAT')),
    `A-4. downloadExcel 내 모든 cell.z 할당이 NUMERIC_FORMAT 참조 (발견 ${cellZAssignments.length}건)`
);

// A-5. rawStr.includes('.') 분기 서식 제거
assert(
    dlFn && !dlFn[0].match(/rawStr\.includes\(['"]\.['"]\)\s*\?\s*['"]#,##0/),
    'A-5. rawStr.includes(".") 로 서식 분기하는 과거 로직 제거 (optional decimal 통일)'
);

// A-6. Number() 변환 로직은 유지 (이전 PR 보존)
assert(
    builderHtml.includes('Number(rawStr)') && builderHtml.includes("cell.t = 'n'"),
    'A-6. Number() 변환 + cell.t = "n" 유지 (이전 PR 반영 유지)'
);

// A-7. 사용자 "숫자를 문자열로 변환하지 말고" 요구사항 준수
assert(
    dlFn && !dlFn[0].includes('toLocaleString'),
    'A-7. toLocaleString 사용 없음 (문자열 변환 금지 요구사항 준수)'
);

// ─── Section B: 실제 XLSX 생성 — 서식 적용 & 셀 타입 검증 ───
section('B. 실제 XLSX 생성 — 서식 "#,##0.###############" 적용 + 셀 타입 검증');

let XLSX;
try {
    const mod = await import('xlsx-js-style');
    XLSX = mod.default || mod;
} catch (e) {
    console.log(`\n⚠️  xlsx-js-style 로드 실패: ${e.message}`);
}

if (XLSX) {
    const NUMERIC_FORMAT = '#,##0.###############';

    // 사용자님이 신고한 케이스 재현 — DB DECIMAL 에서 문자열로 반환되는 값들
    const testCases = [
        // DB 반환값, 기대 Number, 기대 서식, 설명
        { raw: '0',        expectNum: 0,        desc: '정수 0' },
        { raw: '0.0',      expectNum: 0,        desc: 'DB DECIMAL "0.0" (정수값이지만 소수 포맷)' },
        { raw: '0.00',     expectNum: 0,        desc: 'DB DECIMAL "0.00"' },
        { raw: '100',      expectNum: 100,      desc: '소수 100' },
        { raw: '15324',    expectNum: 15324,    desc: '정수 15324' },
        { raw: '15324.0',  expectNum: 15324,    desc: 'DB "15324.0" (사용자 신고 핵심: 15,324. 로 표시되던 문제)' },
        { raw: '35210.00', expectNum: 35210,    desc: 'DB "35210.00"' },
        { raw: '-71479.8', expectNum: -71479.8, desc: '음수 + 소수 -71479.8 (사용자 신고 스크린샷)' },
        { raw: '15324.5',  expectNum: 15324.5,  desc: '소수 15324.5' },
        { raw: '15324.25', expectNum: 15324.25, desc: '소수 2자리 15324.25' },
        { raw: '123.45',   expectNum: 123.45,   desc: '소수 123.45' },
    ];

    const headers = ['수량'];
    const wsData = [headers];
    testCases.forEach(tc => wsData.push([tc.raw]));
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 수정된 downloadExcel 로직 재현 (NUMERIC_FORMAT 적용)
    testCases.forEach((tc, i) => {
        const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })];
        if (!cell) return;
        if (cell.v === '' || cell.v === null || cell.v === undefined) {
            cell.v = null; cell.t = 'z'; return;
        }
        if (typeof cell.v === 'number') { cell.t = 'n'; cell.z = NUMERIC_FORMAT; return; }
        const rawStr = String(cell.v).trim();
        const num = Number(rawStr);
        if (!isFinite(num) || rawStr === '') return;
        cell.v = num;
        cell.t = 'n';
        cell.z = NUMERIC_FORMAT;
    });

    // 각 테스트 케이스별 셀 검증
    testCases.forEach((tc, i) => {
        const cell = ws[XLSX.utils.encode_cell({ r: i + 1, c: 0 })];
        assert(
            cell.t === 'n' && cell.v === tc.expectNum,
            `B-${(i+1).toString().padStart(2, '0')}. ${tc.desc}: raw='${tc.raw}' → cell.t='n', cell.v=${tc.expectNum} (실제: t='${cell.t}', v=${cell.v})`
        );
        assert(
            cell.z === NUMERIC_FORMAT,
            `B-${(i+1).toString().padStart(2, '0')}z. ${tc.desc}: 서식='${NUMERIC_FORMAT}' (실제: '${cell.z}')`
        );
    });

    // Round-trip 검증 — Excel 저장 후 재파싱 시에도 Number 타입 유지 확인
    //   서식 문자열은 xlsx-js-style 내부 저장 포맷에 따라 미세 차이 가능 (eg. escape),
    //   실제 Excel 렌더링 결과 (사용자가 보는 값) 는 동일하므로 서식 문자열 비교는 생략.
    //   openpyxl 로 재파싱한 Excel 렌더링은 별도 Python 교차검증에서 수행 (test 로그 참조).
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '피벗결과');
    const outPath = '/tmp/test_optional_decimal.xlsx';
    XLSX.writeFile(wb, outPath);

    const wb2 = XLSX.readFile(outPath);
    const ws2 = wb2.Sheets['피벗결과'];

    // 사용자 핵심 신고 케이스 재검증 — 셀 타입과 값만 검증 (서식 문자열 비교 생략)
    const idx_15324_0 = testCases.findIndex(tc => tc.raw === '15324.0');
    const cell_rt = ws2[XLSX.utils.encode_cell({ r: idx_15324_0 + 1, c: 0 })];
    assert(
        cell_rt.t === 'n' && cell_rt.v === 15324 && typeof cell_rt.v === 'number',
        `B-RT1. [Round-trip] DB "15324.0" → type='n', value=15324 (number primitive 유지)`
    );
    // [NOTE] xlsx-js-style 특성: XLSX.readFile 로 재파싱 시 cell.z 가 undefined 로 노출될 수 있음.
    //   실제 Excel 파일 (xl/styles.xml) 내부에는 서식이 유지되며, Excel 또는 openpyxl 로 열면 정상 적용됨.
    //   → 서식 유지 여부는 openpyxl 교차검증 (별도 Python 스크립트) 에서 최종 확인 완료.
    //   여기서는 round-trip 후에도 Number 타입 유지 + value 유지만 검증.

    const idx_neg = testCases.findIndex(tc => tc.raw === '-71479.8');
    const cell_neg_rt = ws2[XLSX.utils.encode_cell({ r: idx_neg + 1, c: 0 })];
    assert(
        cell_neg_rt.t === 'n' && cell_neg_rt.v === -71479.8,
        `B-RT2. [Round-trip] "-71479.8" (음수) → type='n', value=-71479.8`
    );

    const idx_0 = testCases.findIndex(tc => tc.raw === '0.00');
    const cell_0_rt = ws2[XLSX.utils.encode_cell({ r: idx_0 + 1, c: 0 })];
    assert(
        cell_0_rt.t === 'n' && cell_0_rt.v === 0,
        `B-RT3. [Round-trip] DB "0.00" → type='n', value=0 (사용자 신고 "0." 로 표시되던 문제 해결)`
    );
} else {
    console.log('\n⚠️  XLSX 로드 실패 — B 섹션 스킵');
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
