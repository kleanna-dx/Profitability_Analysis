package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.SteamPriceInterval;
import com.company.module.rollingplanningsimulation.repository.SteamPriceIntervalRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController @RequestMapping("/rolling-planning-simulation-api/steam-price-intervals") @RequiredArgsConstructor
public class SteamPriceIntervalController {
    private final SteamPriceIntervalRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<SteamPriceInterval>>> list(@RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivisionOrderByContractYearAscIntervalSeqAsc(division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<SteamPriceInterval>> save(@RequestBody SteamPriceInterval e) { return ResponseEntity.ok(ApiResponse.success(repo.save(e))); }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
