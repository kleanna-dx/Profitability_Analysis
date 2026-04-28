package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.request.MetricSaveRequest;
import com.company.module.profit.dto.response.MetricResponse;
import com.company.module.profit.service.MetricService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;

/**
 * Metric(계산 지표) 관리 API
 * - 수익성분석에 사용되는 계산식 정의 및 동의어 관리
 * - AI는 공식을 창작하지 않고, 이 사전에 등록된 수식만 사용
 */
@RestController
@RequestMapping("/profit-api/metrics")
@RequiredArgsConstructor
public class MetricController {

    private final MetricService metricService;

    @GetMapping
    public ResponseEntity<ApiResponse<Page<MetricResponse>>> getList(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.success(metricService.getList(q, page, size)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<MetricResponse>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(metricService.getById(id)));
    }

    @GetMapping("/code/{code}")
    public ResponseEntity<ApiResponse<MetricResponse>> getByCode(@PathVariable String code) {
        return ResponseEntity.ok(ApiResponse.success(metricService.getByCode(code)));
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<MetricResponse>> save(
            @Valid @RequestBody MetricSaveRequest request,
            Principal principal) {
        String createdBy = principal != null ? principal.getName() : "system";
        return ResponseEntity.ok(ApiResponse.created(metricService.save(request, createdBy)));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<MetricResponse>> update(
            @PathVariable Long id,
            @Valid @RequestBody MetricSaveRequest request,
            Principal principal) {
        String updatedBy = principal != null ? principal.getName() : "system";
        return ResponseEntity.ok(ApiResponse.success(metricService.update(id, request, updatedBy)));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id, Principal principal) {
        String updatedBy = principal != null ? principal.getName() : "system";
        metricService.delete(id, updatedBy);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    /**
     * 전체 Metric 조회 (동의어 포함, RAG 인덱스 구축용)
     */
    @GetMapping("/all-with-synonyms")
    public ResponseEntity<ApiResponse<List<MetricResponse>>> getAllWithSynonyms() {
        return ResponseEntity.ok(ApiResponse.success(metricService.getAllWithSynonyms()));
    }

    /**
     * 테이블별 Metric 조회 (동의어 포함)
     */
    @GetMapping("/by-table")
    public ResponseEntity<ApiResponse<List<MetricResponse>>> getByTable(
            @RequestParam String tableName) {
        return ResponseEntity.ok(ApiResponse.success(metricService.getByTableName(tableName)));
    }
}
