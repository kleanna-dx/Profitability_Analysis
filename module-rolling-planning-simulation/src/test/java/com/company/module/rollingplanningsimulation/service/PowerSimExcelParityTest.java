package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.service.PowerSimCalculator.*;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 엑셀 재현 검증 — 「★전력비 이동계획.xlsx」 05.이동계획 2026년 6월(35행) 값을 그대로 넣어
 * 엑셀 결과(E열 사용량 합계, N열 회계비용)와 같은지 확인한다. 운영 데이터로 쓰지 않는 검증 전용 값.
 *
 * 엑셀 수식: 호기 사용량 = 가동h × 가동kW + (월h − 가동h) × 운휴kW (+ 라미네이팅 23,000kWh, 제지2 −23,000kWh)
 *            회계비용 N = 한전요금(F) + ESS요금(G) + SPC지급금(H) − DR정산금(I) − 복합보일러 차감비(J) − 삼성보상금(K)
 *            한전 고지서 단가 O = (F + G) ÷ E
 */
class PowerSimExcelParityTest {

    static BigDecimal d(String v) { return new BigDecimal(v); }

    /** {호기, 단위, 생산량, 가동h, 가동kW, 운휴kW} */
    static final String[][] JUNE = {
            {"제지2", "kg", "7314000", "531", "6123.702142058796", "1200"},
            {"제지3", "kg", "21074000", "531", "19965.995925642503", "3200"},
            {"화장지3", "kg", "370299.99999999994", "161", "2790.362847222222", "584.2003980376534"},
            {"화장지4", "kg", "1192400", "542", "2838.5", "839.3844109084497"},
            {"화장지5", "kg", "2436000", "696", "4285.35119047619", "904.6689517376518"},
            {"가공2", "ea", "0", "0", "173.57373796243462", "0"},
            {"가공3", "ea", "6808178.125", "644", "138.76490973825898", "0"},
            {"가공4", "ea", "5562500", "400", "135.3", "0"},
            {"가공5", "ea", "5438500", "365", "64.12273799776447", "0"},
            {"가공6", "ea", "14344000", "652", "308", "0"},
            {"생리대5", "ea", "10820000", "256", "432.26820449999997", "36.393671493968"},
            {"생리대6", "ea", "37940000", "672", "653.2052868000001", "54.59050724095201"},
    };

    static List<Line> juneLines() {
        List<Line> ls = new ArrayList<>();
        for (String[] r : JUNE) {
            BigDecimal fixed = r[0].equals("제지2") ? d("-23000") : null;
            ls.add(new Line(r[0], r[0], r[0].replaceAll("\\d", ""), r[1], d(r[2]), null, null, null, null,
                    d(r[4]), d(r[5]), null, null, fixed, fixed == null ? null : "라미네이팅 사용량 분리", d(r[3])));
        }
        ls.add(new Line("LAM", "라미네이팅", "라미네이팅", "ea", BigDecimal.ZERO, null, null, null, null,
                BigDecimal.ZERO, BigDecimal.ZERO, null, null, d("23000"), "라미네이팅 월 사용량", null));
        return ls;
    }

    @Test void june2026_usageAndAccountingCost_matchExcel() {
        Price kepco = new Price(d("189.11288339512723"), "N", "Y", "Y", "N", "한전 고지서 기준 (F+G)/E — 부가세 별도, 기본요금·ESS요금 포함, 정산금 별도");
        List<Adjust> adj = List.of(
                new Adjust("SPC지급금", "ADD", d("70225514.88"), "OTHER", "N", "엑셀 H열"),
                new Adjust("DR정산금", "DEDUCT", d("35231591.142"), "SETTLEMENT", "N", "엑셀 I열"),
                new Adjust("복합보일러 차감비", "DEDUCT", d("117480000"), "SETTLEMENT", "N", "엑셀 J열"));
        Result r = PowerSimCalculator.calculate(new Input(2026, 6, kepco, juneLines(), adj));
        assertTrue(r.complete(), r.errors() + " / " + r.lines().stream().flatMap(l -> l.errors().stream()).toList());
        // 사용량 합계 = 엑셀 E35
        assertTrue(r.totalKwh().subtract(d("21090067.045653045")).abs().compareTo(d("0.001")) < 0, "kWh " + r.totalKwh());
        // 회계비용 = 엑셀 N35 (호기별 원 단위 반올림 차이 ±13원 이내 — 13행)
        assertTrue(r.finalCost().subtract(d("3905917313.738")).abs().compareTo(d("13")) <= 0, "원 " + r.finalCost());
        // 입력 가동시간 사용 표시
        assertEquals("INPUT", r.lines().get(0).runHoursSource());
    }

    @Test void june2026_accountingUnitPrice_matchesExcelN() {
        Price acct = new Price(d("185.20174949102704"), "N", "Y", "Y", "Y", "회계비용 기준 N/E — 정산금(DR·복합보일러)·SPC 포함");
        Result r = PowerSimCalculator.calculate(new Input(2026, 6, acct, juneLines(), List.of()));
        assertTrue(r.complete(), String.valueOf(r.errors()));
        assertTrue(r.finalCost().subtract(d("3905917313.738")).abs().compareTo(d("13")) <= 0, "원 " + r.finalCost());
    }

    @Test void fixedKwh_requiresNote() {
        Line l = new Line("LAM", "라미네이팅", "라미네이팅", "ea", BigDecimal.ZERO, null, null, null, null,
                BigDecimal.ZERO, BigDecimal.ZERO, null, null, d("23000"), null, null);
        LineResult r = PowerSimCalculator.calcLine(l, d("720"), d("150"));
        assertEquals(PowerSimCalculator.ERROR, r.status());
    }

    @Test void runHoursInput_overMonth_blocked() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("100"), null, null, null, null,
                d("1000"), d("100"), null, null, null, null, d("800"));
        assertEquals(PowerSimCalculator.ERROR, PowerSimCalculator.calcLine(l, d("720"), d("150")).status());
    }

    @Test void runHoursInput_differsFromProductivity_warns() {
        // 생산성 2ton/h → 1,000ton = 500h, 입력 400h → 경고 (계산은 입력값 사용)
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), d("2"), "HOUR", "ton", null,
                d("1000"), d("100"), null, null, null, null, d("400"));
        LineResult r = PowerSimCalculator.calcLine(l, d("720"), d("150"));
        assertEquals(PowerSimCalculator.OK, r.status(), String.valueOf(r.errors()));
        assertEquals(0, d("400").compareTo(r.runHours()));
        assertEquals(0, d("500").compareTo(r.calcRunHours()));
        assertFalse(r.warnings().isEmpty());
        // 400h × 1000 + 320h × 100 = 432,000 kWh
        assertEquals(0, d("432000").compareTo(r.totalKwh()));
    }

    @Test void runHoursInput_noProductivityNeeded() {
        Line l = new Line("T1", "1호기", "제지", "ton", d("1000"), null, null, null, null,
                d("1000"), d("100"), null, null, null, null, d("500"));
        LineResult r = PowerSimCalculator.calcLine(l, d("720"), d("150"));
        assertEquals(PowerSimCalculator.OK, r.status(), String.valueOf(r.errors()));
        assertEquals(0, d("522000").compareTo(r.totalKwh()));
    }
}
