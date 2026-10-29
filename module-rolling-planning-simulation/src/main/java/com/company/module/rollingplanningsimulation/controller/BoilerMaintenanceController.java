package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerMaintenance;
import com.company.module.rollingplanningsimulation.repository.BoilerMaintenanceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-maintenances") @RequiredArgsConstructor
public class BoilerMaintenanceController {
    private final BoilerMaintenanceRepository repo;
    private final AuditSupport auditSupport;

    @GetMapping public ResponseEntity<ApiResponse<List<BoilerMaintenance>>> list(
            @RequestParam(defaultValue="PS") String division,
            @RequestParam(required=false) Integer year,
            @RequestParam(required=false) Integer month) {
        List<BoilerMaintenance> list;
        if (year != null && month != null) {
            list = repo.findByYearAndMonthAndDivision(year, month, division);
        } else if (year != null) {
            list = repo.findByYearAndDivision(year, division);
        } else {
            list = repo.findByDivision(division);
        }
        return ResponseEntity.ok(ApiResponse.success(list));
    }

    @PostMapping public ResponseEntity<ApiResponse<BoilerMaintenance>> save(@RequestBody Map<String,Object> body) {
        BoilerMaintenance e = BoilerMaintenance.builder()
            .year(parseIntSafe(body.get("year")))
            .month(parseIntSafe(body.get("month")))
            .boilerCode(str(body.get("boilerCode")))
            .division(str(body.getOrDefault("division","PS")))
            .maintType(str(body.getOrDefault("maintType","REGULAR")))
            .maintName(str(body.get("maintName")))
            .startDate(parseDateSafe(body.get("startDate")))
            .endDate(parseDateSafe(body.get("endDate")))
            .maintHours(parseBD(body.get("maintHours"), BigDecimal.ZERO))
            .memo(str(body.get("memo")))
            .build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
    }

    private Integer parseIntSafe(Object v) {
        if (v == null) return null;
        String s = v.toString().trim();
        if (s.isEmpty()) return null;
        try { return Integer.parseInt(s); } catch (NumberFormatException e) { return null; }
    }
    private BigDecimal parseBD(Object v, BigDecimal def) {
        if (v == null) return def;
        String s = v.toString().trim();
        if (s.isEmpty()) return def;
        try { return new BigDecimal(s); } catch (NumberFormatException e) { return def; }
    }
    private LocalDate parseDateSafe(Object v) {
        if (v == null) return null;
        String s = v.toString().trim();
        if (s.isEmpty()) return null;
        // 2026.07.21 → 2026-07-21 / 2026/07/21 → 2026-07-21
        s = s.replace('.', '-').replace('/', '-');
        try { return LocalDate.parse(s); } catch (Exception e) { return null; }
    }
    private String str(Object v) { return v != null ? v.toString() : null; }

    @PutMapping("/{id}") public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { body.remove("id"); body.put(UPDATE_ID, id); return save(body); }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        auditSupport.softDelete(repo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    // 등록: UK가 같은 행이 있으면 덮어씀(삭제된 행이면 되살림) / 수정: 지정 행만, 키 중복 시 오류
    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {};
    private BoilerMaintenance persist(BoilerMaintenance e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
