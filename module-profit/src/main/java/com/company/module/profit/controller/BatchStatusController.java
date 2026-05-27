package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.response.BatchStatusResponse;
import com.company.module.profit.service.BatchStatusService;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 배치 작업 이력 API
 * - batch_jobs 테이블 조회 (Node.js와 테이블 공유)
 * - Spring Boot에서는 조회 전용 (생성/수정은 SapRfcSyncService에서 수행)
 */
@RestController
@RequestMapping("/profit-api/batches")
@RequiredArgsConstructor
public class BatchStatusController {

    private final BatchStatusService batchStatusService;

    /**
     * 배치 목록 조회 (페이징 + 필터)
     */
    @GetMapping
    public ResponseEntity<ApiResponse<Page<BatchStatusResponse>>> getList(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String jobType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(ApiResponse.success(
                batchStatusService.getList(status, jobType, page, size)));
    }

    /**
     * 배치 상태 단건 조회 (Node.js 폴링에서 사용)
     */
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<BatchStatusResponse>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.getById(id)));
    }

    /**
     * 입력년월(cmonth)별 배치 조회
     */
    @GetMapping("/by-cmonth")
    public ResponseEntity<ApiResponse<List<BatchStatusResponse>>> getByCmonth(
            @RequestParam String cmonth) {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.getByCmonth(cmonth)));
    }

    /**
     * 상태별 배치 수 통계
     */
    @GetMapping("/summary")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> getStatusSummary() {
        return ResponseEntity.ok(ApiResponse.success(batchStatusService.getStatusSummary()));
    }
}
