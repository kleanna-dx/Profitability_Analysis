package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.HlCustomerExpense;
import com.company.module.rollingplanningsimulation.entity.HlProductionPlan;
import com.company.module.rollingplanningsimulation.entity.HlSalesClose;
import com.company.module.rollingplanningsimulation.entity.HlSalesPlan;
import com.company.module.rollingplanningsimulation.service.HlSalesService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * HL 판매계획(SKU별) · 거래처별 장려금/마케팅비 · 마감
 * <ul>
 *   <li>GET  /hl-sales/teams                       — 등록된 영업팀 목록</li>
 *   <li>GET  /hl-sales/plans?ym=&amp;team=           — 판매계획 (team 없으면 전체)</li>
 *   <li>POST/PUT/DELETE /hl-sales/plans[/{id}]      — 한 행 등록·수정·삭제</li>
 *   <li>POST /hl-sales/plans/upload                 — 엑셀 업로드 (년월·팀 통째 교체)</li>
 *   <li>같은 구성: /hl-sales/expenses?ym=           — 장려금·마케팅비 (기획팀, 년월 전체 · 영업팀 구분 없음)</li>
 *   <li>같은 구성: /hl-sales/productions?ym=        — 생산계획 (현업, 년월 전체 → 확정 = closeType PRODUCTION)</li>
 *   <li>GET  /hl-sales/machines                     — HL 호기 마스터 (생산 호기 드롭다운)</li>
 *   <li>GET  /hl-sales/close?ym= · POST /hl-sales/close · POST /hl-sales/reopen (EXPENSE 는 영업팀 없이 년월 전체)</li>
 *   <li>GET  /hl-sales/summary?ym=                  — 순매출·장려금·마케팅비 합계</li>
 * </ul>
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/hl-sales")
@RequiredArgsConstructor
public class HlSalesController {

    private final HlSalesService service;

    @GetMapping("/teams")
    public ResponseEntity<ApiResponse<List<String>>> teams() { return ResponseEntity.ok(ApiResponse.success(service.teams())); }

    // ── 판매계획 ──
    @GetMapping("/plans")
    public ResponseEntity<ApiResponse<List<HlSalesPlan>>> plans(@RequestParam String ym, @RequestParam(required = false) String team) {
        return ResponseEntity.ok(ApiResponse.success(service.plans(ym, team)));
    }
    @PostMapping("/plans")
    public ResponseEntity<ApiResponse<HlSalesPlan>> addPlan(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.savePlan(null, b)));
    }
    @PutMapping("/plans/{id}")
    public ResponseEntity<ApiResponse<HlSalesPlan>> updatePlan(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.savePlan(id, b)));
    }
    @DeleteMapping("/plans/{id}")
    public ResponseEntity<ApiResponse<Void>> deletePlan(@PathVariable Long id) {
        service.deletePlan(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
    @PostMapping("/plans/upload")
    public ResponseEntity<ApiResponse<Map<String, Object>>> uploadPlans(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.uploadPlans(b)));
    }

    // ── 장려금·마케팅비 ──
    @GetMapping("/expenses")
    public ResponseEntity<ApiResponse<List<HlCustomerExpense>>> expenses(@RequestParam String ym) {
        return ResponseEntity.ok(ApiResponse.success(service.expenses(ym)));
    }
    @PostMapping("/expenses")
    public ResponseEntity<ApiResponse<HlCustomerExpense>> addExpense(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.saveExpense(null, b)));
    }
    @PutMapping("/expenses/{id}")
    public ResponseEntity<ApiResponse<HlCustomerExpense>> updateExpense(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.saveExpense(id, b)));
    }
    @DeleteMapping("/expenses/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteExpense(@PathVariable Long id) {
        service.deleteExpense(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
    @PostMapping("/expenses/upload")
    public ResponseEntity<ApiResponse<Map<String, Object>>> uploadExpenses(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.uploadExpenses(b)));
    }

    // ── 생산계획 ──
    @GetMapping("/machines")
    public ResponseEntity<ApiResponse<List<Map<String, String>>>> machines() {
        return ResponseEntity.ok(ApiResponse.success(service.hlMachines()));
    }
    @GetMapping("/productions")
    public ResponseEntity<ApiResponse<Map<String, Object>>> productions(@RequestParam String ym) {
        return ResponseEntity.ok(ApiResponse.success(service.productions(ym)));
    }
    @PostMapping("/productions")
    public ResponseEntity<ApiResponse<HlProductionPlan>> addProduction(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.saveProduction(null, b)));
    }
    @PutMapping("/productions/{id}")
    public ResponseEntity<ApiResponse<HlProductionPlan>> updateProduction(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.saveProduction(id, b)));
    }
    @DeleteMapping("/productions/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteProduction(@PathVariable Long id) {
        service.deleteProduction(id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }
    @PostMapping("/productions/upload")
    public ResponseEntity<ApiResponse<Map<String, Object>>> uploadProductions(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.uploadProductions(b)));
    }

    // ── 마감 ──
    @GetMapping("/close")
    public ResponseEntity<ApiResponse<List<HlSalesClose>>> closeStatus(@RequestParam String ym) {
        return ResponseEntity.ok(ApiResponse.success(service.closeStatus(ym)));
    }
    @PostMapping("/close")
    public ResponseEntity<ApiResponse<HlSalesClose>> close(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.setClosed(b.get("ym"), b.get("salesTeam"), b.get("closeType"), true)));
    }
    @PostMapping("/reopen")
    public ResponseEntity<ApiResponse<HlSalesClose>> reopen(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(service.setClosed(b.get("ym"), b.get("salesTeam"), b.get("closeType"), false)));
    }

    // ── 요약 ──
    @GetMapping("/summary")
    public ResponseEntity<ApiResponse<Map<String, Object>>> summary(@RequestParam String ym) {
        return ResponseEntity.ok(ApiResponse.success(service.summary(ym)));
    }
}
