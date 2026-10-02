/**
 * test_vqb_business_area_history.mjs
 *
 * [2026-10-02] 비주얼 쿼리 빌더 쿼리 이력 업무영역(수익/제조) 복원 regression 방지 테스트
 *
 * 배경:
 *   사용자 신고 — 제조원가에서 만든 쿼리 이력을 수익성분석 영역에서 클릭하면
 *   제조원가 필드가 수익성분석 schema 로 조회되어 500 오류.
 *   원인: builder_query_history 에 business_area_code 가 저장되지 않았고,
 *          history 클릭 시 AreaTabs 를 전환하지 않고 그대로 쿼리 복원했음.
 *
 * 수정:
 *   - 서버: builder_query_history + shared_queries 에 business_area_code 컬럼 추가
 *          saveBuilderHistory() 시그니처에 businessAreaCode 파라미터 추가
 *          /api/builder/query 가 payload.area 를 PROFITABILITY/MANUFACTURING_COST 로 변환하여 저장
 *          GET /api/builder/history 조회 시 business_area_code 포함
 *   - 클라이언트: history list 에 [수익]/[제조] Badge 렌더 (자연어 질의와 동일 inline style)
 *                switchAreaForHistory() 신규 — AreaTabs 전환 + loadColumns 완료 await + lock
 *                restoreBuilderHistory() 복원 순서: area → domain → applyHistory
 *                newQueryBuilder() 에서 AreaTabs.unlock() 호출
 *                executeQuery() 에 필드 metadata validation (영역 불일치 시 alert + 중단)
 *                _inferBusinessAreaFromHistory() — 레거시 이력 fallback (SQL + 전용 필드 기반)
 *
 * 실행: node nlq-server/tests/test_vqb_business_area_history.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC = resolve(__dirname, '../public');
const SERVER_MJS = resolve(__dirname, '../server.mjs');
const BUILDER_HTML = resolve(PUBLIC, 'builder.html');
const INDEX_HTML = resolve(PUBLIC, 'index.html');

const serverSrc = readFileSync(SERVER_MJS, 'utf8');
const builderSrc = readFileSync(BUILDER_HTML, 'utf8');
const indexSrc = readFileSync(INDEX_HTML, 'utf8');

let PASS = 0, FAIL = 0;
const failures = [];
function assert(cond, name) {
    if (cond) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name); }
}
function assertMatch(src, re, name) {
    const ok = re.test(src);
    if (ok) { PASS++; } else { FAIL++; failures.push(name); console.log('FAIL:', name, '\n  regex:', re); }
}

// ============================================================
// A. 서버 DB 마이그레이션 — builder_query_history.business_area_code
// ============================================================
assertMatch(serverSrc,
    /ALTER TABLE builder_query_history ADD COLUMN business_area_code varchar\(32\) DEFAULT NULL/,
    'A-1: builder_query_history 에 business_area_code 컬럼 추가 ALTER 존재');
assertMatch(serverSrc,
    /business_area_code\s+varchar\(32\)[^`]*COMMENT\s+'업무영역/,
    'A-2: business_area_code 컬럼 COMMENT 에 "업무영역" 포함');
assertMatch(serverSrc,
    /ALTER TABLE builder_query_history ADD INDEX idx_business_area/,
    'A-3: business_area_code INDEX 추가');
assertMatch(serverSrc,
    /SELECT COLUMN_NAME FROM INFORMATION_SCHEMA\.COLUMNS[\s\S]{0,300}'business_area_code'/,
    'A-4: 마이그레이션 idempotent 체크 (SELECT 후 조건부 ALTER)');

// ============================================================
// B. 서버 saveBuilderHistory() 함수 시그니처 + 저장 로직
// ============================================================
assertMatch(serverSrc,
    /async function saveBuilderHistory\([^)]*,\s*domainCode,\s*businessAreaCode\s*\)/,
    'B-1: saveBuilderHistory() 시그니처 마지막에 businessAreaCode 파라미터');
assertMatch(serverSrc,
    /UPDATE builder_query_history SET[^']*business_area_code=\?/,
    'B-2: UPDATE 쿼리에 business_area_code 포함');
assertMatch(serverSrc,
    /INSERT INTO builder_query_history[^(]*\([^)]*business_area_code\)/,
    'B-3: INSERT 쿼리 컬럼 리스트에 business_area_code 포함');

// ============================================================
// C. /api/builder/query 호출 시 area → business_area_code 변환 + 저장
// ============================================================
assertMatch(serverSrc,
    /\(areaKey === 'manufacturing-cost'\)\s*\?\s*'MANUFACTURING_COST'[\s\S]{0,100}'PROFITABILITY'/,
    'C-1: areaKey → business_area_code 변환 로직 (manufacturing-cost → MANUFACTURING_COST, profitability → PROFITABILITY)');
assertMatch(serverSrc,
    /saveBuilderHistory\([^)]*,\s*_bacForSave\s*\)/,
    'C-2: 성공 저장 호출 시 _bacForSave 전달');
assertMatch(serverSrc,
    /saveBuilderHistory\([^)]*,\s*_bacForFail\s*\)/,
    'C-3: 실패 저장 호출 시 _bacForFail 전달');

// ============================================================
// D. GET /api/builder/history 응답에 business_area_code 포함
// ============================================================
assertMatch(serverSrc,
    /SELECT id, title, fields_json[\s\S]{0,500}business_area_code,\s*created_at[\s\S]{0,100}FROM builder_query_history WHERE user_id = \? AND is_bookmarked = 1/,
    'D-1: 즐겨찾기 탭 조회에 business_area_code 포함');
assertMatch(serverSrc,
    /SELECT id, title, fields_json[\s\S]{0,500}business_area_code,\s*created_at[\s\S]{0,100}FROM builder_query_history WHERE user_id = \? ORDER BY created_at DESC/,
    'D-2: 최근이력 탭 조회에 business_area_code 포함');

// ============================================================
// E. shared_queries 테이블 마이그레이션 + 공유 복사
// ============================================================
assertMatch(serverSrc,
    /ALTER TABLE shared_queries ADD COLUMN domain_code varchar\(20\)/,
    'E-1: shared_queries 에 domain_code 컬럼 추가 (복사 전제)');
assertMatch(serverSrc,
    /ALTER TABLE shared_queries ADD COLUMN business_area_code varchar\(32\)/,
    'E-2: shared_queries 에 business_area_code 컬럼 추가');
assertMatch(serverSrc,
    /INSERT INTO shared_queries[^(]*\([^)]*domain_code,\s*business_area_code\)/,
    'E-3: 공유 INSERT 에 domain_code + business_area_code 포함');
assertMatch(serverSrc,
    /src\.domain_code \|\| null,\s*src\.business_area_code \|\| null/,
    'E-4: 공유 INSERT 값으로 원본의 domain_code / business_area_code 복사');

// ============================================================
// F. 클라이언트 — [수익]/[제조] Badge 렌더링
// ============================================================
// F-1: _BAC_TO_AREA / _AREA_TO_BAC 매핑 상수 정의
assertMatch(builderSrc,
    /_BAC_TO_AREA\s*=\s*\{[\s\S]{0,200}'PROFITABILITY':\s*'profitability'[\s\S]{0,200}'MANUFACTURING_COST':\s*'manufacturing-cost'/,
    'F-1: _BAC_TO_AREA 매핑 상수 정의');

// F-2: Badge 색상 — 자연어 질의와 100% 동일한 inline style (background #885DF6 / #0373AE, color #ffffff, font-size 9px)
assertMatch(builderSrc,
    /background:\$\{bac==='PROFITABILITY'\?'#885DF6':'#0373AE'\};color:#ffffff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px/,
    'F-2: [수익]/[제조] Badge 가 자연어 질의와 완전히 동일한 inline style 재사용 (background/color/font-size/padding)');

// F-3: 자연어 질의와 동일한 Badge style 이 index.html 에도 그대로 존재 (regression source)
assertMatch(indexSrc,
    /background:\$\{bac==='PROFITABILITY'\?'#885DF6':'#0373AE'\};color:#ffffff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:4px/,
    'F-3: 자연어 질의 index.html 의 Badge style 이 원본대로 유지 (비주얼 쿼리 빌더가 재사용하는 레퍼런스)');

// F-4: 수익/제조 라벨 매핑
assertMatch(builderSrc,
    /bac === 'PROFITABILITY' \? '수익'\s*:\s*\(bac === 'MANUFACTURING_COST' \? '제조' : null\)/,
    'F-4: business_area_code → "수익" / "제조" 라벨 매핑');

// F-5: 공유 이력(shared tab) 에도 Badge 렌더
assertMatch(builderSrc,
    /areaBadge_s\s*=\s*_bacDisp_s[\s\S]{0,500}background:\$\{bac_s==='PROFITABILITY'\?'#885DF6':'#0373AE'\}/,
    'F-5: 공유 이력(shared) 렌더링에도 [수익]/[제조] Badge');

// ============================================================
// G. 레거시 이력 fallback (_inferBusinessAreaFromHistory)
// ============================================================
assertMatch(builderSrc,
    /function _inferBusinessAreaFromHistory\(item\)/,
    'G-1: _inferBusinessAreaFromHistory 함수 정의');
assertMatch(builderSrc,
    /sql\.includes\('sys_aimd_cot015'\)[\s\S]{0,100}return 'MANUFACTURING_COST'/,
    'G-2: generated_sql 에 sys_aimd_cot015 포함 시 MANUFACTURING_COST 추론');
assertMatch(builderSrc,
    /sql\.includes\('bw_profitability_data'\)[\s\S]{0,100}return 'PROFITABILITY'/,
    'G-3: generated_sql 에 bw_profitability_data 포함 시 PROFITABILITY 추론');
assertMatch(builderSrc,
    /MFG_EXCLUSIVE_FIELDS[\s\S]{0,200}'ZCGUBUN'[\s\S]{0,200}'ZZKVGR7'/,
    'G-4: 제조원가 전용 field (ZCGUBUN, ZZKVGR7 등) 기반 추론');
// 사용자 요구: 애매한 경우 임의 기본값 금지
assertMatch(builderSrc,
    /추론 불가 — 임의 기본값 사용 금지[\s\S]{0,100}return null/,
    'G-5: 추론 불가 시 null 반환 (사용자 요구: 임의 기본값 금지)');

// ============================================================
// H. switchAreaForHistory — history 복원 시 영역 전환 + lock
// ============================================================
assertMatch(builderSrc,
    /async function switchAreaForHistory\(targetBac\)/,
    'H-1: switchAreaForHistory 함수 정의');
// H-2~H-5: 복원 순서 (사용자 요구 Step 1~5)
assertMatch(builderSrc,
    /window\.AreaTabs\.unlock\(\)[\s\S]{0,200}window\.AreaTabs\.set\(targetAreaKey,\s*\{\s*force:\s*true\s*\}\)/,
    'H-2: unlock → set(force:true) 순서 (lock 상태의 confirm alert 회피)');
assertMatch(builderSrc,
    /window\.AreaTabs\.set\(targetAreaKey,[\s\S]{0,800}await loadColumns\(\)/,
    'H-3: AreaTabs.set 후 loadColumns() await (schema 로드 완료 대기 → race condition 방지)');
assertMatch(builderSrc,
    /switchAreaForHistory[\s\S]{0,3000}await loadColumns\(\)[\s\S]{0,1500}window\.AreaTabs\.lock\(\)/,
    'H-4: switchAreaForHistory 안에서 loadColumns 완료 후 lock (schema 준비 완료 상태에서 lock)');

// ============================================================
// I. restoreBuilderHistory — 전체 복원 순서 (area → domain → applyHistory)
// ============================================================
assertMatch(builderSrc,
    /async function restoreBuilderHistory\(id,\s*hintDomain,\s*hintAreaBac\)/,
    'I-1: restoreBuilderHistory() 시그니처에 hintAreaBac 추가');
// 복원 순서: area → domain → applyHistory
assertMatch(builderSrc,
    /await switchAreaForHistory\(_bacFinal\)[\s\S]{0,300}await switchDomainForHistory[\s\S]{0,300}applyHistoryToBuilder\(item\)/,
    'I-2: 복원 순서 — switchAreaForHistory → switchDomainForHistory → applyHistoryToBuilder');
assertMatch(builderSrc,
    /hintAreaBac \|\| item\.business_area_code \|\| _inferBusinessAreaFromHistory\(item\)/,
    'I-3: 영역 결정 우선순위 — hintAreaBac > item.business_area_code > fallback 추론');
// I-4: 공유 이력도 동일 순서
assertMatch(builderSrc,
    /await switchAreaForHistory\(_bacFinal\)[\s\S]{0,200}await switchDomainForHistory\(item\.domain_code\)[\s\S]{0,200}applyHistoryToBuilder\(item\)/,
    'I-4: restoreSharedHistory 도 동일 복원 순서');

// ============================================================
// J. newQueryBuilder — AreaTabs.unlock 호출
// ============================================================
assertMatch(builderSrc,
    /function newQueryBuilder\(\)\{[\s\S]{0,3000}window\.AreaTabs\.unlock\(\)[\s\S]{0,500}\}/,
    'J-1: newQueryBuilder() 안에서 AreaTabs.unlock() 호출 (history mode → new query mode 전환 시 영역 선택 가능)');
assertMatch(builderSrc,
    /newQueryBuilder[\s\S]{0,3000}document\.querySelectorAll\('\.history-item'\)\.forEach\(el => el\.classList\.remove\('active'\)\)/,
    'J-2: newQueryBuilder() 가 history-item active 표시 해제');

// ============================================================
// K. executeQuery — field metadata validation (영역 불일치 safeguard)
// ============================================================
assertMatch(builderSrc,
    /_activeArea = _currentBuilderArea\(\)[\s\S]{0,300}_availableColNames = new Set/,
    'K-1: executeQuery 시작에서 _currentBuilderArea + allColumns 수집');
assertMatch(builderSrc,
    /selectedFields[\s\S]{0,200}filter\(col => col && !_availableColNames\.has\(col\)\)/,
    'K-2: selectedFields 중 현재 영역 metadata 에 없는 field 검출');
assertMatch(builderSrc,
    /_invalidFields\.length > 0[\s\S]{0,800}alert\([\s\S]{0,500}return;/,
    'K-3: metadata 에 없는 field 있으면 alert + return (잘못된 영역 조회 차단)');

// ============================================================
// L. hintArg 전달 방식 — 사이드바 클릭 시 bac 전달
// ============================================================
assertMatch(builderSrc,
    /hintArg = `,\$\{dc \? `'\$\{dc\}'` : 'null'\},\$\{bac \? `'\$\{bac\}'` : 'null'\}`/,
    'L-1: hintArg 가 (dc, bac) 두 값을 모두 전달 (null 안전)');
assertMatch(builderSrc,
    /onclick="restoreBuilderHistory\(\$\{item\.id\}\$\{hintArg\}\)"/,
    'L-2: history item onclick 이 restoreBuilderHistory(id, hintDomain, hintAreaBac) 호출');

// ============================================================
// M. 자연어 질의 패턴과의 동질성 (regression 방지 — 둘이 동일한 패턴 유지)
// ============================================================
// nl: window.AreaTabs.set(_targetAreaKey, { force: true }) — index.html 7347
assertMatch(indexSrc,
    /window\.AreaTabs\.set\(_targetAreaKey,\s*\{\s*force:\s*true\s*\}\)/,
    'M-1: 자연어 질의가 AreaTabs.set(force:true) 패턴 그대로 유지');
assertMatch(indexSrc,
    /window\.AreaTabs\.unlock[\s\S]{0,500}window\.AreaTabs\.lock/,
    'M-2: 자연어 질의가 unlock → set → lock 패턴 그대로 유지 (비주얼 쿼리 빌더와 동일 패턴)');

// ============================================================
// 리포트
// ============================================================
console.log('');
console.log('==================================================');
console.log(`VQB BUSINESS AREA HISTORY TEST — PASS: ${PASS}, FAIL: ${FAIL}`);
console.log('==================================================');
if (FAIL > 0) {
    console.log('실패 케이스:');
    for (const f of failures) console.log('  -', f);
    process.exit(1);
}
