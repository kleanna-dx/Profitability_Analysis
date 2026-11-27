package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.HlMaterialMaster;
import com.company.module.rollingplanningsimulation.repository.HlMaterialMasterRepository;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.support.HlConversion;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.*;

/**
 * 기준정보 › HL 자재 마스터 (SAP 자재 마스터 양식 — 엑셀 업로드, 향후 RFC 가 같은 테이블을 채움)
 * <ul>
 *   <li>GET    /hl-material-masters            — 목록 (1EA 중량·단위 환산 계산값 포함)</li>
 *   <li>POST   /hl-material-masters/bulk       — 여러 행 등록/덮어쓰기 (자재코드 기준). 한 행이라도 오류면 전부 저장 안 함</li>
 *   <li>DELETE /hl-material-masters/{id}       — 소프트 삭제</li>
 * </ul>
 */
@RestController @RequestMapping("/rolling-planning-simulation-api/hl-material-masters") @RequiredArgsConstructor
public class HlMaterialMasterController {
    private final HlMaterialMasterRepository repo;
    private final AuditSupport auditSupport;
    static final String[] UK = {"division", "materialCode"};
    static final String HL = "HL";

    @GetMapping public ResponseEntity<ApiResponse<List<HlMaterialMaster>>> list() {
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivisionOrderByMaterialCodeAsc(HL)));
    }

    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        auditSupport.softDelete(repo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    @Transactional
    @PostMapping("/bulk") public ResponseEntity<ApiResponse<Map<String, Object>>> bulk(@RequestBody Map<String, Object> body) {
        List<Map<String, Object>> rows = new ArrayList<>();
        if (body.get("rows") instanceof List<?> l) for (Object o : l) if (o instanceof Map<?, ?> m) {
            @SuppressWarnings("unchecked") Map<String, Object> r = (Map<String, Object>) m;
            rows.add(r);
        }
        Map<String, Object> res = new LinkedHashMap<>();
        Checked c = check(rows);
        if (!c.errors().isEmpty()) { res.put("ok", false); res.put("errors", c.errors()); return ResponseEntity.ok(ApiResponse.success(res)); }
        if (c.rows().isEmpty()) { res.put("ok", false); res.put("errors", List.of("올릴 행이 없습니다")); return ResponseEntity.ok(ApiResponse.success(res)); }
        int over = 0;
        List<String> noWeight = new ArrayList<>();
        for (HlMaterialMaster e : c.rows()) {
            if (auditSupport.upsert(repo, e, UK).isUpserted()) over++;
            String issue = e.getWeightIssue();
            if (issue != null) noWeight.add(e.getMaterialCode() + "(" + issue + ")");
        }
        res.put("ok", true);
        res.put("saved", c.rows().size());
        res.put("overwritten", over);
        List<String> warnings = new ArrayList<>();
        if (!noWeight.isEmpty())
            warnings.add("1EA 중량을 계산할 수 없는 자재 " + noWeight.size() + "건 — 생산계획 환산 때 0톤으로 계산됩니다: "
                    + String.join(", ", noWeight.subList(0, Math.min(30, noWeight.size()))) + (noWeight.size() > 30 ? " 외 " + (noWeight.size() - 30) + "건" : ""));
        res.put("warnings", warnings);
        return ResponseEntity.ok(ApiResponse.success(res));
    }

    public record Checked(List<HlMaterialMaster> rows, List<String> errors) {}

    /** 행 검사 — 자재코드 필수·중복 금지, 숫자 칸은 숫자. 중량·환산이 비어도 저장(경고) */
    static Checked check(List<Map<String, Object>> rows) {
        List<String> errors = new ArrayList<>();
        List<HlMaterialMaster> out = new ArrayList<>();
        Map<String, String> seen = new HashMap<>();
        for (int i = 0; i < rows.size(); i++) {
            Map<String, Object> r = rows.get(i);
            Object no = r.get("rowNo");
            String at = (no != null ? no + "행" : (i + 1) + "번째 행") + ": ";
            int before = errors.size();
            String mat = str(r.get("materialCode"));
            if (mat == null) errors.add(at + "자재코드를 입력하세요");
            else if (mat.length() > 50) errors.add(at + "자재코드는 50자 이내입니다");
            else {
                String prev = seen.putIfAbsent(mat.toUpperCase(Locale.ROOT), at);
                if (prev != null) errors.add(at + "자재코드 " + mat + " 가 " + prev.replace(": ", "") + "과 중복입니다");
            }
            BigDecimal[] n = new BigDecimal[7];
            String[] keys = {"convQty1", "baseQty1", "convQty2", "baseQty2", "convQty5", "baseQty5", "netWeight"};
            String[] labels = {"환산수량1", "기본수량1", "환산수량2", "기본수량2", "환산수량5", "기본수량5", "순중량"};
            for (int k = 0; k < keys.length; k++) {
                Object v = r.get(keys[k]);
                if (str(v) == null) continue;
                n[k] = HlConversion.bd(v);
                if (n[k] == null) errors.add(at + labels[k] + "가 숫자가 아닙니다: " + v);
                else if (n[k].signum() < 0) errors.add(at + labels[k] + "는 0 이상이어야 합니다: " + v);
            }
            if (errors.size() != before) continue;
            out.add(HlMaterialMaster.builder().division(HL)
                    .brand(cut(r.get("brand"), 100)).materialCode(mat).materialName(cut(r.get("materialName"), 300))
                    .convQty1(n[0]).convUnit1(unit(r.get("convUnit1"))).baseQty1(n[1]).baseUnit1(unit(r.get("baseUnit1")))
                    .convQty2(n[2]).convUnit2(unit(r.get("convUnit2"))).baseQty2(n[3]).baseUnit2(unit(r.get("baseUnit2")))
                    .convQty5(n[4]).convUnit5(unit(r.get("convUnit5"))).baseQty5(n[5]).baseUnit5(unit(r.get("baseUnit5")))
                    .netWeight(n[6]).weightUnit(unit(r.get("weightUnit"))).baseMachine(cut(r.get("baseMachine"), 100))
                    .hier1Code(cut(r.get("hier1Code"), 50)).hier1Name(cut(r.get("hier1Name"), 200))
                    .hier3Code(cut(r.get("hier3Code"), 50)).hier3Name(cut(r.get("hier3Name"), 200))
                    .hierCode(cut(r.get("hierCode"), 50)).hierName(cut(r.get("hierName"), 200))
                    .build());
        }
        return new Checked(out, errors);
    }

    static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }
    static String cut(Object o, int n) { String s = str(o); return s == null ? null : (s.length() > n ? s.substring(0, n) : s); }
    static String unit(Object o) { String s = str(o); return s == null ? null : (s.length() > 10 ? s.substring(0, 10) : s).toUpperCase(Locale.ROOT); }
}
