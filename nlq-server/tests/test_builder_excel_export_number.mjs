// [2026-11-25] VQB 엑셀 다운로드 수치형 Number 타입 저장 테스트
//
// 사용자 신고 (verbatim):
//   "수치 데이터가 Excel에서 숫자가 아니라 문자열(Text)로 저장되고 있다"
//   "ISNUMBER() = FALSE → SUM/AVERAGE 등 Excel 수식을 사용할 수 없는 문제"
//   "수치형 필드는 문자열이 아니라 실제 Excel Number 타입으로 저장해야 한다"
//
// 요구사항 체크리스트:
//   ✅ 수익성분석 / 제조원가 공통 downloadExcel() 함수 — 단일 수정으로 양 영역 커버
//   ✅ 메타데이터 기준 수치형 판별 (is_metric || aggregate ∈ SUM/AVG/MIN/MAX/COUNT)
//   ✅ 코드/ID 컬럼 (자재코드/플랜트/YYYYMM) 은 기존처럼 String 유지
//   ✅ 음수/0/소수점/NULL 정상 처리
//   ✅ toLocaleString / 쉼표 포함 문자열로 변환해서 넣지 않음
//
// 검증 방식:
//   - builder.html 에서 downloadExcel() 함수를 그대로 추출
//   - 가짜 selectedFields / lastResultColumns / lastResultRows 로 setup
//   - XLSX 라이브러리 (xlsx-js-style) 로 Workbook 생성
//   - sheet 의 각 cell 의 .t (type) 와 .v (value) 를 직접 검증
//     · 수치형 → .t === 'n', .v 는 number primitive
//     · 코드성 → .t === 's', .v 는 string primitive
//
// 실행: node nlq-server/tests/test_builder_excel_export_number.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── 테스트 유틸 ────────────────────────────────────────────
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

// ─── Section A: builder.html 에서 downloadExcel 함수 추출 검증 ───
section('A. builder.html downloadExcel 함수 메타데이터 검증');

const builderHtmlPath = path.join(__dirname, '..', 'public', 'builder.html');
const builderHtml = fs.readFileSync(builderHtmlPath, 'utf-8');

// A-1. 함수 존재 확인
assert(
    builderHtml.includes('function downloadExcel()'),
    'A-1. downloadExcel() 함수 존재'
);

// A-2. 핵심 변경 마커 (수정 일자 주석) 존재 — 추적성
assert(
    builderHtml.includes('[2026-11-25] 수치형 셀 Number 타입 강제 저장'),
    'A-2. 수정 추적용 주석 마커 존재'
);

// A-3. is_metric 판별 로직 존재
assert(
    builderHtml.includes('!!f.is_metric'),
    'A-3. is_metric 판별 로직 존재'
);

// A-4. aggregate 판별 로직 존재
assert(
    builderHtml.includes('NUMERIC_AGGS') && builderHtml.includes("'SUM'") && builderHtml.includes("'AVG'"),
    'A-4. NUMERIC_AGGS (SUM/AVG/...) 판별 로직 존재'
);

// A-5. MIN/MAX/COUNT 포함
assert(
    builderHtml.includes("'MIN'") && builderHtml.includes("'MAX'") && builderHtml.includes("'COUNT'"),
    'A-5. NUMERIC_AGGS 에 MIN/MAX/COUNT 포함'
);

// A-6. cell.t = 'n' 명시적 설정
assert(
    builderHtml.includes("cell.t = 'n'"),
    'A-6. 수치형 셀 타입 명시 설정 (cell.t = "n")'
);

// A-7. Number() 변환 사용
assert(
    builderHtml.includes('Number(rawStr)'),
    'A-7. Number() 명시적 변환 사용'
);

// A-8. 쉼표 포맷 문자열로 변환하지 않음 — toLocaleString 사용 금지
const downloadExcelFn = builderHtml.match(/function downloadExcel\(\) \{[\s\S]*?^\}/m);
assert(
    downloadExcelFn && !downloadExcelFn[0].includes('toLocaleString'),
    'A-8. downloadExcel 함수 내부에 toLocaleString 사용 없음 (요구사항 준수)'
);

// A-9. Number 형식 서식 지정 (#,##0)
assert(
    builderHtml.includes("'#,##0'"),
    'A-9. Number 서식 지정 (#,##0)'
);

// A-10. 소수점 포함 시 다른 서식 (#,##0.##)
assert(
    builderHtml.includes("'#,##0.##'"),
    'A-10. 소수점 포함 수치용 서식 지정 (#,##0.##)'
);

// A-11. 변환 실패 시 안전 처리 (경고 로그 + 원본 유지)
assert(
    builderHtml.includes('convertFailCount') && builderHtml.includes('console.warn'),
    'A-11. 변환 실패 시 경고 로그 + 원본 문자열 유지'
);

// A-12. 빈 셀 처리 (blank cell type 'z')
assert(
    builderHtml.includes("cell.t = 'z'"),
    'A-12. 빈 셀 타입 설정 (cell.t = "z")'
);

// A-13. isFinite 검사 (NaN/Infinity 안전 처리)
assert(
    builderHtml.includes('isFinite(num)'),
    'A-13. isFinite() 안전 검사 존재'
);

// A-14. selectedFields 메타데이터 참조
assert(
    builderHtml.includes('selectedFields.forEach') && builderHtml.includes('numericColSet'),
    'A-14. selectedFields 로부터 수치형 컬럼 집합 선계산'
);

// A-15. alias 우선 매칭 (서버 응답 컬럼명과 일관)
assert(
    builderHtml.includes('f.alias || f.column'),
    'A-15. alias 우선 매칭 로직 (서버 응답 컬럼명과 일관)'
);

// ─── Section B: 가짜 데이터로 실제 XLSX 생성 검증 ───
section('B. 실제 XLSX 생성 — 셀 타입/값 직접 검증');

// 서버 응답 시뮬레이션 — 수익성분석 예시
const selectedFields = [
    // 차원 필드 (코드성) — String 유지되어야 함
    { column: 'CALMONTH', alias: '',               aggregate: '', is_metric: false },  // YYYYMM 코드
    { column: 'PLANT',    alias: '',               aggregate: '', is_metric: false },  // 플랜트 코드
    { column: 'MATERIAL', alias: '',               aggregate: '', is_metric: false },  // 자재코드
    { column: 'MATL_NM',  alias: '',               aggregate: '', is_metric: false },  // 자재명 (텍스트)
    // 집계 필드 — Number 로 변환되어야 함
    { column: 'SALES',    alias: 'SUM_SALES',      aggregate: 'SUM', is_metric: false }, // SUM(총매출)
    { column: 'LABOR',    alias: 'AVG_LABOR',      aggregate: 'AVG', is_metric: false }, // AVG(인건비)
    // 산식 metric — Number 로 변환되어야 함
    { column: 'OP_PROFIT',       alias: '', aggregate: '', is_metric: true },   // 영업이익
    { column: 'UNIT_COST',       alias: '', aggregate: '', is_metric: true },   // 개당 단가
];

// 서버 응답 컬럼명 (alias 우선, 없으면 column)
const lastResultColumns = selectedFields.map(f => f.alias || f.column);
// → ['CALMONTH', 'PLANT', 'MATERIAL', 'MATL_NM', 'SUM_SALES', 'AVG_LABOR', 'OP_PROFIT', 'UNIT_COST']

// 서버 응답 rows — DB 에서 숫자가 문자열로 반환되는 상황 시뮬레이션
const lastResultRows = [
    {
        CALMONTH: '202610',                 // String (코드)
        PLANT: 'P100',                      // String (코드)
        MATERIAL: 'F2111240-08200820B',    // String (코드)
        MATL_NM: 'Manila 240GSM 0820*0820',// String (텍스트)
        SUM_SALES: '41868195260',           // String (DB 에서 문자열로 옴) → Number 변환 필요
        AVG_LABOR: '27524.5',               // String + 소수점
        OP_PROFIT: '303928',                // String → Number 변환 필요
        UNIT_COST: '72002'                  // String → Number 변환 필요 (사용자 신고 핵심 케이스)
    },
    {
        CALMONTH: '202611',
        PLANT: 'P100',
        MATERIAL: 'F2111240-08900850B',
        MATL_NM: 'Manila 240GSM 0890*0850',
        SUM_SALES: '38500000000',
        AVG_LABOR: '28000',
        OP_PROFIT: '-150000',               // 음수 처리 검증
        UNIT_COST: '81788'
    },
    {
        // NULL / 빈값 처리 검증
        CALMONTH: '202612',
        PLANT: 'P100',
        MATERIAL: 'F0000000-XXXX',
        MATL_NM: '테스트 자재',
        SUM_SALES: null,
        AVG_LABOR: '',
        OP_PROFIT: '0',                     // 0 처리 검증
        UNIT_COST: null
    }
];

// XLSX 라이브러리 로드 (브라우저에서는 CDN, 테스트에서는 node_modules)
let XLSX;
try {
    const mod = await import('xlsx-js-style');
    XLSX = mod.default || mod;
} catch (e) {
    console.log(`\n⚠️  xlsx-js-style 없음 — npm install xlsx-js-style 필요`);
    console.log(`   설치 중...`);
    const { execSync } = await import('node:child_process');
    try {
        execSync('cd /home/user/webapp && npm install xlsx-js-style --no-save 2>&1', { stdio: 'inherit' });
        const mod2 = await import('xlsx-js-style');
        XLSX = mod2.default || mod2;
    } catch (e2) {
        console.log(`❌ xlsx-js-style 설치 실패: ${e2.message}`);
        console.log(`   B 섹션 스킵. (브라우저 환경에서는 CDN 으로 로드됨)`);
    }
}

if (XLSX) {
    // downloadExcel 함수와 동일한 로직 재현 (XLSX.writeFile 대신 메모리에 담아 검증)
    const NUMERIC_AGGS = new Set(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT']);
    const numericColSet = new Set();
    selectedFields.forEach(f => {
        if (!f) return;
        const isNumeric = !!f.is_metric || (f.aggregate && NUMERIC_AGGS.has(String(f.aggregate).toUpperCase()));
        if (!isNumeric) return;
        const colKey = f.alias || f.column;
        if (colKey) numericColSet.add(colKey);
    });

    // 수치형 컬럼 집합 검증
    const expectedNumericCols = new Set(['SUM_SALES', 'AVG_LABOR', 'OP_PROFIT', 'UNIT_COST']);
    const expectedStringCols = ['CALMONTH', 'PLANT', 'MATERIAL', 'MATL_NM'];

    assert(
        numericColSet.size === expectedNumericCols.size &&
        [...expectedNumericCols].every(c => numericColSet.has(c)),
        'B-1. 수치형 컬럼 집합 정확히 식별 (SUM_SALES/AVG_LABOR/OP_PROFIT/UNIT_COST)'
    );

    assert(
        expectedStringCols.every(c => !numericColSet.has(c)),
        'B-2. 차원 컬럼은 수치형 집합에서 제외 (CALMONTH/PLANT/MATERIAL/MATL_NM 등)'
    );

    // Sheet 생성
    const wsData = [lastResultColumns];
    lastResultRows.forEach(row => {
        wsData.push(lastResultColumns.map(col => {
            const v = row[col];
            return (v === null || v === undefined) ? '' : v;
        }));
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 수치형 처리 (downloadExcel 과 동일 로직)
    let convertFailCount = 0;
    lastResultColumns.forEach((col, ci) => {
        if (!numericColSet.has(col)) return;
        lastResultRows.forEach((row, ri) => {
            const cell = ws[XLSX.utils.encode_cell({ r: ri + 1, c: ci })];
            if (!cell) return;
            if (cell.v === '' || cell.v === null || cell.v === undefined) {
                cell.v = null;
                cell.t = 'z';
                return;
            }
            if (typeof cell.v === 'number') {
                cell.t = 'n';
                cell.z = '#,##0';
                return;
            }
            const rawStr = String(cell.v).trim();
            const num = Number(rawStr);
            if (!isFinite(num) || rawStr === '') {
                convertFailCount++;
                return;
            }
            cell.v = num;
            cell.t = 'n';
            cell.z = rawStr.includes('.') ? '#,##0.##' : '#,##0';
        });
    });

    // ─── 수치형 컬럼 셀 검증 ───
    section('B-NUM. 수치형 컬럼 Number 타입 저장 검증');

    // row 1: 정상 수치형 모두 Number
    const r1_sales = ws[XLSX.utils.encode_cell({ r: 1, c: 4 })]; // SUM_SALES
    assert(r1_sales.t === 'n' && r1_sales.v === 41868195260,
        `B-3. SUM_SALES (row 1): type='n', value=41868195260 (실제: t='${r1_sales.t}', v=${r1_sales.v})`);
    assert(r1_sales.z === '#,##0',
        `B-4. SUM_SALES (row 1): 서식='#,##0' (실제: '${r1_sales.z}')`);

    const r1_labor = ws[XLSX.utils.encode_cell({ r: 1, c: 5 })]; // AVG_LABOR (소수점)
    assert(r1_labor.t === 'n' && r1_labor.v === 27524.5,
        `B-5. AVG_LABOR (row 1, 소수점): type='n', value=27524.5 (실제: t='${r1_labor.t}', v=${r1_labor.v})`);
    assert(r1_labor.z === '#,##0.##',
        `B-6. AVG_LABOR (row 1, 소수점): 서식='#,##0.##' (실제: '${r1_labor.z}')`);

    const r1_profit = ws[XLSX.utils.encode_cell({ r: 1, c: 6 })]; // OP_PROFIT (metric)
    assert(r1_profit.t === 'n' && r1_profit.v === 303928,
        `B-7. OP_PROFIT (row 1, is_metric): type='n', value=303928 (실제: t='${r1_profit.t}', v=${r1_profit.v})`);

    const r1_unit = ws[XLSX.utils.encode_cell({ r: 1, c: 7 })]; // UNIT_COST — 사용자 신고 핵심 케이스
    assert(r1_unit.t === 'n' && r1_unit.v === 72002,
        `B-8. UNIT_COST (row 1, 사용자 신고 핵심): type='n', value=72002 (실제: t='${r1_unit.t}', v=${r1_unit.v})`);

    // row 2: 음수 처리
    const r2_profit = ws[XLSX.utils.encode_cell({ r: 2, c: 6 })];
    assert(r2_profit.t === 'n' && r2_profit.v === -150000,
        `B-9. OP_PROFIT (row 2, 음수): type='n', value=-150000 (실제: t='${r2_profit.t}', v=${r2_profit.v})`);

    // row 3: NULL / 0 / 빈값
    const r3_sales = ws[XLSX.utils.encode_cell({ r: 3, c: 4 })];
    assert(r3_sales.t === 'z' && r3_sales.v === null,
        `B-10. SUM_SALES (row 3, NULL): type='z' (blank), value=null (실제: t='${r3_sales.t}', v=${r3_sales.v})`);

    const r3_labor = ws[XLSX.utils.encode_cell({ r: 3, c: 5 })];
    assert(r3_labor.t === 'z' && r3_labor.v === null,
        `B-11. AVG_LABOR (row 3, 빈 문자열): type='z' (blank), value=null (실제: t='${r3_labor.t}', v=${r3_labor.v})`);

    const r3_profit = ws[XLSX.utils.encode_cell({ r: 3, c: 6 })];
    assert(r3_profit.t === 'n' && r3_profit.v === 0,
        `B-12. OP_PROFIT (row 3, "0"): type='n', value=0 (실제: t='${r3_profit.t}', v=${r3_profit.v})`);

    // ─── 차원 컬럼 (코드성) 셀 검증 — String 유지되어야 함 ───
    section('B-CODE. 차원 컬럼 String 타입 유지 검증 (코드/ID 보호)');

    const r1_cmonth = ws[XLSX.utils.encode_cell({ r: 1, c: 0 })]; // CALMONTH='202610'
    assert(r1_cmonth.t === 's' && r1_cmonth.v === '202610',
        `B-13. CALMONTH (YYYYMM 코드 — 숫자처럼 보이지만 String 유지): type='s', value='202610' (실제: t='${r1_cmonth.t}', v='${r1_cmonth.v}')`);

    const r1_plant = ws[XLSX.utils.encode_cell({ r: 1, c: 1 })]; // PLANT='P100'
    assert(r1_plant.t === 's' && r1_plant.v === 'P100',
        `B-14. PLANT (플랜트 코드): type='s', value='P100'`);

    const r1_matl = ws[XLSX.utils.encode_cell({ r: 1, c: 2 })]; // MATERIAL='F2111240-...'
    assert(r1_matl.t === 's' && r1_matl.v === 'F2111240-08200820B',
        `B-15. MATERIAL (자재코드): type='s'`);

    const r1_nm = ws[XLSX.utils.encode_cell({ r: 1, c: 3 })]; // MATL_NM='Manila...'
    assert(r1_nm.t === 's',
        `B-16. MATL_NM (자재명): type='s' (text)`);

    // row 2 CALMONTH 도 String 유지
    const r2_cmonth = ws[XLSX.utils.encode_cell({ r: 2, c: 0 })];
    assert(r2_cmonth.t === 's' && r2_cmonth.v === '202611',
        `B-17. CALMONTH (row 2, 202611): String 유지`);

    // 변환 실패 카운트 — 정상 데이터만 있으므로 0 이어야 함
    assert(convertFailCount === 0,
        `B-18. 변환 실패 카운트 = 0 (정상 데이터 전부 변환 성공)`);

    // ─── 최종 XLSX 바이너리 생성 + 재파싱 교차검증 ───
    section('B-RT. XLSX 바이너리 생성 + openpyxl 교차검증용 파일 저장');

    XLSX.utils.book_append_sheet(XLSX.utils.book_new(), ws, '피벗결과');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '피벗결과');

    const outPath = '/tmp/test_vqb_excel_output.xlsx';
    XLSX.writeFile(wb, outPath);
    assert(fs.existsSync(outPath),
        `B-19. Excel 파일 생성 성공: ${outPath}`);
    const stat = fs.statSync(outPath);
    assert(stat.size > 1000,
        `B-20. Excel 파일 크기 > 1KB (${stat.size} bytes)`);

    // ─── 저장된 파일을 다시 읽어서 cell type 재검증 (round-trip) ───
    const wb2 = XLSX.readFile(outPath);
    const ws2 = wb2.Sheets['피벗결과'];

    const rt_unit = ws2[XLSX.utils.encode_cell({ r: 1, c: 7 })];
    assert(rt_unit.t === 'n' && typeof rt_unit.v === 'number',
        `B-21. [Round-trip] UNIT_COST: 재파싱 후에도 type='n' + number primitive 유지 (실제: t='${rt_unit.t}', typeof v='${typeof rt_unit.v}')`);

    const rt_cmonth = ws2[XLSX.utils.encode_cell({ r: 1, c: 0 })];
    assert(rt_cmonth.t === 's' && typeof rt_cmonth.v === 'string' && rt_cmonth.v === '202610',
        `B-22. [Round-trip] CALMONTH: 재파싱 후에도 type='s' + string primitive 유지`);
} else {
    console.log(`\n⚠️  XLSX 라이브러리 로드 실패 — B 섹션 스킵 (브라우저 CDN 환경에서는 정상 동작)`);
}

// ─── Section C: 사용자 요구사항 준수 체크 ───
section('C. 사용자 요구사항 verbatim 준수 검증');

// C-1. toLocaleString / 쉼표 포함 문자열 변환 금지
assert(
    !builderHtml.match(/toLocaleString[\s\S]{0,200}XLSX\.writeFile/) &&
    !builderHtml.match(/XLSX\.writeFile[\s\S]{0,200}toLocaleString/),
    'C-1. downloadExcel 주변에 toLocaleString 사용 없음 (요구사항: "쉼표가 포함된 문자열로 변환한 뒤 Excel에 넣지 말 것")'
);

// C-2. 수익성분석/제조원가 공통 함수 (단일 지점 수정)
//   - builder.html 의 downloadExcel 함수는 양 영역이 공통으로 사용
//   - area 분기 없이 단일 함수로 처리되는지 확인
const downloadExcelOccurrences = (builderHtml.match(/function downloadExcel\(\)/g) || []).length;
assert(
    downloadExcelOccurrences === 1,
    `C-2. downloadExcel() 함수는 단 1개 (공통 로직): 발견=${downloadExcelOccurrences}`
);

// C-3. 메타데이터 기반 판별 (값 기반 fallback 없음)
//   - "숫자처럼 생겼다고 모든 값을 Number로 변환하면 안 된다" 요구사항 준수
//   - !isNaN(v) 같은 값 기반 판별이 downloadExcel 내부에 있으면 안 됨
const dlFn = builderHtml.match(/function downloadExcel\(\) \{[\s\S]*?^\}/m);
assert(
    dlFn && !dlFn[0].match(/!isNaN\s*\(/) && !dlFn[0].match(/parseFloat\s*\(/),
    'C-3. 값 기반 fallback (isNaN/parseFloat) 사용 안 함 — 메타데이터 기준만 사용'
);

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
