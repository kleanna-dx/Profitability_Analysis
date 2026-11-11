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
        var pr = PowerSimService.plRequest(List.of(line("PM3", "kg", "20000")), Map.of("PM3", d("20000")), Map.of("PM3", d("22000")), w);
        assertEquals(0, d("20000000").compareTo(new BigDecimal((String) pr.req().get("PM3").get("baseQty"))));
        assertEquals(0, d("22000000").compareTo(new BigDecimal((String) pr.req().get("PM3").get("qty"))));
        assertEquals(List.of("PM3"), pr.matched());
        assertTrue(w.isEmpty(), String.valueOf(w));
    }

    @Test void caseInsensitiveMatch() {
        var pr = PowerSimService.plRequest(List.of(line("pm3", "ton", "1")), Map.of("PM3", d("10")), Map.of(), new ArrayList<>());
        assertEquals(0, d("10").compareTo(new BigDecimal((String) pr.req().get("pm3").get("baseQty"))));
    }

    @Test void noPlan_isZeroWithWarning_andUnusedPlanWarned() {
        List<String> w = new ArrayList<>();
        var pr = PowerSimService.plRequest(List.of(line("제지2", "kg", "6000"), line("라미네이팅", "ea", "0")), Map.of("PM2", d("100")), Map.of(), w);
        assertEquals("0", pr.req().get("제지2").get("baseQty"));
        assertEquals("0", pr.req().get("라미네이팅").get("baseQty"));
        assertEquals(List.of("PM2"), pr.unusedPlanCodes());
        assertTrue(w.stream().anyMatch(x -> x.contains("제지2")), "생산계획 없는 호기 경고");
        assertFalse(w.stream().anyMatch(x -> x.contains("라미네이팅")), "고정 사용량 행(가동kW 0)은 경고 안 함");
        assertTrue(w.stream().anyMatch(x -> x.contains("PM2")), "기준정보에 없는 생산계획 호기 경고");
    }

    @Test void unitNotConvertible_isNull_notZero() {
        List<String> w = new ArrayList<>();
        var pr = PowerSimService.plRequest(List.of(line("가공3", "ea", "100")), Map.of("가공3", d("5")), Map.of(), w);
        assertNull(pr.req().get("가공3").get("baseQty"));
        assertFalse(w.isEmpty());
    }

    static Map<String, Object> row(String mc, String prod, String ton) { Map<String, Object> m = new HashMap<>(); m.put("MACHINE_CODE", mc); m.put("PRODUCT", prod); m.put("TON", d(ton)); return m; }

    @Test void productSim_drivesMachineTon() {
        // PM2: SC 100톤 + KL 50톤, PM3: SC 300톤. P/L 에서 SC 400 → 480 (×1.2), KL 50 → 50, 백판 = 생산계획 없음 → 30톤 입력
        List<Map<String, Object>> plan = List.of(row("PM2", "SC", "100"), row("PM2", "KL", "50"), row("PM3", "SC", "300"));
        List<String> w = new ArrayList<>();
        var mt = PowerSimService.machineTonFromProducts(plan, List.of(
                new PowerSimService.ProductSim("SC", d("400"), d("480")),
                new PowerSimService.ProductSim("KL", d("50"), d("50")),
                new PowerSimService.ProductSim("백판", d("0"), d("30"))), "ALL", w);
        assertEquals(0, d("150").compareTo(mt.get("base").get("PM2")));
        assertEquals(0, d("170").compareTo(mt.get("sim").get("PM2")));   // 100×1.2 + 50
        assertEquals(0, d("360").compareTo(mt.get("sim").get("PM3")));   // 300×1.2
        assertTrue(w.stream().anyMatch(x -> x.contains("백판")), "생산계획 없는 지종 경고");
    }

    @Test void productNotInPl_keepsPlan() {
        var mt = PowerSimService.machineTonFromProducts(List.of(row("PM2", "SC", "100")), List.of(), "ALL", new ArrayList<>());
        assertEquals(0, d("100").compareTo(mt.get("sim").get("PM2")));
    }

    @Test void machineSelected_appliesRatioOnlyToThatMachine() {
        List<Map<String, Object>> plan = List.of(row("PM2", "SC", "100"), row("PM3", "SC", "300"));
        var mt = PowerSimService.machineTonFromProducts(plan, List.of(new PowerSimService.ProductSim("SC", d("100"), d("120"))), "PM2", new ArrayList<>());
        assertEquals(0, d("120").compareTo(mt.get("sim").get("PM2")));
        assertEquals(0, d("300").compareTo(mt.get("sim").get("PM3")));
    }

    @Test void pickVersion_order() {
        PwSimBasisVersion other = PwSimBasisVersion.builder().division("PS").versionName("다른월").applyYm("202605").build();
        PwSimBasisVersion draft = PwSimBasisVersion.builder().division("PS").versionName("계산월 검토용").applyYm("202606").build();
        assertSame(draft, PowerSimService.pickVersion(List.of(other, draft), "202606"));
        assertSame(other, PowerSimService.pickVersion(List.of(other), "202606"));
        assertNull(PowerSimService.pickVersion(List.of(), "202606"));
    }

    // ---------------- STEP3 확정(잠금) 호기 = 확정 생산계획 그대로 / 미확정 호기 = P/L 입력 생산량
    static Map<String, Object> rowL(String mc, String prod, String ton, int locked) { Map<String, Object> m = row(mc, prod, ton); m.put("LOCKED", locked); return m; }

    @Test void lockedMachine_keepsConfirmedPlan_unlockedUsesPl() {
        // PM2 확정(SC 100), PM3 미확정(SC 300). P/L SC 400 → 480 (×1.2) → PM2 100 그대로, PM3 360
        List<Map<String, Object>> plan = List.of(rowL("PM2", "SC", "100", 1), rowL("PM3", "SC", "300", 0));
        Map<String, Map<String, BigDecimal>> mt = PowerSimService.machineTonFromProducts(plan,
                List.of(new PowerSimService.ProductSim("SC", d("400"), d("480"))), "ALL", new ArrayList<>());
        assertEquals(0, d("100").compareTo(mt.get("sim").get("PM2")), "확정 호기는 P/L 입력과 무관");
        assertEquals(0, d("360").compareTo(mt.get("sim").get("PM3")));
        Map<String, Object> src = PowerSimService.qtySource(plan, true);
        assertEquals("MIXED", src.get("code"));
        assertEquals(List.of("PM2"), src.get("lockedMachines"));
        assertEquals(List.of("PM3"), src.get("unlockedMachines"));
    }

    @Test void qtySource_codes() {
        assertEquals("NONE", PowerSimService.qtySource(List.of(), true).get("code"));
        assertEquals("LOCKED", PowerSimService.qtySource(List.of(rowL("PM2", "SC", "1", 1), rowL("PM3", "SC", "1", 1)), true).get("code"));
        assertEquals("PL", PowerSimService.qtySource(List.of(rowL("PM2", "SC", "1", 0)), true).get("code"));
        assertEquals("PLAN", PowerSimService.qtySource(List.of(rowL("PM2", "SC", "1", 0)), false).get("code"));
        // 한 호기 안에서 일부 지종만 확정이면 미확정으로 봄
        assertEquals(List.of("PM2"), PowerSimService.qtySource(List.of(rowL("PM2", "SC", "1", 1), rowL("PM2", "KL", "1", 0)), true).get("unlockedMachines"));
    }

    @Test void isLocked_variants() {
        assertTrue(PowerSimService.isLocked(1)); assertTrue(PowerSimService.isLocked(true)); assertTrue(PowerSimService.isLocked("1"));
        assertFalse(PowerSimService.isLocked(0)); assertFalse(PowerSimService.isLocked(null)); assertFalse(PowerSimService.isLocked("N"));
    }

    // ---------------- 생산계획에 없는 지종 → 실적 호기 비중으로 배분
    @Test void noPlan_productSplitByActual() {
        // 생산계획 없음. 실적: SC저평량 PM2 300 / PM3 100 → P/L 시뮬 4,000 → PM2 3,000, PM3 1,000 (기준 0)
        List<Map<String, Object>> actual = List.of(row("PM2", "SC저평량", "300"), row("PM3", "SC저평량", "100"));
        List<String> w = new ArrayList<>();
        Map<String, Map<String, BigDecimal>> mt = PowerSimService.machineTonFromProducts(List.of(),
                List.of(new PowerSimService.ProductSim("SC저평량", d("0"), d("4000"))), "ALL", actual, "2026.10 실적", w);
        assertEquals(0, d("3000").compareTo(mt.get("sim").get("PM2")));
        assertEquals(0, d("1000").compareTo(mt.get("sim").get("PM3")));
        assertEquals(0, BigDecimal.ZERO.compareTo(mt.get("base").get("PM2")), "기준 = 생산계획 0");
        assertTrue(w.stream().anyMatch(x -> x.contains("2026.10 실적 호기 비중")));
    }

    @Test void noPlan_noActual_notReflected_warns() {
        List<String> w = new ArrayList<>();
        Map<String, Map<String, BigDecimal>> mt = PowerSimService.machineTonFromProducts(List.of(),
                List.of(new PowerSimService.ProductSim("IV", null, d("600"))), "ALL", List.of(), null, w);
        assertTrue(mt.get("sim").isEmpty());
        assertTrue(w.stream().anyMatch(x -> x.contains("생산계획·실적 모두 없는 지종") && x.contains("IV")));
    }

    @Test void noPlan_machineSelected_allToThatMachine() {
        List<String> w = new ArrayList<>();
        Map<String, Map<String, BigDecimal>> mt = PowerSimService.machineTonFromProducts(List.of(),
                List.of(new PowerSimService.ProductSim("IV", d("0"), d("600"))), "PM3", List.of(), null, w);
        assertEquals(0, d("600").compareTo(mt.get("sim").get("PM3")));
    }
}
