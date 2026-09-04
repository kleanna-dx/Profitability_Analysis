# 수익성분석 AI 챗봇 (NLQ Server)

## 프로젝트 개요
- **이름**: 수익성분석 AI 챗봇
- **목표**: 자연어 질문을 MariaDB SQL로 변환하여 BW 수익성분석 데이터를 조회·시각화
- **AI 모델**: GPT-5-mini (via OpenAI API proxy)
- **핵심 기술**: RAG (Retrieval-Augmented Generation) 기반 메타데이터 검색으로 정확한 SQL 생성

## URL
- **Production**: https://analytics.kleannara.com

## 주요 기능

### ✅ 구현 완료
1. **자연어 질의 (NLQ)** — 한국어 질문 → SQL 자동 생성 → 결과 테이블/차트
2. **RAG 기반 프롬프트** — 178개 메타데이터 청크(스키마/온톨로지/메트릭/코드매핑/피드백/규칙)에서 질문 관련 컨텍스트만 검색하여 프롬프트에 주입
3. **학습 데이터 매칭** — sql_feedback 테이블에 저장된 검증 SQL을 정확 매칭하여 AI 호출 없이 즉시 응답
4. **SQL 피드백 루프** — 사용자가 '정확해요' 또는 'SQL 수정하기'로 학습 데이터 축적
5. **천단위 콤마 포맷팅** — FORMAT(SUM(...), 0)으로 금액 표시, ORDER BY에는 원본 집계식 사용
6. **차트 자동 추천** — bar(카테고리 비교), line(시계열), pie(비율), table(상세)
7. **코드값 매핑** — CASE WHEN 구문으로 코드→명칭 변환 (PLANT, PRODH1, DISTR_CHAN 등)
8. **학습 관리 UI** — 온톨로지/메트릭/조인/코드매핑 CRUD + 동의어 관리
9. **PPT 보고서 생성** — Python(python-pptx)으로 수익성분석 보고서 자동 생성
10. **질의 이력 관리** — 모든 질의/결과를 DB에 저장, 사이드바에서 재조회
11. **DB 성능 인덱스** — PLANT, DIVISION, PRODH1, DISTR_CHAN 등 7개 인덱스 추가
12. **인터페이스 관리** — SAP RFC 호출을 통한 데이터 적재 (수익성 · 제조원가)
    - **NLP_RFC_001 수익성분석 RFC** (`Z_BI_WEB_EX_BL`) → `bw_profitability_data` 적재
    - **NLP_RFC_002 제조원가 RFC** (`Z_BI_WEB_EX_BL_4`) → `sys_aimd_cot015` 적재 [PR #329]
    - I_CMONTH(YYYYMM) 파라미터 · CALMONTH 검증 · 트랜잭션 DELETE+INSERT 재적재 · NO_DATA 상태 구분
    - 인터페이스 수행관리(batch_schedule) + 이력관리(batch_jobs) 통합
    - 이력 상세에 실제 실행 함수명(rfc_name) 표시

### 🚧 향후 개선 예정
- 비주얼 쿼리 빌더 (드래그&드롭 방식 SQL 생성)
- 멀티턴 대화 컨텍스트 유지
- 사용자 인증/권한 관리
- PPT 보고서 커스텀 템플릿

## API 엔드포인트 요약

### NLQ (자연어 질의)
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/nlq` | 자연어 → SQL 변환 및 실행 |
| POST | `/api/execute-sql` | SQL 직접 실행 (SELECT만) |
| GET | `/api/suggestions` | 추천 질의 목록 |
| GET | `/api/status` | DB/AI/RAG 상태 확인 |

### 이력 관리
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/history?limit=50` | 질의 이력 조회 |
| GET | `/api/history/:id` | 이력 단건 상세 |
| DELETE | `/api/history/:id` | 이력 삭제 |
| DELETE | `/api/history` | 이력 전체 삭제 |

### SQL 피드백
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/feedback` | 피드백 저장 (correct/corrected) |
| GET | `/api/feedback` | 피드백 목록 조회 |
| DELETE | `/api/feedback/:id` | 피드백 삭제 |

### 학습 관리
| Method | Path | 설명 |
|--------|------|------|
| GET/POST/PUT/DELETE | `/api/ontology` | 온톨로지 컬럼 CRUD |
| POST/DELETE | `/api/ontology/:id/synonym` | 동의어 관리 |
| GET/POST/PUT/DELETE | `/api/metric` | 메트릭 지표 CRUD |
| POST/DELETE | `/api/metric/:id/synonym` | 메트릭 동의어 |
| GET/POST/PUT/DELETE | `/api/join` | 조인 조건 CRUD |
| GET/POST/PUT/DELETE | `/api/code-mapping` | 코드값 매핑 CRUD |
| GET | `/api/code-mapping/columns` | 매핑 컬럼 목록 |
| GET | `/api/learning/stats` | 학습 통계 |

### RAG 관리
| Method | Path | 설명 |
|--------|------|------|
| POST | `/api/rag/build` | RAG 인덱스 전체 리빌드 |
| GET | `/api/rag/stats` | RAG 상태/통계 |
| POST | `/api/rag/search` | RAG 검색 테스트 |

### PPT 보고서
| Method | Path | 설명 |
|--------|------|------|
| GET | `/api/report/months` | 사용 가능한 월 목록 |
| POST | `/api/report/preview` | 보고서 미리보기 데이터 |
| POST | `/api/report/ppt` | PPT 파일 생성/다운로드 |
| POST | `/api/report/upload-preview` | 첨부파일 미리보기 |

### 페이지
| Path | 설명 |
|------|------|
| `/` | 메인 챗봇 UI |
| `/learning.html` | 학습 관리 페이지 |
| `/report` | PPT 보고서 생성 페이지 |

## 데이터 아키텍처

### 테이블 구조
| 테이블 | 설명 | 행수 |
|--------|------|------|
| `bw_profitability_data` | BW 수익성분석 원천 데이터 | ~226,811 |
| `code_mapping` | 코드값→명칭 매핑 | 26 |
| `ontology_column` | 컬럼 온톨로지 (동의어 포함) | 31 |
| `metric` | 계산 지표 사전 | 19 |
| `metric_synonym` | 메트릭 동의어 | 17 |
| `join_condition` | 조인 조건 | 3 |
| `sql_feedback` | SQL 피드백 (학습 데이터) | 10+ |
| `nl_query_history` | 질의 이력 | 자동 증가 |
| `rag_embeddings` | RAG 벡터 인덱스 | 178 |
| `ontology_synonym` | 온톨로지 동의어 | 18 |
| `batch_master` | 인터페이스 마스터 (rfc_name, rfc_param, IFTBL) | NLP_RFC_001/002 등 |
| `batch_schedule` | 인터페이스 수행관리 (스케줄) | 자동 증가 |
| `batch_jobs` | 인터페이스 이력관리 (실행 이력) | 자동 증가 |
| `sys_aimd_cot015` | 제조원가 RFC 적재 테이블 (seq + 37 필드; DIVISION/DIVISION_NM 포함) | RFC 적재량 |

### bw_profitability_data 인덱스
- PRIMARY (SEQ), CALMONTH, CALDAY, PROFIT_CTR, MATERIAL, CUSTOMER
- PLANT, DIVISION, PRODH1, DISTR_CHAN, ZBRAND1, ZJPCODE, SALES_OFF

### 금액 컬럼 (ZAMT001~ZAMT064)
- 총매출(001), 판매장려금(002), 순매출(003), 매출원가계(034), 매출총이익(035)
- 판매관리비(036), 영업이익(055), 경상이익(064) 외 60개 세부 항목

## 기술 스택
- **백엔드**: Node.js + Express 5.2.1
- **AI**: OpenAI API (GPT-5-mini) + text-embedding-3-small
- **DB**: MariaDB (mysql2/promise)
- **RAG**: 코사인 유사도 기반 메타데이터 검색 (rag.mjs)
- **보고서**: Python (python-pptx, XlsxWriter, pymysql)
- **프론트엔드**: Tailwind CSS + Chart.js + FontAwesome
- **프로세스 관리**: PM2

## 프로젝트 구조
```
nlq-server/
├── server.mjs           # 메인 Express 서버 (1,226줄)
├── rag.mjs              # RAG 모듈 - 메타데이터 검색 (433줄)
├── report_generator.py  # PPT 보고서 생성기 (1,389줄)
├── report_cli.py        # 보고서 CLI 래퍼 (201줄)
├── ecosystem.config.cjs # PM2 프로세스 설정
├── .env                 # 환경변수 (API 키)
├── public/
│   ├── index.html       # 메인 챗봇 UI
│   ├── learning.html    # 학습 관리 UI
│   └── report.html      # PPT 보고서 UI
└── sql/
    ├── 001_create_learning_tables.sql
    └── 002_seed_learning_data.sql
```

## 실행 방법
```bash
# PM2로 서버 시작
cd /home/user/webapp/nlq-server
pm2 start ecosystem.config.cjs

# 상태 확인
pm2 list
curl http://localhost:3000/api/status

# 로그 확인
pm2 logs nlq-server --nostream
```

## 최근 변경사항

### 2026-08-03 (PR #329) — 제조원가 RFC 함수명 변경 및 인터페이스 연계
- **RFC 함수명 변경**: `Z_BI_PRE_COST` → `Z_BI_WEB_EX_BL_4` (인터페이스 설정 · 배치 · 로그 · 화면 전 영역 일괄 교체)
- **DB 마이그레이션**: `sql/044_update_nlp_rfc_002_to_z_bi_web_ex_bl_4.sql` (batch_master UPDATE + Z_BI_PRE_COST 잔존 청소)
- **적재 로직**: `scripts/sap_rfc_sync_mfg_cost.py` (수익성 스크립트와 완전 분리)
  - `I_CMONTH` YYYYMM 전달 → `Z_BI_WEB_EX_BL_4` 호출 → `T_DATA` 파싱 → `sys_aimd_cot015` 적재
  - CALMONTH 검증, 숫자 정리(공백/쉼표/후행부호), /BIC/ prefix 자동 제거, 필드 오류 로그
  - 재적재 시 트랜잭션 DELETE+INSERT (autocommit=False + rollback)
  - Exit code: 0=SUCCESS / 1=FAILED / 2=NO_DATA (수익성 상태값과 통일)
- **수행관리·이력관리 연계**: `[신규 등록]` → batch_schedule → NLP_RFC_002 실행 → batch_jobs 이력 저장
- **이력 상세 화면**: `RFC 함수: Z_BI_WEB_EX_BL_4 | 입력값: I_CMONTH=YYYYMM` 표시 (구 함수명 노출 없음)
- **분리 원칙**: 수익성 RFC(`Z_BI_WEB_EX_BL`) 로직에 영향 없음 (별도 스크립트 + 별도 적재 테이블)
- **테스트**: 91건 통과 (unit 42 + DB 통합 22 + 인터페이스 흐름 27)

### 2026-05-06
- RAG removeFromIndex 버그 수정 (sourceId=null 처리)
- SPA fallback에서 /api/* 경로 제외 (Report API 충돌 해결)
- bw_profitability_data 테이블에 7개 성능 인덱스 추가
- 전체 API 엔드투엔드 테스트 완료
- report_generator.py 테이블명 bw_profitability_data로 통일
