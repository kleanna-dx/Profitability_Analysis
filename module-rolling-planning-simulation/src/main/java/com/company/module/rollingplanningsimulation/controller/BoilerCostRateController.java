package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerCostRate;
import com.company.module.rollingplanningsimulation.repository.BoilerCostRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-cost-rates") @RequiredArgsConstructor
public class BoilerCostRateController {
    private final BoilerCostRateRepository repo;

    @GetMapping
    public ResponseEntity<ApiResponse<List<BoilerCostRate>>> list(
            @RequestParam Integer year,
            @RequestParam(required=false) Integer month,
            @RequestParam(defaultValue="PS") String division) {
        if (month != null && month > 0) {
            // 월별 조회: 해당 월 데이터 우선, 없으면 기본(month=0) 사용
            List<BoilerCostRate> all = repo.findByYearMonthAndDivision(year, month, division);
            // 같은 boilerCode+rateType에 대해 월별(month>0) 우선
            Map<String, BoilerCostRate> merged = new LinkedHashMap<>();
            // 기본(month=0) 먼저
            all.stream().filter(b -> b.getMonth() == null || b.getMonth() == 0)
                .forEach(b -> merged.put(b.getBoilerCode() + "|" + b.getRateType(), b));
            // 월별 데이터로 덮어쓰기
            all.stream().filter(b -> b.getMonth() != null && b.getMonth() > 0)
                .forEach(b -> merged.put(b.getBoilerCode() + "|" + b.getRateType(), b));
            return ResponseEntity.ok(ApiResponse.success(new ArrayList<>(merged.values())));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<BoilerCostRate>> save(@RequestBody Map<String,Object> body) {
        BoilerCostRate e = BoilerCostRate.builder()
            .year(parseI(body.get("year"), 0))
            .month(parseI(body.get("month"), 0))
            .boilerCode((String)body.get("boilerCode"))
            .rateType((String)body.get("rateType"))
            .rateName((String)body.get("rateName"))
            .rateValue(parseBD(body.get("rateValue")))
            .rateUnit((String)body.get("rateUnit"))
            .factor(parseBDnull(body.get("factor")))
            .division((String)body.getOrDefault("division","PS"))
            .memo((String)body.get("memo"))
            .build();
        if(body.get("createdBy")!=null) e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    @PutMapping("/{id}")
    @SuppressWarnings("unchecked")
    public ResponseEntity update(@PathVariable Long id, @RequestBody Map<String,Object> body) {
        BoilerCostRate e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        e.update(
            body.containsKey("rateName") ? (String)body.get("rateName") : e.getRateName(),
            body.containsKey("rateValue") ? parseBD(body.get("rateValue")) : e.getRateValue(),
            body.containsKey("rateUnit") ? (String)body.get("rateUnit") : e.getRateUnit(),
            body.containsKey("factor") ? parseBDnull(body.get("factor")) : e.getFactor(),
            body.containsKey("memo") ? (String)body.get("memo") : e.getMemo(),
            body.containsKey("year") ? parseI(body.get("year"), e.getYear()) : null,
            body.containsKey("month") ? parseI(body.get("month"), 0) : null
        );
        if(body.get("createdBy")!=null) e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
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
    private BigDecimal parseBDnull(Object v) {
        if (v == null) return null;
        String s = v.toString().trim();
        if (s.isEmpty()) return null;
        try { return new BigDecimal(s); } catch (Exception e) { return null; }
    }
    private int parseI(Object v, int def) {
        if (v == null) return def;
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return def; }
    }
}
