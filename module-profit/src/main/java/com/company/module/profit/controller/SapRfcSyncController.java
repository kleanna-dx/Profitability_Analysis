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
 *   <li>POST /profit-api/sap-rfc/execute — 수동 실행 (관리자)</li>
 *   <li>GET  /profit-api/sap-rfc/check/{cmonth} — 해당 월 기존 데이터 건수 확인</li>
 *   <li>GET  /profit-api/sap-rfc/monthly-summary — 월별 데이터 현황</li>
 * </ul>
 */
@RestController
@RequestMapping("/profit-api/sap-rfc")
@RequiredArgsConstructor
@Slf4j
public class SapRfcSyncController {

    private final SapRfcSyncService sapRfcSyncService;

    /**
     * SAP RFC 동기화 수동 실행
     * - 관리자만 실행 가능
     * - 비동기 실행: 즉시 작업 ID 반환, 백그라운드에서 처리
     */
    @PostMapping("/execute")
    public ResponseEntity<ApiResponse<SapRfcSyncResponse>> execute(
            @Valid @RequestBody SapRfcSyncRequest request,
            Principal principal) {

        String userId = principal != null ? principal.getName() : "system";
        String cmonth = request.getCmonth();
        String mode = request.getMode();

        log.info("[SAP RFC API] 실행 요청 - cmonth={}, mode={}, user={}", cmonth, mode, userId);

        // 실행 중인 배치가 있는지 확인
        if (sapRfcSyncService.hasRunningBatch()) {
            return ResponseEntity.badRequest().body(
                    ApiResponse.fail("이미 실행 중인 배치 작업이 있습니다. 완료 후 다시 시도해주세요."));
        }

        // 기존 데이터 건수 조회
        long existingCount = sapRfcSyncService.countExistingData(cmonth);

        // 배치 작업 생성 (동기)
        BatchStatus batch = sapRfcSyncService.createBatchJob(cmonth, mode, userId);

        // 비동기 실행 시작
        sapRfcSyncService.executeAsync(batch.getBatchId(), cmonth, mode, userId);

        SapRfcSyncResponse response = SapRfcSyncResponse.fromBatch(batch, cmonth, mode, existingCount);
        return ResponseEntity.ok(ApiResponse.created(response));
    }

    /**
     * 해당 월 기존 데이터 건수 확인
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
     * 월별 데이터 현황 조회
     */
    @GetMapping("/monthly-summary")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> monthlySummary() {
        return ResponseEntity.ok(ApiResponse.success(sapRfcSyncService.getMonthlyDataSummary()));
    }
}
