# Module-Profit 독립 실행 가이드

## 개요
SAP BW 시스템에서 RFC 함수(Z_BI_WEB_EX_BL)를 호출하여
`bw_profitability_data` 테이블에 수익성분석 데이터를 동기화합니다.

## 1. SAP JCo 파일 배치

두 파일 모두 `libs/` 폴더에 넣습니다:
```
module-profit/libs/
├── sapjco3.jar           ← JCo Java 라이브러리
└── libsapjco3.so         ← JCo 네이티브 라이브러리 (Linux)
```

## 2. 빌드

```bash
cd /data/analytics/source/module-profit
./gradlew clean bootJar -x test
```

빌드 결과: `build/libs/module-profit.jar`

## 3. JAR 복사 및 실행

```bash
# JAR를 app 디렉토리에 복사
cp build/libs/module-profit.jar /data/analytics/app/

# 실행
java -Djava.library.path=/data/analytics/source/module-profit/libs \
     -jar /data/analytics/app/module-profit.jar
```

또는 설정 파일을 외부에서 지정:
```bash
java -Djava.library.path=/data/analytics/source/module-profit/libs \
     -jar /data/analytics/app/module-profit.jar \
     --spring.config.location=file:/data/analytics/config/application-profit.yml
```

## 4. systemctl 서비스 등록 (선택)

`/etc/systemd/system/module-profit.service`:
```ini
[Unit]
Description=Module-Profit SAP RFC Sync
After=network.target mariadb.service

[Service]
Type=simple
User=knaraadm
ExecStart=/usr/bin/java \
    -Djava.library.path=/data/analytics/source/module-profit/libs \
    -Xmx512m \
    -jar /data/analytics/app/module-profit.jar
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable module-profit
sudo systemctl start module-profit
sudo systemctl status module-profit
```

## 5. API 확인

```bash
# 헬스체크
curl http://localhost:18083/profit-api/sap-rfc/check/202604

# 수동 실행
curl -X POST http://localhost:18083/profit-api/sap-rfc/execute \
     -H "Content-Type: application/json" \
     -d '{"cmonth":"202604","mode":"replace"}'
```

## 6. 서버 정보

| 항목 | 값 |
|------|-----|
| Spring Boot 포트 | 18083 |
| SAP 서버 | 10.2.14.220:01 (BWP) |
| DB 서버 | 10.2.14.247:3306 (integration) |
| RFC 함수 | Z_BI_WEB_EX_BL |
