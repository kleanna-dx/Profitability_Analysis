package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.LogiExchangeRateSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.LogiExchangeRateResponse;
import com.company.module.rollingplanningsimulation.service.LogiExchangeRateService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/exchange-rates") @RequiredArgsConstructor
public class LogiExchangeRateController {
    private final LogiExchangeRateService service;

    @GetMapping
    public ResponseEntity<ApiResponse<List<LogiExchangeRateResponse>>> getByYear(@RequestParam Integer year, @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getByYear(year, division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<LogiExchangeRateResponse>> save(@Valid @RequestBody LogiExchangeRateSaveRequest request) {
        return ResponseEntity.ok(ApiResponse.created(service.save(request)));
    }
}
