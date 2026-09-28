package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.LogiCostLocalSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.LogiCostLocalResponse;
import com.company.module.rollingplanningsimulation.service.LogiCostLocalService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/logi-cost-local") @RequiredArgsConstructor
public class LogiCostLocalController {
    private final LogiCostLocalService service;

    @GetMapping
    public ResponseEntity<ApiResponse<List<LogiCostLocalResponse>>> getList(@RequestParam(required = false) String yearQuarter, @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getList(yearQuarter, division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<LogiCostLocalResponse>> save(@Valid @RequestBody LogiCostLocalSaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.created(service.save(request, currentUserId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<LogiCostLocalResponse>> update(@PathVariable Long id, @Valid @RequestBody LogiCostLocalSaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.success(service.update(id, request, currentUserId)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        Long currentUserId = 1L;
        service.delete(id, currentUserId);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
