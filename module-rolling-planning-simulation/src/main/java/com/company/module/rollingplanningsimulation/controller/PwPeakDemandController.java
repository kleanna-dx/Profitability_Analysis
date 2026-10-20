package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.PwPeakDemandSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwPeakDemandResponse;
import com.company.module.rollingplanningsimulation.service.PwPeakDemandService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/pw-peak-demands") @RequiredArgsConstructor
public class PwPeakDemandController {
    private final PwPeakDemandService service;
    @GetMapping
    public ResponseEntity<ApiResponse<List<PwPeakDemandResponse>>> list(@RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getList(division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<PwPeakDemandResponse>> save(@RequestBody PwPeakDemandSaveRequest req) {
        return ResponseEntity.ok(ApiResponse.success(service.save(req)));
    }
    @PutMapping("/{id}") public ResponseEntity<ApiResponse<?>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { repo.deleteById(id); body.remove("id"); try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); } }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { service.delete(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
