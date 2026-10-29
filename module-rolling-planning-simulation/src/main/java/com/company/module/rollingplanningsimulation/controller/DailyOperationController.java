package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.DailyOperation;
import com.company.module.rollingplanningsimulation.repository.DailyOperationRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/daily-operations") @RequiredArgsConstructor
public class DailyOperationController {
    private final DailyOperationRepository repo;
    private final AuditSupport auditSupport;

    @GetMapping
    public ResponseEntity<ApiResponse<List<DailyOperation>>> list(
            @RequestParam Integer year, @RequestParam Integer month,
            @RequestParam(required = false) String machineCode,
            @RequestParam(defaultValue = "PS") String division) {
        List<DailyOperation> list = machineCode != null
            ? repo.findByYearAndMonthAndMachineCodeAndDivision(year, month, machineCode, division)
            : repo.findByYearAndMonthAndDivision(year, month, division);
        return ResponseEntity.ok(ApiResponse.success(list));
    }

    /** 일별 데이터 저장 (upsert: 있으면 수정, 없으면 신규) */
    @PostMapping
    public ResponseEntity<ApiResponse<DailyOperation>> save(@RequestBody Map<String, Object> body) {
        Integer year = parseIntSafe(body.get("year"));
        Integer month = parseIntSafe(body.get("month"));
        Integer day = parseIntSafe(body.get("day"));
        String mc = str(body.get("machineCode"));
        String div = str(body.getOrDefault("division", "PS"));

        DailyOperation e = DailyOperation.builder()
                .division(div).machineCode(mc).year(year).month(month).day(day)
                .operationHours(parseBD(body.get("operationHours"), new BigDecimal("24")))
                .isShutdown(body.get("isShutdown") != null ? Boolean.parseBoolean(body.get("isShutdown").toString()) : false)
                .shutdownReason(str(body.get("shutdownReason")))
                .memo(str(body.get("memo")))
                .build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
    }

    /** 월간 일괄 저장 (배열) */
    @PostMapping("/batch")
    public ResponseEntity<ApiResponse<Map<String, Object>>> saveBatch(@RequestBody List<Map<String, Object>> items) {
        int saved = 0;
        for (Map<String, Object> body : items) {
            Integer year = parseIntSafe(body.get("year"));
            Integer month = parseIntSafe(body.get("month"));
            Integer day = parseIntSafe(body.get("day"));
            String mc = str(body.get("machineCode"));
            String div = str(body.getOrDefault("division", "PS"));

            DailyOperation e = DailyOperation.builder()
                    .division(div).machineCode(mc).year(year).month(month).day(day)
                    .operationHours(parseBD(body.get("operationHours"), new BigDecimal("24")))
                    .isShutdown(body.get("isShutdown") != null ? Boolean.parseBoolean(body.get("isShutdown").toString()) : false)
                    .shutdownReason(str(body.get("shutdownReason")))
                    .memo(str(body.get("memo")))
                    .build();
            auditSupport.upsert(repo, e, UK);
            saved++;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("saved", saved);
        return ResponseEntity.ok(ApiResponse.success(result));
    }

    @PutMapping("/{id}") public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { body.remove("id"); body.put(UPDATE_ID, id); return save(body); }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        auditSupport.softDelete(repo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private Integer parseIntSafe(Object v) { if (v == null) return null; String s = v.toString().trim(); if (s.isEmpty()) return null; try { return Integer.parseInt(s); } catch (NumberFormatException e) { return null; } }
    private BigDecimal parseBD(Object v, BigDecimal def) { if (v == null) return def; String s = v.toString().trim(); if (s.isEmpty()) return def; try { return new BigDecimal(s); } catch (NumberFormatException e) { return def; } }
    private String str(Object v) { return v != null ? v.toString() : null; }

    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {"division", "machineCode", "year", "month", "day"};
    private DailyOperation persist(DailyOperation e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
