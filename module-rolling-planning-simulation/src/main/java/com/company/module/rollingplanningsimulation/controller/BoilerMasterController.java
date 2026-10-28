package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BoilerMaster;
import com.company.module.rollingplanningsimulation.repository.BoilerMasterRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

@RestController @RequestMapping("/rolling-planning-simulation-api/boiler-masters") @RequiredArgsConstructor
public class BoilerMasterController {
    private final BoilerMasterRepository repo;

    @GetMapping
    public ResponseEntity<ApiResponse<List<BoilerMaster>>> list(
            @RequestParam(defaultValue="PS") String division,
            @RequestParam(required=false) Integer year,
            @RequestParam(required=false) Integer month) {
        if (year != null && month != null) {
            // 월별 조회: 해당 연/월 데이터만 (연도 0 / 월 0 기본값은 표시하지 않음)
            List<BoilerMaster> result = new ArrayList<>(repo.findByDivisionAndYearMonth(division, year, month));
            result.sort(Comparator.comparingInt(b -> b.getPriority() != null ? b.getPriority() : 99));
            return ResponseEntity.ok(ApiResponse.success(result));
        }
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivision(division)));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<BoilerMaster>> save(@RequestBody Map<String,Object> body) {
        BoilerMaster e = BoilerMaster.builder()
            .boilerCode((String)body.get("boilerCode"))
            .boilerName((String)body.get("boilerName"))
            .boilerType((String)body.getOrDefault("boilerType","COGEN"))
            .steamPerHour(parseBD(body.get("steamPerHour")))
            .priority(parseI(body.get("priority"), 99))
            .capacityNote((String)body.get("capacityNote"))
            .isActive(body.get("isActive")!=null?Boolean.parseBoolean(body.get("isActive").toString()):true)
            .division((String)body.getOrDefault("division","PS"))
            .year(parseI(body.get("year"), 0))
            .month(parseI(body.get("month"), 0))
            .displayOrder(parseI(body.get("displayOrder"), 0))
            .build();
        if(body.get("createdBy")!=null) e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<ApiResponse<BoilerMaster>> update(@PathVariable Long id, @RequestBody Map<String,Object> body) {
        BoilerMaster e = repo.findById(id).orElseThrow(() -> new RuntimeException("Not found: " + id));
        e.update(
            body.containsKey("boilerName") ? (String)body.get("boilerName") : e.getBoilerName(),
            body.containsKey("boilerType") ? (String)body.get("boilerType") : e.getBoilerType(),
            body.containsKey("steamPerHour") ? parseBD(body.get("steamPerHour")) : e.getSteamPerHour(),
            body.containsKey("priority") ? parseI(body.get("priority"), e.getPriority()) : e.getPriority(),
            body.containsKey("capacityNote") ? (String)body.get("capacityNote") : e.getCapacityNote(),
            body.containsKey("isActive") ? Boolean.parseBoolean(body.get("isActive").toString()) : e.getIsActive(),
            body.containsKey("year") ? parseI(body.get("year"), 0) : null,
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
    private int parseI(Object v, int def) {
        if (v == null) return def;
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return def; }
    }
}
