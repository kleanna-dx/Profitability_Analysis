package com.company.module.rollingplanningsimulation.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** HL 생산계획(EA) × 환산단위(1EA kg) → 호기 톤 — 테스트 전용 값 */
class HlPlanConvertTest {
    static BigDecimal d(String v) { return new BigDecimal(v); }
    static Map<String, Object> row(String mc, String mat, String cat, String ea) {
        Map<String, Object> m = new HashMap<>();
        m.put("MACHINE", mc); m.put("MATERIAL_CODE", mat); m.put("CATEGORY", cat); m.put("QTY_EA", ea == null ? null : d(ea));
        return m;
    }

    @Test void eaTimesKg_dividedBy1000_mappedToUnitCode() {
        var units = Map.of("tm3", "TM3", "화장지3", "TM3", "tm4", "TM4");
        var kg = Map.of("M1", d("0.5"), "M2", d("2"));
        var p = PowerSimService.convertHlPlan(List.of(
                row("화장지 3호기", "m1", "롤", "10000"),   // 10000 × 0.5 / 1000 = 5톤, 이름·소문자 매칭
                row("TM3", "M2", "롤", "1000"),            // 2톤 → 같은 호기·카테고리 합산 7
                row("TM4", "M2", "미용", "500")), kg, units, true);
        assertTrue(p.warnings().isEmpty(), p.warnings().toString());
        assertTrue(p.locked());
        assertEquals(2, p.rows().size());
        assertEquals("TM3", p.rows().get(0).get("MACHINE_CODE"));
        assertEquals(0, d("7").compareTo((BigDecimal) p.rows().get(0).get("TON")));
        assertEquals(1, p.rows().get(0).get("LOCKED"));
        assertEquals(0, d("1").compareTo((BigDecimal) p.rows().get(1).get("TON")));
        assertEquals(0, d("11500").compareTo(p.totalEa()));
        assertEquals(0, d("8").compareTo(p.totalTon()));
    }

    @Test void missingConv_zeroTon_warn_noFakeValue() {
        var p = PowerSimService.convertHlPlan(List.of(row("TM3", "M9", "롤", "1000"), row("TM3", "M1", "롤", "1000")),
                Map.of("M1", d("1")), Map.of("tm3", "TM3"), false);
        assertEquals(0, d("1").compareTo(p.totalTon()));
        assertEquals(0, p.rows().get(0).get("LOCKED"));
        assertEquals(1, p.warnings().size());
        assertTrue(p.warnings().get(0).contains("M9"), p.warnings().toString());
    }

    @Test void unknownMachine_keptAsIs_warn() {
        var p = PowerSimService.convertHlPlan(List.of(row("가공1", "M1", null, "100")),
                Map.of("M1", d("1")), Map.of("tm3", "TM3"), true);
        assertEquals("가공1", p.rows().get(0).get("MACHINE_CODE"));
        assertEquals("(미분류)", p.rows().get(0).get("PRODUCT"));
        assertTrue(p.warnings().stream().anyMatch(w -> w.contains("가공1")), p.warnings().toString());
    }

    @Test void zeroEaWithoutConv_noWarning() {
        var p = PowerSimService.convertHlPlan(List.of(row("TM3", "M9", "롤", "0")), Map.of(), Map.of("tm3", "TM3"), true);
        assertTrue(p.warnings().isEmpty(), p.warnings().toString());
    }
}
