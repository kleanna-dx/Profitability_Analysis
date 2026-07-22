# 자체 서버 배포 가이드

## 목차
1. [사전 요구사항](#1-사전-요구사항)
2. [프로젝트 파일 복사](#2-프로젝트-파일-복사)
3. [환경변수 설정 (.env)](#3-환경변수-설정)
4. [MariaDB 설정](#4-mariadb-설정)
5. [의존성 설치 및 실행](#5-의존성-설치-및-실행)
6. [PM2 프로세스 관리](#6-pm2-프로세스-관리)
7. [트러블슈팅](#7-트러블슈팅)
8. [Nginx / 리버스 프록시 타임아웃 설정 (필수)](#8-nginx--리버스-프록시-타임아웃-설정-필수)

---

## 1. 사전 요구사항

| 항목 | 최소 버전 | 비고 |
|------|----------|------|
| **Node.js** | 18.x 이상 | 20.x LTS 권장 |
| **npm** | 9.x 이상 | Node.js와 함께 설치됨 |
| **MariaDB** | 10.6 이상 | 또는 MySQL 8.0 |
| **PM2** | 5.x 이상 | `npm install -g pm2` |
| **RAM** | 2GB 이상 | Node.js `--max-old-space-size=1024` 사용 중 |

---

## 2. 프로젝트 파일 복사

```bash
# GitHub에서 클론
git clone https://github.com/kleanna-dx/Profitability_Analysis.git
cd Profitability_Analysis/nlq-server
```

### 필수 디렉토리 구조
```
nlq-server/
├── server.mjs          # 메인 서버
├── rag.mjs             # RAG 모듈 (벡터 검색)
├── package.json        # 의존성 정의
├── ecosystem.config.cjs # PM2 설정
├── .env.example        # 환경변수 템플릿 ← 이걸 복사해서 .env 생성
├── .env                # 실제 환경변수 (git에 포함되지 않음)
├── public/             # 프론트엔드 파일
│   ├── index.html      # NLQ 채팅 UI
│   ├── builder.html    # 비주얼 쿼리 빌더
│   └── learning.html   # 학습관리 화면
└── uploads/            # 엑셀 업로드 임시 디렉토리 (자동 생성)
```

---

## 3. 환경변수 설정

```bash
# 템플릿 복사
cp .env.example .env

# 편집기로 열어서 수정
nano .env   # 또는 vi .env
```

### 핵심: GenSpark LLM 프록시 키를 그대로 사용

이 프로젝트는 **GenSpark LLM 프록시**를 통해 GPT API를 호출합니다.
자체 서버에서도 동일한 키와 URL을 그대로 사용하면 됩니다.

> GenSpark 사이트 → **LLM API 키 관리** 화면에서 키를 확인/발급할 수 있습니다.
> 지원 모델: `gpt-5`, `gpt-5.1`, `gpt-5.2`, `gpt-5-mini`, `gpt-5-nano` 등

### .env 설정 예시

```env
# ── GenSpark LLM 프록시 (API 키/URL/모델명 그대로 사용) ──
OPENAI_API_KEY=여기에_GenSpark_LLM_프록시_키_입력
OPENAI_BASE_URL=https://www.genspark.ai/api/llm_proxy/v1
GPT_MODEL=gpt-5-mini
EMBEDDING_MODEL=text-embedding-3-small

# ── MariaDB (★ 자체 서버 환경에 맞게 수정) ──
DB_HOST=localhost
DB_PORT=3306
DB_USER=company
DB_PASSWORD=여기에_실제_비밀번호_입력
DB_NAME=company_board
DB_POOL_SIZE=5
```

> **요약: API 관련 설정 3줄은 GenSpark에서 복붙, DB 관련 설정만 자체 서버에 맞게 수정하면 끝입니다.**

---

## 4. MariaDB 설정

### 데이터베이스 생성
```sql
-- MariaDB에 접속
mysql -u root -p

-- 데이터베이스 생성
CREATE DATABASE company_board CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 사용자 생성 및 권한 부여
CREATE USER 'company'@'localhost' IDENTIFIED BY '실제비밀번호';
GRANT ALL PRIVILEGES ON company_board.* TO 'company'@'localhost';
FLUSH PRIVILEGES;
```

### 테이블 이관

서버 초기 실행 시 메타테이블(`ontology_column`, `ontology_synonym`, `metric`, `metric_synonym`, `sql_feedback`, `join_condition`, `rag_embeddings`)은 **자동 생성**됩니다.

**수동 이관 필요**: `bw_profitability_data` (실적 데이터 테이블)
```bash
# 기존 환경에서 내보내기
mysqldump -u company -p company_board bw_profitability_data > data.sql

# 새 서버에서 적용
mysql -u company -p company_board < data.sql
```

학습된 데이터(온톨로지, 메트릭, SQL 피드백 등)도 이관하려면:
```bash
# 기존 환경에서 메타테이블 포함 전체 내보내기
mysqldump -u company -p company_board > full_backup.sql

# 새 서버에서 적용
mysql -u company -p company_board < full_backup.sql
```

---

## 5. 의존성 설치 및 실행

```bash
cd nlq-server

# 의존성 설치
npm install

# 환경변수 확인
node -e "require('dotenv').config(); console.log('API Key:', process.env.OPENAI_API_KEY ? '설정됨 (' + process.env.OPENAI_API_KEY.substring(0,8) + '...)' : '미설정'); console.log('Base URL:', process.env.OPENAI_BASE_URL); console.log('GPT Model:', process.env.GPT_MODEL); console.log('DB Host:', process.env.DB_HOST);"

# 테스트 실행 (포그라운드)
node server.mjs
# → "[NLQ] AI 설정: model=gpt-5-mini, baseURL=https://www.genspark.ai/api/llm_proxy/v1" 출력 확인
# → "🚀 NLQ Server running on http://0.0.0.0:3000" 확인 후 Ctrl+C

# PM2로 백그라운드 실행
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # 서버 재부팅 시 자동 시작 설정
```

### 동작 확인
```bash
# 상태 확인
curl http://localhost:3000/api/status
# → {"db":"connected","table":"bw_profitability_data","totalRows":588919,"ai":"gpt-5-mini",...}

# NLQ 테스트 질의
curl -X POST http://localhost:3000/api/nlq \
  -H "Content-Type: application/json" \
  -d '{"query": "브랜드별 매출 TOP 5"}'
```

---

## 6. PM2 프로세스 관리

```bash
pm2 start ecosystem.config.cjs    # 시작
pm2 restart nlq-server             # 재시작
pm2 stop nlq-server                # 중지
pm2 logs nlq-server --nostream     # 로그 확인
pm2 monit                          # 실시간 모니터링
```

### ecosystem.config.cjs 기본 설정
```javascript
module.exports = {
  apps: [{
    name: 'nlq-server',
    script: 'server.mjs',
    node_args: '--max-old-space-size=1024',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

---

## 7. 트러블슈팅

### ❌ "401 Unauthorized" 또는 "Incorrect API key provided"
```
원인: OPENAI_API_KEY가 잘못되었거나 만료됨
해결: GenSpark → LLM API 키 관리에서 키 확인 또는 새 키 생성
```

### ❌ "ECONNREFUSED 127.0.0.1:3306"
```
원인: MariaDB가 실행되지 않거나 접속 정보 불일치
해결: 
  1. MariaDB 실행 상태 확인: systemctl status mariadb
  2. .env의 DB_HOST, DB_PORT, DB_USER, DB_PASSWORD 확인
  3. DB 접속 테스트: mysql -u company -p -h localhost company_board
```

### ❌ "429 Rate limit exceeded" 또는 "insufficient_quota"
```
원인: GenSpark 크레딧 부족
해결: GenSpark 계정의 크레딧 잔액 확인 및 충전
```

### ❌ RAG 인덱스 재구축 필요
```
메타데이터를 대량 수정한 경우:
→ 학습관리 화면(learning.html) 접속 → RAG 재구축 버튼 클릭
→ 또는 서버 재시작 시 자동 재구축됨
```

### ❌ "fetch failed" 또는 네트워크 오류
```
원인: 서버에서 GenSpark API 접근이 차단됨 (방화벽/프록시)
해결:
  1. 아웃바운드 HTTPS (443 포트) 허용 확인
  2. 프록시 환경: HTTPS_PROXY 환경변수 설정
  3. 테스트: curl https://www.genspark.ai/api/llm_proxy/v1/models -H "Authorization: Bearer 키값"
```

---

## 8. Nginx / 리버스 프록시 타임아웃 설정 (필수)

### 배경

NLQ 서비스는 프론트엔드 → **Nginx(리버스 프록시)** → Node.js(PM2) → MariaDB 로 흐릅니다.
현황집계(aggregate) 질의는 실측 **60~90초** 걸리는 SQL 이 존재하는데, Nginx 기본
`proxy_read_timeout` 은 **60초** 이므로 그대로 두면:

```
[증상] 사용자 화면에 "HTTP 504 Gateway Time-out" HTML 이 노출됨
[로그] nlq-server.log 에 event="request_aborted" 로 남고, X-Request-Id 헤더가
       없어 사용자가 로그를 추적하기 어려움
```

### PR #247 이후의 전 계층 타임아웃 위계

애플리케이션 코드(server.mjs / index.html) 는 이미 아래 값으로 정렬되어 있습니다.
운영자는 **Nginx 만** 이 값들과 정합되도록 조정하면 됩니다.

| 계층 | 값 | 위치 |
|------|-----|------|
| MariaDB `max_statement_time` (서버단 강제 종료) | **90초** | `server.mjs` 환경변수 `NLQ_DB_QUERY_TIMEOUT_MS` |
| 프론트 fetch AbortController (aggregate) | **180초** | `public/index.html` L1737 |
| 프론트 fetch AbortController (analysis) | **300초** | `public/index.html` L1737 |
| **Nginx `proxy_read_timeout`** | **240초 이상 권장** | ⬅ 아래 참고 |
| Express `requestTimeout` / undici | 600초 | `server.mjs` 환경변수 `BUILDER_SERVER_TIMEOUT_MS` |

### Nginx 설정 예시

`/etc/nginx/conf.d/nlq.conf` (또는 `sites-available/*`) 의 NLQ 서비스 `server` /
`location` 블록에 아래 지시어를 추가합니다.

```nginx
server {
    listen 80;
    server_name your-nlq-server.example.com;

    # [PR #247] NLQ /api/nlq 는 최대 90초 DB + 90초 LLM = 최대 180초 소요 가능.
    # 안전마진 60초를 더해 240초로 설정. 이보다 짧으면 HTTP 504 재발 위험.
    proxy_read_timeout   240s;
    proxy_send_timeout   240s;
    proxy_connect_timeout 60s;   # 연결 단계는 그대로 유지

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection        "";

        # 응답 헤더 X-Request-Id 를 그대로 클라이언트에 전달 (로그 추적용)
        proxy_pass_header X-Request-Id;
    }
}
```

**location 별로 다르게 하고 싶다면**:

```nginx
# NLQ 만 넉넉하게, 다른 API 는 기본값(60s) 유지
location = /api/nlq {
    proxy_read_timeout   240s;
    proxy_send_timeout   240s;
    proxy_pass http://127.0.0.1:3000;
}

# analysis async 폴링은 응답이 항상 짧으므로 별도 설정 불필요
location /api/nlq/ {
    proxy_pass http://127.0.0.1:3000;
}
```

### 반영 및 검증

```bash
# 1. 문법 검사
sudo nginx -t

# 2. 무중단 리로드
sudo systemctl reload nginx

# 3. 실제 헤더 확인 (240s 반영 여부는 응답 시간이 아니라 아래로 판정)
curl -I http://your-nlq-server.example.com/api/status

# 4. NLQ 회귀 테스트 — 아래 질의가 90초 안에 완료되어야 함
#    "2026년 3월부터 6월까지 월별 SKU 매출"
```

### 자주 하는 실수

- ❌ `proxy_read_timeout 60s;` 그대로 → HTTP 504 재발
- ❌ `keepalive_timeout` 만 조정 → NLQ 응답 시간과 무관 (연결 재사용용)
- ❌ Nginx 240s 인데 프론트 180s 보다 크게 유지하지 않음 → **문제 없음**
  (프론트가 먼저 abort 하는 것은 안전한 방향. 반대가 문제.)
- ⚠️ Cloudflare / AWS ALB / 기타 상위 게이트웨이가 있다면 그쪽도 함께 확인 필요

---

## 빠른 체크리스트

자체 서버 배포 시 아래 항목을 순서대로 확인하세요:

- [ ] Node.js 18+ 설치 확인
- [ ] MariaDB 실행 중 + 데이터베이스/테이블 이관 완료
- [ ] `cp .env.example .env` 후 수정
- [ ] `OPENAI_API_KEY` → GenSpark LLM 프록시 키 (GenSpark에서 복사)
- [ ] `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` → 자체 서버 DB에 맞게 수정
- [ ] `npm install` 완료
- [ ] `pm2 start ecosystem.config.cjs` → 정상 시작
- [ ] `curl http://localhost:3000/api/status` → 정상 응답
- [ ] NLQ 테스트 질의 → GPT 응답 정상 수신
- [ ] **Nginx `proxy_read_timeout` ≥ 240s 설정 (섹션 8 참고)** — HTTP 504 방지
