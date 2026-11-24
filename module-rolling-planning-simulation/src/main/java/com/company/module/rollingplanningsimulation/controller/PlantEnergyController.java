package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.service.PlantEnergyService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 공장 통합 에너지비(스팀) — PS·HL 합산 배분 후 사업부별 비용. 저장하지 않음 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/plant-energy")
@RequiredArgsConstructor
public class PlantEnergyController {
    private final PlantEnergyService service;

    /** body: {ym, division(보고 있는 사업부), machine, products:[{product, plan, sim}]} */
    @PostMapping("/calculate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> calculate(@RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(ApiResponse.success(service.calculate(body)));
    }
}
