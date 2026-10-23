package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.LineSteamRatio;
import com.company.module.rollingplanningsimulation.repository.LineSteamRatioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/line-steam-ratios") @RequiredArgsConstructor
public class LineSteamRatioController {
    private final LineSteamRatioRepository repo;

    @GetMapping
    public ResponseEntity<ApiResponse<List<LineSteamRatio>>> list(
            @RequestParam Integer year,
            @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<LineSteamRatio>> save(@RequestBody Map<String,Object> body) {
        Integer year = Integer.parseInt(body.get("year").toString());
        String division = (String) body.getOrDefault("division", "PS");
        String machineCode = (String) body.get("machineCode");
        BigDecimal steamRatio = body.get("steamRatio") != null
                ? new BigDecimal(body.get("steamRatio").toString()) : BigDecimal.ZERO;
        String memo = (String) body.get("memo");

        // UPSERT: 같은 연도/사업부/호기가 있으면 업데이트
        LineSteamRatio entity = repo.findByYearAndDivisionAndMachineCode(year, division, machineCode)
                .map(existing -> { existing.update(steamRatio, memo); return existing; })
                .orElseGet(() -> {
                    LineSteamRatio e = LineSteamRatio.builder()
                            .year(year).division(division).machineCode(machineCode)
                            .steamRatio(steamRatio).memo(memo).build();
                    if (body.get("createdBy") != null) e.setCreatedBy(body.get("createdBy").toString());
                    return e;
                });
        return ResponseEntity.ok(ApiResponse.success(repo.save(entity)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<LineSteamRatio>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) {
        LineSteamRatio entity = repo.findById(id).orElseThrow(() -> new RuntimeException("NOT_FOUND: " + id));
        BigDecimal steamRatio = body.get("steamRatio") != null
                ? new BigDecimal(body.get("steamRatio").toString()) : entity.getSteamRatio();
        String memo = body.containsKey("memo") ? (String) body.get("memo") : entity.getMemo();
        entity.update(steamRatio, memo);
        return ResponseEntity.ok(ApiResponse.success(repo.save(entity)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
