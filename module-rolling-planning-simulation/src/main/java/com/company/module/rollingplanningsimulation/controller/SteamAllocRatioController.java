package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.SteamAllocRatio;
import com.company.module.rollingplanningsimulation.repository.SteamAllocRatioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/steam-alloc-ratios") @RequiredArgsConstructor
public class SteamAllocRatioController {
    private final SteamAllocRatioRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<SteamAllocRatio>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<SteamAllocRatio>> save(@RequestBody SteamAllocRatio e) { return ResponseEntity.ok(ApiResponse.success(repo.save(e))); }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
