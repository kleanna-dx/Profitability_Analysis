package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
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
    private final AuditSupport auditSupport;

    @GetMapping
    public ResponseEntity<ApiResponse<List<BoilerCostRate>>> list(
            @RequestParam Integer year,
            @RequestParam(required=false) Integer month,
            @RequestParam(defaultValue="PS") String division) {
        if (month != null && month > 0) {
            // 월별 조회: 해당 월 데이터만 (월 0 기본값은 표시하지 않음)
            return ResponseEntity.ok(ApiResponse.success(repo.findByYearMonthAndDivision(year, month, division)));
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
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
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
        auditSupport.assertUkFree(e, id, UK);
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        auditSupport.softDelete(repo, id);
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

    // 등록: UK가 같은 행이 있으면 덮어씀(삭제된 행이면 되살림) / 수정: 지정 행만, 키 중복 시 오류
    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {"year", "month", "boilerCode", "rateType", "division"};
    private BoilerCostRate persist(BoilerCostRate e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
