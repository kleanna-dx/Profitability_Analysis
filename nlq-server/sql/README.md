# SQL 마이그레이션 스크립트

## 실행 순서

```bash
# 1. 데이터베이스 생성 (root 권한)
mysql -u root -p < 000_create_database.sql

# 2. 테이블 생성 (순서대로 실행)
mysql -u appuser -p company_board < 001_create_bw_profitability_data.sql
mysql -u appuser -p company_board < 002_create_users.sql
mysql -u appuser -p company_board < 003_create_group_tables.sql
mysql -u appuser -p company_board < 004_create_learning_tables.sql
mysql -u appuser -p company_board < 005_create_history_tables.sql
mysql -u appuser -p company_board < 006_create_rag_embeddings.sql

# 3. 시드 데이터 (학습 초기 데이터)
mysql -u appuser -p company_board < 010_seed_learning_data.sql
```

## 파일 목록

| 파일 | 설명 | 테이블 |
|------|------|--------|
| `000_create_database.sql` | DB + 사용자 생성 | - |
| `001_create_bw_profitability_data.sql` | BW 수익성분석 데이터 | `bw_profitability_data` |
| `002_create_users.sql` | 사용자 관리 | `users` |
| `003_create_group_tables.sql` | 그룹(조직) 정보 | `group_info`, `user_group_info` |
| `004_create_learning_tables.sql` | 학습 메타데이터 | `ontology_column`, `ontology_synonym`, `metric`, `metric_synonym`, `code_mapping`, `join_condition`, `sql_feedback` |
| `005_create_history_tables.sql` | 이력 관리 | `nl_query_history`, `builder_query_history` |
| `006_create_rag_embeddings.sql` | RAG 벡터 인덱스 | `rag_embeddings` |
| `010_seed_learning_data.sql` | 온톨로지/메트릭/동의어/조인 시드 | - |

## 전체 테이블 (14개)

| 테이블 | 행수 (참고) | 비고 |
|--------|-------------|------|
| `bw_profitability_data` | ~588,919 | 핵심 실적 데이터 (대용량, 별도 이관 필요) |
| `users` | ~8 | 시스템 사용자 |
| `group_info` | ~151 | 그룹웨어 조직 (API 연동) |
| `user_group_info` | ~606 | 유저-그룹 매핑 (API 연동) |
| `ontology_column` | ~110 | 컬럼 사전 |
| `ontology_synonym` | ~60 | 컬럼 동의어 |
| `metric` | ~19 | 계산지표 사전 |
| `metric_synonym` | ~28 | 지표 동의어 |
| `code_mapping` | ~26 | 코드-명칭 매핑 |
| `join_condition` | ~3 | 조인 조건 |
| `sql_feedback` | ~24 | SQL 피드백 학습 |
| `nl_query_history` | 가변 | NLQ 질의 이력 |
| `builder_query_history` | 가변 | 빌더 쿼리 이력 |
| `rag_embeddings` | ~260 | RAG 벡터 (서버 시작 시 자동 빌드) |

## 참고

- 모든 DDL은 `CREATE TABLE IF NOT EXISTS` 사용 — 재실행 안전
- 시드 데이터는 `INSERT IGNORE` 사용 — 재실행 시 중복 무시
- `rag_embeddings`는 서버 시작 시 자동 생성/빌드됨 (수동 생성도 가능)
- `bw_profitability_data` 데이터는 별도 dump/import 필요 (약 58만 행)
