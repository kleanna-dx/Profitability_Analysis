package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.PwTimezoneDefSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwTimezoneDefResponse;
import com.company.module.rollingplanningsimulation.service.PwTimezoneDefService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/pw-timezone-defs") @RequiredArgsConstructor
public class PwTimezoneDefController {
    private final PwTimezoneDefService service;
    @GetMapping
    public ResponseEntity<ApiResponse<List<PwTimezoneDefResponse>>> list(@RequestParam(defaultValue = "PS") String division, @RequestParam(required = false) Integer year) {
        return ResponseEntity.ok(ApiResponse.success(year != null ? service.getByYear(year, division) : service.getList(division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<PwTimezoneDefResponse>> save(@RequestBody PwTimezoneDefSaveRequest req) {
        return ResponseEntity.ok(ApiResponse.success(service.save(req)));
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { service.delete(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
