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
    @GetMapping public ResponseEntity<ApiResponse<List<CogenDeduction>>> list(@RequestParam Integer year, @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<CogenDeduction>> save(@RequestBody Map<String,Object> body) {
        CogenDeduction e = CogenDeduction.builder().year(Integer.parseInt(body.get("year").toString()))
            .itemType((String)body.get("itemType")).itemName((String)body.get("itemName"))
            .monthlyAmount(body.get("monthlyAmount")!=null?new BigDecimal(body.get("monthlyAmount").toString()):BigDecimal.ZERO)
            .division((String)body.getOrDefault("division","PS")).memo((String)body.get("memo")).build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { repo.deleteById(id); return ResponseEntity.ok(ApiResponse.success(null)); }
}
