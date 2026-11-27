package com.company.module.rollingplanningsimulation.support;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** HL 환산 공통 규칙 — 테스트 전용 값 */
class HlConversionTest {
    static BigDecimal d(String v) { return new BigDecimal(v); }
    static HlConversion.Conv c(String cq, String cu, String bq, String bu) { return new HlConversion.Conv(cq == null ? null : d(cq), cu, bq == null ? null : d(bq), bu); }

    @Test void alias() {
        assertEquals("RP3", HlConversion.resolveMachine("가공 3호기", Map.of()));
        assertEquals("RP5", HlConversion.resolveMachine("가공5", Map.of()));
        assertEquals("SN5", HlConversion.resolveMachine("생리대 5호기", Map.of()));
        assertEquals("SN6", HlConversion.resolveMachine("생리대6", Map.of()));
        assertNull(HlConversion.resolveMachine("가공1", Map.of()));
    }

    @Test void diaperExcluded() {
        assertTrue(HlConversion.excluded("기저귀 1호기"));
        assertFalse(HlConversion.excluded("생리대 5호기"));
        assertFalse(HlConversion.excluded(null));
    }

    /** 순중량 = BAG(기본단위) 1개 중량, 30 EA = 1 BAG → 1EA = 순중량 ÷ 30 */
    @Test void kgPerEa_bagBase() {
        var w = HlConversion.kgPerEa(d("3"), "KG", List.of(c("30", "EA", "1", "BAG"), c("1", "PAL", "128", "BAG"), c(null, null, null, null)));
        assertNull(w.issue());
        assertEquals("BAG", w.baseUnit());
        assertEquals(0, d("0.1").compareTo(w.kgPerEa()));
        assertEquals(0, d("30").compareTo(w.eaPerBase()));
    }

    @Test void kgPerEa_gramUnit_eaBase() {
        var w = HlConversion.kgPerEa(d("250"), "G", List.of(c("1", "EA", "1", "EA")));
        assertEquals(0, d("0.25").compareTo(w.kgPerEa()));
    }

    @Test void kgPerEa_missing_noFakeValue() {
        assertNull(HlConversion.kgPerEa(null, "KG", List.of(c("30", "EA", "1", "BAG"))).kgPerEa());
        assertNull(HlConversion.kgPerEa(d("3"), null, List.of(c("30", "EA", "1", "BAG"))).kgPerEa());
        var w = HlConversion.kgPerEa(d("3"), "KG", List.of(c("1", "PAL", "128", "BAG")));
        assertNull(w.kgPerEa());
        assertTrue(w.issue().contains("EA"), w.issue());
    }

    @Test void convText() {
        assertEquals("30 EA = 1 BAG · 1 PAL = 128 BAG", HlConversion.convText(List.of(c("30", "EA", "1", "BAG"), c("1", "PAL", "128", "BAG"), c("1", "BAG", "1", "BAG"))));
    }
}
