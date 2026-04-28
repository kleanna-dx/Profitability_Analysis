package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.request.JoinConditionSaveRequest;
import com.company.module.profit.dto.response.JoinConditionResponse;
import com.company.module.profit.service.JoinConditionService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;

/**
 * JOIN 조건 관리 API
 * - BW 데이터 테이블 간의 연결 조건을 관리
 * - SQL 생성 시 ON 절에 자동 적용
 */
@RestController
@RequestMapping("/profit-api/joins")
@RequiredArgsConstructor
public class JoinConditionController {

    private final JoinConditionService joinConditionService;

    @GetMapping
    public ResponseEntity<ApiResponse<Page<JoinConditionResponse>>> getList(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.success(joinConditionService.getList(q, page, size)));
    }

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<JoinConditionResponse>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(joinConditionService.getById(id)));
    }

    @PostMapping
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<JoinConditionResponse>> save(
            @Valid @RequestBody JoinConditionSaveRequest request,
            Principal principal) {
        String createdBy = principal != null ? principal.getName() : "system";
        return ResponseEntity.ok(ApiResponse.created(joinConditionService.save(request, createdBy)));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<JoinConditionResponse>> update(
            @PathVariable Long id,
            @Valid @RequestBody JoinConditionSaveRequest request,
            Principal principal) {
        String updatedBy = principal != null ? principal.getName() : "system";
        return ResponseEntity.ok(ApiResponse.success(joinConditionService.update(id, request, updatedBy)));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasRole('ADMIN')")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id, Principal principal) {
        String updatedBy = principal != null ? principal.getName() : "system";
        joinConditionService.delete(id, updatedBy);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    /**
     * 특정 테이블이 포함된 JOIN 조건 조회
     */
    @GetMapping("/by-table")
    public ResponseEntity<ApiResponse<List<JoinConditionResponse>>> getByTable(
            @RequestParam String tableName) {
        return ResponseEntity.ok(ApiResponse.success(joinConditionService.getByTableInvolved(tableName)));
    }

    /**
     * 두 테이블 간 JOIN 조건 조회
     */
    @GetMapping("/by-table-pair")
    public ResponseEntity<ApiResponse<List<JoinConditionResponse>>> getByTablePair(
            @RequestParam String table1,
            @RequestParam String table2) {
        return ResponseEntity.ok(ApiResponse.success(joinConditionService.getByTablePair(table1, table2)));
    }

    /**
     * 전체 활성 JOIN 조건 조회 (RAG 인덱스 구축용)
     */
    @GetMapping("/all-active")
    public ResponseEntity<ApiResponse<List<JoinConditionResponse>>> getAllActive() {
        return ResponseEntity.ok(ApiResponse.success(joinConditionService.getAllActive()));
    }
}
