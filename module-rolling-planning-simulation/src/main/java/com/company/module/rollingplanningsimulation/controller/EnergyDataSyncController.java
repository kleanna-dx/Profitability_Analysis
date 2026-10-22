package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.RpsimItfHistory;
import com.company.module.rollingplanningsimulation.repository.RpsimItfHistoryRepository;
import com.company.module.rollingplanningsimulation.service.EnergyDataSyncService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

/**
 * 에너지팀 데이터 수신 API
 *
 * <p>aiplatform.steam_cell_value 테이블에서 단가/원단위를 읽어
 * RPSIM 기준정보 테이블에 동기화합니다.</p>
 *
 * <ul>
 *   <li>POST /rolling-planning-simulation-api/energy-sync/prices   — 단가 수신</li>
 *   <li>POST /rolling-planning-simulation-api/energy-sync/unit-rates — 원단위 수신</li>
 *   <li>POST /rolling-planning-simulation-api/energy-sync/all       — 전체 수신</li>
 *   <li>GET  /rolling-planning-simulation-api/energy-sync/check     — 에너지팀 데이터 존재 확인</li>
 * </ul>
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/energy-sync")
@RequiredArgsConstructor
@Slf4j
public class EnergyDataSyncController {

    private final EnergyDataSyncService syncService;
    private final RpsimItfHistoryRepository histRepo;

    /**
     * 단가 수신 (unit_price_detail → boiler_cost_rate + steam_price_interval)
     */
    @PostMapping("/prices")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncPrices(@RequestBody Map<String, Object> body) {
        int year = parseI(body.get("year"), LocalDateTime.now().getYear());
        String division = (String) body.getOrDefault("division", "PS");
        String executedBy = (String) body.getOrDefault("executedBy", "");

        // 이력 생성
        RpsimItfHistory hist = createHistory("RPSIM_ITF_005", "보일러 연료단가 (에너지팀)", executedBy);
        try {
            int count = syncService.syncPriceData(year, division);
            completeHistory(hist, "success", count, null);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("year", year);
            result.put("division", division);
            result.put("processCount", count);
            result.put("historyId", hist.getHistoryId());
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            completeHistory(hist, "failed", 0, e.getMessage());
            log.error("[EnergySync] 단가 수신 에러", e);
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }

    /**
     * 원단위 수신 (energy_fuel_ratio → steam_unit_rate)
     */
    @PostMapping("/unit-rates")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncUnitRates(@RequestBody Map<String, Object> body) {
        int year = parseI(body.get("year"), LocalDateTime.now().getYear());
        String division = (String) body.getOrDefault("division", "PS");
        String executedBy = (String) body.getOrDefault("executedBy", "");

        RpsimItfHistory hist = createHistory("RPSIM_ITF_001", "스팀사용 원단위 (에너지팀)", executedBy);
        try {
            int count = syncService.syncUnitRateData(year, division);
            completeHistory(hist, "success", count, null);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("year", year);
            result.put("division", division);
            result.put("processCount", count);
            result.put("historyId", hist.getHistoryId());
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            completeHistory(hist, "failed", 0, e.getMessage());
            log.error("[EnergySync] 원단위 수신 에러", e);
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }

    /**
     * 전체 수신 (단가 + 원단위)
     */
    @PostMapping("/all")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncAll(@RequestBody Map<String, Object> body) {
        int year = parseI(body.get("year"), LocalDateTime.now().getYear());
        String division = (String) body.getOrDefault("division", "PS");
        String executedBy = (String) body.getOrDefault("executedBy", "");

        RpsimItfHistory hist = createHistory("RPSIM_ITF_005", "에너지팀 전체 수신 (단가+원단위)", executedBy);
        try {
            Map<String, Integer> counts = syncService.syncAll(year, division);
            completeHistory(hist, "success", counts.get("totalCount"), null);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("year", year);
            result.put("division", division);
            result.putAll(counts);
            result.put("historyId", hist.getHistoryId());
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            completeHistory(hist, "failed", 0, e.getMessage());
            log.error("[EnergySync] 전체 수신 에러", e);
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }

    /**
     * 에너지팀 데이터 존재 확인 (미리보기)
     */
    @GetMapping("/check")
    public ResponseEntity<ApiResponse<Map<String, Object>>> check(
            @RequestParam int year,
            @RequestParam(defaultValue = "PS") String division) {
        String yearStr = String.valueOf(year);
        try {
            Long priceCount = syncService.getJdbcTemplate().queryForObject(
                    "SELECT COUNT(*) FROM aiplatform.steam_cell_value WHERE table_name='unit_price_detail' AND month=?",
                    Long.class, yearStr);
            Long unitRateCount = syncService.getJdbcTemplate().queryForObject(
                    "SELECT COUNT(*) FROM aiplatform.steam_cell_value WHERE table_name='energy_fuel_ratio' AND month=? AND row_key LIKE 't17|%'",
                    Long.class, yearStr);
            Map<String, Object> result = new LinkedHashMap<>();
            result.put("year", year);
            result.put("priceDataCount", priceCount != null ? priceCount : 0);
            result.put("unitRateDataCount", unitRateCount != null ? unitRateCount : 0);
            result.put("available", (priceCount != null && priceCount > 0) || (unitRateCount != null && unitRateCount > 0));
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            log.warn("[EnergySync] check 실패: {}", e.getMessage());
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage(), "available", false)));
        }
    }

    // ================================================================
    // 이력 헬퍼
    // ================================================================

    private RpsimItfHistory createHistory(String interfaceId, String interfaceName, String executedBy) {
        RpsimItfHistory h = RpsimItfHistory.builder()
                .interfaceId(interfaceId).interfaceName(interfaceName)
                .jobType("ENERGY_DB_SYNC").execMode("replace").status("running")
                .startedAt(LocalDateTime.now()).executedBy(executedBy)
                .build();
        return histRepo.save(h);
    }

    private void completeHistory(RpsimItfHistory h, String status, int processCount, String errorMessage) {
        LocalDateTime now = LocalDateTime.now();
        int durationMs = h.getStartedAt() != null
                ? (int) java.time.Duration.between(h.getStartedAt(), now).toMillis() : 0;
        h.complete(status, now, durationMs, processCount, errorMessage);
        histRepo.save(h);
    }

    private int parseI(Object v, int def) {
        if (v == null) return def;
        try { return Integer.parseInt(v.toString().trim()); } catch (Exception e) { return def; }
    }
}
