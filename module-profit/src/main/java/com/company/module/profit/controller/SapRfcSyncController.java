package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.request.SapRfcSyncRequest;
import com.company.module.profit.dto.response.SapRfcSyncResponse;
import com.company.module.profit.entity.BatchStatus;
import com.company.module.profit.sap.SapRfcSyncService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;
import java.util.Map;

/**
 * SAP RFC 데이터 동기화 API
 *
 * <ul>
 *   <li>POST /profit-api/sap-rfc/execute - 수동 실행</li>
 *   <li>GET  /profit-api/sap-rfc/check/{cmonth} - 해당 월 기존 데이터 건수 확인</li>
 *   <li>GET  /profit-api/sap-rfc/monthly-summary - 월별 데이터 현황</li>
 * </ul>
 *
 * <p>[PR #332] Node.js 인터페이스 라우팅(interfaceId / rfcName / targetTable) 을
 * body 로 받아 두 인터페이스(NLP_RFC_001 수익성 / NLP_RFC_002 제조원가) 를 하나의
 * 실행 경로에서 처리하도록 확장. 세 필드가 없으면 기존 수익성 동작 유지.</p>
 */
@RestController
@RequestMapping("/profit-api/sap-rfc")
@RequiredArgsConstructor
@Slf4j
public class SapRfcSyncController {

    private final SapRfcSyncService sapRfcSyncService;

    /**
     * SAP RFC 동기화 수동 실행
     * - 비동기 실행: 즉시 작업 ID 반환, 백그라운드에서 처리
     * - jobId 전달 시: Node.js가 이미 생성한 batch_jobs 레코드 재사용
     * - jobId 미전달: Spring Boot가 새 batch_jobs 레코드 생성
     *
     * <p>[PR #332] rfcName / targetTable 필드가 있으면 그 값을 그대로 실행에 사용.
     * 없으면 수익성분석 기본값(Z_BI_WEB_EX_BL / bw_profitability_data) 을 사용하여
     * 스케줄러 / 기존 클라이언트와 후위호환.</p>
     */
    @PostMapping("/execute")
    public ResponseEntity<ApiResponse<SapRfcSyncResponse>> execute(
            @Valid @RequestBody SapRfcSyncRequest request,
            Principal principal) {

        String userId = principal != null ? principal.getName() : "system";
        String cmonth = request.getCmonth();
        String mode = request.getMode();

        // [PR #332] 인터페이스 라우팅 정보 로그
        log.info("[SAP RFC API] 실행 요청 - cmonth={}, mode={}, user={}, jobId={},"
                + " interfaceId={}, rfcName={}, targetTable={}",
                cmonth, mode, userId, request.getJobId(),
                request.getInterfaceId(), request.getRfcName(), request.getTargetTable());

        // 실행 중인 배치가 있는지 확인 (jobId 전달 시 자기 자신 제외)
        boolean hasRunning = request.getJobId() != null
                ? sapRfcSyncService.hasRunningBatchExcluding(request.getJobId())
                : sapRfcSyncService.hasRunningBatch();
        if (hasRunning) {
            return ResponseEntity.badRequest().body(
                    ApiResponse.fail("이미 실행 중인 배치 작업이 있습니다. 완료 후 다시 시도해주세요."));
        }

        // [PR #332] 기존 데이터 건수 조회 — targetTable 인지 처리
        //   (rfcName / targetTable 이 blank 이면 기본 수익성 테이블 사용)
        long existingCount = sapRfcSyncService.countExistingData(
                cmonth, request.getTargetTable());

        // 배치 작업 처리
        BatchStatus batch;
        if (request.getJobId() != null) {
            // Node.js가 이미 생성한 batch_jobs 레코드 사용
            batch = sapRfcSyncService.getOrCreateBatchJob(request.getJobId(), cmonth, mode, userId);
        } else {
            // Spring Boot 단독 호출 - 새 레코드 생성
            batch = sapRfcSyncService.createBatchJob(cmonth, mode, userId);
        }

        // [PR #332] 비동기 실행 시작 — rfcName / targetTable 전달
        //   (null/blank 이면 서비스 내부에서 수익성분석 기본값으로 폴백)
        sapRfcSyncService.executeAsync(
                batch.getId(), cmonth, mode, userId,
                request.getRfcName(),
                request.getTargetTable());

        SapRfcSyncResponse response = SapRfcSyncResponse.fromBatch(batch, cmonth, mode, existingCount);
        return ResponseEntity.ok(ApiResponse.created(response));
    }

    /**
     * 해당 월 기존 데이터 건수 확인
     * <p>[PR #332] 기존 수익성 전용 엔드포인트로 유지. Node.js pre-flight 헬스체크가
     * 이 경로를 여전히 호출하므로 시그니처를 바꾸지 않음.</p>
     */
    @GetMapping("/check/{cmonth}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> check(@PathVariable String cmonth) {
        if (cmonth == null || !cmonth.matches("^\\d{6}$")) {
            return ResponseEntity.badRequest().body(ApiResponse.fail("유효하지 않은 년월 형식 (YYYYMM)"));
        }

        long count = sapRfcSyncService.countExistingData(cmonth);
        boolean hasRunning = sapRfcSyncService.hasRunningBatch();

        return ResponseEntity.ok(ApiResponse.success(Map.of(
                "cmonth", cmonth,
                "existingCount", count,
                "hasRunningBatch", hasRunning
        )));
    }

    /**
     * 월별 데이터 현황 조회 (수익성분석 대시보드 전용)
     */
    @GetMapping("/monthly-summary")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> monthlySummary() {
        return ResponseEntity.ok(ApiResponse.success(sapRfcSyncService.getMonthlyDataSummary()));
    }
}
