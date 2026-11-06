package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.service.PurchasePlanService;
import com.company.module.rollingplanningsimulation.support.CurrentUser;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** 구매 이동계획 — 업로드 / 버전 / 계산 결과 / P/L 영향 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/purchase-plan")
@RequiredArgsConstructor
public class PurchasePlanController {

    private final PurchasePlanService service;

    /** 엑셀 양식 드롭다운·검증용 목록 (사업부, SAP 펄프자재, 지급통화, 품목그룹, 자재그룹) */
    @GetMapping("/masters")
    public ResponseEntity<ApiResponse<Map<String, Object>>> masters() {
        return ResponseEntity.ok(ApiResponse.success(service.masters()));
    }

    /** 같은 시작월 기존 업로드 여부 */
    @GetMapping("/check")
    public ResponseEntity<ApiResponse<Map<String, Object>>> check(@RequestParam String startYm) {
        return ResponseEntity.ok(ApiResponse.success(service.check(startYm)));
    }

    /** 업로드 — 오류 있으면 저장 안 함, 같은 시작월 있으면 needConfirm (replace=true 로 다시 호출) */
    @PostMapping("/upload")
    public ResponseEntity<ApiResponse<Map<String, Object>>> upload(@RequestBody Map<String, Object> body) {
        return ResponseEntity.ok(ApiResponse.success(service.upload(body)));
    }

    @GetMapping("/versions")
    public ResponseEntity<ApiResponse<List<Map<String, Object>>>> versions() {
        return ResponseEntity.ok(ApiResponse.success(service.versions()));
    }

    @GetMapping("/versions/{id}")
    public ResponseEntity<ApiResponse<Map<String, Object>>> detail(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(service.detail(id)));
    }

    @DeleteMapping("/versions/{id}")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        service.deleteVersion(id, CurrentUser.get());
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    /** P/L 구매 단가 영향 — 기준월을 포함하는 최신 시작월 버전 */
    @GetMapping("/impact")
    public ResponseEntity<ApiResponse<Map<String, Object>>> impact(@RequestParam String ym,
                                                                   @RequestParam(defaultValue = "PS") String division) {
        return ResponseEntity.ok(ApiResponse.success(service.impact(ym, division)));
    }
}
