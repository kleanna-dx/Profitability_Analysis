package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 월 총 전력비 계산 결과 (변동층 + 고정층)
 * 월 총 전력비 = 한전요금(변동층) + ESS지급금 − DR환급금 − 부하차단보상금 − 복합보일러차감
 */
@Entity
@Table(name = "rpsim_pw_monthly_summary")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwMonthlySummary {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "SUMMARY_ID")
    private Long summaryId;

    @Column(name = "YM", nullable = false, length = 6)
    private String ym;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    // 변동층 (한전요금)
    @Column(name = "TOTAL_USAGE_KWH", precision = 18, scale = 4)
    private BigDecimal totalUsageKwh;

    @Column(name = "PEAK_USAGE_KWH", precision = 18, scale = 4)
    private BigDecimal peakUsageKwh;

    @Column(name = "MID_USAGE_KWH", precision = 18, scale = 4)
    private BigDecimal midUsageKwh;

    @Column(name = "OFF_USAGE_KWH", precision = 18, scale = 4)
    private BigDecimal offUsageKwh;

    @Column(name = "ENERGY_COST_KRW", precision = 18, scale = 2)
    private BigDecimal energyCostKrw;

    @Column(name = "DEMAND_COST_KRW", precision = 18, scale = 2)
    private BigDecimal demandCostKrw;

    @Column(name = "POWER_FACTOR_KRW", precision = 18, scale = 2)
    private BigDecimal powerFactorKrw;

    @Column(name = "POWER_FUND_KRW", precision = 18, scale = 2)
    private BigDecimal powerFundKrw;

    @Column(name = "VARIABLE_TOTAL_KRW", precision = 18, scale = 2)
    private BigDecimal variableTotalKrw;

    // 고정층 (환급/지급)
    @Column(name = "DR_REFUND_KRW", precision = 18, scale = 2)
    private BigDecimal drRefundKrw;

    @Column(name = "LOAD_CUT_KRW", precision = 18, scale = 2)
    private BigDecimal loadCutKrw;

    @Column(name = "BOILER_DEDUCT_KRW", precision = 18, scale = 2)
    private BigDecimal boilerDeductKrw;

    @Column(name = "ESS_PAYMENT_KRW", precision = 18, scale = 2)
    private BigDecimal essPaymentKrw;

    @Column(name = "FIXED_TOTAL_KRW", precision = 18, scale = 2)
    private BigDecimal fixedTotalKrw;

    // 최종
    @Column(name = "MONTHLY_TOTAL_KRW", precision = 18, scale = 2)
    private BigDecimal monthlyTotalKrw;

    @Column(name = "COST_PER_TON_KRW", precision = 12, scale = 2)
    private BigDecimal costPerTonKrw;

    @Column(name = "CALC_STATUS", nullable = false, length = 20)
    private String calcStatus;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.division == null) this.division = "PS";
        if (this.calcStatus == null) this.calcStatus = "DRAFT";
    }

    @PreUpdate
    protected void onUpdate() { this.updatedAt = LocalDateTime.now(); }

    @Builder
    public PwMonthlySummary(String ym, String division,
                            BigDecimal totalUsageKwh, BigDecimal peakUsageKwh,
                            BigDecimal midUsageKwh, BigDecimal offUsageKwh,
                            BigDecimal energyCostKrw, BigDecimal demandCostKrw,
                            BigDecimal powerFactorKrw, BigDecimal powerFundKrw,
                            BigDecimal variableTotalKrw,
                            BigDecimal drRefundKrw, BigDecimal loadCutKrw,
                            BigDecimal boilerDeductKrw, BigDecimal essPaymentKrw,
                            BigDecimal fixedTotalKrw,
                            BigDecimal monthlyTotalKrw, BigDecimal costPerTonKrw,
                            String calcStatus) {
        this.ym = ym;
        this.division = division != null ? division : "PS";
        this.totalUsageKwh = totalUsageKwh;
        this.peakUsageKwh = peakUsageKwh;
        this.midUsageKwh = midUsageKwh;
        this.offUsageKwh = offUsageKwh;
        this.energyCostKrw = energyCostKrw;
        this.demandCostKrw = demandCostKrw;
        this.powerFactorKrw = powerFactorKrw;
        this.powerFundKrw = powerFundKrw;
        this.variableTotalKrw = variableTotalKrw;
        this.drRefundKrw = drRefundKrw;
        this.loadCutKrw = loadCutKrw;
        this.boilerDeductKrw = boilerDeductKrw;
        this.essPaymentKrw = essPaymentKrw;
        this.fixedTotalKrw = fixedTotalKrw;
        this.monthlyTotalKrw = monthlyTotalKrw;
        this.costPerTonKrw = costPerTonKrw;
        this.calcStatus = calcStatus != null ? calcStatus : "DRAFT";
    }

    public void updateCalculation(BigDecimal totalUsageKwh, BigDecimal peakUsageKwh,
                                  BigDecimal midUsageKwh, BigDecimal offUsageKwh,
                                  BigDecimal energyCostKrw, BigDecimal demandCostKrw,
                                  BigDecimal powerFactorKrw, BigDecimal powerFundKrw,
                                  BigDecimal variableTotalKrw,
                                  BigDecimal drRefundKrw, BigDecimal loadCutKrw,
                                  BigDecimal boilerDeductKrw, BigDecimal essPaymentKrw,
                                  BigDecimal fixedTotalKrw,
                                  BigDecimal monthlyTotalKrw, BigDecimal costPerTonKrw,
                                  String calcStatus) {
        this.totalUsageKwh = totalUsageKwh;
        this.peakUsageKwh = peakUsageKwh;
        this.midUsageKwh = midUsageKwh;
        this.offUsageKwh = offUsageKwh;
        this.energyCostKrw = energyCostKrw;
        this.demandCostKrw = demandCostKrw;
        this.powerFactorKrw = powerFactorKrw;
        this.powerFundKrw = powerFundKrw;
        this.variableTotalKrw = variableTotalKrw;
        this.drRefundKrw = drRefundKrw;
        this.loadCutKrw = loadCutKrw;
        this.boilerDeductKrw = boilerDeductKrw;
        this.essPaymentKrw = essPaymentKrw;
        this.fixedTotalKrw = fixedTotalKrw;
        this.monthlyTotalKrw = monthlyTotalKrw;
        this.costPerTonKrw = costPerTonKrw;
        this.calcStatus = calcStatus;
    }
}
