package com.company.module.rollingplanningsimulation.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.rollingplanningsimulation.entity.HlMaterialConv;
import com.company.module.rollingplanningsimulation.repository.HlMaterialConvRepository;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.math.BigDecimal;
import java.util.*;

/**
 * 기준정보 › HL 환산단위 (자재코드별 1 EA 중량 kg) — 연도 구분 없음.
 * 등록: 사업부+자재코드가 같으면 덮어씀 / 수정: 지정 행만 / 삭제: 소프트 삭제
 */
@RestController @RequestMapping("/rolling-planning-simulation-api/hl-material-convs") @RequiredArgsConstructor
public class HlMaterialConvController {
    private final HlMaterialConvRepository repo;
    private final AuditSupport auditSupport;
    static final String[] UK = {"division", "materialCode"};

    @GetMapping public ResponseEntity<ApiResponse<List<HlMaterialConv>>> list(@RequestParam(defaultValue = "HL") String division) {
        return ResponseEntity.ok(ApiResponse.success(repo.findByDivisionOrderByMaterialCodeAsc(div(division))));
    }

    @PostMapping public ResponseEntity<ApiResponse<HlMaterialConv>> save(@RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(auditSupport.upsert(repo, build(b), UK)));
    }

    @PutMapping("/{id}") public ResponseEntity<ApiResponse<HlMaterialConv>> update(@PathVariable Long id, @RequestBody Map<String, Object> b) {
        return ResponseEntity.ok(ApiResponse.success(auditSupport.updateById(repo, id, build(b), UK)));
    }

    @DeleteMapping("/{id}") public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        auditSupport.softDelete(repo, id);
        return ResponseEntity.ok(ApiResponse.success(null));
    }

    static String div(Object v) {
        String d = v == null ? "HL" : v.toString().trim().toUpperCase(Locale.ROOT);
        if (d.isEmpty()) d = "HL";
        if (!List.of("PS", "HL").contains(d)) throw new IllegalArgumentException("사업부는 PS/HL 중 하나여야 합니다: " + d);
        return d;
    }

    static HlMaterialConv build(Map<String, Object> b) {
        String mat = str(b.get("materialCode"));
        if (mat == null) throw new IllegalArgumentException("자재코드를 입력하세요");
        if (mat.length() > 50) throw new IllegalArgumentException("자재코드는 50자 이내입니다");
        String name = str(b.get("materialName"));
        if (name != null && name.length() > 200) throw new IllegalArgumentException("자재명은 200자 이내입니다");
        BigDecimal kg;
        String raw = str(b.get("kgPerEa"));
        if (raw == null) throw new IllegalArgumentException("1EA 중량(kg)을 입력하세요");
        try { kg = new BigDecimal(raw.replace(",", "")); } catch (NumberFormatException e) { throw new IllegalArgumentException("1EA 중량(kg)이 숫자가 아닙니다: " + raw); }
        if (kg.signum() <= 0) throw new IllegalArgumentException("1EA 중량(kg)은 0보다 커야 합니다: " + kg.toPlainString());
        String memo = str(b.get("memo"));
        if (memo != null && memo.length() > 500) memo = memo.substring(0, 500);
        return HlMaterialConv.builder().division(div(b.get("division"))).materialCode(mat).materialName(name).kgPerEa(kg).memo(memo).build();
    }

    private static String str(Object o) { if (o == null) return null; String s = o.toString().trim(); return s.isEmpty() ? null : s; }
}
