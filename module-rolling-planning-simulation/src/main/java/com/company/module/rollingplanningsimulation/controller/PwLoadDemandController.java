package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.PwLoadDemandSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwLoadDemandResponse;
import com.company.module.rollingplanningsimulation.service.PwLoadDemandService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/pw-load-demands") @RequiredArgsConstructor
public class PwLoadDemandController {
    private final PwLoadDemandService service;
    @GetMapping
    public ResponseEntity<ApiResponse<List<PwLoadDemandResponse>>> list(@RequestParam String ym, @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getList(ym, division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<PwLoadDemandResponse>> save(@RequestBody PwLoadDemandSaveRequest req) {
        return ResponseEntity.ok(ApiResponse.success(service.save(req)));
    }
    @PutMapping("/{id}") public ResponseEntity<ApiResponse<?>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { repo.deleteById(id); body.remove("id"); try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); } }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { service.delete(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
