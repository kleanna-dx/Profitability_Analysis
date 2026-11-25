package com.company.module.rollingplanningsimulation.service;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Map;

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

    @Test void cellTable_nameValidation() {
        assertEquals("aiplatform.steam_cell_value", EnergyDataSyncService.validTable(" aiplatform.steam_cell_value "));
        assertEquals("steam_cell_value", EnergyDataSyncService.validTable("steam_cell_value"));
        assertThrows(IllegalArgumentException.class, () -> EnergyDataSyncService.validTable("x; DROP TABLE y"));
        assertThrows(IllegalArgumentException.class, () -> EnergyDataSyncService.validTable("a.b.c"));
    }
}
