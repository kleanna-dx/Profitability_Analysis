package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.PwSimBasisLine;
import com.company.module.rollingplanningsimulation.entity.PwSimBasisVersion;
import com.company.module.rollingplanningsimulation.service.PowerSimCalculator.*;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/** 테스트 전용 데이터 — 운영 기준정보와 무관. 시나리오 스냅샷 보존 · 임시 변경(override) 격리 */
class PowerSimServiceComputeTest {

    static BigDecimal d(String v) { return new BigDecimal(v); }
    static final ObjectMapper OM = new ObjectMapper();
    static final Price PRICE = new Price(d("150"), "N", "Y", "Y", "N", "테스트 단가");
    static final PwSimBasisVersion VER = PwSimBasisVersion.builder().division("PS").versionName("테스트 v1").applyYm("202609").source("MANUAL").build();

    static PwSimBasisLine basis(String runKw) {
        return PwSimBasisLine.builder().versionId(1L).lineCode("T1").lineName("테스트1").processName("제지").prodUnit("ton")
                .productivityValue(d("2")).productivityBasis("HOUR").productivityUnit("ton").runKw(d(runKw)).idleKw(d("100")).sortOrder(10).build();
    }
    static Map<String, Map<String, Object>> req(String base, String qty, Map<String, Object> override) {
        Map<String, Object> r = new HashMap<>();
        r.put("lineCode", "T1"); r.put("baseQty", base); r.put("qty", qty);
        if (override != null) r.put("override", override);
        return Map.of("T1", r);
    }

    @Test void compute_baseAndSim_delta() {
        Map<String, Object> res = PowerSimService.compute("PS", "202609", VER, List.of(basis("1000")), req("1000", "1100", null), PRICE, List.of());
        Result sim = (Result) res.get("sim"), base = (Result) res.get("base");
        assertEquals(0, d("85050000").compareTo(sim.finalCost()));
        assertEquals(0, d("78300000").compareTo(base.finalCost()));
        Delta dl = (Delta) res.get("delta");
        assertEquals(0, d("45000").compareTo(dl.kwh()));
        assertEquals(0, d("6750000").compareTo(dl.finalCost()));
        assertTrue(((List<?>) res.get("warnings")).stream().anyMatch(w -> w.toString().contains("검토용 초기값")), "미승인 버전 경고");
    }

    @Test void scenarioSnapshot_preserved_afterBasisChange() throws Exception {
        // 1) 저장: 계산 결과를 JSON 스냅샷으로
        Map<String, Object> first = PowerSimService.compute("PS", "202609", VER, List.of(basis("1000")), req(null, "1000", null), PRICE, List.of());
        Map<String, Object> snap = new LinkedHashMap<>();
        snap.put("sim", first.get("sim"));
        snap.put("simInput", first.get("simInput"));
        String json = OM.writeValueAsString(snap);

        // 2) 기준정보 변경 (가동 평균전력 1,000 → 1,200 kW) 후 최신 기준 재계산
        Map<String, Object> latest = PowerSimService.compute("PS", "202609", VER, List.of(basis("1200")), req(null, "1000", null), PRICE, List.of());
        Result lr = (Result) latest.get("sim");
        assertEquals(0, d("622000").compareTo(lr.totalKwh()), "최신 기준 재계산은 바뀐 값 반영 (500h×1200 + 220h×100)");

        // 3) 저장된 스냅샷은 그대로
        Map<String, Object> back = OM.readValue(json, new TypeReference<Map<String, Object>>() {});
        @SuppressWarnings("unchecked") Map<String, Object> sim = (Map<String, Object>) back.get("sim");
        assertEquals(0, d("522000").compareTo(new BigDecimal(sim.get("totalKwh").toString())));
        assertEquals(0, d("78300000").compareTo(new BigDecimal(sim.get("finalCost").toString())));
        @SuppressWarnings("unchecked") Map<String, Object> in = (Map<String, Object>) back.get("simInput");
        @SuppressWarnings("unchecked") Map<String, Object> l0 = ((List<Map<String, Object>>) in.get("lines")).get(0);
        assertEquals(0, d("1000").compareTo(new BigDecimal(l0.get("runKw").toString())), "적용한 평균전력도 저장 당시 값");
        assertEquals(0, d("150").compareTo(new BigDecimal(((Map<?, ?>) in.get("price")).get("krwPerKwh").toString())), "적용 단가도 저장");
    }

    @Test void override_appliesOnlyToThisCalc_basisUntouched() {
        PwSimBasisLine b = basis("1000");
        Map<String, Object> res = PowerSimService.compute("PS", "202609", VER, List.of(b), req(null, "1000", Map.of("runKw", "1200")), PRICE, List.of());
        Result sim = (Result) res.get("sim");
        assertEquals(0, d("622000").compareTo(sim.totalKwh()));
        assertEquals(0, d("1000").compareTo(b.getRunKw()), "기준정보 원본은 그대로");
        @SuppressWarnings("unchecked") List<Map<String, Object>> info = (List<Map<String, Object>>) res.get("lineInfo");
        assertEquals(List.of("runKw"), info.get(0).get("overridden"));
        assertTrue(((List<?>) res.get("warnings")).stream().anyMatch(w -> w.toString().contains("임시 변경")));
    }

    @Test void noBaseQty_noDelta() {
        Map<String, Object> res = PowerSimService.compute("PS", "202609", VER, List.of(basis("1000")), req(null, "1000", null), PRICE, List.of());
        assertNull(res.get("delta"));
        assertNull(res.get("base"));
    }

    @Test void applyYmMismatch_warns() {
        Map<String, Object> res = PowerSimService.compute("PS", "202610", VER, List.of(basis("1000")), req(null, "1000", null), PRICE, List.of());
        assertTrue(((List<?>) res.get("warnings")).stream().anyMatch(w -> w.toString().contains("적용월")));
    }

    @Test void buildLine_dayWithoutBasisHours_rejected() {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> PowerSimService.buildLine(1L,
                Map.of("lineCode", "T1", "productivityValue", "48", "productivityBasis", "DAY", "productivityUnit", "ton", "prodUnit", "ton"), 10));
        assertTrue(e.getMessage().contains("1일 기준시간"));
    }

    @Test void buildLine_blankStaysNull_notZero() {
        PwSimBasisLine l = PowerSimService.buildLine(1L, Map.of("lineCode", "T1", "runKw", "", "idleKw", " "), 10);
        assertNull(l.getRunKw());
        assertNull(l.getIdleKw());
        assertNull(l.getProductivityValue());
    }

    @Test void buildLine_unitMismatch_rejected() {
        assertThrows(IllegalArgumentException.class, () -> PowerSimService.buildLine(1L,
                Map.of("lineCode", "T1", "prodUnit", "ton", "productivityUnit", "개"), 10));
    }

    @Test void buildLine_negative_rejected() {
        assertThrows(IllegalArgumentException.class, () -> PowerSimService.buildLine(1L, Map.of("lineCode", "T1", "runKw", "-1"), 10));
    }
}
