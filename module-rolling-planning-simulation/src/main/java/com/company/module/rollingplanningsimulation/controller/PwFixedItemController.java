package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.dto.request.PwFixedItemSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwFixedItemResponse;
import com.company.module.rollingplanningsimulation.service.PwFixedItemService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/pw-fixed-items") @RequiredArgsConstructor
public class PwFixedItemController {
    private final PwFixedItemService service;
    @GetMapping
    public ResponseEntity<ApiResponse<List<PwFixedItemResponse>>> list(@RequestParam String ym, @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.getList(ym, division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<PwFixedItemResponse>> save(@RequestBody PwFixedItemSaveRequest req) {
        return ResponseEntity.ok(ApiResponse.success(service.save(req)));
    }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { service.delete(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
