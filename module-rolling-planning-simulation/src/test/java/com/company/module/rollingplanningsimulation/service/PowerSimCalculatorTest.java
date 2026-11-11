package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.service.PowerSimCalculator.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 테스트 전용 데이터 — 실제 업무값이 아니며 운영 기준정보·파일 데이터와 무관.
 * 기준 케이스: 30일(720h), 1,000ton, 2ton/h, 가동 1,000kW, 운휴 100kW, 150원/kWh, 조정 0
 */
class PowerSimCalculatorTest {

    static BigDecimal d(String v) { return new BigDecimal(v); }
    static void eq(String expected, BigDecimal actual) {
        assertNotNull(actual, "값이 null(계산 안 됨)입니다 — 기대값 " + expected);
        assertEquals(0, d(expected).compareTo(actual), "기대 " + expected + " / 실제 " + actual.toPlainString());
    }

    static final Price PRICE = new Price(d("150"), "N", "Y", "Y", "N", "테스트 단가 — 부가세 별도, 기본요금·ESS 포함, 정산금 별도");

    static Line line(String code, String qty) {
        return new Line(code, code + "호기", "제지", "ton", qty == null ? null : d(qty),
                d("2"), "HOUR", "ton", null, d("1000"), d("100"), BigDecimal.ZERO, null);
    }

    static Result run(int y, int m, List<Line> lines, List<Adjust> adj) {
        return PowerSimCalculator.calculate(new Input(y, m, PRICE, lines, adj));
    }

    // ── 필수: 기준 케이스 ──
    @Test void baseCase_1000ton() {
        Result r = run(2026, 9, List.of(line("T1", "1000")), List.of());   // 2026.09 = 30일
        eq("720", r.monthHours());
        LineResult l = r.lines().get(0);
        assertEquals(PowerSimCalculator.OK, l.status(), String.valueOf(l.errors()));
        eq("500", l.runHours());
        eq("220", l.idleHours());
        eq("500000", l.runKwh());
        eq("22000", l.idleKwh());
        eq("522000", l.totalKwh());
        eq("78300000", l.costKrw());
        assertTrue(r.complete(), String.valueOf(r.errors()));
        eq("78300000", r.finalCost());
    }

    @Test void simCase_1100ton_andDelta() {
        Result base = run(2026, 9, List.of(line("T1", "1000")), List.of());
        Result sim = run(2026, 9, List.of(line("T1", "1100")), List.of());
        LineResult l = sim.lines().get(0);
        eq("550", l.runHours());
        eq("170", l.idleHours());
        eq("567000", l.totalKwh());
        eq("85050000", l.costKrw());
        Delta dl = PowerSimCalculator.delta(base, sim);
        assertTrue(dl.available());
        eq("45000", dl.kwh());
        eq("6750000", dl.lineCost());
        eq("6750000", dl.finalCost());
    }

    // ── 생산량 0 → 운휴 사용량만 ──
    @Test void zeroProduction_idleOnly() {
        Result r = run(2026, 9, List.of(line("T1", "0")), List.of());
        LineResult l = r.lines().get(0);
        assertEquals(PowerSimCalculator.OK, l.status());
        eq("0", l.runHours());
        eq("720", l.idleHours());
        eq("72000", l.totalKwh());        // 720h × 100kW
        eq("10800000", l.costKrw());      // × 150
        assertTrue(r.complete());
    }

    // ── 생산량 0 이면 생산성 미입력이어도 계산 (가동시간 0) ──
    @Test void zeroProduction_noProductivity_ok() {
        Line l0 = new Line("T1", "1호기", "제지", "ton", d("0"), null, null, null, null, d("1000"), d("100"), null, null);
        Result r = run(2026, 9, List.of(l0), List.of());
        assertEquals(PowerSimCalculator.OK, r.lines().get(0).status(), String.valueOf(r.lines().get(0).errors()));
        eq("72000", r.lines().get(0).totalKwh());
    }

    // ── 양수 생산량 + 생산성 미입력 → 차단 ──
    @Test void positiveQty_missingProductivity_blocked() {
        Line bad = new Line("T1", "1호기", "제지", "ton", d("1000"), null, "HOUR", "ton", null, d("1000"), d("100"), null, null);
        Result r = run(2026, 9, List.of(bad), List.of());
        LineResult l = r.lines().get(0);
        assertEquals(PowerSimCalculator.ERROR, l.status());
        assertNull(l.totalKwh());
        assertNull(l.costKrw());
        assertTrue(l.errors().stream().anyMatch(e -> e.contains("생산성 미입력")), String.valueOf(l.errors()));
        assertFalse(r.complete());
        assertNull(r.finalCost(), "오류 호기가 있으면 전체 합계는 계산 미완료(null)");
    }

    @Test void positiveQty_zeroProductivity_blocked() {
        Line bad = new Line("T1", "1호기", "제지", "ton", d("1000"), d("0"), "HOUR", "ton", null, d("1000"), d("100"), null, null);
        Result r = run(2026, 9, List.of(bad), List.of());
        assertEquals(PowerSimCalculator.ERROR, r.lines().get(0).status());
        assertFalse(r.complete());
    }

    // ── 생산능력 초과 ──
    @Test void capacityExceeded() {
        Result r = run(2026, 9, List.of(line("T1", "1500")), List.of()); // 750h > 720h
        LineResult l = r.lines().get(0);
        assertEquals(PowerSimCalculator.CAPACITY_EXCEEDED, l.status());
        eq("750", l.runHours());               // 필요 가동시간은 보여줌 (줄이지 않음)
        assertNull(l.idleHours(), "음수 운휴시간을 계산하지 않음");
        assertNull(l.totalKwh());
        assertTrue(l.errors().get(0).contains("생산 불가"));
        assertFalse(r.complete());
        assertNull(r.finalCost());
    }

    @Test void exactlyFullMonth_ok() {
        Result r = run(2026, 9, List.of(line("T1", "1440")), List.of()); // 720h = 월 전체
        LineResult l = r.lines().get(0);
        assertEquals(PowerSimCalculator.OK, l.status());
        eq("0", l.idleHours());
        eq("720000", l.totalKwh());
    }

    // ── 윤년 2월 ──
    @Test void leapYearFebruary() {
        eq("696", PowerSimCalculator.monthHours(2028, 2));   // 29일
        eq("672", PowerSimCalculator.monthHours(2026, 2));   // 28일
        eq("744", PowerSimCalculator.monthHours(2026, 1));
        Result r = run(2028, 2, List.of(line("T1", "1000")), List.of());
        LineResult l = r.lines().get(0);
        eq("500", l.runHours());
        eq("196", l.idleHours());
        eq("519600", l.totalKwh());   // 500,000 + 19,600
        eq("77940000", l.costKrw());
    }

    // ── 단위 변환 ──
    @Test void unitConversion_tonPerDay_toKgQty() {
        // 생산량 kg, 생산성 48 ton/일 · 1일 기준 24h → 2 ton/h = 2,000 kg/h
        Line l = new Line("T1", "1호기", "제지", "kg", d("1000000"), d("48"), "DAY", "ton", d("24"),
                d("1000"), d("100"), null, null);
        Result r = run(2026, 9, List.of(l), List.of());
        LineResult x = r.lines().get(0);
        assertEquals(PowerSimCalculator.OK, x.status(), String.valueOf(x.errors()));
        eq("2000", x.productivityPerHour());
        eq("500", x.runHours());
        eq("522000", x.totalKwh());
    }

    @Test void unitConversion_dayBasisNot24() {
        // 40 ton/일, 1일 기준시간 20h → 2 ton/h (24시간으로 나누지 않음)
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), d("40"), "DAY", "ton", d("20"),
                d("1000"), d("100"), null, null);
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        eq("2", x.productivityPerHour());
        eq("500", x.runHours());
    }

    @Test void unitConversion_dayBasisMissing_blocked() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), d("48"), "DAY", "ton", null,
                d("1000"), d("100"), null, null);
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        assertEquals(PowerSimCalculator.ERROR, x.status());
        assertTrue(x.errors().stream().anyMatch(e -> e.contains("1일 기준시간")));
    }

    @Test void unitMismatch_blocked() {
        Line l = new Line("T1", "1호기", "화장지", "ton", d("1000"), d("5000"), "HOUR", "개", null,
                d("1000"), d("100"), null, null);
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        assertEquals(PowerSimCalculator.ERROR, x.status());
        assertTrue(x.errors().stream().anyMatch(e -> e.contains("단위 불일치")));
    }

    // ── 사용량 조정 ──
    @Test void negativeAdjustment_finalNegative_blocked() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), d("2"), "HOUR", "ton", null,
                d("1000"), d("100"), d("-600000"), "테스트: 과도한 차감");
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        assertEquals(PowerSimCalculator.ERROR, x.status());
        assertNull(x.totalKwh());
        assertTrue(x.errors().stream().anyMatch(e -> e.contains("음수")));
    }

    @Test void adjustment_requiresReason() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), d("2"), "HOUR", "ton", null,
                d("1000"), d("100"), d("10000"), " ");
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        assertEquals(PowerSimCalculator.ERROR, x.status());
        assertTrue(x.errors().stream().anyMatch(e -> e.contains("사유")));
    }

    @Test void adjustment_positiveWithReason() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), d("2"), "HOUR", "ton", null,
                d("1000"), d("100"), d("-22000"), "테스트: 운휴 중 공용설비 분리");
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        eq("500000", x.totalKwh());
        eq("75000000", x.costKrw());
    }

    // ── 기타 가산·차감 ──
    @Test void manualAddDeduct_applied() {
        List<Adjust> adj = List.of(
                new Adjust("테스트 가산", PowerSimCalculator.ADD, d("1000000"), "OTHER", "N", "테스트 근거"),
                new Adjust("테스트 차감", PowerSimCalculator.DEDUCT, d("300000"), "SETTLEMENT", "N", "테스트 근거"));
        Result r = run(2026, 9, List.of(line("T1", "1000")), adj);
        assertTrue(r.complete(), String.valueOf(r.errors()));
        eq("78300000", r.lineCostSum());
        eq("1000000", r.addTotal());
        eq("300000", r.deductTotal());
        eq("79000000", r.finalCost());
    }

    @Test void manualAdjust_negativeAmount_blocked() {
        List<Adjust> adj = List.of(new Adjust("음수", PowerSimCalculator.DEDUCT, d("-1"), "OTHER", "N", "근거"));
        Result r = run(2026, 9, List.of(line("T1", "1000")), adj);
        assertFalse(r.complete());
        assertNull(r.finalCost());
    }

    @Test void manualAdjust_duplicateWithPriceScope_blocked() {
        // 단가에 ESS 포함(Y) → ESS 항목을 다시 넣으면 중복
        List<Adjust> adj = List.of(new Adjust("ESS 정산", PowerSimCalculator.DEDUCT, d("500000"), "ESS", "N", "근거"));
        Result r = run(2026, 9, List.of(line("T1", "1000")), adj);
        assertFalse(r.complete());
        assertTrue(r.adjusts().get(0).errors().get(0).contains("중복"));
    }

    @Test void manualAdjust_vatMismatch_blocked() {
        List<Adjust> adj = List.of(new Adjust("기타", PowerSimCalculator.ADD, d("1000"), "OTHER", "Y", "근거"));
        Result r = run(2026, 9, List.of(line("T1", "1000")), adj);
        assertFalse(r.complete());
        assertTrue(r.adjusts().get(0).errors().get(0).contains("부가세"));
    }

    // ── 미입력 ≠ 0 ──
    @Test void missingPrice_notComplete_butUsageShown() {
        Result r = PowerSimCalculator.calculate(new Input(2026, 9, null, List.of(line("T1", "1000")), List.of()));
        assertFalse(r.complete());
        eq("522000", r.lines().get(0).totalKwh());    // 사용량은 계산
        assertNull(r.lines().get(0).costKrw());        // 금액은 0이 아니라 미계산
        assertNull(r.finalCost());
    }

    @Test void missingQty_isNotZero() {
        Result r = run(2026, 9, List.of(line("T1", null)), List.of());
        assertEquals(PowerSimCalculator.ERROR, r.lines().get(0).status());
        assertFalse(r.complete());
    }

    @Test void negativeInputs_blocked() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("-1"), d("2"), "HOUR", "ton", null, d("-5"), d("100"), null, null);
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        assertEquals(PowerSimCalculator.ERROR, x.status());
        assertTrue(x.errors().size() >= 2);
        Result r = PowerSimCalculator.calculate(new Input(2026, 9,
                new Price(d("-1"), "N", "N", "N", "N", "x"), List.of(line("T1", "1000")), List.of()));
        assertFalse(r.complete());
    }

    @Test void idleGreaterThanRun_warns() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), d("2"), "HOUR", "ton", null, d("100"), d("200"), null, null);
        LineResult x = run(2026, 9, List.of(l), List.of()).lines().get(0);
        assertEquals(PowerSimCalculator.OK, x.status());
        assertFalse(x.warnings().isEmpty());
    }

    // ── 합계 = 화면의 호기별 금액 합 (원 단위 반올림 후 합산) ──
    @Test void totalEqualsSumOfRoundedLineCosts() {
        Price odd = new Price(d("123.456"), "N", "N", "N", "N", "테스트");
        List<Line> lines = new ArrayList<>();
        String[] qtys = {"333.3", "777.7", "0", "1234.5"};
        for (int i = 0; i < qtys.length; i++)
            lines.add(new Line("L" + i, "L" + i, i < 2 ? "제지" : "화장지", "ton", d(qtys[i]), d("3.3"), "HOUR", "ton", null,
                    d("987.65"), d("43.21"), null, null));
        Result r = PowerSimCalculator.calculate(new Input(2026, 9, odd, lines, List.of()));
        assertTrue(r.complete(), String.valueOf(r.errors()));
        BigDecimal sum = BigDecimal.ZERO;
        for (LineResult l : r.lines()) {
            assertEquals(0, l.costKrw().scale(), "호기 금액은 원 단위");
            sum = sum.add(l.costKrw());
        }
        assertEquals(0, sum.compareTo(r.lineCostSum()));
        assertEquals(0, sum.compareTo(r.finalCost()));
        BigDecimal procSum = r.processes().stream().map(ProcessResult::costKrw).reduce(BigDecimal.ZERO, BigDecimal::add);
        assertEquals(0, sum.compareTo(procSum), "공정별 합 = 전체 합");
        assertEquals(2, r.processes().size());
    }

    @Test void oneBadLine_makesTotalIncomplete_othersStillShown() {
        Line bad = new Line("T2", "2호기", "제지", "ton", d("100"), null, "HOUR", "ton", null, d("1000"), d("100"), null, null);
        Result r = run(2026, 9, List.of(line("T1", "1000"), bad), List.of());
        eq("78300000", r.lines().get(0).costKrw());
        assertEquals(PowerSimCalculator.ERROR, r.lines().get(1).status());
        assertNull(r.lineCostSum());
        assertNull(r.finalCost());
        assertFalse(r.complete());
    }
}
