package com.company.module.simulation.dto.response;

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
    private long baseProdTon;

    private Rates rates;
    private Rates prevRates;
    private Totals totals;
    private Totals prevTotals;
    private CostBehavior costBehavior;
    private FromDB fromDB;
    private List<MaterialByProduct> materialByProduct;

    @Getter
    @Builder
    public static class Rates {
        private BigDecimal revenuePerTon;
        private BigDecimal materialPerTon;
        private BigDecimal energyPerTon;
        private BigDecimal logisticsPerTon;
    }

    @Getter
    @Builder
    public static class Totals {
        private BigDecimal materialCost;
        private BigDecimal energyCost;
        private BigDecimal logisticsCost;
        private BigDecimal productionKg;
        private long productionTon;
    }

    @Getter
    @Builder
    public static class CostBehavior {
        private String material;
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
