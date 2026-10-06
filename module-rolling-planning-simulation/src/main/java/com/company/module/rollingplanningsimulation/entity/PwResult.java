package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 전력비 계산 결과 엔티티
 * - 월별/호기별 가동시간·전력량·전력비 계산 결과
 */
@Entity
@Table(name = "rpsim_pw_result")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwResult {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "RESULT_ID")
    private Long resultId;

    @Column(name = "YM", nullable = false, length = 6)
    private String ym;

    @Column(name = "LINE_CODE", nullable = false, length = 20)
    private String lineCode;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "RUN_HOURS", precision = 12, scale = 2)
    private BigDecimal runHours;

    @Column(name = "STANDBY_HOURS", precision = 12, scale = 2)
    private BigDecimal standbyHours;

    @Column(name = "TOTAL_KWH", precision = 18, scale = 4)
    private BigDecimal totalKwh;

    @Column(name = "DEMAND_COST_KRW", precision = 18, scale = 2)
    private BigDecimal demandCostKrw;

    @Column(name = "ENERGY_COST_KRW", precision = 18, scale = 2)
    private BigDecimal energyCostKrw;

    @Column(name = "TOTAL_COST_KRW", precision = 18, scale = 2)
    private BigDecimal totalCostKrw;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.division == null) this.division = "PS";
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public PwResult(String ym, String lineCode, String division,
                    BigDecimal runHours, BigDecimal standbyHours, BigDecimal totalKwh,
                    BigDecimal demandCostKrw, BigDecimal energyCostKrw, BigDecimal totalCostKrw) {
        this.ym = ym;
        this.lineCode = lineCode;
        this.division = division != null ? division : "PS";
        this.runHours = runHours;
        this.standbyHours = standbyHours;
        this.totalKwh = totalKwh;
        this.demandCostKrw = demandCostKrw;
        this.energyCostKrw = energyCostKrw;
        this.totalCostKrw = totalCostKrw;
    }

    public void update(BigDecimal runHours, BigDecimal standbyHours, BigDecimal totalKwh,
                       BigDecimal demandCostKrw, BigDecimal energyCostKrw, BigDecimal totalCostKrw) {
        this.runHours = runHours;
        this.standbyHours = standbyHours;
        this.totalKwh = totalKwh;
        this.demandCostKrw = demandCostKrw;
        this.energyCostKrw = energyCostKrw;
        this.totalCostKrw = totalCostKrw;
    }
}
