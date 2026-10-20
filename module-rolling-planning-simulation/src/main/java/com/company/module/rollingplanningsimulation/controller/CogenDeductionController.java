package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.CogenDeduction;
import com.company.module.rollingplanningsimulation.repository.CogenDeductionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/cogen-deductions") @RequiredArgsConstructor
public class CogenDeductionController {
    private final CogenDeductionRepository repo;

    @GetMapping
    public ResponseEntity<ApiResponse<List<CogenDeduction>>> list(
            @RequestParam Integer year,
            @RequestParam(required=false) Integer month,
            @RequestParam(defaultValue="PS") String division) {
        if (month != null && month > 0) {
            return ResponseEntity.ok(ApiResponse.success(repo.findByYearMonthAndDivision(year, month, division)));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<CogenDeduction>> save(@RequestBody Map<String,Object> body) {
        CogenDeduction e = CogenDeduction.builder()
            .year(parseI(body.get("year"), 0))
            .month(parseI(body.get("month"), 0))
            .itemType((String)body.get("itemType"))
            .itemName((String)body.get("itemName"))
            .monthlyAmount(parseBD(body.get("monthlyAmount")))
            .division((String)body.getOrDefault("division","PS"))
            .memo((String)body.get("memo"))
            .build();
        if(body.get("createdBy")!=null) e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<?>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) {
        repo.deleteById(id);
        body.remove("id");
        try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private BigDecimal parseBD(Object v) {
        if (v == null) return BigDecimal.ZERO;
        String s = v.toString().trim();
        if (s.isEmpty()) return BigDecimal.ZERO;
        try { return new BigDecimal(s); } catch (Exception e) { return BigDecimal.ZERO; }
    }
    private int parseI(Object v, int def) {
        if (v == null) return def;
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return def; }
    }
}
