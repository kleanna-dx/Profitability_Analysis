package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.PwSimBasisLine;
import com.company.module.rollingplanningsimulation.entity.PwSimBasisVersion;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** P/L 전력비 연결 — 생산계획(ton) → 전력비 요청 변환. 테스트 전용 값 */
class PowerSimPlLinkTest {

    static BigDecimal d(String v) { return new BigDecimal(v); }
    static PwSimBasisLine line(String code, String unit, String runKw) {
        return PwSimBasisLine.builder().lineCode(code).lineName(code).processName("제지").prodUnit(unit)
                .productivityValue(d("900")).productivityBasis("DAY").productivityUnit("ton").dayBasisHours(d("24"))
                .runKw(runKw == null ? null : d(runKw)).idleKw(d("100")).build();
    }

    @Test void tonToKg_andRatioScaling() {
        List<String> w = new ArrayList<>();
        var pr = PowerSimService.plRequest(List.of(line("PM3", "kg", "20000")), Map.of("PM3", d("20000")), d("1.1"), w);
        assertEquals(0, d("20000000").compareTo(new BigDecimal((String) pr.req().get("PM3").get("baseQty"))));
        assertEquals(0, d("22000000").compareTo(new BigDecimal((String) pr.req().get("PM3").get("qty"))));
        assertEquals(List.of("PM3"), pr.matched());
        assertTrue(w.isEmpty(), String.valueOf(w));
    }

    @Test void caseInsensitiveMatch() {
        var pr = PowerSimService.plRequest(List.of(line("pm3", "ton", "1")), Map.of("PM3", d("10")), BigDecimal.ONE, new ArrayList<>());
        assertEquals(0, d("10").compareTo(new BigDecimal((String) pr.req().get("pm3").get("baseQty"))));
    }

    @Test void noPlan_isZeroWithWarning_andUnusedPlanWarned() {
        List<String> w = new ArrayList<>();
        var pr = PowerSimService.plRequest(List.of(line("제지2", "kg", "6000"), line("라미네이팅", "ea", "0")), Map.of("PM2", d("100")), BigDecimal.ONE, w);
        assertEquals("0", pr.req().get("제지2").get("baseQty"));
        assertEquals("0", pr.req().get("라미네이팅").get("baseQty"));
        assertEquals(List.of("PM2"), pr.unusedPlanCodes());
        assertTrue(w.stream().anyMatch(x -> x.contains("제지2")), "생산계획 없는 호기 경고");
        assertFalse(w.stream().anyMatch(x -> x.contains("라미네이팅")), "고정 사용량 행(가동kW 0)은 경고 안 함");
        assertTrue(w.stream().anyMatch(x -> x.contains("PM2")), "기준정보에 없는 생산계획 호기 경고");
    }

    @Test void unitNotConvertible_isNull_notZero() {
        List<String> w = new ArrayList<>();
        var pr = PowerSimService.plRequest(List.of(line("가공3", "ea", "100")), Map.of("가공3", d("5")), BigDecimal.ONE, w);
        assertNull(pr.req().get("가공3").get("baseQty"));
        assertFalse(w.isEmpty());
    }

    @Test void pickVersion_order() {
        PwSimBasisVersion other = PwSimBasisVersion.builder().division("PS").versionName("다른월").applyYm("202605").build();
        PwSimBasisVersion draft = PwSimBasisVersion.builder().division("PS").versionName("계산월 검토용").applyYm("202606").build();
        assertSame(draft, PowerSimService.pickVersion(List.of(other, draft), "202606"));
        assertSame(other, PowerSimService.pickVersion(List.of(other), "202606"));
        assertNull(PowerSimService.pickVersion(List.of(), "202606"));
    }
}
