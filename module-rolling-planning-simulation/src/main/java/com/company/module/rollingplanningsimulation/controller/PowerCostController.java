package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.PwMonthlySummary;
import com.company.module.rollingplanningsimulation.service.PowerCostService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.Map;

@RestController
@RequestMapping("/rolling-planning-simulation-api/power-cost")
@RequiredArgsConstructor
public class PowerCostController {

    private final PowerCostService powerCostService;

    /**
     * 전력비 계산 실행
     * POST /rolling-planning-simulation-api/power-cost/calculate?ym=202605&division=PS
     */
    @PostMapping("/calculate")
    public ResponseEntity<ApiResponse<PwMonthlySummary>> calculate(
            @RequestParam String ym,
            @RequestParam(defaultValue = "PS") String division,
            @RequestBody(required = false) Map<String, Map<String, BigDecimal>> overrides) {
        Map<String, BigDecimal> runH = overrides != null ? overrides.get("runHours") : null;
        Map<String, BigDecimal> stbyH = overrides != null ? overrides.get("stbyHours") : null;
        PwMonthlySummary result = powerCostService.calculate(ym, division, runH, stbyH);
        return ResponseEntity.ok(ApiResponse.success(result));
    }

    /**
     * 설비별 배분 실행
     * POST /rolling-planning-simulation-api/power-cost/distribute?ym=202605&division=PS
     */
    @PostMapping("/distribute")
    public ResponseEntity<ApiResponse<Void>> distribute(
            @RequestParam String ym,
            @RequestParam(defaultValue = "PS") String division) {
        powerCostService.distributeToMachines(ym, division);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    /**
     * 월 전력비 결과 조회
     * GET /rolling-planning-simulation-api/power-cost/summary?ym=202605&division=PS
     */
    @GetMapping("/summary")
    public ResponseEntity<ApiResponse<PwMonthlySummary>> getSummary(
            @RequestParam String ym,
            @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(
                powerCostService.getSummary(ym, division).orElse(null)));
    }

    /**
     * 부하별 가용시간 조회 (달력 자동 계산)
     * GET /rolling-planning-simulation-api/power-cost/load-hours?ym=202605&division=PS
     */
    @GetMapping("/load-hours")
    public ResponseEntity<ApiResponse<Map<String, BigDecimal>>> getLoadHours(
            @RequestParam String ym,
            @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(
                powerCostService.calcLoadAvailHours(ym, division)));
    }
}
