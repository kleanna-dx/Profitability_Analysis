package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.PwLineKw;
import com.company.module.rollingplanningsimulation.repository.PwLineKwRepository;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.*;

/** 기준정보 › 호기별 전력 kW (월별) — 가동 kW / 운휴 kW */
@RestController @RequestMapping("/rolling-planning-simulation-api/pw-line-kws") @RequiredArgsConstructor
public class PwLineKwController {
    private final PwLineKwRepository repo;
    private final AuditSupport auditSupport;
    private static final String[] UK = {"year", "month", "division", "machineCode"};

    @GetMapping public ResponseEntity<ApiResponse<List<PwLineKw>>> list(@RequestParam Integer year, @RequestParam(required = false) Integer month,
                                                                        @RequestParam(defaultValue = "PS") String division) {
        // 월 지정 시 해당 월만 (다른 월 값으로 대체하지 않음)
        if (month != null && month > 0) return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndMonthAndDivisionOrderByMachineCodeAsc(year, month, division)));
        return ResponseEntity.ok(ApiResponse.success(repo.findByYearAndDivisionOrderByMonthAscMachineCodeAsc(year, division)));
    }

    @PostMapping public ResponseEntity<ApiResponse<PwLineKw>> save(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(auditSupport.upsert(repo, build(b), UK)));
    }

    @PutMapping("/{id}") public ResponseEntity<ApiResponse<PwLineKw>> update(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(auditSupport.updateById(repo, id, build(b), UK)));
    }

    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        auditSupport.softDelete(repo, id); return ResponseEntity.ok(ApiResponse.success(null));
    }

    /** 여러 행 한 번에 등록/덮어쓰기 (엑셀 가져오기용). 한 행이라도 오류면 전부 저장 안 함 */
    @Transactional
    @PostMapping("/bulk") public ResponseEntity<ApiResponse<Map<String, Object>>> bulk(@RequestBody Map<String, Object> body) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (body.get("rows") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) {
            @SuppressWarnings("unchecked") Map<String, Object> r = new HashMap<>((Map<String, Object>) m);
            r.putIfAbsent("division", body.get("division"));
            rows.add(r);
        }
        if (rows.isEmpty()) throw new IllegalArgumentException("등록할 행이 없습니다");
        List<PwLineKw> es = new ArrayList<>();
        int i = 0;
        for (Map<String, Object> r : rows) {
            i++;
            try { es.add(build(r)); } catch (IllegalArgumentException e) { throw new IllegalArgumentException(i + "행: " + e.getMessage()); }
        }
        int over = 0;
        for (PwLineKw e : es) if (auditSupport.upsert(repo, e, UK).isUpserted()) over++;
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("saved", es.size()); res.put("overwritten", over);
        return ResponseEntity.ok(ApiResponse.success(res));
    }

    static PwLineKw build(Map<String, Object> b) {
        int year = intOf(b.get("year")), month = intOf(b.get("month"));
        if (year < 2000 || year > 2100) throw new IllegalArgumentException("연도를 입력하세요 (예: 2026)");
        if (month < 1 || month > 12) throw new IllegalArgumentException("월을 입력하세요 (1~12)");
        String div = str(b.get("division"));
        if (div == null) throw new IllegalArgumentException("사업부를 입력하세요");
        div = div.toUpperCase(Locale.ROOT);
        if (!List.of("PS", "HL").contains(div)) throw new IllegalArgumentException("사업부는 PS/HL 중 하나여야 합니다: " + div);
        String mc = str(b.get("machineCode"));
        if (mc == null) throw new IllegalArgumentException("호기를 선택하세요");
        BigDecimal run = kw(b.get("runKw"), "가동 kW"), idle = kw(b.get("idleKw"), "운휴 kW");
        if (run == null && idle == null) throw new IllegalArgumentException("가동 kW 또는 운휴 kW를 입력하세요");
        String memo = str(b.get("memo"));
        if (memo != null && memo.length() > 500) memo = memo.substring(0, 500);
        PwLineKw e = PwLineKw.builder().year(year).month(month).division(div).machineCode(mc.length() > 20 ? mc.substring(0, 20) : mc)
                .runKw(run).idleKw(idle).memo(memo).build();
        if (b.get("createdBy") != null) e.setCreatedBy(b.get("createdBy").toString());
        return e;
    }

    private static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }
    private static int intOf(Object o) { try { return o == null ? 0 : (int) Double.parseDouble(o.toString().trim()); } catch (Exception e) { return 0; } }
    /** 빈칸 = 미입력(null) — 0으로 바꾸지 않음 */
    private static BigDecimal kw(Object o, String label) {
        String s = str(o);
        if (s == null) return null;
        BigDecimal v;
        try { v = new BigDecimal(s.replace(",", "")); } catch (NumberFormatException e) { throw new IllegalArgumentException(label + " 숫자가 아닙니다: " + s); }
        if (v.signum() < 0) throw new IllegalArgumentException(label + "은(는) 0 이상이어야 합니다");
        return v;
    }
}
