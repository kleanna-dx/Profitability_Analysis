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
        LocalDate start = parseYmd(body.get("startDate"), "시작일");
        LocalDate end = parseYmd(body.get("endDate"), "종료일");
        if (end.isBefore(start)) throw new IllegalArgumentException("종료일(" + end + ")이 시작일(" + start + ")보다 빠릅니다");
        Integer y = parseIntSafe(body.get("year")), m = parseIntSafe(body.get("month"));
        if (y == null || m == null || y != start.getYear() || m != start.getMonthValue())
            throw new IllegalArgumentException("연도/월(" + y + "." + m + ")이 시작일(" + start + ")과 다릅니다 — 연도/월은 시작일 기준으로 입력하세요");
        BigDecimal hours = parseBD(body.get("maintHours"), null);
        long maxHours = (java.time.temporal.ChronoUnit.DAYS.between(start, end) + 1) * 24;
        if (hours != null && (hours.signum() < 0 || hours.compareTo(BigDecimal.valueOf(maxHours)) > 0))
            throw new IllegalArgumentException("정비시간(" + hours.stripTrailingZeros().toPlainString() + "hr)은 0 ~ " + maxHours + "hr (정비기간 " + start + "~" + end + ") 이어야 합니다");
        BoilerMaintenance e = BoilerMaintenance.builder()
            .year(parseIntSafe(body.get("year")))
            .month(parseIntSafe(body.get("month")))
            .boilerCode(str(body.get("boilerCode")))
            .division(str(body.getOrDefault("division","PS")))
            .maintType(str(body.getOrDefault("maintType","REGULAR")))
            .maintName(str(body.get("maintName")))
            .startDate(start)
            .endDate(end)
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
    /** 시작일·종료일: yyyy-mm-dd 형식만 허용 (필수) */
    private static final java.util.regex.Pattern YMD = java.util.regex.Pattern.compile("\\d{4}-\\d{2}-\\d{2}");
    private LocalDate parseYmd(Object v, String label) {
        String s = v == null ? "" : v.toString().trim();
        if (s.isEmpty()) throw new IllegalArgumentException(label + "을 입력하세요 (yyyy-mm-dd)");
        if (!YMD.matcher(s).matches()) throw new IllegalArgumentException(label + " 형식이 올바르지 않습니다: " + s + " → yyyy-mm-dd (예: 2026-01-01)");
        try { return LocalDate.parse(s); } catch (Exception e) { throw new IllegalArgumentException(label + "이 올바른 날짜가 아닙니다: " + s); }
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
