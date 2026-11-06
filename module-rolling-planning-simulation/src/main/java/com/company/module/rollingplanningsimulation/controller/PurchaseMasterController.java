package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.PurchaseCurrency;
import com.company.module.rollingplanningsimulation.entity.PurchaseExchangeRate;
import com.company.module.rollingplanningsimulation.entity.PurchaseIncidentalRate;
import com.company.module.rollingplanningsimulation.repository.PurchaseCurrencyRepository;
import com.company.module.rollingplanningsimulation.repository.PurchaseExchangeRateRepository;
import com.company.module.rollingplanningsimulation.repository.PurchaseIncidentalRateRepository;
import com.company.module.rollingplanningsimulation.service.PurchasePlanService;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

/**
 * 구매 이동계획 기준정보 (전사 공통) — 지급통화 / 이동계획 환율 / 부대비율
 * 등록: UK 같으면 덮어씀 / 수정: 지정 행만 / 삭제: 소프트 삭제. 기본값 없음 (필수값 누락 시 오류)
 */
@RestController
@RequestMapping("/rolling-planning-simulation-api/purchase-master")
@RequiredArgsConstructor
public class PurchaseMasterController {

    private final PurchaseCurrencyRepository currencyRepo;
    private final PurchaseExchangeRateRepository rateRepo;
    private final PurchaseIncidentalRateRepository incidentalRepo;
    private final AuditSupport auditSupport;

    private static final String[] UK_CUR = {"currencyCode"};
    private static final String[] UK_RATE = {"ym", "currencyCode"};
    private static final String[] UK_INC = {"year", "materialCode"};

    private static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }
    private static BigDecimal dec(Object o, String label) {
        String s = str(o);
        if (s == null) throw new IllegalArgumentException(label + "을(를) 입력하세요");
        try { return new BigDecimal(s.replace(",", "")); }
        catch (NumberFormatException e) { throw new IllegalArgumentException(label + " 숫자가 아닙니다: " + s); }
    }

    // ── 지급통화 ──
    @GetMapping("/currencies")
    public ResponseEntity<ApiResponse<List<PurchaseCurrency>>> currencies() {
        return ResponseEntity.ok(ApiResponse.success(currencyRepo.findAllByOrderBySortOrderAscCurrencyCodeAsc()));
    }

    @PostMapping("/currencies")
    public ResponseEntity<ApiResponse<PurchaseCurrency>> saveCurrency(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistCurrency(null, b)));
    }

    @PutMapping("/currencies/{id}")
    public ResponseEntity<ApiResponse<PurchaseCurrency>> updateCurrency(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistCurrency(id, b)));
    }

    @DeleteMapping("/currencies/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteCurrency(@PathVariable Long id) {
        auditSupport.softDelete(currencyRepo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private PurchaseCurrency persistCurrency(Long id, Map<String, Object> b) {
        String code = str(b.get("currencyCode"));
        if (code == null) throw new IllegalArgumentException("통화코드를 입력하세요");
        code = code.toUpperCase();
        if (!code.matches("[A-Z]{3}")) throw new IllegalArgumentException("통화코드는 영문 3자리입니다 (예: USD): " + code);
        Integer sort = str(b.get("sortOrder")) == null ? null : Integer.valueOf(str(b.get("sortOrder")));
        PurchaseCurrency e = PurchaseCurrency.builder().currencyCode(code).currencyName(str(b.get("currencyName")))
                .baseYn(str(b.get("baseYn"))).sortOrder(sort).useYn(str(b.get("useYn"))).build();
        return id != null ? auditSupport.updateById(currencyRepo, id, e, UK_CUR) : auditSupport.upsert(currencyRepo, e, UK_CUR);
    }

    // ── 이동계획 환율 ──
    @GetMapping("/exchange-rates")
    public ResponseEntity<ApiResponse<List<PurchaseExchangeRate>>> rates(@RequestParam Integer year) {
        return ResponseEntity.ok(ApiResponse.success(rateRepo.findByYmStartingWithOrderByYmAscCurrencyCodeAsc(String.valueOf(year))));
    }

    @PostMapping("/exchange-rates")
    public ResponseEntity<ApiResponse<PurchaseExchangeRate>> saveRate(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistRate(null, b)));
    }

    @PutMapping("/exchange-rates/{id}")
    public ResponseEntity<ApiResponse<PurchaseExchangeRate>> updateRate(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistRate(id, b)));
    }

    @DeleteMapping("/exchange-rates/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteRate(@PathVariable Long id) {
        auditSupport.softDelete(rateRepo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private PurchaseExchangeRate persistRate(Long id, Map<String, Object> b) {
        String ym = PurchasePlanService.normYm(b.get("ym"));
        if (ym == null) throw new IllegalArgumentException("적용년월 형식이 올바르지 않습니다 (yyyy.mm): " + b.get("ym"));
        String curRaw = str(b.get("currencyCode"));
        if (curRaw == null) throw new IllegalArgumentException("통화를 선택하세요");
        final String cur = curRaw.toUpperCase();
        if (currencyRepo.findAllByOrderBySortOrderAscCurrencyCodeAsc().stream().noneMatch(c -> c.getCurrencyCode().equals(cur)))
            throw new IllegalArgumentException("지급통화 기준정보에 없는 통화입니다: " + cur);
        BigDecimal rate = dec(b.get("rate"), "환율");
        if (rate.signum() <= 0) throw new IllegalArgumentException("환율은 0보다 커야 합니다");
        PurchaseExchangeRate e = PurchaseExchangeRate.builder().ym(ym).currencyCode(cur).rate(rate).memo(str(b.get("memo"))).build();
        return id != null ? auditSupport.updateById(rateRepo, id, e, UK_RATE) : auditSupport.upsert(rateRepo, e, UK_RATE);
    }

    // ── 부대비율 ──
    @GetMapping("/incidental-rates")
    public ResponseEntity<ApiResponse<List<PurchaseIncidentalRate>>> incidental(@RequestParam Integer year) {
        return ResponseEntity.ok(ApiResponse.success(incidentalRepo.findByYearOrderByMaterialCodeAsc(year)));
    }

    @PostMapping("/incidental-rates")
    public ResponseEntity<ApiResponse<PurchaseIncidentalRate>> saveIncidental(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistIncidental(null, b)));
    }

    @PutMapping("/incidental-rates/{id}")
    public ResponseEntity<ApiResponse<PurchaseIncidentalRate>> updateIncidental(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(persistIncidental(id, b)));
    }

    @DeleteMapping("/incidental-rates/{id}")
    public ResponseEntity<ApiResponse<Void>> deleteIncidental(@PathVariable Long id) {
        auditSupport.softDelete(incidentalRepo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    private PurchaseIncidentalRate persistIncidental(Long id, Map<String, Object> b) {
        String y = str(b.get("year"));
        if (y == null || !y.matches("\\d{4}")) throw new IllegalArgumentException("연도는 4자리 숫자입니다: " + b.get("year"));
        String code = PurchasePlanService.stripCode(b.get("materialCode"));
        if (code == null) throw new IllegalArgumentException("SAP 펄프자재를 선택하세요");
        BigDecimal rate = dec(b.get("rate"), "부대비율");
        if (rate.signum() <= 0) throw new IllegalArgumentException("부대비율은 0보다 커야 합니다 (예: 1.05)");
        PurchaseIncidentalRate e = PurchaseIncidentalRate.builder().year(Integer.valueOf(y)).materialCode(code)
                .materialName(str(b.get("materialName"))).rate(rate).memo(str(b.get("memo"))).build();
        return id != null ? auditSupport.updateById(incidentalRepo, id, e, UK_INC) : auditSupport.upsert(incidentalRepo, e, UK_INC);
    }
}
