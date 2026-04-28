# module-profit SQL 스크립트

## 모듈 개요
- **모듈명**: module-profit
- **설명**: RAG 기반 수익성분석 AI 챗봇 모듈
- **DB**: MariaDB 10.11+ (utf8mb4 / utf8mb4_general_ci)

## 실행 순서

> ⚠️ **반드시 아래 순서대로 실행하세요.**

| 순서 | 파일명 | 설명 |
|------|--------|------|
| 1 | `01_schema.sql` | DDL - 테이블 8개 + 인덱스 + 제약조건 생성 |
| 2 | `02_seed_data.sql` | 초기 데이터 - Ontology/Metric/JOIN/배치/질의이력 샘플 |

## 실행 방법

```bash
# 1단계: DDL 실행
mysql -u {user} -p {database} < sql/module-profit/01_schema.sql

# 2단계: 초기 데이터 적재
mysql -u {user} -p {database} < sql/module-profit/02_seed_data.sql
```

## 생성되는 테이블 목록

| # | 테이블명 | 설명 | 주요 컬럼 |
|---|---------|------|----------|
| 1 | `profit_ontology_column` | Ontology 컬럼 마스터 | COLUMN_NAME, TABLE_NAME, COLUMN_GROUP |
| 2 | `profit_ontology_synonym` | Ontology 동의어 | SYNONYM_TEXT, ONTOLOGY_COLUMN_ID (FK) |
| 3 | `profit_metric` | Metric(계산 지표) 사전 | METRIC_CODE, AGGREGATION, FORMULA |
| 4 | `profit_metric_synonym` | Metric 동의어 | SYNONYM_TEXT, METRIC_ID (FK) |
| 5 | `profit_join_condition` | JOIN 조건 사전 | LEFT_COLUMN/TABLE, RIGHT_COLUMN/TABLE, JOIN_TYPE |
| 6 | `profit_nl_query_history` | 자연어 질의 이력 | NATURAL_QUERY, GENERATED_SQL, STATUS |
| 7 | `profit_batch_status` | 배치 상태 이력 | BATCH_NAME, STATUS, PERIOD_YEAR/MONTH |
| 8 | `profit_mapping_inbox` | 미매핑 용어 인박스 | UNMAPPED_TERM, TERM_TYPE, STATUS |

## 초기 데이터 요약

| 항목 | 건수 | 설명 |
|------|------|------|
| Ontology 컬럼 | 18건 | 기간(2), 조직/사업부(8), 자재/제품(4), 수량(4) |
| Ontology 동의어 | 약 35건 | 컬럼별 2~3개 한글 동의어 |
| Metric | 5건 | NETSALES, FG_COST, ET_COST, GROSS_PROFIT, OP_PROFIT |
| Metric 동의어 | 약 22건 | 지표별 3~5개 한글/영문 동의어 |
| JOIN 조건 | 2건 | PLANT(INNER), SALES_OFF(LEFT) |
| 배치 상태 | 3건 | 2026-03 완료(2건), 2026-04 대기(1건) |
| 질의 이력 | 3건 | 손익센터별 매출, 플랜트별 매출, 제품별 TOP 5 |

## 플랫폼 통합 시 수정 사항

이 모듈을 기존 플랫폼에 추가할 때 **아래 3곳만 수정**하면 됩니다:

1. **settings.gradle** → `include 'module-profit'` 추가
2. **app/build.gradle** → `implementation project(':module-profit')` 추가
3. **DB** → 위 SQL 스크립트 순서대로 실행

## 참고사항

- `ddl-auto=none` 설정이므로 테이블은 반드시 SQL 스크립트로 생성
- `PhysicalNamingStrategyStandardImpl` 적용 → @Table, @Column 이름이 DB에 그대로 반영
- `core_user` 테이블 참조 시 EntityManager 네이티브 쿼리 사용 (직접 JOIN 금지)
- 모든 API는 `/profit-api/` prefix 사용 → 기존 `/api/` 경로와 충돌 방지
