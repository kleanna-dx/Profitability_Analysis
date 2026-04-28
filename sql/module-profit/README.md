# module-profit SQL 설치 가이드

## 개요

**RAG 기반 수익성분석 AI 챗봇** 모듈의 데이터베이스 스키마 및 초기 데이터입니다.

| 항목 | 내용 |
|------|------|
| DB 엔진 | MariaDB 10.11+ |
| 문자셋 | utf8mb4 / utf8mb4_unicode_ci |
| 스토리지 | InnoDB |
| 네이밍 | 테이블: lower_snake_case / 컬럼: UPPER_SNAKE_CASE |
| JPA 매핑 | `PhysicalNamingStrategyStandardImpl` (ddl-auto=none) |

---

## 파일 구성

```
sql/module-profit/
├── 01_schema.sql              -- DDL: 모듈 테이블 8개, 인덱스, FK, UK
├── 02_seed_data.sql           -- 초기 사전 데이터 (Ontology, Metric, Join, 샘플 이력)
├── 03_bw_table_schema.sql     -- DDL: BW 수익성분석 원천 데이터 테이블 (120컬럼)
├── 04_bw_data_part01.sql      -- BW 데이터 INSERT (1~50,000행)
├── 04_bw_data_part02.sql      -- BW 데이터 INSERT (50,001~100,000행)
├── 04_bw_data_part03.sql      -- BW 데이터 INSERT (100,001~150,000행)
├── 04_bw_data_part04.sql      -- BW 데이터 INSERT (150,001~200,000행)
├── 04_bw_data_part05.sql      -- BW 데이터 INSERT (200,001~203,562행)
└── README.md                  -- 이 문서
```

---

## 테이블 목록 (8개)

| # | 테이블명 | 설명 | 엔티티 |
|---|---------|------|--------|
| 1 | `profit_ontology_column` | Ontology 컬럼 사전 (BW DB 컬럼 ↔ 자연어 매핑) | `OntologyColumn` |
| 2 | `profit_ontology_synonym` | Ontology 동의어 (컬럼당 N개 자연어 표현) | `OntologySynonym` |
| 3 | `profit_metric` | 계산 지표 사전 (수식 정의, AI가 참조) | `Metric` |
| 4 | `profit_metric_synonym` | Metric 동의어 (지표당 N개 자연어 표현) | `MetricSynonym` |
| 5 | `profit_join_condition` | JOIN 조건 사전 (테이블 간 연결 조건) | `JoinCondition` |
| 6 | `profit_nl_query_history` | 자연어 질의 이력 (질문→SQL→결과→피드백) | `NlQueryHistory` |
| 7 | `profit_batch_status` | 배치 실행 상태 (SAP 마감/적재/검증 추적) | `BatchStatus` |
| 8 | `profit_mapping_inbox` | 매핑 인박스 (미매핑 표현 수집→관리자 검수) | `MappingInbox` |

### ER 관계도 (핵심)

```
profit_ontology_column  1 ─── N  profit_ontology_synonym
profit_metric           1 ─── N  profit_metric_synonym

profit_nl_query_history  (독립, core_user 참조는 EntityManager 네이티브 쿼리)
profit_batch_status      (독립)
profit_join_condition    (독립)
profit_mapping_inbox     (독립, UK: UNMAPPED_TERM + TERM_TYPE)
```

---

## 실행 방법

### 1단계: 스키마 생성

```bash
# MariaDB CLI
mysql -u {user} -p {database} < sql/module-profit/01_schema.sql

# 또는 DBeaver, DataGrip 등 GUI 도구에서 실행
```

### 2단계: 초기 데이터 입력

```bash
mysql -u {user} -p {database} < sql/module-profit/02_seed_data.sql
```

### 3단계: 검증

```sql
-- 테이블 생성 확인
SHOW TABLES LIKE 'profit_%';

-- 시드 데이터 건수 확인
SELECT 'ontology_column'   AS tbl, COUNT(*) AS cnt FROM profit_ontology_column
UNION ALL
SELECT 'ontology_synonym',        COUNT(*)         FROM profit_ontology_synonym
UNION ALL
SELECT 'metric',                   COUNT(*)         FROM profit_metric
UNION ALL
SELECT 'metric_synonym',           COUNT(*)         FROM profit_metric_synonym
UNION ALL
SELECT 'join_condition',           COUNT(*)         FROM profit_join_condition
UNION ALL
SELECT 'nl_query_history',        COUNT(*)         FROM profit_nl_query_history
UNION ALL
SELECT 'batch_status',            COUNT(*)         FROM profit_batch_status
UNION ALL
SELECT 'mapping_inbox',           COUNT(*)         FROM profit_mapping_inbox;
```

**예상 건수:**

| 테이블 | 예상 건수 |
|--------|----------|
| ontology_column | 30 |
| ontology_synonym | ~80 |
| metric | 15 |
| metric_synonym | ~47 |
| join_condition | 2 |
| nl_query_history | 5 |
| batch_status | 7 |
| mapping_inbox | 12 |

---

## 플랫폼 통합 (3줄 수정)

### ① settings.gradle

```groovy
include 'module-profit'
```

### ② app/build.gradle

```groovy
dependencies {
    implementation project(':module-profit')
}
```

### ③ SQL 스크립트 실행

```bash
mysql -u {user} -p {database} < sql/module-profit/01_schema.sql
mysql -u {user} -p {database} < sql/module-profit/02_seed_data.sql
```

---

## 시드 데이터 상세

### Ontology Column (BW DB 컬럼 사전)

컬럼을 **그룹**별로 분류하여 관리합니다:

| 그룹 | 컬럼 예시 | 설명 |
|------|----------|------|
| 기간 | ZYEAR, ZMONTH, ZPERIOD, ZQUARTER | 회계연도/월/기간/분기 |
| 조직 | ZCOMP, ZPLANT, ZPROFIT_CTR, ZDIVISION | 회사/플랜트/손익센터/사업부 |
| 제품 | ZMATNR, ZBRAND, ZPROD_GRP, ZPROD_LINE | 자재번호/브랜드/제품군/라인 |
| 거래처 | ZCUSTOMER, ZCHANNEL, ZREGION | 거래처/유통채널/판매지역 |
| 금액 | ZAMT001~ZAMT008 | 총매출/할인/원가/에누리/판관비/물류비/광고비/R&D |
| 수량 | ZQTY_BOX, ZQTY_EA | BOX/EA 수량 |
| 마스터 | ZMAKTX, ZBRAND_NM, ZCUST_NM 등 | 자재/거래처 마스터 텍스트 |

### Metric (계산 지표 사전)

AI가 **수식을 창작하지 않고** 이 사전만 참조하여 SQL을 생성합니다:

| 코드 | 지표명 | 수식 |
|------|--------|------|
| GROSS_SALES | 총매출 | `SUM(ZAMT001)` |
| NET_SALES | 순매출 | `SUM(ZAMT001) - SUM(ZAMT002) - SUM(ZAMT004)` |
| COGS | 매출원가 | `SUM(ZAMT003)` |
| GROSS_PROFIT | 매출총이익 | 순매출 - 매출원가 |
| GP_RATE | 매출총이익률 | 매출총이익 / 순매출 × 100 |
| OPER_PROFIT | 영업이익 | 매출총이익 - 판관비 |
| OP_RATE | 영업이익률 | 영업이익 / 순매출 × 100 |
| CONTRIB_MARGIN | 공헌이익 | 매출총이익 - 물류비 |
| AVG_PRICE | 평균단가 | 총매출 / BOX수량 |

### JOIN Condition (연결 조건)

| 좌측 테이블 | 우측 테이블 | 조인 키 | 유형 |
|------------|-----------|---------|------|
| BW.ZFICO_T01 | BW.ZFICO_M01 | ZMATNR | LEFT |
| BW.ZFICO_T01 | BW.ZFICO_M02 | ZCUSTOMER | LEFT |

---

## BW 수익성분석 원천 데이터 테이블

### 테이블: `bw_profitability_data`

SAP BW에서 마감 후 적재되는 수익성분석 원천 데이터입니다.

| 항목 | 내용 |
|------|------|
| 원본 파일 | test3.xlsb |
| 총 컬럼 수 | 120개 (+ ID, CREATED_AT) |
| 총 데이터 행 | 203,562행 |
| 파일 분할 | 5개 파트 (50,000행 단위) |
| 총 용량 | ~142MB |

### 컬럼 구성 (120개)

| 그룹 | 컬럼 | 설명 |
|------|------|------|
| 기간 | CALMONTH, CALDAY | 달력연도/월, 달력일 |
| 조직 | CO_AREA, PROFIT_CTR, DIVISION, PLANT, DISTR_CHAN, SALES_OFF | 관리회계영역/손익센터/제품군/플랜트/유통경로/사업장 |
| 내수/수출 | ZDISTCHAN, ZORG_TEAM | 내수/수출구분, 영업팀 |
| 자재 | MATL_TYPE, MATERIAL, MATERIAL_NM | 자재유형/자재번호/자재명 |
| 제품계층 | PRODH1~PRODH4, ZJPCODE, ZBRAND, ZSBRAND | 제품계층구조 4레벨/지종/브랜드1,2 |
| 거래 | BILL_TYPE, INCOTERMS, CUST_GROUP, CUST_GRP1, COUNTRY | 대금청구유형/인도조건/고객그룹/국가 |
| 고객/영업 | ZKUNN2, CUSTOMER | 영업사원/고객 |
| 단위 | ZBOXUNIT, ZBAGUNIT, ZUNIT, CURRENCY | BOX/BAG/KG-EA 단위, 통화 |
| 수량 | ZQTY_BOX, ZQTY_BAG, ZQTY_KE | BOX/BAG/KG-EA 수량 |
| 금액 | ZAMT001~ZAMT064 | 총매출~경상이익 (64개 계정) |

### BW 데이터 실행 방법

```bash
# 1단계: BW 테이블 생성
mysql -u {user} -p {database} < sql/module-profit/03_bw_table_schema.sql

# 2단계: 데이터 적재 (순서대로 실행)
mysql -u {user} -p {database} < sql/module-profit/04_bw_data_part01.sql
mysql -u {user} -p {database} < sql/module-profit/04_bw_data_part02.sql
mysql -u {user} -p {database} < sql/module-profit/04_bw_data_part03.sql
mysql -u {user} -p {database} < sql/module-profit/04_bw_data_part04.sql
mysql -u {user} -p {database} < sql/module-profit/04_bw_data_part05.sql

# 3단계: 검증
mysql -u {user} -p {database} -e "SELECT COUNT(*) FROM bw_profitability_data;"
# 예상 결과: 203,562
```

---

## 주의사항

1. **ddl-auto=none**: JPA가 스키마를 자동 생성/수정하지 않으므로, 스키마 변경 시 반드시 SQL 스크립트를 먼저 실행해야 합니다.
2. **PhysicalNamingStrategyStandardImpl**: `@Table`/`@Column`에 명시된 이름이 그대로 DB에 매핑됩니다.
3. **core 모듈 미수정**: `core_user` 테이블 참조가 필요한 경우 `EntityManager` 네이티브 쿼리를 사용합니다 (직접 FK 참조 없음).
4. **시드 데이터 멱등성**: `INSERT INTO`를 사용하므로, 기존 데이터가 있는 환경에서는 중복 에러가 발생할 수 있습니다. 초기 설정 시에만 실행하세요.
5. **MariaDB 10.11+**: `CURRENT_TIMESTAMP` DEFAULT, `TEXT` 타입 등 MariaDB 10.11 이상 기능을 사용합니다.

---

## API 엔드포인트 요약

모든 API는 `/profit-api/` 접두사를 사용합니다:

| API 그룹 | Base Path | 주요 기능 |
|----------|-----------|----------|
| 대시보드 | `/profit-api/dashboard` | 통합 현황 조회 |
| Ontology | `/profit-api/ontology` | 컬럼 사전 CRUD, 동의어 관리 |
| Metric | `/profit-api/metrics` | 지표 사전 CRUD, 동의어 관리 |
| JOIN | `/profit-api/joins` | JOIN 조건 CRUD |
| 질의 | `/profit-api/queries` | 자연어 질의 실행, 이력, 북마크, 피드백 |
| 배치 | `/profit-api/batches` | 배치 상태 관리 (등록/시작/완료/실패) |
| 매핑 인박스 | `/profit-api/mapping-inbox` | 미매핑 표현 관리 (신고/승인/거절) |
