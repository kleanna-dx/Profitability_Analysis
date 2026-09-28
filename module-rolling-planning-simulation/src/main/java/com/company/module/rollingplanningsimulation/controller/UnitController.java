package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.UnitSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.UnitResponse;
import com.company.module.rollingplanningsimulation.service.UnitService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/units") @RequiredArgsConstructor
public class UnitController {
    private final UnitService unitService;

    @GetMapping
    public ResponseEntity<ApiResponse<List<UnitResponse>>> getList(@RequestParam(required = false) String division) {
        return ResponseEntity.ok(ApiResponse.success(unitService.getList(division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<UnitResponse>> save(@Valid @RequestBody UnitSaveRequest request) {
        Long currentUserId = 1L; // TODO: CurrentUserProvider
        return ResponseEntity.ok(ApiResponse.created(unitService.save(request, currentUserId)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<UnitResponse>> update(@PathVariable Long id, @Valid @RequestBody UnitSaveRequest request) {
        Long currentUserId = 1L;
        return ResponseEntity.ok(ApiResponse.success(unitService.update(id, request, currentUserId)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        Long currentUserId = 1L;
        unitService.delete(id, currentUserId);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
