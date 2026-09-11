package com.company.module.simulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.simulation.dto.response.CostUnitRateResponse;
import com.company.module.simulation.dto.response.DataReadinessResponse;
import com.company.module.simulation.service.SimulationService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * P/L 시뮬레이터 API
 * - 비용 원단위 조회 (원재료비/전력비/물류비 DB 자동 로드)
 * - 지종별 원재료비 분리 (SC고평량/SC저평량/ACB/IV/CB/KB)
 * - 데이터 준비 현황 대시보드
 */
@RestController
@RequestMapping("/simulation-api")
@RequiredArgsConstructor
public class SimulationController {

    private final SimulationService simulationService;

    /**
     * 비용 원단위 조회 (P/L 시뮬레이터용)
     * GET /simulation-api/cost-unit-rates?ym=202605&machine=ALL&division=PS
     */
    @GetMapping("/cost-unit-rates")
    public ResponseEntity<ApiResponse<CostUnitRateResponse>> getCostUnitRates(
            @RequestParam(defaultValue = "202605") String ym,
            @RequestParam(defaultValue = "ALL") String machine,
            @RequestParam(defaultValue = "PS") String division) {

        return ResponseEntity.ok(
                ApiResponse.success(simulationService.getCostUnitRates(ym, machine, division))
        );
    }

    /**
     * 데이터 준비 현황 대시보드
     * GET /simulation-api/data-readiness?ym=202605&division=PS
     */
    @GetMapping("/data-readiness")
    public ResponseEntity<ApiResponse<DataReadinessResponse>> getDataReadiness(
            @RequestParam(defaultValue = "202605") String ym,
            @RequestParam(defaultValue = "PS") String division) {

        return ResponseEntity.ok(
                ApiResponse.success(simulationService.getDataReadiness(ym, division))
        );
    }
}
