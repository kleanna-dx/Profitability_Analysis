package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
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
    private final AuditSupport auditSupport;

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
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
    }

    @PutMapping("/{id}") public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { body.remove("id"); body.put(UPDATE_ID, id); return save(body); }

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
    private int parseI(Object v, int def) {
        if (v == null) return def;
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return def; }
    }

    // 등록: UK가 같은 행이 있으면 덮어씀(삭제된 행이면 되살림) / 수정: 지정 행만, 키 중복 시 오류
    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {"year", "month", "itemType", "division"};
    private CogenDeduction persist(CogenDeduction e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
