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
        SteamUnitRate e = SteamUnitRate.builder()
            .year(Integer.parseInt(body.get("year").toString()))
            .month(body.get("month") != null ? Integer.parseInt(body.get("month").toString()) : null)
            .machineCode((String) body.get("machineCode"))
            .division((String) body.getOrDefault("division", "PS"))
            .steamPerTon(body.get("steamPerTon") != null ? new BigDecimal(body.get("steamPerTon").toString()) : BigDecimal.ZERO)
            .etcUsageTon(body.get("etcUsageTon") != null ? new BigDecimal(body.get("etcUsageTon").toString()) : BigDecimal.ZERO)
            .limitNote((String) body.get("limitNote"))
            .memo((String) body.get("memo"))
            .build();
        return ResponseEntity.ok(ApiResponse.success(repo.save(e)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        repo.deleteById(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
}
