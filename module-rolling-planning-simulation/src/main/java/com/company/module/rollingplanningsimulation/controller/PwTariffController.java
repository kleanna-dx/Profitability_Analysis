package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.PwTariffSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwTariffResponse;
import com.company.module.rollingplanningsimulation.service.PwTariffService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/pw-tariffs") @RequiredArgsConstructor
public class PwTariffController {
    private final PwTariffService service;

    @GetMapping
    public ResponseEntity<ApiResponse<List<PwTariffResponse>>> getByYear(@RequestParam Integer year, @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getByYear(year, division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<PwTariffResponse>> save(@Valid @RequestBody PwTariffSaveRequest request) {
        return ResponseEntity.ok(ApiResponse.created(service.save(request)));
    }
}
