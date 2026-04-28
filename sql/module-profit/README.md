# module-profit SQL 스크립트

## 모듈 정보
- **모듈명**: module-profit
- **설명**: RAG 기반 수익성분석 AI 챗봇 모듈
- **DB**: MariaDB 10.11+ (utf8mb4)

## 실행 순서

| 순서 | 파일명 | 설명 |
|------|--------|------|
| 1 | `01_schema.sql` | DDL - 테이블 생성 (8개 테이블) |
| 2 | `02_seed_data.sql` | 초기 데이터 삽입 (Ontology, Metric, JOIN, 샘플 데이터) |

## 실행 방법

```bash
# 1. 스키마 생성
mysql -u [사용자] -p [DB명] < sql/module-profit/01_schema.sql

# 2. 초기 데이터 삽입
mysql -u [사용자] -p [DB명] < sql/module-profit/02_seed_data.sql
```

## 생성되는 테이블 목록

| 테이블명 | 설명 |
|----------|------|
| `profit_ontology_column` | Ontology 컬럼 (BW DB 컬럼 메타데이터) |
| `profit_ontology_synonym` | Ontology 동의어 (컬럼-자연어 매핑) |
| `profit_metric` | Metric 사전 (계산 지표 정의) |
| `profit_metric_synonym` | Metric 동의어 (Metric-자연어 매핑) |
| `profit_join_condition` | JOIN 조건 (테이블 간 연결 규칙) |
| `profit_nl_query_history` | 자연어 질의 이력 (학습 데이터) |
| `profit_batch_status` | 배치 상태 (SAP→BW 데이터 적재 이력) |
| `profit_mapping_inbox` | 매핑 인박스 (미매핑 용어 수집) |

## 주의사항
- `ddl-auto=none` 설정이므로 반드시 SQL 스크립트로 테이블을 생성해야 합니다
- `01_schema.sql`은 `CREATE TABLE IF NOT EXISTS`를 사용하므로 재실행 가능합니다
- `02_seed_data.sql`의 동의어 INSERT는 서브쿼리로 FK를 참조하므로 반드시 01 실행 후 실행하세요
- 테이블명은 소문자 snake_case, 컬럼명은 대문자 SNAKE_CASE 컨벤션을 따릅니다
