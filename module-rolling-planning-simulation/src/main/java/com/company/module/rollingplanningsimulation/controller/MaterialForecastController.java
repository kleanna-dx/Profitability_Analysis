package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.service.MaterialForecastService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** 원부재료비 — 전월 실적 + 차월 예상(수기입력) */
@RestController
@RequestMapping("/rolling-planning-simulation-api/material-forecast")
@RequiredArgsConstructor
public class MaterialForecastController {
    private final MaterialForecastService service;

    /** GET ?ym=예상월(YYYYMM)&division=PS&machine=ALL — 전월 실적 + 지종별 생산량 + 자재×지종 사용량 + 저장값 */
    @GetMapping
    public ResponseEntity<ApiResponse<Map<String, Object>>> load(@RequestParam String ym,
                                                                 @RequestParam(defaultValue = "PS") String division,
                                                                 @RequestParam(defaultValue = "ALL") String machine) {
        return ResponseEntity.ok(ApiResponse.success(service.load(ym, division, machine)));
    }

    /** POST {ym, division, machineCode, products:[{itemCode,prodTon}], materials:[{itemCode,itemName,usageQty,unitRate,receiptPrice,openingPrice,usePrice,issueNote}]} */
    @PostMapping("/save")
    public ResponseEntity<ApiResponse<Map<String, Integer>>> save(@RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(ApiResponse.success(service.save(body)));
    }
}
