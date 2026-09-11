# module-simulation (경영시뮬레이션 — Rolling Planning Simulation)

## 모듈 설명
경영시뮬레이션 모듈로, 생산량 변동 시 전체 비용(원부재료비/전력비/물류비/인건비/감가상각/판관비)의 인과관계를 시뮬레이션하고 영업이익 영향을 분석하는 시스템입니다.

**기존 수익성분석 시스템**(module-profit)에 **새 탭으로 추가**되는 업무 모듈입니다.

## 주요 기능
1. **P/L 시뮬레이터** — 생산량 슬라이더 조정 → 전체 비용 변동 + 영업이익 즉시 계산
2. **KPI 인과관계 네트워크 맵** — 생산량 → 변동비 → 고정비 → 영업이익 노드 기반 시각화 (아모레퍼시픽 SCI BI 스타일)
3. **지종별 원재료비 드릴다운** — SC고평량/SC저평량/ACB/IV/CB/KB 6개 지종별 원단위 분석
4. **비용 원단위 자동 계산** — DB에서 원재료비/전력비/물류비 원단위를 자동 로드
5. **가동시간 관리** — 월별 호기별 가동일수/비가동일수 입력
6. **데이터 준비 현황 대시보드** — 모듈별 데이터 적재 상태 확인

## 생성 테이블 목록

| 테이블명 | 설명 | Prefix |
|----------|------|--------|
| `rpsim_unit` | 호기(생산설비) 마스터 | rpsim_ |
| `rpsim_material` | 원부자재 마스터 | rpsim_ |
| `rpsim_raw_record` | SAP BW 원본 데이터 (핵심) | rpsim_ |
| `rpsim_machine_capacity` | 호기별 시간당 생산능력 | rpsim_ |
| `rpsim_operating_time` | 월별 가동시간 | rpsim_ |
| `rpsim_pw_line` | 전력비 호기 마스터 | rpsim_ |
| `rpsim_pw_tariff` | 한전 요금 단가 | rpsim_ |
| `rpsim_pw_result` | 전력비 계산 결과 | rpsim_ |
| `rpsim_logi_rate` | 해상 운임 단가 | rpsim_ |
| `rpsim_logi_exchange_rate` | 월별 환율 | rpsim_ |
| `rpsim_logi_cost_local` | 국내 출발항 운임 | rpsim_ |
| `rpsim_batch_job` | 배치 실행 이력 | rpsim_ |

> **주의**: 기존 `profit_` prefix 테이블과 충돌하지 않도록 `rpsim_` prefix를 사용합니다.

## API 목록

| Method | URL | 설명 |
|--------|-----|------|
| GET | `/simulation-api/cost-unit-rates` | 비용 원단위 조회 (ym, machine, division) |
| GET | `/simulation-api/data-readiness` | 데이터 준비 현황 (ym, division) |
| GET | `/simulation-api/operating-time` | 호기별 가동시간 조회 (division, machineCode) |
| GET | `/simulation-api/operating-time/by-ym` | 월별 전체 호기 가동시간 조회 (division, ym) |
| POST | `/simulation-api/operating-time` | 가동시간 저장/수정 |

## 메뉴 등록 요청 정보

| 항목 | 값 |
|------|------|
| 메뉴명 | 경영시뮬레이션 |
| 메뉴 위치 | 수익성분석 > 경영시뮬레이션 |
| 메뉴 URL | /simulation |
| API Prefix | /simulation-api |

## 권한 코드 목록

| 코드 | 설명 |
|------|------|
| `SIMULATION_READ` | 시뮬레이션 조회 |
| `SIMULATION_WRITE` | 시뮬레이션 데이터 입력/수정 |
| `SIMULATION_DELETE` | 시뮬레이션 데이터 삭제 |

**관리자 권한**: SIMULATION_READ, SIMULATION_WRITE, SIMULATION_DELETE
**일반 사용자 권한**: SIMULATION_READ, SIMULATION_WRITE
**조회 사용자 권한**: SIMULATION_READ

## SQL 실행 순서

```
1. sql/module-simulation/01_schema.sql    -- DDL (12개 테이블)
2. sql/module-simulation/02_seed_data.sql -- 초기 데이터 (환율 등)
```

## 프로젝트 구조

```
module-simulation/
├── build.gradle
└── src/main/java/com/company/module/simulation/
    ├── controller/
    │   ├── SimulationController.java       -- P/L 시뮬레이터 API
    │   └── OperatingTimeController.java    -- 가동시간 관리 API
    ├── dto/
    │   ├── request/
    │   │   └── OperatingTimeSaveRequest.java
    │   └── response/
    │       ├── CostUnitRateResponse.java    -- 비용 원단위 응답
    │       ├── DataReadinessResponse.java   -- 데이터 준비 현황
    │       └── OperatingTimeResponse.java
    ├── entity/
    │   ├── RawRecord.java                   -- SAP BW 원본 데이터
    │   └── OperatingTime.java               -- 가동시간
    ├── repository/
    │   ├── RawRecordRepository.java
    │   └── OperatingTimeRepository.java
    └── service/
        ├── SimulationService.java           -- 핵심 비즈니스 로직
        └── OperatingTimeService.java

sql/module-simulation/
├── 01_schema.sql      -- DDL (rpsim_ prefix)
├── 02_seed_data.sql   -- 초기 데이터
└── README.md          -- 본 문서
```

## 운영 반영 시 필요한 설정

1. `settings.gradle`에 `include 'module-simulation'` 추가
2. `app/build.gradle`에 `implementation project(':module-simulation')` 추가
3. DB에 `01_schema.sql`, `02_seed_data.sql` 순서대로 실행
4. 메뉴/권한 등록 (위 표 참조)

## React 프론트엔드 통합

기존 수익성분석 시스템의 React 앱에 **새 탭으로 추가**합니다.

프론트엔드 코드는 현재 별도 Cloudflare Pages 앱(`management-simulation_2607`)에서 운영 중이며,
통합 시 해당 HTML/CSS/JS를 React 컴포넌트로 변환하여 탑재합니다.

주요 프론트엔드 컴포넌트:
- `SimulationTab.tsx` — 탭 진입점
- `PLSimulator.tsx` — P/L 시뮬레이터 (슬라이더 + 비용 계산)
- `CausalNetworkMap.tsx` — KPI 인과관계 네트워크 맵 (SVG)
- `MaterialDrilldown.tsx` — 지종별 원재료비 드릴다운
- `DataReadiness.tsx` — 데이터 준비 현황 대시보드

## core에 추가로 필요한 기능

- `CurrentUserProvider` — 현재 로그인 사용자 ID 조회
  - 현재 OperatingTimeController에서 `currentUserId = 1L`로 임시 설정
  - core에서 CurrentUserProvider 제공 시 실제 사용자 ID 주입 필요

## 자체 검수 체크리스트

| 번호 | 검수 항목 | 결과 | 비고 |
|------|----------|------|------|
| 1 | User/Auth/Role/Menu/Security 관련 클래스 생성 여부 | 통과 | 미생성 |
| 2 | SecurityConfig, JwtProvider, AuthController 생성 여부 | 통과 | 미생성 |
| 3 | application.yml, application.properties 생성 여부 | 통과 | 미생성 |
| 4 | Dockerfile, docker-compose.yml, Nginx 설정 생성 여부 | 통과 | 미생성 |
| 5 | SpringBootApplication main class 생성 여부 | 통과 | 미생성 |
| 6 | API URL이 /{모듈명}-api/** 규칙 준수 | 통과 | /simulation-api/** |
| 7 | 금지 URL /api/**, /admin/**, /auth/** 미사용 | 통과 | |
| 8 | Entity에 @Setter 미사용 | 통과 | |
| 9 | Entity에 @Data 미사용 | 통과 | |
| 10 | Service에서 entity.setXxx() 미사용 | 통과 | update() 메서드 사용 |
| 11 | 모든 Entity 컬럼에 @Column(name = "UPPER_SNAKE_CASE") | 통과 | |
| 12 | 모든 업무 테이블에 공통 컬럼 포함 | 통과 | CREATED_AT~DELETED_BY |
| 13 | 삭제 기능이 DELETED_YN 기반 소프트 삭제 | 통과 | |
| 14 | 모든 테이블/컬럼에 COMMENT | 통과 | |
| 15 | SQL에 DROP TABLE 미사용 | 통과 | |
| 16 | SQL에 TRUNCATE TABLE 미사용 | 통과 | |
| 17 | SQL에 무조건 DELETE 미사용 | 통과 | |
| 18 | SQL에 ALTER TABLE DROP COLUMN 미사용 | 통과 | |
| 19 | core 테이블에 FK 미생성 | 통과 | |
| 20 | Controller 응답이 ApiResponse<T>로 감싸짐 | 통과 | |
| 21 | Entity를 Controller에서 직접 반환 미사용 | 통과 | Response DTO 사용 |
| 22 | RuntimeException 직접 throw 미사용 | 통과 | |
| 23 | DDL을 SQL로 제공 | 통과 | 01_schema.sql |
| 24 | core 모듈 미수정 | 통과 | |
| 25 | app 모듈 미수정 | 통과 | |
| 26 | 메뉴/권한 등록 정보 README.md 작성 | 통과 | |
| 27 | core에 필요한 기능 README.md 명시 | 통과 | CurrentUserProvider |
