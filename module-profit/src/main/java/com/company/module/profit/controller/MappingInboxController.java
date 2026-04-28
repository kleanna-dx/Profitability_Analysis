package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.request.MappingInboxResolveRequest;
import com.company.module.profit.dto.response.MappingInboxResponse;
import com.company.module.profit.service.MappingInboxService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;
import java.util.Map;

/**
 * 매핑 인박스 관리 API
 * - 미매핑 표현을 수집하고, 관리자가 검수하여 사전을 개선
 * - 미매핑 표현 → 승인 → Ontology/Metric 사전 반영 흐름
 */
@RestController
@RequestMapping("/profit-api/mapping-inbox")
@RequiredArgsConstructor
public class MappingInboxController {

    private final MappingInboxService mappingInboxService;

    /**
     * 미매핑 인박스 목록 조회 (페이징 + 필터)
     */
    @GetMapping
    public ResponseEntity<ApiResponse<Page<MappingInboxResponse>>> getList(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String termType,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(ApiResponse.success(
                mappingInboxService.getList(status, termType, page, size)));
    }

    /**
     * 미매핑 인박스 검색
     */
    @GetMapping("/search")
    public ResponseEntity<ApiResponse<Page<MappingInboxResponse>>> search(
            @RequestParam String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(ApiResponse.success(
                mappingInboxService.search(q, page, size)));
    }

    /**
     * 미매핑 인박스 단건 조회
     */
    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<MappingInboxResponse>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(mappingInboxService.getById(id)));
    }

    /**
     * 미매핑 용어 신고 (자연어 질의 중 매핑 실패 시 자동/수동 호출)
     */
    @PostMapping("/report")
    public ResponseEntity<ApiResponse<MappingInboxResponse>> report(
            @RequestParam String unmappedTerm,
            @RequestParam String termType,
            @RequestParam(required = false) String originalQuery) {
        return ResponseEntity.ok(ApiResponse.created(
                mappingInboxService.reportUnmapped(unmappedTerm, termType, originalQuery)));
    }

    /**
     * 미매핑 항목 처리 (승인/거절) - 관리자 전용
     */
    @PatchMapping("/{id}/resolve")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<MappingInboxResponse>> resolve(
            @PathVariable Long id,
            @Valid @RequestBody MappingInboxResolveRequest request,
            Principal principal) {
        String resolvedBy = principal != null ? principal.getName() : "system";
        return ResponseEntity.ok(ApiResponse.success(
                mappingInboxService.resolve(id, request, resolvedBy)));
    }

    /**
     * 대기 중인 미매핑 항목 수 조회
     */
    @GetMapping("/count-pending")
    public ResponseEntity<ApiResponse<Long>> countPending() {
        return ResponseEntity.ok(ApiResponse.success(mappingInboxService.countPending()));
    }

    /**
     * 유형별 대기 항목 수 통계
     */
    @GetMapping("/summary")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> getSummary() {
        return ResponseEntity.ok(ApiResponse.success(mappingInboxService.countPendingByTermType()));
    }
}
