package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.service.RpsimSapRfcService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

/**
 * 경영시뮬레이션 SAP RFC 동기화 API
 *
 * <ul>
 *   <li>POST /rolling-planning-simulation-api/sap-rfc/raw-material   — 원부재료 (Z_BI_WEB_EX_BL_2)</li>
 *   <li>POST /rolling-planning-simulation-api/sap-rfc/raw-inventory  — 원부자재 수불부 (Z_BI_WEB_EX_BL_3)</li>
 *   <li>POST /rolling-planning-simulation-api/sap-rfc/all            — 전체 실행</li>
 *   <li>GET  /rolling-planning-simulation-api/sap-rfc/check/{cmonth} — 데이터 존재 확인</li>
 * </ul>
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/sap-rfc")
@RequiredArgsConstructor
@Slf4j
public class RpsimSapRfcController {

    private final RpsimSapRfcService rfcService;

    /**
     * 원부재료 사용현황 수신 (Z_BI_WEB_EX_BL_2)
     * body: { cmonth: "202610", mode: "replace", executedBy: "deyang" }
     */
    @PostMapping("/raw-material")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncRawMaterial(@RequestBody Map<String, Object> body) {
        String cmonth = (String) body.getOrDefault("cmonth", "");
        String mode = (String) body.getOrDefault("mode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");
        try {
            Map<String, Object> result = rfcService.executeRawMaterial(cmonth, mode, executedBy);
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            log.error("[RPSIM RFC] raw-material 에러", e);
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }

    /**
     * 원부자재 수불부 수신 (Z_BI_WEB_EX_BL_3)
     * body: { cmonth: "202610", mode: "replace", executedBy: "deyang" }
     */
    @PostMapping("/raw-inventory")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncRawInventory(@RequestBody Map<String, Object> body) {
        String cmonth = (String) body.getOrDefault("cmonth", "");
        String mode = (String) body.getOrDefault("mode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");
        try {
            Map<String, Object> result = rfcService.executeRawInventory(cmonth, mode, executedBy);
            return ResponseEntity.ok(ApiResponse.success(result));
        } catch (Exception e) {
            log.error("[RPSIM RFC] raw-inventory 에러", e);
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }

    /**
     * 전체 RFC 실행 (원부재료 + 수불부)
     */
    @PostMapping("/all")
    public ResponseEntity<ApiResponse<Map<String, Object>>> syncAll(@RequestBody Map<String, Object> body) {
        String cmonth = (String) body.getOrDefault("cmonth", "");
        String mode = (String) body.getOrDefault("mode", "replace");
        String executedBy = (String) body.getOrDefault("executedBy", "");
        Map<String, Object> result = new LinkedHashMap<>();
        try {
            Map<String, Object> mat = rfcService.executeRawMaterial(cmonth, mode, executedBy);
            result.put("rawMaterial", mat);
        } catch (Exception e) {
            result.put("rawMaterialError", e.getMessage());
        }
        try {
            Map<String, Object> inv = rfcService.executeRawInventory(cmonth, mode, executedBy);
            result.put("rawInventory", inv);
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
            Long matCount = rfcService.getJdbcTemplate().queryForObject(
                    "SELECT COUNT(*) FROM rpsim_raw_material WHERE CALMONTH=?", Long.class, cmonth);
            Long invCount = rfcService.getJdbcTemplate().queryForObject(
                    "SELECT COUNT(*) FROM rpsim_raw_inventory WHERE CALMONTH=?", Long.class, cmonth);
            return ResponseEntity.ok(ApiResponse.success(Map.of(
                    "cmonth", cmonth,
                    "rawMaterialCount", matCount != null ? matCount : 0,
                    "rawInventoryCount", invCount != null ? invCount : 0
            )));
        } catch (Exception e) {
            return ResponseEntity.ok(ApiResponse.success(Map.of("error", e.getMessage())));
        }
    }
}
