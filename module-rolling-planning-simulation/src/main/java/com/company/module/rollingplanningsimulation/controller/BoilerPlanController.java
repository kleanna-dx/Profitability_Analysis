package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerPlan;
import com.company.module.rollingplanningsimulation.repository.BoilerPlanRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-plans") @RequiredArgsConstructor
public class BoilerPlanController {
    private final BoilerPlanRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<BoilerPlan>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<BoilerPlan>> save(@RequestBody Map<String,Object> body) {
        BoilerPlan e = BoilerPlan.builder().year(Integer.parseInt(body.get("year").toString()))
            .month(Integer.parseInt(body.get("month").toString()))
            .boilerCode((String)body.get("boilerCode"))
            .division((String)body.getOrDefault("division","PS"))
            .totalDays(body.get("totalDays")!=null?new BigDecimal(body.get("totalDays").toString()):BigDecimal.ZERO)
            .shutdownDays(body.get("shutdownDays")!=null?new BigDecimal(body.get("shutdownDays").toString()):BigDecimal.ZERO)
            .operationDays(body.get("operationDays")!=null?new BigDecimal(body.get("operationDays").toString()):BigDecimal.ZERO)
            .operationHours(body.get("operationHours")!=null?new BigDecimal(body.get("operationHours").toString()):BigDecimal.ZERO)
            .memo((String)body.get("memo")).build();
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
