package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.MachineCapacitySaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.MachineCapacityResponse;
import com.company.module.rollingplanningsimulation.service.MachineCapacityService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/machine-capacities") @RequiredArgsConstructor
public class MachineCapacityController {
    private final MachineCapacityService service;

    @GetMapping
    public ResponseEntity<ApiResponse<List<MachineCapacityResponse>>> getList(@RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getList(division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<MachineCapacityResponse>> save(@Valid @RequestBody MachineCapacitySaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.created(service.save(request, currentUserId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<MachineCapacityResponse>> update(@PathVariable Long id, @Valid @RequestBody MachineCapacitySaveRequest request) {
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
