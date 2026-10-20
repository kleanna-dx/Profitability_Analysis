package com.company.module.rollingplanningsimulation.controller;
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

        Optional<DailyOperation> existing = repo.findByYearAndMonthAndDayAndMachineCodeAndDivision(year, month, day, mc, div);
        DailyOperation e;
        if (existing.isPresent()) {
            e = existing.get();
            e.update(parseBD(body.get("operationHours"), new BigDecimal("24")),
                     body.get("isShutdown") != null ? Boolean.parseBoolean(body.get("isShutdown").toString()) : false,
                     str(body.get("shutdownReason")), str(body.get("memo")));
        } else {
            e = DailyOperation.builder()
                .division(div).machineCode(mc).year(year).month(month).day(day)
                .operationHours(parseBD(body.get("operationHours"), new BigDecimal("24")))
                .isShutdown(body.get("isShutdown") != null ? Boolean.parseBoolean(body.get("isShutdown").toString()) : false)
                .shutdownReason(str(body.get("shutdownReason")))
                .memo(str(body.get("memo")))
                .build();
        }
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
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

            Optional<DailyOperation> existing = repo.findByYearAndMonthAndDayAndMachineCodeAndDivision(year, month, day, mc, div);
            DailyOperation e;
            if (existing.isPresent()) {
                e = existing.get();
                e.update(parseBD(body.get("operationHours"), new BigDecimal("24")),
                         body.get("isShutdown") != null ? Boolean.parseBoolean(body.get("isShutdown").toString()) : false,
                         str(body.get("shutdownReason")), str(body.get("memo")));
            } else {
                e = DailyOperation.builder()
                    .division(div).machineCode(mc).year(year).month(month).day(day)
                    .operationHours(parseBD(body.get("operationHours"), new BigDecimal("24")))
                    .isShutdown(body.get("isShutdown") != null ? Boolean.parseBoolean(body.get("isShutdown").toString()) : false)
                    .shutdownReason(str(body.get("shutdownReason")))
                    .memo(str(body.get("memo")))
                    .build();
            }
            repo.save(e);
            saved++;
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("saved", saved);
        return ResponseEntity.ok(ApiResponse.success(result));
    }

    @PutMapping("/{id}") public ResponseEntity<ApiResponse<?>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { repo.deleteById(id); body.remove("id"); try { return save(body); } catch(Exception e) { return ResponseEntity.ok(ApiResponse.success("update failed: "+e.getMessage())); } }
    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private Integer parseIntSafe(Object v) { if (v == null) return null; String s = v.toString().trim(); if (s.isEmpty()) return null; try { return Integer.parseInt(s); } catch (NumberFormatException e) { return null; } }
    private BigDecimal parseBD(Object v, BigDecimal def) { if (v == null) return def; String s = v.toString().trim(); if (s.isEmpty()) return def; try { return new BigDecimal(s); } catch (NumberFormatException e) { return def; } }
    private String str(Object v) { return v != null ? v.toString() : null; }
}
