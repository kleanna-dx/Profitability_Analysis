package com.company.module.rollingplanningsimulation.controller;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.DailySteamAlloc;
import com.company.module.rollingplanningsimulation.repository.DailySteamAllocRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.*;

@RestController @RequestMapping("/rolling-planning-simulation-api/daily-steam-allocs") @RequiredArgsConstructor
public class DailySteamAllocController {
    private final DailySteamAllocRepository repo;

    @GetMapping
    public ResponseEntity<ApiResponse<List<DailySteamAlloc>>> list(
            @RequestParam int year, @RequestParam int month,
            @RequestParam(defaultValue="PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(
            repo.findByYearAndMonthAndDivisionOrderByDayAscBoilerCodeAsc(year, month, division)));
    }

    @PostMapping("/batch")
    public ResponseEntity<ApiResponse<Map<String,Object>>> saveBatch(@RequestBody Map<String,Object> body) {
        int year = (int)body.get("year");
        int month = (int)body.get("month");
        String division = (String)body.getOrDefault("division","PS");
        String createdBy = (String)body.getOrDefault("createdBy","");

        // 잠금 체크
        List<DailySteamAlloc> existing = repo.findByYearAndMonthAndDivisionOrderByDayAscBoilerCodeAsc(year, month, division);
        if (existing.stream().anyMatch(d -> Boolean.TRUE.equals(d.getIsLocked()))) {
            Map<String,Object> err = new HashMap<>();
            err.put("error","LOCKED");
            err.put("message","확정(잠금)된 데이터입니다. 잠금 해제 후 수정하세요.");
            return ResponseEntity.ok(ApiResponse.success(err));
        }

        // 기존 미잠금 데이터 삭제
        repo.deleteUnlocked(year, month, division);

        @SuppressWarnings("unchecked")
        List<Map<String,Object>> rows = (List<Map<String,Object>>)body.get("rows");
        int saved = 0;
        if (rows != null) {
            for (Map<String,Object> r : rows) {
                DailySteamAlloc e = DailySteamAlloc.builder()
                    .year(year).month(month)
                    .day(parseI(r.get("day"),1))
                    .boilerCode((String)r.get("boilerCode"))
                    .allocTon(parseBD(r.get("allocTon")))
                    .allocTph(parseBD(r.get("allocTph")))
                    .dailyDemand(parseBD(r.get("dailyDemand")))
                    .isShutdown(r.get("isShutdown") != null && Boolean.parseBoolean(r.get("isShutdown").toString()))
                    .memo((String)r.get("memo"))
                    .division(division)
                    .build();
                e.setCreatedBy(createdBy);
                repo.save(e);
                saved++;
            }
        }
        Map<String,Object> result = new HashMap<>();
        result.put("saved", saved);
        return ResponseEntity.ok(ApiResponse.success(result));
    }

    @PostMapping("/lock")
    public ResponseEntity<ApiResponse<Map<String,Object>>> lock(@RequestBody Map<String,Object> body) {
        int year = (int)body.get("year");
        int month = (int)body.get("month");
        String division = (String)body.getOrDefault("division","PS");
        String userId = (String)body.getOrDefault("userId","");
        int cnt = repo.lockAll(year, month, division, userId);
        Map<String,Object> r = new HashMap<>(); r.put("locked", cnt);
        return ResponseEntity.ok(ApiResponse.success(r));
    }

    @PostMapping("/unlock")
    public ResponseEntity<ApiResponse<Map<String,Object>>> unlock(@RequestBody Map<String,Object> body) {
        int year = (int)body.get("year");
        int month = (int)body.get("month");
        String division = (String)body.getOrDefault("division","PS");
        int cnt = repo.unlockAll(year, month, division);
        Map<String,Object> r = new HashMap<>(); r.put("unlocked", cnt);
        return ResponseEntity.ok(ApiResponse.success(r));
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
