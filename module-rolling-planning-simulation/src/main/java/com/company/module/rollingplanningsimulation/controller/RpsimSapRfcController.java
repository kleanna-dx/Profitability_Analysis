package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.sap.SapRfcSyncService;
import com.company.module.rollingplanningsimulation.entity.RpsimItfHistory;
import com.company.module.rollingplanningsimulation.repository.RpsimItfHistoryRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;

/**
 * 경영시뮬레이션 SAP RFC 동기화 API
 *
 * <p>기존 수익성분석의 SapRfcSyncService(검증된 JCo 호출 로직)를 재사용하여
 * rfcName/targetTable 라우팅으로 RPSIM 테이블에 적재합니다.</p>
 *
 * <ul>
 *   <li>POST /rolling-planning-simulation-api/sap-rfc/raw-material   — 원부재료 (Z_BI_WEB_EX_BL_2 → rpsim_raw_material)</li>
 *   <li>POST /rolling-planning-simulation-api/sap-rfc/raw-inventory  — 원부자재 수불부 (Z_BI_WEB_EX_BL_3 → rpsim_raw_inventory)</li>
 *   <li>POST /rolling-planning-simulation-api/sap-rfc/all            — 전체 실행</li>
 *   <li>GET  /rolling-planning-simulation-api/sap-rfc/check/{cmonth} — 데이터 존재 확인</li>
 * </ul>
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/sap-rfc")
@RequiredArgsConstructor
@Slf4j
public class RpsimSapRfcController {

    /** 기존 수익성분석의 검증된 SAP RFC 서비스 재사용 */
    private final SapRfcSyncService sapRfcSyncService;
    private final RpsimItfHistoryRepository histRepo;
    private final JdbcTemplate jdbcTemplate;

    /**
     * 원부재료 사용현황 수신 (Z_BI_WEB_EX_BL_2 → rpsim_raw_material)
     */
    @PostMapping("/raw-material")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncRawMaterial(@RequestBody Map<String, Object> body) {
        String cmonth = (String) body.getOrDefault("cmonth", "");
        String mode = (String) body.getOrDefault("mode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");

        RpsimItfHistory hist = createHistory("RPSIM_RFC_001", "원부재료 사용현황 (Z_BI_WEB_EX_BL_2)", executedBy);

        try {
            // 기존 수익성분석 서비스의 execute 호출 — rfcName/targetTable로 라우팅
            // 1) batch_jobs 레코드 생성 (수익성분석과 동일한 이력 관리)
            var batch = sapRfcSyncService.createBatchJob(cmonth, mode, executedBy);

            // 2) 비동기가 아닌 동기 실행 (결과를 즉시 반환하기 위해)
            sapRfcSyncService.execute(batch.getId(), cmonth, mode, "Z_BI_WEB_EX_BL_2",
                    SapRfcSyncService.resolveMapping("rpsim_raw_material"));

            // 3) 결과 확인
            long insertedCount = sapRfcSyncService.countExistingData(cmonth, "rpsim_raw_material");

            completeHistory(hist, "success", (int) insertedCount, null);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("rfcName", "Z_BI_WEB_EX_BL_2");
            result.put("cmonth", cmonth);
            result.put("totalInserted", insertedCount);
            result.put("batchId", batch.getId());
            result.put("historyId", hist.getHistoryId());
            return ResponseEntity.ok(ApiResponse.success(result));

        } catch (Exception e) {
            String detail = e.getMessage();
            if (e.getCause() != null) detail += " | Cause: " + e.getCause().getMessage();
            completeHistory(hist, "failed", 0, detail);
            log.error("[RPSIM RFC] raw-material 에러", e);
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", detail)));
        }
    }

    /**
     * 원부자재 수불부 수신 (Z_BI_WEB_EX_BL_3 → rpsim_raw_inventory)
     */
    @PostMapping("/raw-inventory")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncRawInventory(@RequestBody Map<String, Object> body) {
        String cmonth = (String) body.getOrDefault("cmonth", "");
        String mode = (String) body.getOrDefault("mode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");

        RpsimItfHistory hist = createHistory("RPSIM_RFC_002", "원부자재 수불부 (Z_BI_WEB_EX_BL_3)", executedBy);

        try {
            var batch = sapRfcSyncService.createBatchJob(cmonth, mode, executedBy);
            sapRfcSyncService.execute(batch.getId(), cmonth, mode, "Z_BI_WEB_EX_BL_3",
                    SapRfcSyncService.resolveMapping("rpsim_raw_inventory"));

            long insertedCount = sapRfcSyncService.countExistingData(cmonth, "rpsim_raw_inventory");
            completeHistory(hist, "success", (int) insertedCount, null);

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("rfcName", "Z_BI_WEB_EX_BL_3");
            result.put("cmonth", cmonth);
            result.put("totalInserted", insertedCount);
            result.put("batchId", batch.getId());
            result.put("historyId", hist.getHistoryId());
            return ResponseEntity.ok(ApiResponse.success(result));

        } catch (Exception e) {
            String detail = e.getMessage();
            if (e.getCause() != null) detail += " | Cause: " + e.getCause().getMessage();
            completeHistory(hist, "failed", 0, detail);
            log.error("[RPSIM RFC] raw-inventory 에러", e);
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", detail)));
        }
    }

    /**
     * 전체 RFC 실행 (원부재료 + 수불부)
     */
    @PostMapping("/all")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncAll(@RequestBody Map<String, Object> body) {
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            result.put("rawMaterial", syncRawMaterial(body).getBody().getData());
        } catch (Exception e) {
            result.put("rawMaterialError", e.getMessage());
        }
        try {
            result.put("rawInventory", syncRawInventory(body).getBody().getData());
        } catch (Exception e) {
            result.put("rawInventoryError", e.getMessage());
        }
        return ResponseEntity.ok(ApiResponse.success(result));
    }

    /**
     * 데이터 존재 확인
     */
    @GetMapping("/check/{cmonth}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> check(@PathVariable String cmonth) {
        try {
            long matCount = sapRfcSyncService.countExistingData(cmonth, "rpsim_raw_material");
            long invCount = sapRfcSyncService.countExistingData(cmonth, "rpsim_raw_inventory");
            return ResponseEntity.ok(ApiResponse.success(Map.of(
                    "cmonth", cmonth,
                    "rawMaterialCount", matCount,
                    "rawInventoryCount", invCount
            )));
        } catch (Exception e) {
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }

    // ================================================================
    // 이력 헬퍼
    // ================================================================

    private RpsimItfHistory createHistory(String interfaceId, String interfaceName, String executedBy) {
        RpsimItfHistory h = RpsimItfHistory.builder()
                .interfaceId(interfaceId).interfaceName(interfaceName)
                .jobType("SAP_RFC_SYNC").execMode("replace").status("running")
                .startedAt(LocalDateTime.now()).executedBy(executedBy)
                .build();
        return histRepo.save(h);
    }

    private void completeHistory(RpsimItfHistory h, String status, int processCount, String errorMessage) {
        LocalDateTime now = LocalDateTime.now();
        int durationMs = h.getStartedAt() != null
                ? (int) Duration.between(h.getStartedAt(), now).toMillis() : 0;
        h.complete(status, now, durationMs, processCount, errorMessage);
        histRepo.save(h);
    }
}
