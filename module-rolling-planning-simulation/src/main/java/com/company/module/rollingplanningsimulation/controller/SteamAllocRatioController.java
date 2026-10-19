package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.SteamAllocRatio;
import com.company.module.rollingplanningsimulation.repository.SteamAllocRatioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/steam-alloc-ratios") @RequiredArgsConstructor
public class SteamAllocRatioController {
    private final SteamAllocRatioRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<SteamAllocRatio>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<SteamAllocRatio>> save(@RequestBody Map<String,Object> body) {
        SteamAllocRatio e = SteamAllocRatio.builder().year(Integer.parseInt(body.get("year").toString()))
            .machineCode((String)body.get("machineCode")).division((String)body.getOrDefault("division","PS"))
            .allocRatio(body.get("allocRatio")!=null?new BigDecimal(body.get("allocRatio").toString()):BigDecimal.ZERO)
            .memo((String)body.get("memo")).build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
