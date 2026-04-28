package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.response.BatchStatusResponse;
import com.company.module.profit.service.BatchStatusService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;
import java.util.Map;

/**
 * 배치 상태 관리 API
 * - SAP 마감 → BW DB DATA 생성 배치의 실행 상태 추적
 * - 데이터 검증/정합성 체크 결과 조회
 */
@RestController
@RequestMapping("/profit-api/batches")
@RequiredArgsConstructor
public class BatchStatusController {

    private final BatchStatusService batchStatusService;

    /**
     * 배치 상태 목록 조회 (페이징 + 필터)
     */
    @GetMapping
    public ResponseEntity<ApiResponse<Page<BatchStatusResponse>>> getList(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String batchType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(ApiResponse.success(
                batchStatusService.getList(status, batchType, page, size)));
    }

    /**
     * 배치 상태 단건 조회
     */
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<BatchStatusResponse>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.getById(id)));
    }

    /**
     * 배치 등록 (관리자)
     */
    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<BatchStatusResponse>> create(
            @RequestParam String batchName,
            @RequestParam String batchType,
            @RequestParam(required = false) String sourceSystem,
            @RequestParam(required = false) String targetTable,
            @RequestParam(required = false) Long totalRows,
            @RequestParam(required = false) Integer periodYear,
            @RequestParam(required = false) Integer periodMonth,
            Principal principal) {
        String createdBy = principal != null ? principal.getName() : "system";
        return ResponseEntity.ok(ApiResponse.created(
                batchStatusService.create(batchName, batchType, sourceSystem,
                        targetTable, totalRows, periodYear, periodMonth, createdBy)));
    }

    /**
     * 배치 시작
     */
    @PatchMapping("/{id}/start")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<BatchStatusResponse>> start(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.start(id)));
    }

    /**
     * 배치 완료
     */
    @PatchMapping("/{id}/complete")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<BatchStatusResponse>> complete(
            @PathVariable Long id,
            @RequestParam Long processedRows,
            @RequestParam(defaultValue = "0") Long errorRows) {
        return ResponseEntity.ok(ApiResponse.success(
                batchStatusService.complete(id, processedRows, errorRows)));
    }

    /**
     * 배치 실패
     */
    @PatchMapping("/{id}/fail")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<BatchStatusResponse>> fail(
            @PathVariable Long id,
            @RequestParam String errorMessage) {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.fail(id, errorMessage)));
    }

    /**
     * 기간별 배치 조회
     */
    @GetMapping("/by-period")
    public ResponseEntity<ApiResponse<List<BatchStatusResponse>>> getByPeriod(
            @RequestParam Integer year,
            @RequestParam(required = false) Integer month) {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.getByPeriod(year, month)));
    }

    /**
     * 상태별 배치 수 통계
     */
    @GetMapping("/summary")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> getStatusSummary() {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.getStatusSummary()));
    }
}
