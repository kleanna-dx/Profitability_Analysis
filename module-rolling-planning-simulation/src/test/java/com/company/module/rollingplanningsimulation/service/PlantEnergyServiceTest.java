package com.company.module.rollingplanningsimulation.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** 정비 일별 정지시간 · 귀책 판정 · 이름 비교 — 테스트 전용 값 */
class PlantEnergyServiceTest {
    static BigDecimal d(String v) { return new BigDecimal(v); }

    @Test void dailyStops_hoursFromStartDay_capped24() {
        // 4/10 ~ 4/12, 정비 30시간 → 10일 24h, 11일 6h
        Map<Integer, BigDecimal> m = PlantEnergyService.dailyStops(LocalDate.of(2026, 4, 10), LocalDate.of(2026, 4, 12), d("30"), 2026, 4);
        assertEquals(0, d("24").compareTo(m.get(10)));
        assertEquals(0, d("6").compareTo(m.get(11)));
        assertNull(m.get(12));
    }

    @Test void dailyStops_blankHours_wholePeriod_andCrossMonthOnlyThisMonth() {
        // 3/30 ~ 4/2 정비시간 없음 → 4월은 1·2일 24h
        Map<Integer, BigDecimal> m = PlantEnergyService.dailyStops(LocalDate.of(2026, 3, 30), LocalDate.of(2026, 4, 2), null, 2026, 4);
        assertEquals(2, m.size());
        assertEquals(0, d("24").compareTo(m.get(1)));
        assertEquals(0, d("24").compareTo(m.get(2)));
    }

    @Test void normResp_oursPartner() {
        assertEquals("OURS", PlantEnergyService.normResp("당사 귀책"));
        assertEquals("OURS", PlantEnergyService.normResp("OURS"));
        assertEquals("PARTNER", PlantEnergyService.normResp("협력사"));
        assertEquals("", PlantEnergyService.normResp(null));
    }

    @Test void groupCode_cogen() {
        assertEquals("BLR-COGEN", PlantEnergyService.groupCode("BLR-COGEN-1"));
        assertEquals("BLR-LNG", PlantEnergyService.groupCode("BLR-LNG"));
    }

    @Test void energySync_nameNormalize() {
        assertEquals(EnergyDataSyncService.norm("화장지3"), EnergyDataSyncService.norm("화장지 3호기"));
        assertNotEquals(EnergyDataSyncService.norm("화장지3"), EnergyDataSyncService.norm("3호기"));
    }

    /** 원단위: 연·월 1행 → 호기 컬럼별. 소계·빈칸·0·숫자 아님은 받지 않음, 컬럼 대소문자 무시 */
    @Test void energySync_unitCells_skipSubtotalBlankZero() {
        Map<String, Object> r = new HashMap<>();
        r.put("mon", 3);
        r.put("UNIT_PM2", d("2.5"));
        r.put("unit_pm3", "1.75");
        r.put("UNIT_PAPER_SUBTOTAL", d("9.9"));
        r.put("UNIT_TM3", d("0"));
        r.put("UNIT_TM4", null);
        r.put("UNIT_TM5", "abc");
        r.put("UNIT_TISSUE_SUBTOTAL", d("8.8"));
        List<EnergyDataSyncService.UnitCell> cells = EnergyDataSyncService.unitCells(List.of(r));
        assertEquals(2, cells.size());
        assertEquals("UNIT_PM2", cells.get(0).col());
        assertEquals(3, cells.get(0).month());
        assertEquals(0, d("2.5").compareTo(cells.get(0).value()));
        assertEquals("UNIT_PM3", cells.get(1).col());
        assertEquals(0, d("1.75").compareTo(cells.get(1).value()));
    }

    @Test void energySync_unitCols_noSubtotal() {
        assertFalse(EnergyDataSyncService.UNIT_COLS.containsKey("UNIT_PAPER_SUBTOTAL"));
        assertFalse(EnergyDataSyncService.UNIT_COLS.containsKey("UNIT_TISSUE_SUBTOTAL"));
        assertEquals(List.of("제지2", "제지3", "화장지3", "화장지4", "화장지5"), new ArrayList<>(EnergyDataSyncService.UNIT_COLS.values()));
    }

    /** 단가: 연·월·항목 1행 → {항목코드(소문자·공백제거): {월: 값}}, 값 없는 행 제외 */
    @Test void energySync_groupPrices() {
        Map<String, Object> a = new HashMap<>(Map.of("mon", 1, "code", " LNG_UNIT ", "val", d("1200")));
        Map<String, Object> b = new HashMap<>(Map.of("mon", 2, "code", "lng_unit", "val", d("1300")));
        Map<String, Object> c = new HashMap<>(); c.put("mon", 3); c.put("code", "comb_bsc"); c.put("val", null);
        Map<String, Map<Integer, BigDecimal>> g = EnergyDataSyncService.groupPrices(List.of(a, b, c));
        assertEquals(Set.of("lng_unit"), g.keySet());
        assertEquals(0, d("1200").compareTo(g.get("lng_unit").get(1)));
        assertEquals(0, d("1300").compareTo(g.get("lng_unit").get(2)));
    }
}
