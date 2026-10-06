package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.MaterialSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.MaterialResponse;
import com.company.module.rollingplanningsimulation.service.MaterialService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/materials") @RequiredArgsConstructor
public class MaterialController {
    private final MaterialService materialService;

    @GetMapping
    public ResponseEntity<ApiResponse<Page<MaterialResponse>>> getList(@RequestParam(required = false) String q, @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "50") int size) {
        return ResponseEntity.ok(ApiResponse.success(materialService.getList(q, page, size)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<MaterialResponse>> save(@Valid @RequestBody MaterialSaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.created(materialService.save(request, currentUserId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<MaterialResponse>> update(@PathVariable Long id, @Valid @RequestBody MaterialSaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.success(materialService.update(id, request, currentUserId)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        Long currentUserId = 1L;
        materialService.delete(id, currentUserId);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
