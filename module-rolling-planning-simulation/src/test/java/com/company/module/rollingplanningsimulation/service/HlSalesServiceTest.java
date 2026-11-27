package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.HlCustomerExpense;
import com.company.module.rollingplanningsimulation.entity.HlSalesClose;
import com.company.module.rollingplanningsimulation.entity.HlSalesPlan;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** HL 판매계획·장려금/마케팅비 검사·요약 — 테스트 전용 값 */
class HlSalesServiceTest {
    static BigDecimal d(String v) { return new BigDecimal(v); }
    static Map<String, Object> row(Object... kv) { Map<String, Object> m = new HashMap<>(); for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]); return m; }

    @Test void netSales_isQtyTimesPrice() {
        HlSalesPlan p = HlSalesPlan.builder().ym("202701").salesTeam("A팀").customerCode("C1").materialCode("M1")
                .boxQty(d("1200")).boxPrice(d("15000")).build();
        assertEquals(0, d("18000000").compareTo(p.getNetSales()));
        p.change(null, null, d("10"), d("2.5"), null);
        assertEquals(0, d("25").compareTo(p.getNetSales()));
    }

    @Test void checkPlans_ok_commaNumbers_blankScopeUsesSelected() {
        var c = HlSalesService.checkPlans("202701", "A팀", List.of(
                row("customerCode", "C1", "materialCode", "M1", "boxQty", "1,200", "boxPrice", 15000, "category", "화장지"),
                row("ym", "2027-01", "salesTeam", "A팀", "customerCode", "C1", "materialCode", "M2", "boxQty", 0, "boxPrice", "0")));
        assertTrue(c.ok(), c.errors().toString());
        assertEquals(2, c.rows().size());
        assertEquals("A팀", c.rows().get(0).getSalesTeam());
        assertEquals("202701", c.rows().get(0).getYm());
        assertEquals(0, d("18000000").compareTo(c.rows().get(0).getNetSales()));
    }

    @Test void checkPlans_otherTeamOrMonth_rejected() {
        var c = HlSalesService.checkPlans("202701", "A팀", List.of(
                row("rowNo", 2, "salesTeam", "B팀", "customerCode", "C1", "materialCode", "M1", "boxQty", 1, "boxPrice", 1),
                row("rowNo", 3, "ym", "202702", "customerCode", "C2", "materialCode", "M1", "boxQty", 1, "boxPrice", 1)));
        assertFalse(c.ok());
        assertTrue(c.errors().get(0).startsWith("2행:") && c.errors().get(0).contains("B팀"));
        assertTrue(c.errors().get(1).startsWith("3행:") && c.errors().get(1).contains("202702"));
        assertTrue(c.rows().isEmpty());
    }

    @Test void checkPlans_requiredNegativeNotNumberDuplicate() {
        var c = HlSalesService.checkPlans("202701", "A팀", List.of(
                row("rowNo", 2, "materialCode", "M1", "boxQty", 1, "boxPrice", 1),
                row("rowNo", 3, "customerCode", "C1", "materialCode", "M1", "boxQty", -1, "boxPrice", "abc"),
                row("rowNo", 4, "customerCode", "C1", "materialCode", "M1", "boxPrice", 1),
                row("rowNo", 5, "customerCode", "C1", "materialCode", "M1", "boxQty", 1, "boxPrice", 1)));
        String all = String.join("\n", c.errors());
        assertTrue(all.contains("2행: 거래처코드를 입력하세요"), all);
        assertTrue(all.contains("3행: BOX 수량는 0 이상"), all);
        assertTrue(all.contains("3행: BOX당 단가가 숫자가 아닙니다"), all);
        assertTrue(all.contains("4행: BOX 수량를 입력하세요"), all);
        assertTrue(all.contains("5행: 거래처 C1 · 자재 M1 가 3행과 중복"), all);
    }

    @Test void checkExpenses_noTeam_blankAmountsZero_duplicateCustomer() {
        // 기획팀이 년월 전체를 올림 — 영업팀 칸이 있어도 검사하지 않음
        var c = HlSalesService.checkExpenses("202701", List.of(
                row("customerCode", "C1", "incentiveAmt", "3,000,000", "salesTeam", "아무팀"),
                row("customerCode", "C2", "marketingAmt", 500)));
        assertTrue(c.ok(), c.errors().toString());
        assertEquals(0, d("3000000").compareTo(c.rows().get(0).getIncentiveAmt()));
        assertEquals(0, BigDecimal.ZERO.compareTo(c.rows().get(0).getMarketingAmt()));
        assertEquals(0, BigDecimal.ZERO.compareTo(c.rows().get(1).getIncentiveAmt()));

        var dup = HlSalesService.checkExpenses("202701", List.of(
                row("rowNo", 2, "customerCode", "C1"), row("rowNo", 3, "customerCode", "C1"), row("rowNo", 4, "customerCode", "C3", "ym", "202702")));
        String all = String.join("\n", dup.errors());
        assertTrue(all.contains("3행: 거래처 C1 가 2행과 중복"), all);
        assertTrue(all.contains("4행: 년월(202702)"), all);
    }

    @Test void closeTeam_expenseIsWholeMonth() {
        assertEquals(HlSalesClose.ALL_TEAMS, HlSalesService.closeTeam(HlSalesClose.EXPENSE, null));
        assertEquals("A팀", HlSalesService.closeTeam(HlSalesClose.SALES, "A팀"));
        assertThrows(IllegalArgumentException.class, () -> HlSalesService.closeTeam(HlSalesClose.SALES, null));
    }

    @Test void requireYm_andType() {
        assertEquals("202701", HlSalesService.requireYm("2027.01"));
        assertThrows(IllegalArgumentException.class, () -> HlSalesService.requireYm("202713"));
        assertEquals("SALES", HlSalesService.requireType("sales"));
        assertThrows(IllegalArgumentException.class, () -> HlSalesService.requireType("X"));
        assertThrows(IllegalArgumentException.class, () -> HlSalesService.requireTeam(" "));
    }

    @Test void summarize_netAfter_byTeam_byCategory_closed() {
        List<HlSalesPlan> ps = List.of(
                HlSalesPlan.builder().ym("202701").salesTeam("A팀").customerCode("C1").materialCode("M1").category("화장지").boxQty(d("10")).boxPrice(d("1000")).build(),
                HlSalesPlan.builder().ym("202701").salesTeam("B팀").customerCode("C2").materialCode("M1").boxQty(d("5")).boxPrice(d("1000")).build());
        List<HlCustomerExpense> es = List.of(
                HlCustomerExpense.builder().ym("202701").customerCode("C1").incentiveAmt(d("1000")).marketingAmt(d("500")).build());
        HlSalesClose cl = HlSalesClose.builder().ym("202701").salesTeam("A팀").closeType(HlSalesClose.SALES).build();
        cl.close("u1");
        Map<String, Object> s = HlSalesService.summarize("202701", ps, es, List.of(cl));
        assertEquals(0, d("15000").compareTo((BigDecimal) s.get("netSales")));
        assertEquals(0, d("1000").compareTo((BigDecimal) s.get("incentiveAmt")));
        assertEquals(0, d("13500").compareTo((BigDecimal) s.get("netAfter")));
        assertEquals(false, s.get("expenseClosed"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> teams = (List<Map<String, Object>>) s.get("teams");
        assertEquals("A팀", teams.get(0).get("salesTeam"));
        assertEquals(0, d("10000").compareTo((BigDecimal) teams.get(0).get("netSales")));
        assertEquals(true, teams.get(0).get("salesClosed"));
        assertFalse(teams.get(0).containsKey("incentiveAmt"));
        assertEquals(false, teams.get(1).get("salesClosed"));

        HlSalesClose ex = HlSalesClose.builder().ym("202701").salesTeam(HlSalesClose.ALL_TEAMS).closeType(HlSalesClose.EXPENSE).build();
        ex.close("u2");
        Map<String, Object> s2 = HlSalesService.summarize("202701", ps, es, List.of(ex));
        assertEquals(true, s2.get("expenseClosed"));
        @SuppressWarnings("unchecked") List<Map<String, Object>> t2 = (List<Map<String, Object>>) s2.get("teams");
        assertEquals(2, t2.size());   // '전체' 가 영업팀으로 끼지 않음
        @SuppressWarnings("unchecked") List<Map<String, Object>> cats = (List<Map<String, Object>>) s.get("categories");
        assertEquals(List.of("(미입력)", "화장지"), cats.stream().map(m -> m.get("category")).toList());
    }

    @Test void checkProductions_ok_required_duplicate_negative() {
        var ok = HlSalesService.checkProductions("202701", List.of(
                row("category", "화장지", "machine", "TM3", "prodType", "롤", "materialCode", "M1", "materialName", "롤화장지", "qtyEa", "12,000", "note", "x"),
                row("machine", "TM3", "materialCode", "M2", "qtyEa", 0)));
        assertTrue(ok.ok(), ok.errors().toString());
        assertEquals(0, d("12000").compareTo(ok.rows().get(0).getQtyEa()));
        assertEquals("202701", ok.rows().get(0).getYm());

        var bad = HlSalesService.checkProductions("202701", List.of(
                row("rowNo", 2, "materialCode", "M1", "qtyEa", 1),
                row("rowNo", 3, "machine", "TM3", "materialCode", "M1", "qtyEa", -5),
                row("rowNo", 4, "machine", "TM3", "materialCode", "M1"),
                row("rowNo", 5, "machine", "TM3", "materialCode", "M1", "qtyEa", 1),
                row("rowNo", 6, "machine", "TM4", "materialCode", "M9", "qtyEa", 1, "ym", "202702")));
        String all = String.join("\n", bad.errors());
        assertTrue(all.contains("2행: 생산 호기를 입력하세요"), all);
        assertTrue(all.contains("3행: 월 생산량(EA)는 0 이상"), all);
        assertTrue(all.contains("4행: 월 생산량(EA)를 입력하세요"), all);
        assertTrue(all.contains("5행: 생산 호기 TM3 · 자재 M1 가 3행과 중복"), all);
        assertTrue(all.contains("6행: 년월(202702)"), all);
    }

    @Test void unknownMachines_matchCodeOrName_ignoreSpaceAndSuffix() {
        List<Map<String, String>> master = List.of(Map.of("code", "TM3", "name", "화장지3"), Map.of("code", "TM4", "name", "화장지 4호기"));
        assertEquals(List.of("TM9", "가공1"),
                HlSalesService.unknownMachines(List.of("TM3", "화장지 3호기", "화장지4", "tm4", "TM9", "가공1"), master));
    }

    @Test void closeTeam_productionIsWholeMonth() {
        assertEquals(HlSalesClose.ALL_TEAMS, HlSalesService.closeTeam(HlSalesClose.PRODUCTION, null));
        assertEquals("PRODUCTION", HlSalesService.requireType("production"));
    }

    @Test void unknownMachines_aliasKnown_diaperIgnored() {
        assertEquals(List.of("가공1"),
                HlSalesService.unknownMachines(List.of("가공 3호기", "RP4", "생리대 5호기", "SN6", "기저귀 2호기", "가공1"), List.of()));
    }
}
