package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.PwMachineUsageRatioSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwMachineUsageRatioResponse;
import com.company.module.rollingplanningsimulation.service.PwMachineUsageRatioService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/pw-machine-ratios") @RequiredArgsConstructor
public class PwMachineUsageRatioController {
    private final PwMachineUsageRatioService service;
    @GetMapping
    public ResponseEntity<ApiResponse<List<PwMachineUsageRatioResponse>>> list(@RequestParam String ym, @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getList(ym, division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<PwMachineUsageRatioResponse>> save(@RequestBody PwMachineUsageRatioSaveRequest req) {
        return ResponseEntity.ok(ApiResponse.success(service.save(req)));
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { service.delete(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
