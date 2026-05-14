# 자체 서버 배포 가이드

## 목차
1. [사전 요구사항](#1-사전-요구사항)
2. [프로젝트 파일 복사](#2-프로젝트-파일-복사)
3. [환경변수 설정 (.env)](#3-환경변수-설정)
4. [MariaDB 설정](#4-mariadb-설정)
5. [의존성 설치 및 실행](#5-의존성-설치-및-실행)
6. [PM2 프로세스 관리](#6-pm2-프로세스-관리)
7. [트러블슈팅](#7-트러블슈팅)

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
