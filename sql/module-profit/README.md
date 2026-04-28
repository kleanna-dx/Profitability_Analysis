# module-profit SQL 스크립트

## RAG 기반 수익성분석 AI 챗봇 모듈

### 실행 순서

| 순서 | 파일명 | 설명 |
|------|--------|------|
| 1 | `01_schema.sql` | DDL - 테이블 생성 (8개 테이블) |
| 2 | `02_seed_data.sql` | 초기 데이터 - Ontology, Metric, JOIN, 샘플 데이터 |

### 실행 방법

```sql
-- 1. 스키마 생성
source /path/to/sql/module-profit/01_schema.sql;

-- 2. 초기 데이터 적재
source /path/to/sql/module-profit/02_seed_data.sql;
```

### 생성되는 테이블 목록

| 테이블명 | 설명 |
|----------|------|
| `profit_ontology_column` | Ontology 컬럼 마스터 (BW DB 컬럼 메타데이터) |
| `profit_ontology_synonym` | Ontology 동의어 (컬럼↔자연어 매핑) |
| `profit_metric` | Metric 계산지표 마스터 (수식 정의) |
| `profit_metric_synonym` | Metric 동의어 (지표↔자연어 매핑) |
| `profit_join_condition` | JOIN 조건 정의 (테이블 간 연결 조건) |
| `profit_nl_query_history` | 자연어 질의 이력 (학습 데이터) |
| `profit_batch_status` | 배치 상태 관리 (SAP→BW ETL 추적) |
| `profit_mapping_inbox` | 매핑 인박스 (미매핑 용어 수집) |

### 초기 데이터 요약

- **Ontology 컬럼**: 30건 (기간 2 + 조직/사업부 8 + 자재/제품 8 + 금액 12)
- **Ontology 동의어**: 약 40건
- **Metric**: 8건 (순매출, 제품원가, 판관비, 매출총이익, 영업이익, 총매출, 총수량BAG, 총수량BOX)
- **Metric 동의어**: 약 21건
- **JOIN 조건**: 2건 (플랜트 조인, 매출 조인)
- **배치 상태 샘플**: 4건
- **질의 이력 샘플**: 5건
- **매핑 인박스 샘플**: 5건

### 주의사항

- MariaDB 10.11 이상 필요
- `utf8mb4_general_ci` 문자셋 사용
- `ddl-auto=none` 설정이므로 반드시 SQL 스크립트로 테이블 생성
- 기존 테이블이 있는 경우 `CREATE TABLE IF NOT EXISTS`로 안전하게 처리
- Seed Data의 `INSERT INTO ... SELECT` 구문은 Ontology 컬럼 ID를 동적으로 참조
