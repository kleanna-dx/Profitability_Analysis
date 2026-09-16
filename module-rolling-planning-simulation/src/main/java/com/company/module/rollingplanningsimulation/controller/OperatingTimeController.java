package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.OperatingTimeSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.OperatingTimeResponse;
import com.company.module.rollingplanningsimulation.service.OperatingTimeService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 가동시간 관리 API
 * - 호기별 월별 가동일수/비가동일수 CRUD
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/operating-time")
@RequiredArgsConstructor
public class OperatingTimeController {

    private final OperatingTimeService operatingTimeService;

    /**
     * 특정 호기의 가동시간 조회
     * GET /rolling-planning-simulation-api/operating-time?division=PS&machineCode=M01
     */
    @GetMapping
    public ResponseEntity<ApiResponse<List<OperatingTimeResponse>>> getByMachine(
            @RequestParam(defaultValue = "PS") String division,
            @RequestParam String machineCode) {

        return ResponseEntity.ok(
                ApiResponse.success(operatingTimeService.getByMachine(division, machineCode))
        );
    }

    /**
     * 특정 월의 전체 호기 가동시간 조회
     * GET /rolling-planning-simulation-api/operating-time/by-ym?division=PS&ym=202605
     */
    @GetMapping("/by-ym")
    public ResponseEntity<ApiResponse<List<OperatingTimeResponse>>> getByYm(
            @RequestParam(defaultValue = "PS") String division,
            @RequestParam String ym) {

        return ResponseEntity.ok(
                ApiResponse.success(operatingTimeService.getByYm(division, ym))
        );
    }

    /**
     * 가동시간 저장/수정 (Upsert)
     * POST /rolling-planning-simulation-api/operating-time
     */
    @PostMapping
    public ResponseEntity<ApiResponse<OperatingTimeResponse>> save(
            @Valid @RequestBody OperatingTimeSaveRequest request) {

        // TODO: CurrentUserProvider 연동 후 실제 사용자 ID 주입
        Long currentUserId = 1L;

        return ResponseEntity.ok(
                ApiResponse.created(operatingTimeService.save(request, currentUserId))
        );
    }
}
