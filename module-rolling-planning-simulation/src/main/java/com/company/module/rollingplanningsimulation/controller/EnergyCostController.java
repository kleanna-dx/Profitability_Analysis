package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.EnergyMonthly;
import com.company.module.rollingplanningsimulation.service.EnergyCostService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.Map;

@RestController
@RequestMapping("/rolling-planning-simulation-api/energy-cost")
@RequiredArgsConstructor
public class EnergyCostController {

    private final EnergyCostService energyCostService;

    /**
     * 에너지비 계산 실행
     * POST /rolling-planning-simulation-api/energy-cost/calculate?ym=202607&division=PS
     * Body: {"PM2": 3280, "PM3": 5088}  (호기별 생산량 톤)
     */
    @PostMapping("/calculate")
    public ResponseEntity<ApiResponse<EnergyMonthly>> calculate(
            @RequestParam String ym,
            @RequestParam(defaultValue = "PS") String division,
            @RequestBody Map<String, BigDecimal> productionByMachine) {
        EnergyMonthly result = energyCostService.calculate(ym, division, productionByMachine);
        return ResponseEntity.ok(ApiResponse.success(result));
    }

    /**
     * 스팀 분배 시뮬레이션 (저장 안 함, 미리보기)
     * POST /rolling-planning-simulation-api/energy-cost/simulate-distribution?ym=202607&division=PS
     * Body: {"PM2": 3280, "PM3": 5088}
     */
    @PostMapping("/simulate-distribution")
    public ResponseEntity<ApiResponse<Map<String, BigDecimal>>> simulateDistribution(
            @RequestParam String ym,
            @RequestParam(defaultValue = "PS") String division,
            @RequestBody Map<String, BigDecimal> productionByMachine) {
        int year = Integer.parseInt(ym.substring(0, 4));
        int month = Integer.parseInt(ym.substring(4, 6));
        BigDecimal steamRequired = energyCostService.calcSteamRequired(division, year, productionByMachine);
        Map<String, BigDecimal> distribution = energyCostService.distributeSteam(division, year, month, steamRequired);
        distribution.put("_steamRequired", steamRequired);
        return ResponseEntity.ok(ApiResponse.success(distribution));
    }

    /**
     * 월 에너지비 결과 조회
     * GET /rolling-planning-simulation-api/energy-cost/summary?ym=202607&division=PS
     */
    @GetMapping("/summary")
    public ResponseEntity<ApiResponse<EnergyMonthly>> getSummary(
            @RequestParam String ym,
            @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(
                energyCostService.getSummary(ym, division).orElse(null)));
    }
}
