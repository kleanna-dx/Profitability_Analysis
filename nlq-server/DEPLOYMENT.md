# 자체 서버 배포 가이드

## 목차
1. [사전 요구사항](#1-사전-요구사항)
2. [프로젝트 파일 복사](#2-프로젝트-파일-복사)
3. [환경변수 설정 (.env)](#3-환경변수-설정)
4. [OpenAI API Key 발급 및 설정](#4-openai-api-key-발급-및-설정)
5. [MariaDB 설정](#5-mariadb-설정)
6. [의존성 설치 및 실행](#6-의존성-설치-및-실행)
7. [PM2 프로세스 관리](#7-pm2-프로세스-관리)
8. [트러블슈팅](#8-트러블슈팅)

---

## 1. 사전 요구사항

| 항목 | 최소 버전 | 비고 |
|------|----------|------|
| **Node.js** | 18.x 이상 | 20.x LTS 권장 |
| **npm** | 9.x 이상 | Node.js와 함께 설치됨 |
| **MariaDB** | 10.6 이상 | 또는 MySQL 8.0 |
| **PM2** | 5.x 이상 | `npm install -g pm2` |
| **RAM** | 2GB 이상 | Node.js `--max-old-space-size=1024` 사용 중 |
| **OpenAI API Key** | — | GPT-4o-mini + Embedding 사용 |

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

### 핵심 환경변수 (반드시 수정)

```env
# ── OpenAI API ──
OPENAI_API_KEY=sk-여기에_실제_API_키_입력    # ★ 필수
OPENAI_BASE_URL=https://api.openai.com/v1   # OpenAI 직접 연결

# ── AI 모델 ──
GPT_MODEL=gpt-4o-mini                       # 권장 (비용 효율적)
EMBEDDING_MODEL=text-embedding-3-small       # RAG용 임베딩

# ── MariaDB ──
DB_HOST=localhost                            # DB 서버 주소
DB_PORT=3306
DB_USER=company                              # ★ 실제 DB 계정으로 변경
DB_PASSWORD=여기에_실제_비밀번호              # ★ 실제 비밀번호로 변경
DB_NAME=company_board                        # ★ 실제 DB명으로 변경
DB_POOL_SIZE=5
```

### GenSpark 샌드박스 vs 자체 서버 비교

| 설정 항목 | GenSpark (현재) | 자체 서버 (변경 후) |
|-----------|----------------|-------------------|
| `OPENAI_API_KEY` | GenSpark 프록시 토큰 | OpenAI 직접 API 키 (`sk-...`) |
| `OPENAI_BASE_URL` | `https://www.genspark.ai/api/llm_proxy/v1` | `https://api.openai.com/v1` |
| `GPT_MODEL` | `gpt-5-mini` (프록시 전용) | `gpt-4o-mini` (OpenAI 공식) |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | `text-embedding-3-small` (동일) |
| `DB_HOST` | `localhost` | 실제 DB 서버 주소 |
| `DB_PASSWORD` | `company1234!` | 실제 비밀번호 |

---

## 4. OpenAI API Key 발급 및 설정

### Step 1: API Key 발급
1. https://platform.openai.com 접속 → 로그인
2. 좌측 메뉴 **API keys** → **Create new secret key**
3. 이름 입력 (예: `profitability-analysis-server`)
4. 생성된 `sk-...` 키를 안전한 곳에 복사

### Step 2: .env에 설정
```env
OPENAI_API_KEY=sk-proj-abc123...실제키
OPENAI_BASE_URL=https://api.openai.com/v1
```

### Step 3: 사용 가능한 모델 확인

| 모델 | 용도 | 비용 (1M 토큰 기준) | 권장 |
|------|------|---------------------|------|
| `gpt-4o-mini` | SQL 생성 + 분석 | 입력 $0.15 / 출력 $0.60 | ★ 기본 권장 |
| `gpt-4o` | 더 높은 정확도 | 입력 $2.50 / 출력 $10.00 | 정확도 우선 시 |
| `gpt-4-turbo` | 고성능 | 입력 $10.00 / 출력 $30.00 | 비권장 (비용) |

> **참고**: 현재 GenSpark 환경에서는 `gpt-5-mini`(프록시 전용 모델명)를 사용하지만,
> OpenAI 직접 연결 시에는 공식 모델명(`gpt-4o-mini` 등)을 사용해야 합니다.

### Step 4: 월 비용 예상
- 일 100건 질의 기준: 약 $3~5/월 (gpt-4o-mini)
- 일 500건 질의 기준: 약 $15~25/월 (gpt-4o-mini)
- Usage limit 설정 권장: https://platform.openai.com/settings/organization/limits

---

## 5. MariaDB 설정

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

### 필수 테이블 (자동 생성되지 않는 항목)

서버 초기 실행 시 대부분의 메타테이블(`ontology_column`, `ontology_synonym`, `metric`, `metric_synonym`, `sql_feedback`, `join_condition`, `rag_embeddings`)은 자동 생성됩니다.

**수동 생성 필요**: `bw_profitability_data` (실적 데이터 테이블)
```sql
-- 기존 환경에서 테이블 구조 내보내기
mysqldump -u company -p company_board bw_profitability_data --no-data > schema.sql

-- 새 서버에서 구조 적용
mysql -u company -p company_board < schema.sql

-- 데이터 이관 (필요시)
mysqldump -u company -p company_board bw_profitability_data > data.sql
mysql -u company -p company_board < data.sql
```

---

## 6. 의존성 설치 및 실행

```bash
cd nlq-server

# 의존성 설치
npm install

# 환경변수 확인 (API 키가 정상 로드되는지)
node -e "require('dotenv').config(); console.log('API Key:', process.env.OPENAI_API_KEY ? '설정됨 (' + process.env.OPENAI_API_KEY.substring(0,8) + '...)' : '미설정'); console.log('Base URL:', process.env.OPENAI_BASE_URL); console.log('GPT Model:', process.env.GPT_MODEL); console.log('DB Host:', process.env.DB_HOST);"

# 테스트 실행 (포그라운드)
node server.mjs
# → "[NLQ] AI 설정: model=gpt-4o-mini, baseURL=https://api.openai.com/v1" 출력 확인
# → "Server running on port 3000" 확인 후 Ctrl+C

# PM2로 백그라운드 실행
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # 서버 재부팅 시 자동 시작 설정
```

### 동작 확인
```bash
# 헬스체크
curl http://localhost:3000/api/status
# → {"db":"connected","table":"bw_profitability_data","totalRows":588919,"ai":"gpt-4o-mini",...}

# NLQ 테스트 질의
curl -X POST http://localhost:3000/api/nlq \
  -H "Content-Type: application/json" \
  -d '{"query": "브랜드별 매출 TOP 5"}'
```

---

## 7. PM2 프로세스 관리

```bash
# ecosystem.config.cjs 이미 포함됨
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

## 8. 트러블슈팅

### ❌ "401 Unauthorized" 또는 "Incorrect API key provided"
```
원인: OPENAI_API_KEY가 잘못되었거나 만료됨
해결: .env 파일의 OPENAI_API_KEY 값 확인
     → https://platform.openai.com/api-keys 에서 새 키 발급
```

### ❌ "404 The model `gpt-5-mini` does not exist"
```
원인: GenSpark 프록시 전용 모델명을 OpenAI 직접 연결에서 사용
해결: .env 파일에서 GPT_MODEL=gpt-4o-mini 로 변경
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
원인: OpenAI API 사용 한도 초과
해결:
  1. https://platform.openai.com/settings/organization/billing 에서 크레딧 확인
  2. Usage limits 설정으로 월 예산 관리
  3. GPT_MODEL을 더 저렴한 모델로 변경
```

### ❌ RAG 인덱스 재구축 필요
```
임베딩 모델을 변경했거나 메타데이터를 대량 수정한 경우:
→ 학습관리 화면(learning.html) 접속 → RAG 재구축 버튼 클릭
→ 또는 서버 재시작 시 자동 재구축됨
```

### ❌ "fetch failed" 또는 네트워크 오류
```
원인: 서버에서 OpenAI API 접근이 차단됨 (방화벽/프록시)
해결:
  1. 아웃바운드 HTTPS (443 포트) 허용 확인
  2. 프록시 환경: HTTPS_PROXY 환경변수 설정
  3. curl https://api.openai.com/v1/models -H "Authorization: Bearer sk-..." 로 직접 테스트
```

---

## 빠른 체크리스트

자체 서버 배포 시 아래 항목을 순서대로 확인하세요:

- [ ] Node.js 18+ 설치 확인
- [ ] MariaDB 실행 중 + 데이터베이스/테이블 생성 완료
- [ ] `cp .env.example .env` 후 실제 값으로 수정
- [ ] `OPENAI_API_KEY` → OpenAI 직접 발급 키 (`sk-...`)
- [ ] `OPENAI_BASE_URL` → `https://api.openai.com/v1`
- [ ] `GPT_MODEL` → `gpt-4o-mini` (또는 원하는 공식 모델명)
- [ ] `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` 수정
- [ ] `npm install` 완료
- [ ] `pm2 start ecosystem.config.cjs` → 정상 시작
- [ ] `curl http://localhost:3000/api/health` → 정상 응답
- [ ] NLQ 테스트 질의 → GPT 응답 정상 수신
