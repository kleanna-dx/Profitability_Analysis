# SAP RFC 동기화 설정 가이드

## 개요
SAP BW 시스템에서 RFC 함수(Z_BI_WEB_EX_BL)를 호출하여
`bw_profitability_data` 테이블에 수익성분석 데이터를 동기화합니다.

## 1. SAP JCo 설치

### 1-1. SAP JCo 3.1 다운로드
- SAP Service Marketplace (https://support.sap.com) 에서 다운로드
- 또는 SAP Note 2786882 참조

### 1-2. 파일 배치
```
module-profit/
├── libs/
│   └── sapjco3.jar          ← JCo Java 라이브러리
└── ...

/usr/lib/ (또는 LD_LIBRARY_PATH)
└── libsapjco3.so             ← JCo 네이티브 라이브러리 (Linux)
```

### 1-3. 환경 변수 설정
```bash
# Linux
export LD_LIBRARY_PATH=/usr/lib:$LD_LIBRARY_PATH

# 또는 /etc/ld.so.conf.d/sapjco.conf 에 추가
echo "/usr/lib" > /etc/ld.so.conf.d/sapjco.conf
ldconfig
```

## 2. application.yml 설정

```yaml
sap:
  rfc:
    # SAP 연결 정보
    ashost: 10.2.14.220        # SAP 어플리케이션 서버
    sysnr: "01"                # 인스턴스 번호
    sysid: BWP                 # 시스템 ID
    client: "100"              # 클라이언트(만트)
    user: ITM120               # 로그인 사용자
    passwd: kleannara123@      # 로그인 비밀번호
    lang: KO                   # 언어
    rfc-function: Z_BI_WEB_EX_BL  # RFC 함수명

    # 커넥션 풀
    pool-capacity: 3
    peak-limit: 5

    # 스케줄러
    schedule:
      enabled: true            # 자동 동기화 활성화
      cron: "0 0 2 1 * *"      # 매월 1일 새벽 2시
      daily-cron: "0 0 6 * * *" # (선택) 매일 새벽 6시
```

## 3. API 사용법

### 3-1. 수동 실행 (관리자)
```bash
POST /profit-api/sap-rfc/execute
Content-Type: application/json
Authorization: Bearer {JWT_TOKEN}

{
  "cmonth": "202604",
  "mode": "replace"
}
```

mode 옵션:
- `replace`: 해당 월 기존 데이터 삭제 후 INSERT (기본)
- `append`: 기존 데이터 유지, 추가 INSERT
- `dry-run`: RFC 호출만 (DB INSERT 안 함)

### 3-2. 실행 전 확인
```bash
GET /profit-api/sap-rfc/check/202604
```
응답: 해당 월 기존 데이터 건수 + 실행 중인 배치 여부

### 3-3. 월별 데이터 현황
```bash
GET /profit-api/sap-rfc/monthly-summary
```

### 3-4. 배치 상태 조회
```bash
GET /profit-api/batches?batchType=SAP_RFC_SYNC&page=0&size=20
GET /profit-api/batches/{id}
```

## 4. SAP 연결 정보

| 항목 | 값 |
|------|-----|
| 어플리케이션 서버 | 10.2.14.220 |
| 인스턴스 번호 | 01 |
| 시스템 ID | BWP |
| 클라이언트 | 100 |
| RFC 함수 | Z_BI_WEB_EX_BL |
| 입력 파라미터 | I_CMONTH (YYYYMM) |
| 출력 테이블 | T_DATA |

## 5. 대상 DB

| 항목 | 값 |
|------|-----|
| 호스트 | 10.2.14.247 |
| 포트 | 3306 |
| 데이터베이스 | integration |
| 테이블 | bw_profitability_data |

## 6. 트러블슈팅

### JCo 라이브러리 오류
```
ClassNotFoundException: com.sap.conn.jco.JCoDestinationManager
```
→ `sapjco3.jar`가 classpath에 없음. `libs/` 디렉토리에 배치

### 네이티브 라이브러리 오류
```
UnsatisfiedLinkError: no sapjco3 in java.library.path
```
→ `libsapjco3.so`가 LD_LIBRARY_PATH에 없음

### SAP 연결 실패
```
JCoException: COMMUNICATION_FAILURE
```
→ SAP 서버(10.2.14.220) 접근 가능 여부 확인: `telnet 10.2.14.220 3301`
