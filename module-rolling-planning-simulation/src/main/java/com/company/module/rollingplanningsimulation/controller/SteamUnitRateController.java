package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.SteamUnitRate;
import com.company.module.rollingplanningsimulation.repository.SteamUnitRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/steam-unit-rates") @RequiredArgsConstructor
public class SteamUnitRateController {
    private final SteamUnitRateRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<SteamUnitRate>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<SteamUnitRate>> save(@RequestBody Map<String,Object> body) {
        SteamUnitRate e = SteamUnitRate.builder().year(Integer.parseInt(body.get("year").toString()))
            .machineCode((String)body.get("machineCode")).division((String)body.getOrDefault("division","PS"))
            .steamPerTon(body.get("steamPerTon")!=null?new BigDecimal(body.get("steamPerTon").toString()):BigDecimal.ZERO)
            .etcUsageTon(body.get("etcUsageTon")!=null?new BigDecimal(body.get("etcUsageTon").toString()):BigDecimal.ZERO)
            .limitNote((String)body.get("limitNote")).memo((String)body.get("memo")).build();
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
