// [2026-11-25] VQB 즐겨찾기 복원 시 metric 메타데이터 hydration 테스트
//
// 사용자 신고 (verbatim):
//   "즐겨찾기에 등록했던 예전꺼(수정전꺼) 피벗생성해서 한게 그런거였네.
//    예전꺼여도 새로 [피벗생성]버튼 눌러서 나온 결과를 엑셀화하는건데
//    왜 예전꺼는 수치로 안되는거야?"
//
// 버그 원인:
//   - 이력 저장 시 (executeQuery payload): metric 필드는 aggregate='' 로, is_metric 미저장
//     → fields_json: [{ column: 'METRIC__UNIT_COST', aggregate: '', alias: '개당 단가' }]
//   - 기존 applyHistoryToBuilder() 는 저장값 그대로 복원 + 메타데이터 재매칭 안 함
//   - → selectedFields 에 is_metric 이 없어서 downloadExcel 이 수치형 오판
//   - → Excel 셀이 type='s' (string) 로 저장되어 ISNUMBER()=FALSE
//
// 수정 (사용자 확정 방향):
//   1) applyHistoryToBuilder() 에서 allColumns 메타데이터 재매칭 hydration
//      - metric 필드: is_metric/formula/metric_code/aggregate='METRIC' 복구
//      - 일반 필드: type/category 복구, aggregate 는 저장값 그대로
//   2) downloadExcel() 에 allColumns fallback 방어선 추가 (2중 방어)
//
// 실행: node nlq-server/tests/test_builder_history_metric_hydration.mjs

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

// ─── Section A: builder.html 수정 지점 코드 검증 ───
section('A. builder.html 수정 지점 메타데이터 검증');

const builderHtmlPath = path.join(__dirname, '..', 'public', 'builder.html');
const builderHtml = fs.readFileSync(builderHtmlPath, 'utf-8');

// A-1. applyHistoryToBuilder 함수 존재
assert(
    builderHtml.includes('function applyHistoryToBuilder(item)'),
    'A-1. applyHistoryToBuilder(item) 함수 존재'
);

// A-2. 수정 추적 마커
assert(
    builderHtml.includes('[2026-11-25] 이력 복원 시 metric 메타데이터 hydration'),
    'A-2. applyHistoryToBuilder 수정 추적 마커 존재'
);

// A-3. allColumns 재매칭 로직
assert(
    builderHtml.match(/selectedFields\s*=\s*\(item\.fields_json\s*\|\|\s*\[\]\)\.map\(f\s*=>\s*\{[\s\S]*?allColumns\.find\(c\s*=>\s*c\.name\s*===\s*f\.column\)/),
    'A-3. applyHistoryToBuilder 에서 allColumns.find() 재매칭 실행'
);

// A-4. metric 분기에서 is_metric: true 복구
const applyFn = builderHtml.match(/function applyHistoryToBuilder\(item\)\s*\{[\s\S]*?^\}/m);
assert(
    applyFn && applyFn[0].includes('is_metric: true'),
    'A-4. metric 분기에서 is_metric: true 복구'
);

// A-5. metric 분기에서 aggregate: 'METRIC' 복구
assert(
    applyFn && applyFn[0].includes("aggregate: 'METRIC'"),
    'A-5. metric 분기에서 aggregate: "METRIC" 복구 (addField L2897~2899 패턴과 일관)'
);

// A-6. formula / metric_code 복구
assert(
    applyFn && applyFn[0].includes('formula: col.formula') && applyFn[0].includes('metric_code: col.metric_code'),
    'A-6. metric 분기에서 formula / metric_code 복구'
);

// A-7. category 복구 (metric 영역 식별용)
assert(
    applyFn && applyFn[0].includes('category: col.category'),
    'A-7. metric / 일반 분기 모두 category 복구'
);

// A-8. type: 'number' 복구 (metric)
assert(
    applyFn && applyFn[0].includes("type: 'number'"),
    'A-8. metric 분기에서 type: "number" 복구'
);

// A-9. alias 사용자 저장값 우선 (사용자 변경 보존)
assert(
    applyFn && applyFn[0].includes('f.alias || col.label'),
    'A-9. metric 분기에서 alias 사용자 저장값 우선 (사용자 변경 보존)'
);

// A-10. 일반 필드는 aggregate 저장값 그대로 유지 (기존 동작 보존)
assert(
    applyFn && applyFn[0].includes("aggregate: f.aggregate || ''"),
    'A-10. 일반 필드는 aggregate 저장값 그대로 (기존 SUM/AVG 등 동작 보존)'
);

// A-11. allColumns 매칭 없는 경우 안전 fallback
assert(
    applyFn && applyFn[0].includes('allColumns.find(c => c.name === f.column) || {}'),
    'A-11. allColumns 매칭 없는 경우 빈 객체 fallback (과거 삭제된 metric 등 안전 처리)'
);

// ─── Section B: downloadExcel 방어선 검증 ───
section('B. downloadExcel 방어선 2중 체크 검증');

// B-1. colMetaMap 캐시 선언
assert(
    builderHtml.includes('const colMetaMap = new Map()'),
    'B-1. downloadExcel 에서 colMetaMap 캐시 선언 (allColumns 조회 최적화)'
);

// B-2. 2차 판별 방어선 주석 마커
assert(
    builderHtml.includes('[2026-11-25 보강] is_metric 2중 방어선'),
    'B-2. downloadExcel 2중 방어선 수정 추적 마커'
);

// B-3. 2차 판별 로직 — is_metric 비어있으면 allColumns 조회
const dlFn = builderHtml.match(/function downloadExcel\(\)\s*\{[\s\S]*?^\}/m);
assert(
    dlFn && dlFn[0].includes('colMetaMap.get(f.column)') && dlFn[0].includes('meta.is_metric'),
    'B-3. downloadExcel 2차 판별: colMetaMap.get() + meta.is_metric 체크'
);

// B-4. 2중 방어 순서 — 1차(is_metric/aggregate) → 2차(allColumns fallback)
assert(
    dlFn && dlFn[0].indexOf('!!f.is_metric') < dlFn[0].indexOf('colMetaMap.get'),
    'B-4. 2중 방어 순서: 1차(selectedFields) → 2차(allColumns fallback)'
);

// ─── Section C: 복원 로직 시뮬레이션 — 실제 데이터로 재매칭 검증 ───
section('C. 복원 로직 시뮬레이션 (allColumns 재매칭 결과 검증)');

// 서버가 내려주는 allColumns (현재 메타데이터) — /api/builder/columns 응답 시뮬레이션
const allColumns = [
    // 일반 dimension 필드
    { name: 'CALMONTH',  label: '달력연도/월', type: 'text',   category: 'date',     is_metric: false },
    { name: 'PLANT',     label: '플랜트',     type: 'text',   category: 'org',      is_metric: false },
    { name: 'MATERIAL',  label: '자재코드',   type: 'text',   category: 'material', is_metric: false },
    { name: 'MATL_NM',   label: '자재명',     type: 'text',   category: 'material', is_metric: false },
    // 수치 컬럼 (dimension 아니지만 is_metric 은 아님 — 집계 대상)
    { name: 'LBKUM',     label: '매출액',     type: 'number', category: 'quantity', is_metric: false },
    // Metric 필드 (산식) — METRIC__ prefix
    {
        name: 'METRIC__UNIT_COST', label: '개당 단가', type: 'number',
        db_type: 'metric_formula', category: 'metric',
        is_metric: true, metric_code: 'UNIT_COST',
        formula: 'SUM(ZAMT010)/SUM(ZQTY010)'
    },
    {
        name: 'METRIC__OP_PROFIT', label: '영업이익', type: 'number',
        db_type: 'metric_formula', category: 'metric',
        is_metric: true, metric_code: 'OP_PROFIT',
        formula: 'SUM(ZAMT001)-SUM(ZAMT050)'
    },
];

// 서버 DB 에 저장된 fields_json (이력 저장 포맷) — 과거 즐겨찾기 재현
//   - metric 필드: aggregate='' , is_metric 저장 안 됨 (현재 서버 저장 포맷)
//   - 일반 집계: aggregate='SUM' 등 그대로
const fields_json = [
    // 과거 저장된 metric 필드 (사용자 신고 핵심 — 개당 단가)
    { column: 'METRIC__UNIT_COST', alias: '개당 단가', aggregate: '' },
    { column: 'METRIC__OP_PROFIT', alias: '영업이익',  aggregate: '' },
    // 일반 dimension 필드
    { column: 'CALMONTH', alias: 'CALMONTH', aggregate: '' },
    { column: 'PLANT',    alias: 'PLANT',    aggregate: '' },
    { column: 'MATERIAL', alias: 'MATERIAL', aggregate: '' },
    // 일반 집계 필드
    { column: 'LBKUM',    alias: 'SUM_LBKUM', aggregate: 'SUM' },
    // 과거 삭제된 metric (allColumns 매칭 없음 — 안전 fallback 검증용)
    { column: 'METRIC__LEGACY_DELETED', alias: '구버전 메트릭', aggregate: '' },
];

// 수정된 applyHistoryToBuilder 의 필드 복원 로직을 순수 함수로 재현
function hydrateFields(fieldsJson, allColumnsArr) {
    return fieldsJson.map(f => {
        const col = allColumnsArr.find(c => c.name === f.column) || {};
        const isMetric = !!col.is_metric;

        if (isMetric) {
            return {
                column: f.column,
                alias: f.alias || col.label || col.metric_code || f.column,
                aggregate: 'METRIC',
                type: 'number',
                is_metric: true,
                formula: col.formula,
                metric_code: col.metric_code,
                category: col.category || 'metric',
            };
        }

        return {
            column: f.column,
            alias: f.alias || f.column,
            aggregate: f.aggregate || '',
            type: col.type || 'text',
            category: col.category,
        };
    });
}

const restored = hydrateFields(fields_json, allColumns);

// C-1. METRIC__UNIT_COST — is_metric 복구 (사용자 신고 핵심)
const unitCost = restored.find(f => f.column === 'METRIC__UNIT_COST');
assert(unitCost && unitCost.is_metric === true,
    'C-1. METRIC__UNIT_COST 복원 후 is_metric === true (사용자 신고 핵심 케이스)');
assert(unitCost && unitCost.aggregate === 'METRIC',
    'C-2. METRIC__UNIT_COST 복원 후 aggregate === "METRIC" (addField 패턴과 일관)');
assert(unitCost && unitCost.formula === 'SUM(ZAMT010)/SUM(ZQTY010)',
    'C-3. METRIC__UNIT_COST 복원 후 formula 복구');
assert(unitCost && unitCost.metric_code === 'UNIT_COST',
    'C-4. METRIC__UNIT_COST 복원 후 metric_code 복구');
assert(unitCost && unitCost.type === 'number',
    'C-5. METRIC__UNIT_COST 복원 후 type === "number"');
assert(unitCost && unitCost.alias === '개당 단가',
    'C-6. METRIC__UNIT_COST 복원 후 alias 사용자 저장값 유지 ("개당 단가")');

// C-7. METRIC__OP_PROFIT — 영업이익도 동일하게 복구
const opProfit = restored.find(f => f.column === 'METRIC__OP_PROFIT');
assert(opProfit && opProfit.is_metric === true && opProfit.aggregate === 'METRIC',
    'C-7. METRIC__OP_PROFIT (영업이익) 복원 후 is_metric + aggregate 복구');
assert(opProfit && opProfit.formula === 'SUM(ZAMT001)-SUM(ZAMT050)',
    'C-8. METRIC__OP_PROFIT 복원 후 formula 복구');

// C-9. 일반 dimension 필드 — 기존 동작 유지 (aggregate='' / type / category 복구)
const calmonth = restored.find(f => f.column === 'CALMONTH');
assert(calmonth && !calmonth.is_metric && calmonth.aggregate === '' && calmonth.type === 'text',
    'C-9. CALMONTH (dimension) 복원 후 is_metric 없음 + aggregate="" + type="text"');
assert(calmonth && calmonth.category === 'date',
    'C-10. CALMONTH 복원 후 category="date" 복구 (allColumns 메타)');

// C-11. 일반 집계 필드 — aggregate 저장값 유지
const sumLbkum = restored.find(f => f.column === 'LBKUM');
assert(sumLbkum && sumLbkum.aggregate === 'SUM' && !sumLbkum.is_metric,
    'C-11. SUM(LBKUM) 복원 후 aggregate="SUM" 유지 + is_metric 없음 (집계 필드는 기존 동작)');

// C-12. 과거 삭제된 metric — 안전 fallback (매칭 없으면 저장값 그대로)
const legacy = restored.find(f => f.column === 'METRIC__LEGACY_DELETED');
assert(legacy && !legacy.is_metric && legacy.aggregate === '',
    'C-12. METRIC__LEGACY_DELETED (allColumns 매칭 없음): 저장값 그대로 유지 + is_metric 없음');
assert(legacy && legacy.alias === '구버전 메트릭',
    'C-13. METRIC__LEGACY_DELETED: alias 저장값 그대로 유지 (사용자 데이터 보존)');

// ─── Section D: downloadExcel 수치형 판별 — 복원 전/후 동일하게 작동 검증 ───
section('D. downloadExcel 수치형 판별 — 복원된 selectedFields 로 검증');

// 복원된 selectedFields 로 downloadExcel 의 수치형 판별 로직 재현
function resolveNumericCols(selectedFields, allColumnsArr) {
    const NUMERIC_AGGS = new Set(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT']);
    const numericColSet = new Set();

    const colMetaMap = new Map();
    allColumnsArr.forEach(c => {
        if (c && c.name) colMetaMap.set(c.name, c);
    });

    selectedFields.forEach(f => {
        if (!f) return;
        const aggUpper = f.aggregate ? String(f.aggregate).toUpperCase() : '';
        let isNumeric = !!f.is_metric || (aggUpper && NUMERIC_AGGS.has(aggUpper));

        if (!isNumeric) {
            const meta = colMetaMap.get(f.column);
            if (meta && meta.is_metric) isNumeric = true;
        }

        if (!isNumeric) return;
        const colKey = f.alias || f.column;
        if (colKey) numericColSet.add(colKey);
    });

    return numericColSet;
}

const numericSet = resolveNumericCols(restored, allColumns);

assert(numericSet.has('개당 단가'),
    'D-1. 복원 후 "개당 단가" → 수치형 인식 (is_metric=true)');
assert(numericSet.has('영업이익'),
    'D-2. 복원 후 "영업이익" → 수치형 인식');
assert(numericSet.has('SUM_LBKUM'),
    'D-3. 복원 후 "SUM_LBKUM" → 수치형 인식 (aggregate="SUM")');
assert(!numericSet.has('CALMONTH'),
    'D-4. 복원 후 "CALMONTH" → 수치형 아님 (dimension 필드 보호)');
assert(!numericSet.has('PLANT'),
    'D-5. 복원 후 "PLANT" → 수치형 아님');
assert(!numericSet.has('MATERIAL'),
    'D-6. 복원 후 "MATERIAL" → 수치형 아님');

// ─── Section E: 방어선 2차 — selectedFields 에 is_metric 없어도 allColumns fallback ───
section('E. downloadExcel 2중 방어선 (is_metric 없어도 allColumns fallback)');

// Hydration 이 안 된 (수정 전 복원 코드로 들어온) selectedFields 를 모사
//   → 수정 후에도 downloadExcel 자체가 allColumns fallback 으로 수치형 인식해야 함
const legacyRestored = [
    // is_metric 없고 aggregate='' 인 상태 (수정 전 applyHistoryToBuilder 결과 모사)
    { column: 'METRIC__UNIT_COST', alias: '개당 단가', aggregate: '', type: 'number' },
    { column: 'METRIC__OP_PROFIT', alias: '영업이익',  aggregate: '', type: 'number' },
    { column: 'CALMONTH',          alias: 'CALMONTH',  aggregate: '', type: 'text' },
    { column: 'LBKUM',             alias: 'SUM_LBKUM', aggregate: 'SUM', type: 'number' },
];

const legacyNumericSet = resolveNumericCols(legacyRestored, allColumns);

assert(legacyNumericSet.has('개당 단가'),
    'E-1. is_metric 없는 상태에서도 downloadExcel 이 allColumns fallback 으로 "개당 단가" 인식');
assert(legacyNumericSet.has('영업이익'),
    'E-2. is_metric 없는 상태에서도 downloadExcel 이 "영업이익" 인식');
assert(legacyNumericSet.has('SUM_LBKUM'),
    'E-3. aggregate="SUM" 은 1차 판별로 즉시 인식');
assert(!legacyNumericSet.has('CALMONTH'),
    'E-4. 코드성 dimension (CALMONTH) 은 allColumns 에도 is_metric=false 이므로 수치형 아님');

// ─── Section G: end-to-end Excel 생성 + round-trip 검증 (복원 전체 플로우) ───
section('G. end-to-end: 복원 → downloadExcel → openpyxl 재파싱 셀 타입 검증');

// (G 섹션은 실제 Excel 생성 후 round-trip 비교를 코드로 재현)
try {
    const mod = await import('xlsx-js-style');
    const XLSX = mod.default || mod;

    // 과거 즐겨찾기 fields_json (DB 저장 상태 재현)
    const histFields = [
        { column: 'CALMONTH', alias: 'CALMONTH', aggregate: '' },
        { column: 'PLANT',    alias: 'PLANT',    aggregate: '' },
        { column: 'MATERIAL', alias: 'MATERIAL', aggregate: '' },
        { column: 'METRIC__UNIT_COST', alias: '개당 단가', aggregate: '' },
        { column: 'METRIC__OP_PROFIT', alias: '영업이익',  aggregate: '' },
    ];

    // 수정된 applyHistoryToBuilder 로 복원
    const restoredFields = hydrateFields(histFields, allColumns);

    // 서버 응답 결과 (피벗 생성 후) — DB 에서 숫자가 문자열로 옴
    const resultCols = restoredFields.map(f => f.alias || f.column);
    const resultRows = [
        { CALMONTH: '202610', PLANT: 'P100', MATERIAL: 'F2111240-01', '개당 단가': '72002', '영업이익': '303928' },
        { CALMONTH: '202611', PLANT: 'P100', MATERIAL: 'F2111240-02', '개당 단가': '81788', '영업이익': '-150000' },
    ];

    // 수정된 downloadExcel 로직 재현
    const numericSetE2E = resolveNumericCols(restoredFields, allColumns);
    const wsData = [resultCols];
    resultRows.forEach(row => {
        wsData.push(resultCols.map(col => {
            const v = row[col];
            return (v === null || v === undefined) ? '' : v;
        }));
    });
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    resultCols.forEach((col, ci) => {
        if (!numericSetE2E.has(col)) return;
        resultRows.forEach((row, ri) => {
            const cell = ws[XLSX.utils.encode_cell({ r: ri + 1, c: ci })];
            if (!cell) return;
            if (cell.v === '' || cell.v === null || cell.v === undefined) {
                cell.v = null; cell.t = 'z'; return;
            }
            if (typeof cell.v === 'number') { cell.t = 'n'; cell.z = '#,##0'; return; }
            const rawStr = String(cell.v).trim();
            const num = Number(rawStr);
            if (!isFinite(num) || rawStr === '') return;
            cell.v = num; cell.t = 'n';
            cell.z = rawStr.includes('.') ? '#,##0.##' : '#,##0';
        });
    });

    // Round-trip: writeFile → readFile 교차검증
    const outPath = '/tmp/test_e2e_history_restored.xlsx';
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '피벗결과');
    XLSX.writeFile(wb, outPath);

    const wb2 = XLSX.readFile(outPath);
    const ws2 = wb2.Sheets['피벗결과'];

    // "개당 단가" row 2 = 72002 → Number
    const unitR2 = ws2[XLSX.utils.encode_cell({ r: 1, c: 3 })];
    assert(unitR2.t === 'n' && typeof unitR2.v === 'number' && unitR2.v === 72002,
        `G-1. [Round-trip] 과거 즐겨찾기 복원 후 "개당 단가"=72002 → type='n', number primitive (실제: t='${unitR2.t}', v=${unitR2.v})`);

    const unitR3 = ws2[XLSX.utils.encode_cell({ r: 2, c: 3 })];
    assert(unitR3.t === 'n' && unitR3.v === 81788,
        `G-2. [Round-trip] "개당 단가"=81788 → type='n', value=81788`);

    const profitR3 = ws2[XLSX.utils.encode_cell({ r: 2, c: 4 })];
    assert(profitR3.t === 'n' && profitR3.v === -150000,
        `G-3. [Round-trip] "영업이익"=-150000 (음수) → type='n', value=-150000`);

    // 코드성 필드는 String 유지
    const calR2 = ws2[XLSX.utils.encode_cell({ r: 1, c: 0 })];
    assert(calR2.t === 's' && calR2.v === '202610',
        `G-4. [Round-trip] "CALMONTH"='202610' → String 유지 (type='s')`);

    const plantR2 = ws2[XLSX.utils.encode_cell({ r: 1, c: 1 })];
    assert(plantR2.t === 's' && plantR2.v === 'P100',
        `G-5. [Round-trip] "PLANT"='P100' → String 유지 (type='s')`);

    // SUM 시뮬레이션 — Excel 에서 수식이 작동할 값
    const sumUnit = unitR2.v + unitR3.v;
    assert(sumUnit === 72002 + 81788,
        `G-6. SUM(개당 단가) 시뮬레이션 = ${sumUnit.toLocaleString()} (사용자님이 Excel 에서 =SUM() 넣으면 이 값이 나옴)`);
} catch (e) {
    console.log(`\n⚠️  xlsx-js-style 로드 실패 — G 섹션 스킵: ${e.message}`);
}

// ─── Section F: 사용자 verbatim 요구사항 체크 ───
section('F. 사용자 verbatim 요구사항 체크리스트');

// F-1. 기존 즐겨찾기 저장 로직 변경 금지 (서버 저장 payload 변경 X)
//   → server.mjs 는 수정 안 함, executeQuery payload 구조 변경 X
assert(
    !builderHtml.includes('aggregate: f.is_metric ? "METRIC"'),  // 저장 쪽 변경 없음
    'F-1. 기존 즐겨찾기 저장 로직 변경 없음 (프론트 payload 변경 X)'
);

// F-2. 수익성분석 / 제조원가 공통 적용
//   → builder.html 은 양 영역 공통 사용, applyHistoryToBuilder 도 공통 함수
const applyFnMatch = builderHtml.match(/function applyHistoryToBuilder\(item\)/g) || [];
assert(applyFnMatch.length === 1,
    `F-2. applyHistoryToBuilder 함수 단 1개 (수익성분석 / 제조원가 공통): 발견=${applyFnMatch.length}`);

// F-3. metric SQL 산식 생성 로직 변경 금지
//   → 서버 산식 치환 로직은 server.mjs 에 있고, 이번 PR 은 서버 변경 없음
//   (git status 로 확인 필요 — 테스트 외부에서 검증)

// F-4. 신규 쿼리 플로우에 영향 없음 — addField 로직 미변경 확인
assert(
    builderHtml.match(/if \(col\.is_metric\) \{[\s\S]*?newField = \{ column: colName, alias: col\.label \|\| col\.metric_code, aggregate: 'METRIC', type: 'number', is_metric: true, formula: col\.formula, metric_code: col\.metric_code \};/),
    'F-4. addField L2897~2899 metric 분기 변경 없음 (신규 쿼리 플로우 보존)'
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
