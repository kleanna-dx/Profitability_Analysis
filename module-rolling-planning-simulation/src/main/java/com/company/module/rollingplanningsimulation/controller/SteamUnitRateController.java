package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.SteamUnitRate;
import com.company.module.rollingplanningsimulation.repository.SteamUnitRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/steam-unit-rates") @RequiredArgsConstructor
public class SteamUnitRateController {
    private final SteamUnitRateRepository repo;

    /**
     * 스팀사용 원단위 조회
     * - month 없으면: 해당 연도 전체 (기존 호환)
     * - month 있으면: 해당월 + 전년동월 데이터를 {current:[], prevYear:[]} 로 반환
     */
    @GetMapping
    public ResponseEntity<ApiResponse<?>> list(
            @RequestParam Integer year,
            @RequestParam(required = false) Integer month,
            @RequestParam(defaultValue = "PS") String division) {

        if (month == null) {
            // 기존 호환: 연도별 전체 조회
            return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
        }

        // 월별 조회: 당해 + 전년 동월 한번에
        List<Integer> years = Arrays.asList(year, year - 1);
        List<SteamUnitRate> all = repo.findByYearsAndMonthAndDivision(years, month, division);

        List<SteamUnitRate> current = new ArrayList<>();
        List<SteamUnitRate> prevYear = new ArrayList<>();
        for (SteamUnitRate s : all) {
            if (s.getYear().equals(year)) current.add(s);
            else prevYear.add(s);
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("current", current);
        result.put("prevYear", prevYear);
        result.put("year", year);
        result.put("month", month);
        return ResponseEntity.ok(ApiResponse.success(result));
    }

    @PostMapping
    public ResponseEntity<ApiResponse<SteamUnitRate>> save(@RequestBody Map<String, Object> body) {
        // month: null, 빈문자열, 0 → null 처리
        Integer month = null;
        if (body.get("month") != null) {
            String ms = body.get("month").toString().trim();
            if (!ms.isEmpty()) {
                int mv = Integer.parseInt(ms);
                if (mv >= 1 && mv <= 12) month = mv;
            }
        }

        SteamUnitRate e = SteamUnitRate.builder()
            .year(Integer.parseInt(body.get("year").toString()))
            .month(month)
            .machineCode((String) body.get("machineCode"))
            .division((String) body.getOrDefault("division", "PS"))
            .steamPerTon(parseBD(body.get("steamPerTon")))
            .etcUsageTon(parseBD(body.get("etcUsageTon")))
            .limitNote(body.get("limitNote") != null ? body.get("limitNote").toString() : null)
            .memo(body.get("memo") != null ? body.get("memo").toString() : null)
            .build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    private BigDecimal parseBD(Object v) {
        if (v == null) return BigDecimal.ZERO;
        String s = v.toString().trim();
        if (s.isEmpty()) return BigDecimal.ZERO;
        try { return new BigDecimal(s); } catch (NumberFormatException e) { return BigDecimal.ZERO; }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
