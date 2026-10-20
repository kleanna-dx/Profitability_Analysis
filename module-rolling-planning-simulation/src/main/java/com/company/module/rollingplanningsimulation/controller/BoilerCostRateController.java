package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerCostRate;
import com.company.module.rollingplanningsimulation.repository.BoilerCostRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-cost-rates") @RequiredArgsConstructor
public class BoilerCostRateController {
    private final BoilerCostRateRepository repo;
    @GetMapping public ResponseEntity<ApiResponse<List<BoilerCostRate>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<BoilerCostRate>> save(@RequestBody Map<String,Object> body) {
        BoilerCostRate e = BoilerCostRate.builder().year(Integer.parseInt(body.get("year").toString()))
            .boilerCode((String)body.get("boilerCode")).rateType((String)body.get("rateType"))
            .rateName((String)body.get("rateName"))
            .rateValue(body.get("rateValue")!=null?new BigDecimal(body.get("rateValue").toString()):BigDecimal.ZERO)
            .rateUnit((String)body.get("rateUnit")).division((String)body.getOrDefault("division","PS"))
            .memo((String)body.get("memo")).build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @PutMapping("/{id}") public ResponseEntity<ApiResponse<?>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { repo.deleteById(id); body.remove("id"); try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); } }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
