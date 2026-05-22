# Rocky Linux 9.6 배포 가이드

## 전제 조건 (이미 설치 완료)

| 항목 | 상태 | 비고 |
|------|------|------|
| Rocky Linux | 9.6 | ✅ |
| Nginx | 설치됨 | ✅ |
| OpenJDK | 17.0.19 | ✅ (본 프로젝트는 Java 사용 안 함, 기존 환경 호환) |
| MariaDB | 설치됨 | ✅ |

## 디렉토리 구조

```
/data/analytics/
├── app/            ← Node.js 서버 실행 영역 (배포 대상)
├── config/         ← .env 환경변수 설정
├── logs/           ← 서비스 로그
├── source/         ← GitHub 소스 원본 (repo root = source/ 디렉토리)
└── static/         ← (예비, nginx 직접 서비스용)
```

---

## 순서 요약

```
1. Node.js 20 LTS 설치
2. Python 3.9+ 패키지 설치 (보고서 생성용)
3. 한글 폰트 설치
4. 소스 → app 디렉토리 배치 + npm install
5. .env 환경변수 설정
6. MariaDB 데이터베이스 & 테이블 준비
7. 서비스 동작 테스트 (수동)
8. systemd 서비스 등록
9. nginx 리버스 프록시 설정
10. 방화벽(firewalld) 설정
11. SELinux 설정
12. 최종 확인
```

---

## 1단계: Node.js 20 LTS 설치

```bash
# NodeSource 저장소 추가 (Node.js 20 LTS)
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -

# Node.js 설치
sudo dnf install -y nodejs

# 버전 확인
node -v    # v20.x.x
npm -v     # 10.x.x
```

**또는** dnf module 방식:
```bash
sudo dnf module reset nodejs -y
sudo dnf module enable nodejs:20 -y
sudo dnf install -y nodejs
```

---

## 2단계: Python 패키지 설치 (PPT 보고서 생성용)

```bash
# Python 3 확인 (Rocky 9.6은 기본 3.9 포함)
python3 --version

# pip 설치
sudo dnf install -y python3-pip python3-devel

# 보고서 생성에 필요한 Python 라이브러리
sudo pip3 install pymysql python-pptx matplotlib openpyxl
```

---

## 3단계: 한글 폰트 설치 (matplotlib 차트 + PPT 보고서용)

```bash
# 나눔폰트 설치
sudo dnf install -y google-noto-sans-cjk-ttc-fonts

# 또는 나눔고딕 직접 설치
sudo mkdir -p /usr/share/fonts/nanum
cd /tmp
wget https://github.com/naver/nanumfont/releases/download/VER2.5/NanumGothic.ttf
wget https://github.com/naver/nanumfont/releases/download/VER2.5/NanumGothicBold.ttf
sudo cp Nanum*.ttf /usr/share/fonts/nanum/
sudo fc-cache -fv

# 확인
fc-list | grep -i "nanum\|noto.*cjk"

# matplotlib 폰트 캐시 초기화
python3 -c "import matplotlib; print(matplotlib.get_cachedir())"
rm -rf $(python3 -c "import matplotlib; print(matplotlib.get_cachedir())")
```

---

## 4단계: 소스 배치 + npm install

```bash
# source 디렉토리가 곧 Git 저장소 루트 (source/ 안에 직접 clone)
cd /data/analytics/source

# 최신 소스 pull
git pull origin main

# app 디렉토리에 필요한 파일 복사
# ※ 주의: nlq-server/ 하위가 실제 서버, 상위 package.json 의존성도 필요

# 방법 1: nlq-server 내용 + 상위 의존성 파일 복사
cp -r /data/analytics/source/nlq-server/* /data/analytics/app/
cp /data/analytics/source/package.json /data/analytics/app/
cp /data/analytics/source/package-lock.json /data/analytics/app/

# uploads 디렉토리 생성 (엑셀 업로드 임시 저장)
mkdir -p /data/analytics/app/uploads

# 의존성 설치 (production만)
cd /data/analytics/app
npm install --omit=dev

# 설치 확인 (핵심 모듈)
ls node_modules/express node_modules/mysql2 node_modules/openai node_modules/dotenv
```

### app 디렉토리 최종 구조
```
/data/analytics/app/
├── server.mjs              # 메인 Express 서버 (3,338줄)
├── rag.mjs                 # RAG 벡터 검색 모듈
├── report_cli.py           # PPT 보고서 CLI 래퍼
├── report_generator.py     # PPT 보고서 생성기
├── xlsx_preview.py         # 엑셀 미리보기
├── xlsx_load.py            # 엑셀 DB 적재
├── package.json            # npm 의존성 정의
├── package-lock.json
├── .env                    # → /data/analytics/config/.env 심볼릭 링크
├── .env.example            # 환경변수 템플릿
├── ecosystem.config.cjs    # PM2 설정 (참고용, systemd 사용 시 불필요)
├── node_modules/           # npm 패키지들
├── public/                 # 프론트엔드 HTML (Express가 서빙)
│   ├── login.html          # 로그인 페이지
│   ├── index.html          # NLQ 채팅 메인
│   ├── builder.html        # 비주얼 쿼리 빌더
│   ├── learning.html       # 학습관리
│   ├── report.html         # PPT 보고서
│   └── upload.html         # 데이터 업로드
├── sql/                    # DB 마이그레이션 SQL
│   ├── 001_create_users_table.sql
│   ├── 002_create_group_info_table.sql
│   └── 003_create_user_group_info_table.sql
└── uploads/                # 엑셀 업로드 임시 디렉토리
```

---

## 5단계: 환경변수 설정 (.env)

```bash
# 템플릿 복사
cp /data/analytics/app/.env.example /data/analytics/config/.env

# 편집
vi /data/analytics/config/.env
```

```env
# ── GenSpark LLM 프록시 (★ 기존 키 그대로 사용) ──
OPENAI_API_KEY=gsk-실제키값
OPENAI_BASE_URL=https://www.genspark.ai/api/llm_proxy/v1
GPT_MODEL=gpt-5-mini
EMBEDDING_MODEL=text-embedding-3-small

# ── MariaDB (★ 실제 환경에 맞게 수정) ──
DB_HOST=localhost
DB_PORT=3306
DB_USER=company
DB_PASSWORD=실제비밀번호입력
DB_NAME=company_board
DB_POOL_SIZE=10

# ── 그룹웨어 연동 ──
GW_API_KEY=gw-kleannara-2026-secure-api-key
SSO_VALIDATE_URL=https://sso.kleannara.com/rest/security/encValidateProduct
SSO_PRODUCT_ID=PRO_000644

# ── 세션 시크릿 (★ 고정값 권장 — 서버 재시작 시 세션 유지) ──
SESSION_SECRET=여기에-랜덤-32자이상-문자열-입력
```

```bash
# app 디렉토리에 심볼릭 링크 생성
ln -sf /data/analytics/config/.env /data/analytics/app/.env

# .env 파일 권한 제한 (보안)
chmod 600 /data/analytics/config/.env
```

---

## 6단계: MariaDB 데이터베이스 준비

### 6-1. 한글 인코딩 설정

```bash
sudo vi /etc/my.cnf.d/charset.cnf
```

```ini
[mariadbd]
character-set-client-handshake = FALSE
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci
init-connect = "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci"

[client]
default-character-set = utf8mb4
```

```bash
sudo systemctl restart mariadb
```

### 6-2. 데이터베이스 + 사용자 생성

```sql
-- root로 접속
mysql -u root -p

-- 데이터베이스 생성
CREATE DATABASE IF NOT EXISTS company_board
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- 전용 사용자 생성
CREATE USER IF NOT EXISTS 'company'@'localhost' IDENTIFIED BY '실제비밀번호입력';
GRANT ALL PRIVILEGES ON company_board.* TO 'company'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

### 6-3. 데이터 이관

**방법 A: 전체 덤프 이관 (권장)**

기존 환경(샌드박스)에서 내보내기:
```bash
# 기존 서버에서 실행
mysqldump -u company -p \
  --default-character-set=utf8mb4 \
  --single-transaction \
  --routines --triggers \
  company_board > company_board_full.sql
```

새 서버에서 임포트:
```bash
mysql -u company -p --default-character-set=utf8mb4 company_board < company_board_full.sql
```

**방법 B: 테이블별 개별 이관**

서버 시작 시 자동 생성되는 테이블:
- `ontology_column`, `ontology_synonym` — 온톨로지 (자동 생성)
- `metric`, `metric_synonym` — 메트릭 (자동 생성)
- `sql_feedback` — SQL 피드백 (자동 생성)
- `join_condition` — JOIN 조건 (자동 생성)
- `code_mapping` — 코드값 매핑 (자동 생성)
- `rag_embeddings` — RAG 벡터 인덱스 (자동 생성)
- `nl_query_history` — NLQ 이력 (자동 생성)
- `builder_query_history` — 빌더 이력 (자동 생성)

**수동 이관 필수 테이블:**
```bash
# 핵심 실적 데이터 (58만행 — 대용량, 시간 소요)
mysqldump -u company -p company_board bw_profitability_data > bw_data.sql
mysql -u company -p company_board < bw_data.sql

# 사용자 테이블
mysqldump -u company -p company_board users > users.sql
mysql -u company -p company_board < users.sql

# 그룹 정보
mysqldump -u company -p company_board group_info user_group_info > group_data.sql
mysql -u company -p company_board < group_data.sql
```

### 6-4. SQL 마이그레이션 스크립트 실행 (신규 설치 시)

```bash
cd /data/analytics/app/sql
mysql -u company -p company_board < 001_create_users_table.sql
mysql -u company -p company_board < 002_create_group_info_table.sql
mysql -u company -p company_board < 003_create_user_group_info_table.sql
```

### 6-5. 이관 확인

```bash
mysql -u company -p company_board -e "
  SELECT 'bw_profitability_data' AS tbl, COUNT(*) AS rows FROM bw_profitability_data
  UNION ALL SELECT 'users', COUNT(*) FROM users
  UNION ALL SELECT 'group_info', COUNT(*) FROM group_info
  UNION ALL SELECT 'user_group_info', COUNT(*) FROM user_group_info;
"
```

예상 결과:
```
+------------------------+--------+
| tbl                    | rows   |
+------------------------+--------+
| bw_profitability_data  | 588919 |
| users                  |      8 |
| group_info             |    151 |
| user_group_info        |    606 |
+------------------------+--------+
```

---

## 7단계: 수동 테스트 실행

```bash
cd /data/analytics/app

# 포그라운드로 테스트 실행
node server.mjs
```

정상 시 출력:
```
[NLQ] AI 설정: model=gpt-5-mini, baseURL=https://www.genspark.ai/api/llm_proxy/v1
🚀 NLQ Server running on http://0.0.0.0:3000
[RAG] ✅ 기존 인덱스 로드됨: 260개 청크
```

다른 터미널에서 확인:
```bash
# 상태 확인
curl http://localhost:3000/api/status
# → {"db":"connected","table":"bw_profitability_data","totalRows":588919,"ai":"gpt-5-mini","rag":{"enabled":true,...}}

# 로그인 페이지 확인
curl -s http://localhost:3000/login | head -5
# → <!DOCTYPE html> ...
```

**Ctrl+C로 중지 후 다음 단계로 진행.**

---

## 8단계: systemd 서비스 등록

### 8-1. 디렉토리 소유권 확인

```bash
# 서비스를 knaraadm 계정으로 실행하므로 소유권 확인
ls -la /data/analytics/

# 소유권이 knaraadm이 아닌 경우에만 실행
sudo chown -R knaraadm:knaraadm /data/analytics
```

### 8-2. systemd 서비스 파일 생성

```bash
sudo vi /etc/systemd/system/nlq-server.service
```

```ini
[Unit]
Description=NLQ Profitability Analysis Server (Node.js)
Documentation=https://github.com/kleanna-dx/Profitability_Analysis
After=network.target mariadb.service
Wants=mariadb.service

[Service]
# ── 실행 설정 ──
Type=simple
User=knaraadm
Group=knaraadm
WorkingDirectory=/data/analytics/app
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5
StartLimitIntervalSec=60
StartLimitBurst=5

# ── 환경변수 ──
Environment=NODE_ENV=production
Environment=PORT=3000

# ── 메모리/프로세스 제한 ──
# Node.js 힙 메모리 제한 (1GB)
Environment=NODE_OPTIONS=--max-old-space-size=1024
# 시스템 메모리 제한 (2GB)
MemoryLimit=2G

# ── 로그 설정 ──
# stdout/stderr → journald로 자동 수집
StandardOutput=journal
StandardError=journal
SyslogIdentifier=nlq-server

# ── 보안 강화 ──
# ※ knaraadm은 일반 로그인 계정이므로 ProtectHome 사용 안 함
# ProtectHome=true
# /usr, /boot, /efi 를 읽기 전용으로 마운트
ProtectSystem=full
# /tmp을 프로세스 전용 임시 디렉토리로 격리
PrivateTmp=true
# 새로운 권한 획득 금지
NoNewPrivileges=true

# ── 파일 디스크립터 ──
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

### 8-3. 서비스 활성화 + 시작

```bash
# systemd 데몬 리로드
sudo systemctl daemon-reload

# 서비스 시작
sudo systemctl start nlq-server

# 상태 확인
sudo systemctl status nlq-server

# 부팅 시 자동 시작 활성화
sudo systemctl enable nlq-server

# 로그 확인
sudo journalctl -u nlq-server -f
```

### 8-4. 서비스 관리 명령어

```bash
# 시작 / 중지 / 재시작
sudo systemctl start nlq-server
sudo systemctl stop nlq-server
sudo systemctl restart nlq-server

# 상태 확인
sudo systemctl status nlq-server

# 실시간 로그
sudo journalctl -u nlq-server -f

# 최근 100줄 로그
sudo journalctl -u nlq-server -n 100 --no-pager

# 오늘 로그만
sudo journalctl -u nlq-server --since today

# 에러 로그만
sudo journalctl -u nlq-server -p err
```

---

## 9단계: Nginx 리버스 프록시 설정

### 9-1. nginx 설정 파일 생성

```bash
sudo vi /etc/nginx/conf.d/analytics.conf
```

```nginx
# ============================================================
# NLQ 수익성분석 서버 — Nginx 리버스 프록시
# ============================================================

# Upstream 정의 (향후 다중 인스턴스 대비)
upstream nlq_backend {
    server 127.0.0.1:3000;
    keepalive 32;
}

server {
    listen       80;
    server_name  your-domain.com;    # ★ 실제 도메인으로 변경

    # ── 기본 설정 ──
    charset utf-8;

    # 업로드 파일 크기 제한 (엑셀 업로드 최대 300MB)
    client_max_body_size 300M;

    # ── 접근 로그 ──
    access_log /data/analytics/logs/nginx_access.log;
    error_log  /data/analytics/logs/nginx_error.log;

    # ── 정적 파일 (nginx 직접 서비스 — 선택사항) ──
    # Node.js가 자체적으로 static 서빙하므로 기본적으로 불필요
    # 성능 최적화가 필요할 때만 활성화
    #
    # location /static/ {
    #     alias /data/analytics/static/;
    #     expires 30d;
    #     add_header Cache-Control "public, immutable";
    # }

    # ── Node.js 서버로 프록시 ──
    location / {
        proxy_pass http://nlq_backend;
        proxy_http_version 1.1;

        # 헤더 전달
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 지원 (필요 시)
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Keep-Alive
        proxy_set_header Connection "";

        # ── 타임아웃 ──
        # NLQ AI 분석 + PPT 보고서 생성은 시간이 걸림
        proxy_connect_timeout 10s;
        proxy_read_timeout    180s;    # 최대 3분 (PPT 생성 타임아웃)
        proxy_send_timeout    60s;

        # ── 버퍼링 ──
        proxy_buffering on;
        proxy_buffer_size 16k;
        proxy_buffers 4 64k;
        proxy_busy_buffers_size 128k;
    }

    # ── 헬스체크 (로드밸런서 연동 시) ──
    location /health {
        proxy_pass http://nlq_backend/api/status;
        proxy_read_timeout 5s;
        access_log off;
    }

    # ── 보안: 숨김 파일 차단 ──
    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }

    # ── .env 파일 직접 접근 차단 ──
    location ~ /\.env {
        deny all;
        return 404;
    }
}
```

### 9-2. (선택) HTTPS 설정 — SSL 인증서가 있을 때

```nginx
server {
    listen       80;
    server_name  your-domain.com;
    return 301   https://$host$request_uri;
}

server {
    listen       443 ssl http2;
    server_name  your-domain.com;

    ssl_certificate     /etc/nginx/ssl/your-domain.crt;
    ssl_certificate_key /etc/nginx/ssl/your-domain.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 나머지 설정은 위 80 포트 설정과 동일
    # ...
}
```

### 9-3. 설정 검증 + 적용

```bash
# 설정 문법 검증
sudo nginx -t

# nginx 리로드 (무중단)
sudo systemctl reload nginx

# 또는 재시작
sudo systemctl restart nginx
```

---

## 10단계: 방화벽 (firewalld) 설정

```bash
# 현재 상태 확인
sudo firewall-cmd --state
sudo firewall-cmd --list-all

# HTTP/HTTPS 포트 개방
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https

# ★ 3000 포트는 외부에 직접 노출하지 않음 (nginx 프록시만 접근)
# 만약 테스트 목적으로 열어야 한다면:
# sudo firewall-cmd --permanent --add-port=3000/tcp

# 방화벽 리로드
sudo firewall-cmd --reload

# 확인
sudo firewall-cmd --list-all
```

---

## 11단계: SELinux 설정

Rocky Linux 9은 기본적으로 SELinux가 Enforcing 모드입니다.
nginx가 Node.js(3000 포트)로 프록시하려면 SELinux 정책 설정이 필요합니다.

```bash
# SELinux 상태 확인
getenforce    # Enforcing

# nginx → Node.js 프록시 허용
sudo setsebool -P httpd_can_network_connect 1

# /data/analytics 디렉토리 SELinux 컨텍스트 설정
sudo semanage fcontext -a -t httpd_sys_content_t "/data/analytics(/.*)?"
sudo semanage fcontext -a -t httpd_log_t "/data/analytics/logs(/.*)?"
sudo restorecon -Rv /data/analytics

# 확인
ls -Z /data/analytics/
```

SELinux 관련 오류 발생 시 로그 확인:
```bash
sudo ausearch -m avc -ts recent
sudo sealert -a /var/log/audit/audit.log
```

---

## 12단계: 최종 확인

### 12-1. 서비스 상태 확인

```bash
# 모든 서비스 상태
sudo systemctl status mariadb
sudo systemctl status nlq-server
sudo systemctl status nginx

# Node.js 프로세스 확인
ps aux | grep "node server.mjs"

# 포트 확인
ss -tlnp | grep -E "3000|80|443|3306"
```

### 12-2. 동작 테스트

```bash
# 1) Node.js 직접 (내부)
curl http://localhost:3000/api/status

# 2) Nginx 경유 (외부 접근 시뮬레이션)
curl http://localhost/api/status

# 3) NLQ 테스트 질의
curl -X POST http://localhost/api/nlq \
  -H "Content-Type: application/json" \
  -d '{"query": "브랜드별 총매출 TOP 5"}'

# 4) 로그인 테스트
curl -s http://localhost/login | head -3

# 5) 사용자 API 테스트 (API Key 인증)
curl -H "X-API-KEY: gw-kleannara-2026-secure-api-key" \
  http://localhost/api/users?limit=3
```

### 12-3. 외부 접근 테스트

브라우저에서:
```
http://your-server-ip/login
```
로그인 페이지가 나오면 성공!

---

## 운영 명령어 모음

```bash
# ── 서비스 관리 ──
sudo systemctl start nlq-server       # 시작
sudo systemctl stop nlq-server        # 중지
sudo systemctl restart nlq-server     # 재시작
sudo systemctl status nlq-server      # 상태

# ── 로그 ──
sudo journalctl -u nlq-server -f                    # 실시간
sudo journalctl -u nlq-server -n 200 --no-pager     # 최근 200줄
sudo journalctl -u nlq-server --since "1 hour ago"  # 1시간 이내

# ── 소스 업데이트 배포 ──
cd /data/analytics/source
git pull origin main
cp -r nlq-server/* /data/analytics/app/
cp package.json package-lock.json /data/analytics/app/
cd /data/analytics/app && npm install --omit=dev
sudo systemctl restart nlq-server

# ── nginx ──
sudo nginx -t                         # 설정 검증
sudo systemctl reload nginx           # 무중단 리로드
```

---

## 트러블슈팅

### ❌ "ECONNREFUSED 127.0.0.1:3306" — MariaDB 연결 실패

```bash
# MariaDB 실행 확인
sudo systemctl status mariadb

# .env DB 설정 확인
cat /data/analytics/config/.env | grep DB_

# DB 접속 테스트
mysql -u company -p -h localhost company_board -e "SELECT 1;"
```

### ❌ "502 Bad Gateway" — nginx → Node.js 연결 실패

```bash
# nlq-server 실행 중인지 확인
sudo systemctl status nlq-server

# 포트 리스닝 확인
ss -tlnp | grep 3000

# SELinux 차단 확인
sudo ausearch -m avc -ts recent | grep nginx

# SELinux 프록시 허용 (누락된 경우)
sudo setsebool -P httpd_can_network_connect 1
```

### ❌ "EACCES: permission denied" — 파일 권한 문제

```bash
# 소유권 확인
ls -la /data/analytics/app/

# 소유권 재설정
sudo chown -R knaraadm:knaraadm /data/analytics
```

### ❌ "Error: Cannot find module" — npm 모듈 누락

```bash
cd /data/analytics/app
npm install --omit=dev
```

### ❌ PPT 보고서 생성 실패 — Python 모듈 누락

```bash
# Python 모듈 확인
python3 -c "import pymysql; import pptx; import matplotlib; import openpyxl; print('OK')"

# 누락 시 설치
sudo pip3 install pymysql python-pptx matplotlib openpyxl
```

### ❌ 한글 깨짐 — MariaDB charset

```bash
# charset 확인
mysql -u company -p company_board -e "SHOW VARIABLES LIKE 'character_set%';"

# character_set_client, character_set_connection, character_set_results 모두 utf8mb4 이어야 함
# 아니면 /etc/my.cnf.d/charset.cnf 수정 후 MariaDB 재시작
```

### ❌ "429 Rate limit" 또는 "insufficient_quota" — LLM API 크레딧

```bash
# GenSpark API 키 유효성 확인
curl -s https://www.genspark.ai/api/llm_proxy/v1/models \
  -H "Authorization: Bearer $(grep OPENAI_API_KEY /data/analytics/config/.env | cut -d= -f2)"
```

---

## 보안 체크리스트

- [x] `.env` 파일 권한 `600` (소유자만 읽기)
- [x] 3000 포트 외부 비노출 (nginx 프록시만 접근)
- [x] SELinux Enforcing 유지
- [x] firewalld HTTP/HTTPS만 허용
- [x] systemd `ProtectSystem`, `PrivateTmp` 활성화
- [x] knaraadm 계정으로 서비스 실행 (서버 접속 계정)
- [ ] HTTPS 인증서 적용 (운영 환경 필수)
- [ ] SESSION_SECRET 고정값 설정 (.env)
- [ ] GW_API_KEY 실제 운영용 키로 변경
- [ ] DB 비밀번호 강력한 값으로 변경
