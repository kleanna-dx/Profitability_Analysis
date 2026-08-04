# Spring Boot 반영 가이드 (PR #332)

## 목적
Node.js 는 PR #332 로 두 인터페이스(NLP_RFC_001 수익성 / NLP_RFC_002 제조원가) 를 모두
`POST /profit-api/sap-rfc/execute` 로 라우팅합니다. body 에 `rfc_name`, `target_table` 을
담아 보내므로, Spring Boot 도 이 값을 읽어 두 매핑을 분기 처리하도록 함께 배포해야 합니다.

Node.js 만 배포하고 Spring Boot 를 배포하지 않으면:
- 수익성분석 : **정상 동작** ✅ (Spring Boot 하드코딩된 `Z_BI_WEB_EX_BL` 과 우연히 일치)
- 제조원가   : **INSERT 실패** ⚠️ (Z_BI_WEB_EX_BL 이 T_DATA 를 반환하지만 sys_aimd_cot015
  스키마와 컬럼이 완전히 다르므로 매핑 실패. DB 오염 없음, batch_jobs 에 에러만 기록)

Spring Boot 까지 배포되면 두 인터페이스 모두 정상 동작합니다.

## 파일 3개
| 파일 | 원본 위치 (프로젝트 내) | 변경 요약 |
|---|---|---|
| `SapRfcSyncRequest.java`   | `.../module/profit/dto/request/SapRfcSyncRequest.java`     | 3개 필드 추가 (`interfaceId`, `rfcName`, `targetTable`) |
| `SapRfcSyncController.java`| `.../module/profit/controller/SapRfcSyncController.java`   | `execute()` 에서 신규 필드 로그 · 서비스 오버로드 호출 |
| `SapRfcSyncService.java`   | `.../module/profit/sap/SapRfcSyncService.java`             | `TableMapping` 전략 도입, 제조원가 매핑 추가, 오버로드 신설 |

## 반영 순서
1. 위 3개 Java 파일을 프로젝트 원본 위치에 **덮어쓰기** (파일 3개만 교체)
2. 빌드
   ```bash
   ./gradlew build
   # 또는
   mvn package
   ```
3. `module-profit.jar` 를 운영 서버에 재배포
4. Spring Boot 서비스 재시작
5. 검증
   - 수익성 예약 실행 → 정상 (기존과 동일)
   - 제조원가 예약 실행 → `Z_BI_WEB_EX_BL_4` 호출 + `sys_aimd_cot015` 적재 확인

## 후위호환 안전 장치
- 스케줄러(`SapRfcScheduler`) 가 호출하는 기존 4-arg `executeAsync(Long, String, String, String)`
  시그니처는 **삭제하지 않고 유지** — 내부에서 신규 6-arg 오버로드로 위임합니다.
- 신규 오버로드는 `rfcName`/`targetTable` 이 `null` 또는 빈 문자열이면
  **자동으로 수익성분석 기본값** (`Z_BI_WEB_EX_BL` / `bw_profitability_data`) 을 사용합니다.
- `application.yml` 의 `sap.rfc.rfc-function: "Z_BI_WEB_EX_BL"` 은 그대로 두어도 무방합니다
  (폴백 값으로만 사용됨).

## 파일 미변경 (참고)
- `SapRfcProperties.java` — 변경 없음 (rfcFunction 은 폴백값으로 유지)
- `SapRfcScheduler.java` — 변경 없음 (기존 4-arg 오버로드가 유지되므로 자동으로 수익성 경로)

## 검증 쿼리 (Spring Boot 배포 후)
```sql
-- 제조원가 실행 확인
SELECT id, interface_id, status, total_rows, inserted_rows,
       LEFT(log_text, 500) AS log_head
  FROM batch_jobs
 WHERE interface_id='NLP_RFC_002'
 ORDER BY id DESC LIMIT 5;

-- 적재 확인
SELECT CALMONTH, COUNT(*) AS cnt FROM sys_aimd_cot015
 GROUP BY CALMONTH ORDER BY CALMONTH DESC LIMIT 5;

-- 수익성 회귀 확인 (기존과 동일하게 유지되어야 함)
SELECT CALMONTH, COUNT(*) AS cnt FROM bw_profitability_data
 GROUP BY CALMONTH ORDER BY CALMONTH DESC LIMIT 5;
```
