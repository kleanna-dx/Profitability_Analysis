package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.PwSimAdjust;
import com.company.module.rollingplanningsimulation.entity.PwSimBasisLine;
import com.company.module.rollingplanningsimulation.entity.PwSimPrice;
import com.company.module.rollingplanningsimulation.service.PowerSimService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * 호기별 생산량 기반 전력비 시뮬레이션 API
 * 기준정보(버전·호기) / 월 평균단가 / 기타 가산·차감 / 생산계획 생산량 / 계산 / 시나리오
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/power-sim")
@RequiredArgsConstructor
public class PowerSimController {

    private final PowerSimService service;

    private static <T> ResponseEntity<ApiResponse<T>> ok(T v) { return ResponseEntity.ok(ApiResponse.success(v)); }

    // ── 기준정보 버전 ──
    @GetMapping("/versions")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> versions(@RequestParam String division) { return ok(service.versions(division)); }

    @GetMapping("/versions/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> version(@PathVariable Long id) { return ok(service.versionDetail(id)); }

    @PostMapping("/versions")
    public ResponseEntity<ApiResponse<Map<String, Object>>> createVersion(@RequestBody Map<String, Object> b) { return ok(service.createVersion(b)); }

    @PutMapping("/versions/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> updateVersion(@PathVariable Long id, @RequestBody Map<String, Object> b) { return ok(service.updateVersion(id, b)); }

    @PostMapping("/versions/{id}/copy")
    public ResponseEntity<ApiResponse<Map<String, Object>>> copyVersion(@PathVariable Long id, @RequestBody(required = false) Map<String, Object> b) { return ok(service.copyVersion(id, b)); }

    @PostMapping("/versions/{id}/approve")
    public ResponseEntity<ApiResponse<Map<String, Object>>> approveVersion(@PathVariable Long id) { return ok(service.approveVersion(id)); }

    @DeleteMapping("/versions/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteVersion(@PathVariable Long id) { service.deleteVersion(id); return ok(null); }

    /** 엑셀(검토용 초기값) → 새 미승인 버전 */
    @PostMapping("/versions/import")
    public ResponseEntity<ApiResponse<Map<String, Object>>> importVersion(@RequestBody Map<String, Object> b) { return ok(service.importVersion(b)); }

    // ── 기준정보 호기 ──
    @PostMapping("/versions/{vid}/lines")
    public ResponseEntity<ApiResponse<PwSimBasisLine>> addLine(@PathVariable Long vid, @RequestBody Map<String, Object> b) { return ok(service.saveLine(vid, null, b)); }

    @PutMapping("/versions/{vid}/lines/{id}")
    public ResponseEntity<ApiResponse<PwSimBasisLine>> updateLine(@PathVariable Long vid, @PathVariable Long id, @RequestBody Map<String, Object> b) { return ok(service.saveLine(vid, id, b)); }

    @DeleteMapping("/versions/{vid}/lines/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteLine(@PathVariable Long vid, @PathVariable Long id) { service.deleteLine(vid, id); return ok(null); }

    // ── 월 평균단가 ──
    @GetMapping("/prices")
    public ResponseEntity<ApiResponse<List<PwSimPrice>>> prices(@RequestParam String division, @RequestParam Integer year) { return ok(service.prices(division, year)); }

    @PostMapping("/prices")
    public ResponseEntity<ApiResponse<PwSimPrice>> addPrice(@RequestBody Map<String, Object> b) { return ok(service.savePrice(null, b)); }

    @PutMapping("/prices/{id}")
    public ResponseEntity<ApiResponse<PwSimPrice>> updatePrice(@PathVariable Long id, @RequestBody Map<String, Object> b) { return ok(service.savePrice(id, b)); }

    @DeleteMapping("/prices/{id}")
    public ResponseEntity<ApiResponse<Void>> deletePrice(@PathVariable Long id) { service.deletePrice(id); return ok(null); }

    // ── 기타 가산·차감 ──
    @GetMapping("/adjusts")
    public ResponseEntity<ApiResponse<List<PwSimAdjust>>> adjusts(@RequestParam String division, @RequestParam String ym) { return ok(service.adjusts(division, ym)); }

    @PostMapping("/adjusts")
    public ResponseEntity<ApiResponse<PwSimAdjust>> addAdjust(@RequestBody Map<String, Object> b) { return ok(service.saveAdjust(null, b)); }

    @PutMapping("/adjusts/{id}")
    public ResponseEntity<ApiResponse<PwSimAdjust>> updateAdjust(@PathVariable Long id, @RequestBody Map<String, Object> b) { return ok(service.saveAdjust(id, b)); }

    @DeleteMapping("/adjusts/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteAdjust(@PathVariable Long id) { service.deleteAdjust(id); return ok(null); }

    // ── 생산계획 생산량 (자동 채움) ──
    @GetMapping("/plan-qty")
    public ResponseEntity<ApiResponse<Map<String, Object>>> planQty(@RequestParam String ym, @RequestParam String division) { return ok(service.planQty(ym, division)); }

    /** P/L 전력비 연결 — P/L 지종별 시뮬 생산량 → 호기별 생산량(ton) → 전력비 */
    /** 전력비 생산량 — STEP3 확정 호기 = 확정 생산계획, 미확정 호기 = P/L 시뮬레이터 생산량 */
    @PostMapping("/production-qty")
    public ResponseEntity<ApiResponse<Map<String, Object>>> productionQty(@RequestBody Map<String, Object> b) { return ok(service.productionQty(b)); }

    @PostMapping("/pl-cost")
    public ResponseEntity<ApiResponse<Map<String, Object>>> plCost(@RequestBody Map<String, Object> b) { return ok(service.plCost(b)); }

    // ── 계산 / 시나리오 ──
    @PostMapping("/calculate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> calculate(@RequestBody Map<String, Object> b) { return ok(service.calculate(b)); }

    @GetMapping("/scenarios")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> scenarios(@RequestParam String division) { return ok(service.scenarios(division)); }

    @PostMapping("/scenarios")
    public ResponseEntity<ApiResponse<Map<String, Object>>> saveScenario(@RequestBody Map<String, Object> b) { return ok(service.saveScenario(b)); }

    /** 저장 당시 결과 그대로 */
    @GetMapping("/scenarios/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> scenario(@PathVariable Long id) { return ok(service.scenario(id)); }

    /** 최신 기준으로 다시 계산 (명시적 동작 · 저장하지 않음) */
    @PostMapping("/scenarios/{id}/recalculate")
    public ResponseEntity<ApiResponse<Map<String, Object>>> recalculate(@PathVariable Long id, @RequestParam(required = false) Long versionId) {
        return ok(service.recalculate(id, versionId));
    }

    @DeleteMapping("/scenarios/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteScenario(@PathVariable Long id) { service.deleteScenario(id); return ok(null); }
}
