package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.service.PlantSteamCalculator.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** 공장 통합 스팀 배분 — 테스트 전용 값 (운영 기준정보와 무관). 2026.04 = 30일 */
class PlantSteamCalculatorTest {
    static BigDecimal d(String v) { return new BigDecimal(v); }
    static void eq(String exp, BigDecimal act) { assertEquals(0, d(exp).compareTo(act), "expected " + exp + " but " + act); }

    static Line line(String div, String mc, String ton, String rate) { return new Line(div, mc, mc, ton == null ? null : d(ton), rate == null ? null : d(rate), null, null); }
    static Boiler steam(String code, int prio, String tph, String rate) {
        return new Boiler(code, code, prio, d(tph), null, rate == null ? null : d(rate), null, null, null, null, null, Map.of(), Map.of());
    }

    @Test void plantTotal_allocatedOnce_byPriority_andDivisionShareByDemand() {
        // PS 3,000톤×2 = 6,000 / HL 1,500톤×2 = 3,000 → 공장 9,000톤 = 하루 300톤
        // 보일러 A 10톤/h(240/일) 100원, B 나머지 200원 → A 7,200 / B 1,800
        Input in = new Input(2026, 4, List.of(line("PS", "PM2", "3000", "2"), line("HL", "TS3", "1500", "2")),
                List.of(steam("A", 1, "10", "100"), steam("B", 2, "100", "200")), Map.of(), null, null);
        Result r = PlantSteamCalculator.calculate(in);
        eq("9000", r.totalDemandTon());
        eq("7200", r.boilers().get(0).allocTon());
        eq("1800", r.boilers().get(1).allocTon());
        eq("1080000", r.boilerCost());           // 720,000 + 360,000
        DivisionResult ps = r.divisions().stream().filter(x -> x.division().equals("PS")).findFirst().orElseThrow();
        DivisionResult hl = r.divisions().stream().filter(x -> x.division().equals("HL")).findFirst().orElseThrow();
        eq("720000", ps.steamCost());            // 2/3
        eq("360000", hl.steamCost());            // 1/3 — 평균단가(A 방식)
        eq("1080000", ps.total().add(hl.total()));
    }

    @Test void overCap_goesToNextBoiler_lastTakesRestWithWarning() {
        // 하루 300톤. A 240, B 1톤/h=24 → B 가 마지막이라 60톤 받음(케파 초과 36)
        Input in = new Input(2026, 4, List.of(line("PS", "PM2", "4500", "2")),
                List.of(steam("A", 1, "10", "100"), steam("B", 2, "1", "200")), Map.of(), null, null);
        Result r = PlantSteamCalculator.calculate(in);
        eq("1800", r.boilers().get(1).allocTon());
        eq("1080", r.overCapTon());
        assertTrue(r.warnings().stream().anyMatch(w -> w.contains("케파 초과")));
    }

    @Test void maintenance_reducesCapacityByHours_andFixedHrOnlyOurs() {
        // A 10톤/h. 1일 정비 12h(당사 8h) → 1일 케파 120. 나머지 B
        Map<Integer, BigDecimal> all = Map.of(1, d("12")), ours = Map.of(1, d("8"));
        Boiler a = new Boiler("A", "A", 1, d("10"), null, d("100"), null, null, null, d("1000"), null, all, ours);
        Input in = new Input(2026, 4, List.of(line("PS", "PM2", "4500", "2")), List.of(a, steam("B", 2, "100", "0")), Map.of(), null, null);
        Result r = PlantSteamCalculator.calculate(in);
        eq("120", r.daily().get(0).alloc().get("A"));
        eq("8", r.boilers().get(0).oursHours());
        eq("8000", r.boilers().get(0).fixedHrCost());   // 당사 8h × 1,000
    }

    @Test void fixedHrCost_evenWhenNoAllocation() {
        Boiler a = steam("A", 1, "100", "100");
        Boiler b = new Boiler("B", "B", 2, d("10"), null, d("50"), null, null, null, d("90000"), null, Map.of(3, d("10")), Map.of(3, d("10")));
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(line("PS", "PM2", "100", "1")), List.of(a, b), Map.of(), null, null));
        eq("0", r.boilers().get(1).allocTon());
        eq("900000", r.boilers().get(1).cost());          // 배분 0 이어도 당사 귀책 운휴 고정비
    }

    @Test void interval_BSCbase_ASCexcess_monthlyGroupTotal() {
        // 복합 1·2 그룹: 월 9,000톤, 보증량 6,000 → BSC 6,000×10 + ASC 3,000×20 = 120,000. 배분량 비율로 나눔
        Boiler c1 = new Boiler("C-1", "복합1", 1, d("5"), "C", null, null, null, null, null, null, Map.of(), Map.of());
        Boiler c2 = new Boiler("C-2", "복합2", 2, d("100"), "C", null, null, null, null, null, null, Map.of(), Map.of());
        IntervalPrice ip = new IntervalPrice(d("10"), d("1"), d("20"), d("1"), d("6000"));
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(line("PS", "PM2", "4500", "2")), List.of(c1, c2), Map.of("C", ip), null, null));
        eq("120000", r.boilerCost());
        eq("3600", r.boilers().get(0).allocTon());        // 5톤/h × 24 × 30
        eq("48000", r.boilers().get(0).cost());           // 120,000 × 3,600/9,000
        assertEquals("기본구간 (BSC)", r.tiers().get(0).name());
        eq("6000", r.tiers().get(0).qtyTon());
        eq("3000", r.tiers().get(1).qtyTon());
    }

    @Test void interval_factorApplied() {
        Boiler c = new Boiler("C", "복합", 1, d("1000"), "C", null, null, null, null, null, null, Map.of(), Map.of());
        IntervalPrice ip = new IntervalPrice(d("10"), d("0.5"), d("20"), d("2"), d("100"));
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(line("PS", "PM2", "150", "1")), List.of(c), Map.of("C", ip), null, null));
        eq("2500", r.boilerCost());                        // 100×10×0.5 + 50×20×2 = 500 + 2,000
    }

    @Test void lngFuel_tonDividedBySteamEfficiency() {
        // LNG: 300톤 ÷ 0.015 톤/㎥ = 20,000㎥ × 600원 = 12,000,000
        Boiler lng = new Boiler("LNG", "LNG", 1, d("100"), null, d("0.015"), null, d("600"), null, null, null, Map.of(), Map.of());
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(line("PS", "PM2", "300", "1")), List.of(lng), Map.of(), null, null));
        eq("12000000", r.boilerCost());
    }

    @Test void dailyHours_splitDemand_andShutdownDayGetsNothing() {
        // 2일만 가동(1일 24h, 2일 12h) → 수요 3,600 → 1일 2,400 / 2일 1,200
        Map<Integer, BigDecimal> h = new HashMap<>();
        for (int i = 3; i <= 30; i++) h.put(i, d("0"));   // 3일~ 운휴 등록
        h.put(1, d("24")); h.put(2, d("12"));
        Line l = new Line("PS", "PM2", "PM2", d("1800"), d("2"), h, null);
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(l), List.of(steam("A", 1, "1000", "1")), Map.of(), null, null));
        eq("2400", r.daily().get(0).demandTon());
        eq("1200", r.daily().get(1).demandTon());
        eq("0", r.daily().get(2).demandTon());
    }

    @Test void unregisteredDay_counts24h() {
        // 1일만 운휴 등록 → 나머지 29일 24h → 수요 2,900 = 하루 100
        Line l = new Line("PS", "PM2", "PM2", d("2900"), d("1"), Map.of(1, d("0")), null);
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(l), List.of(steam("A", 1, "1000", "1")), Map.of(), null, null));
        eq("0", r.daily().get(0).demandTon());
        eq("100", r.daily().get(1).demandTon());
    }

    @Test void missingRate_isZeroWithWarning_noHours_warns() {
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(line("HL", "TS4", "1000", null)), List.of(steam("A", 1, "10", "1")), Map.of(), null, null));
        eq("0", r.totalDemandTon());
        assertTrue(r.warnings().stream().anyMatch(w -> w.contains("스팀 원단위 미등록") && w.contains("TS4")));
        Result r2 = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(line("HL", "TS4", "1000", "1")), List.of(steam("A", 1, "10", "1")), Map.of(), null, null));
        assertTrue(r2.warnings().stream().anyMatch(w -> w.contains("일별 가동시간 미등록")));
    }

    @Test void deduct_andBurner() {
        Line l = new Line("PS", "PM3", "PM3", d("300"), d("1"), null, d("10"));   // 버너 3,000㎥ × 500 = 1,500,000
        Result r = PlantSteamCalculator.calculate(new Input(2026, 4, List.of(l), List.of(steam("A", 1, "100", "1000")), Map.of(), d("-100000"), d("500")));
        eq("300000", r.boilerCost());
        eq("200000", r.steamCost());                       // − 고정차감 100,000
        eq("1500000", r.burnerCost());
        eq("1700000", r.totalCost());
        eq("1700000", r.divisions().get(0).total());
    }

    @Test void lineCost_sumsToTotal() {
        Input in = new Input(2026, 4, List.of(line("PS", "PM2", "3000", "2"), line("PS", "PM3", "1000", "1"), line("HL", "TS3", "1500", "2")),
                List.of(steam("A", 1, "10", "100"), steam("B", 2, "100", "200")), Map.of(), d("50000"), null);
        Result r = PlantSteamCalculator.calculate(in);
        BigDecimal sum = r.lines().stream().map(LineResult::costKrw).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertTrue(sum.subtract(r.totalCost()).abs().compareTo(d("3")) <= 0, "라인 합 " + sum + " vs " + r.totalCost());
    }
}
