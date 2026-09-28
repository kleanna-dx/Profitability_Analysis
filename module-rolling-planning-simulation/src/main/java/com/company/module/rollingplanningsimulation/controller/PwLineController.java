package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.PwLineSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwLineResponse;
import com.company.module.rollingplanningsimulation.service.PwLineService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/pw-lines") @RequiredArgsConstructor
public class PwLineController {
    private final PwLineService service;

    @GetMapping
    public ResponseEntity<ApiResponse<List<PwLineResponse>>> getList(@RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getList(division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<PwLineResponse>> save(@Valid @RequestBody PwLineSaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.created(service.save(request, currentUserId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<PwLineResponse>> update(@PathVariable Long id, @Valid @RequestBody PwLineSaveRequest request) {
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
