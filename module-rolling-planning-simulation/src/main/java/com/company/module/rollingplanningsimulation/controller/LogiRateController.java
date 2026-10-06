package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.LogiRateSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.LogiRateResponse;
import com.company.module.rollingplanningsimulation.service.LogiRateService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/logi-rates") @RequiredArgsConstructor
public class LogiRateController {
    private final LogiRateService service;

    @GetMapping
    public ResponseEntity<ApiResponse<List<LogiRateResponse>>> getList(@RequestParam(required = false) String yearQuarter) {
        return ResponseEntity.ok(ApiResponse.success(service.getByQuarter(yearQuarter)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<LogiRateResponse>> save(@Valid @RequestBody LogiRateSaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.created(service.save(request, currentUserId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<LogiRateResponse>> update(@PathVariable Long id, @Valid @RequestBody LogiRateSaveRequest request) {
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
