package com.company.module.rollingplanningsimulation.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.util.List;

/**
 * P/L 시뮬레이터 비용 원단위 응답 DTO
 * - 원재료비/전력비/물류비 원단위 + 지종별 원재료비 분리
 */
@Getter
@Builder
public class CostUnitRateResponse {

    private String ym;
    private String prevYm;
    private String machine;
    private String division;
    /** 기준월 생산량(톤) — STEP3 생산계획 총생산량, 없으면 기준월 실적 */
    private long baseProdTon;
    /** 기준월 생산량 출처: PLAN(생산계획) / ACTUAL(기준월 실적) / NONE */
    private String baseProdSource;
    /** 생산계획 확정(잠금) 여부 */
    private boolean planLocked;
    /** 전월 실적에 없어 원·부재료비 0으로 계산한 지종 */
    private List<String> unmatchedProducts;
    /** 화면 경고 문구 */
    private List<String> warnings;

    private Rates rates;
    private Rates prevRates;
    private Totals totals;
    private Totals prevTotals;
    private CostBehavior costBehavior;
    private FromDB fromDB;
    private List<MaterialByProduct> materialByProduct;
    /** P/L 탭 호기 선택 목록 (해당 사업부 호기 중 실적 있는 호기) — {code, name} */
    private List<java.util.Map<String, Object>> machines;
    /** 호기 마스터에 등록된 해당 사업부 호기 코드 */
    private List<String> divisionMachines;

    @Getter
    @Builder
    public static class Rates {
        private BigDecimal revenuePerTon;
        private BigDecimal materialPerTon;
        /** 부재료비 원단위 (천원/톤) */
        private BigDecimal subMaterialPerTon;
        private BigDecimal energyPerTon;
        private BigDecimal logisticsPerTon;
    }

    @Getter
    @Builder
    public static class Totals {
        private BigDecimal materialCost;
        /** 부재료비 (원) */
        private BigDecimal subMaterialCost;
        private BigDecimal energyCost;
        private BigDecimal logisticsCost;
        private BigDecimal productionKg;
        private long productionTon;
    }

    @Getter
    @Builder
    public static class CostBehavior {
        private String material;
        private String subMaterial;
        private String energy;
        private String logistics;
        private String labor;
        private String depreciation;
        private String sga;
    }

    @Getter
    @Builder
    public static class FromDB {
        private boolean material;
        private boolean subMaterial;
        private boolean energy;
        private boolean logistics;
        private boolean revenue;
    }

    @Getter
    @Builder
    public static class MaterialByProduct {
        private String product;
        private long productionTon;
        private BigDecimal materialCost;
        private BigDecimal unitCost1000;
        private long prevProductionTon;
        private BigDecimal prevMaterialCost;
        private BigDecimal prevUnitCost1000;
        private BigDecimal sharePct;
    }
}
