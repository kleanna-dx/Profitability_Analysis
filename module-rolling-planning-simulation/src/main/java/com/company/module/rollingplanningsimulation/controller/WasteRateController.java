package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.WasteRate;
import com.company.module.rollingplanningsimulation.repository.WasteRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/waste-rates") @RequiredArgsConstructor
public class WasteRateController {
    private final WasteRateRepository repo;
    @GetMapping
    public ResponseEntity<ApiResponse<List<WasteRate>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping
    public ResponseEntity<ApiResponse<WasteRate>> save(@RequestBody Map<String,Object> body) {
        WasteRate e = WasteRate.builder()
            .year(Integer.parseInt(body.get("year").toString()))
            .machineCode((String)body.get("machineCode"))
            .product((String)body.get("product"))
            .division((String)body.getOrDefault("division","PS"))
            .wasteRatePct(body.get("wasteRatePct")!=null?new BigDecimal(body.get("wasteRatePct").toString()):BigDecimal.ZERO)
            .note((String)body.get("note")).build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @PutMapping("/{id}") public ResponseEntity<ApiResponse<?>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { repo.deleteById(id); body.remove("id"); try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); } }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
