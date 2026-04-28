package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.request.OntologyColumnSaveRequest;
import com.company.module.profit.dto.response.FieldListResponse;
import com.company.module.profit.dto.response.OntologyColumnResponse;
import com.company.module.profit.service.MetricService;
import com.company.module.profit.service.OntologyService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/profit-api/ontology")
@RequiredArgsConstructor
public class OntologyController {

    private final OntologyService ontologyService;
    private final MetricService metricService;

    /* ───────── 컬럼 목록 조회 ───────── */

    @GetMapping("/columns")
    public ResponseEntity<ApiResponse<Page<OntologyColumnResponse>>> getList(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.success(ontologyService.getList(q, page, size)));
    }

    /* ───────── 단건 조회 ───────── */

    @GetMapping("/columns/{id}")
    public ResponseEntity<ApiResponse<OntologyColumnResponse>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(ontologyService.getById(id)));
    }

    /* ───────── 테이블별 조회 ───────── */

    @GetMapping("/columns/by-table")
    public ResponseEntity<ApiResponse<List<OntologyColumnResponse>>> getByTableName(
            @RequestParam String tableName) {
        return ResponseEntity.ok(ApiResponse.success(ontologyService.getByTableName(tableName)));
    }

    /* ───────── 테이블 목록 ───────── */

    @GetMapping("/tables")
    public ResponseEntity<ApiResponse<List<String>>> getDistinctTableNames() {
        return ResponseEntity.ok(ApiResponse.success(ontologyService.getDistinctTableNames()));
    }

    /* ───────── 컬럼 그룹 목록 ───────── */

    @GetMapping("/column-groups")
    public ResponseEntity<ApiResponse<List<String>>> getDistinctColumnGroups() {
        return ResponseEntity.ok(ApiResponse.success(ontologyService.getDistinctColumnGroups()));
    }

    /* ───────── 비주얼 쿼리 빌더용 필드 목록 ───────── */

    @GetMapping("/fields")
    public ResponseEntity<ApiResponse<FieldListResponse>> getFieldList() {
        FieldListResponse fieldList = ontologyService.getFieldList();
        // Metric 필드도 함께 조합하여 비주얼 쿼리 빌더에 전달
        var metrics = metricService.getAllWithSynonyms();
        var metricFields = metrics.stream()
                .map(m -> FieldListResponse.MetricField.builder()
                        .metricId(m.getMetricId())
                        .metricCode(m.getMetricCode())
                        .metricName(m.getMetricName())
                        .aggregation(m.getAggregation())
                        .formula(m.getFormula())
                        .tableName(m.getTableName())
                        .unit(m.getUnit())
                        .build())
                .collect(java.util.stream.Collectors.toList());
        FieldListResponse enriched = FieldListResponse.builder()
                .fieldGroups(fieldList.getFieldGroups())
                .metricFields(metricFields)
                .build();
        return ResponseEntity.ok(ApiResponse.success(enriched));
    }

    /* ───────── 생성 ───────── */

    @PostMapping("/columns")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<OntologyColumnResponse>> save(
            @Valid @RequestBody OntologyColumnSaveRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(ApiResponse.created(
                ontologyService.save(request, userDetails.getUsername())));
    }

    /* ───────── 수정 ───────── */

    @PutMapping("/columns/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<OntologyColumnResponse>> update(
            @PathVariable Long id,
            @Valid @RequestBody OntologyColumnSaveRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        return ResponseEntity.ok(ApiResponse.success(
                ontologyService.update(id, request, userDetails.getUsername())));
    }

    /* ───────── 삭제 ───────── */

    @DeleteMapping("/columns/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        ontologyService.delete(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    /* ───────── 동의어 개별 추가 ───────── */

    @PostMapping("/columns/{columnId}/synonyms")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<OntologyColumnResponse>> addSynonym(
            @PathVariable Long columnId,
            @RequestParam String synonymText,
            @RequestParam(required = false, defaultValue = "MANUAL") String source) {
        return ResponseEntity.ok(ApiResponse.created(
                ontologyService.addSynonym(columnId, synonymText, source)));
    }

    /* ───────── 동의어 개별 삭제 ───────── */

    @DeleteMapping("/synonyms/{synonymId}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<Void>> removeSynonym(@PathVariable Long synonymId) {
        ontologyService.removeSynonym(synonymId);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
