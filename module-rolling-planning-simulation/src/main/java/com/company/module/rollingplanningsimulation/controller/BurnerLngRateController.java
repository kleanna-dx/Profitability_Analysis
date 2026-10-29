package com.company.module.rollingplanningsimulation.controller;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.BurnerLngRate;
import com.company.module.rollingplanningsimulation.repository.BurnerLngRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

@RestController @RequestMapping("/rolling-planning-simulation-api/burner-lng-rates") @RequiredArgsConstructor
public class BurnerLngRateController {
    private final BurnerLngRateRepository repo;
    private final AuditSupport auditSupport;
    @GetMapping public ResponseEntity<ApiResponse<List<BurnerLngRate>>> list(@RequestParam Integer year, @RequestParam(required=false) Integer month, @RequestParam(defaultValue="PS") String division) {
        // 월 지정 시 해당 월만 (다른 월·월0 값으로 대체하지 않음)
        if (month != null && month > 0) return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndMonthAndDivisionOrderByMachineCodeAsc(year, month, division)));
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivision(year, division)));
    }
    @PostMapping public ResponseEntity<ApiResponse<BurnerLngRate>> save(@RequestBody Map<String,Object> body) {
        int year = parseI(body.get("year")), month = parseI(body.get("month"));
        if (year < 2000 || year > 2100) throw new IllegalArgumentException("연도를 입력하세요 (예: 2026)");
        if (month < 1 || month > 12) throw new IllegalArgumentException("월을 입력하세요 (1~12)");
        if (body.get("machineCode") == null || body.get("machineCode").toString().isBlank()) throw new IllegalArgumentException("호기를 입력하세요");
        BurnerLngRate e = BurnerLngRate.builder().year(year).month(month)
            .machineCode((String)body.get("machineCode")).division((String)body.getOrDefault("division","PS"))
            .lngPerTon(body.get("lngPerTon")!=null?new BigDecimal(body.get("lngPerTon").toString()):BigDecimal.ZERO)
            .memo((String)body.get("memo")).build();
        if(body.get("createdBy")!=null)e.setCreatedBy(body.get("createdBy").toString());
        return ResponseEntity.ok(ApiResponse.success(persist(e, body)));
    }
    @PutMapping("/{id}") public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String,Object> body) { body.remove("id"); body.put(UPDATE_ID, id); return save(body); }
    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) { auditSupport.softDelete(repo, id); return ResponseEntity.ok(ApiResponse.success(null)); }

    // 등록: UK가 같은 행이 있으면 덮어씀(삭제된 행이면 되살림) / 수정: 지정 행만, 키 중복 시 오류
    private static final String UPDATE_ID = "__updateId";
    private static final String[] UK = {"year", "month", "machineCode", "division"};
    private static int parseI(Object v) { try { return v == null ? 0 : (int) Double.parseDouble(v.toString().trim()); } catch (Exception ex) { return 0; } }
    private BurnerLngRate persist(BurnerLngRate e, Map<String,Object> body) {
        Object uid = body.remove(UPDATE_ID);
        return uid != null ? auditSupport.updateById(repo, (Long) uid, e, UK) : auditSupport.upsert(repo, e, UK);
    }
}
