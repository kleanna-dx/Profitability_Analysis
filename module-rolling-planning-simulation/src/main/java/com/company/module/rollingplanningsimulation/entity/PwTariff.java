package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 한전 요금 단가 엔티티
 * - 연도/시즌(summer/winter/spring_fall)/시간대(peak/mid/off) 별 기본요금+전력량요금
 */
@Entity
@Table(name = "rpsim_pw_tariff")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwTariff {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "TARIFF_ID")
    private Long tariffId;

    @Column(name = "YEAR", nullable = false)
    private Integer year;

    @Column(name = "SEASON", nullable = false, length = 20)
    private String season;

    @Column(name = "TIME_ZONE", nullable = false, length = 20)
    private String timeZone;

    @Column(name = "DEMAND_KRW", nullable = false, precision = 12, scale = 4)
    private BigDecimal demandKrw;

    @Column(name = "ENERGY_KRW", nullable = false, precision = 12, scale = 4)
    private BigDecimal energyKrw;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

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
    public PwTariff(Integer year, String season, String timeZone,
                    BigDecimal demandKrw, BigDecimal energyKrw, String division) {
        this.year = year;
        this.season = season;
        this.timeZone = timeZone;
        this.demandKrw = demandKrw != null ? demandKrw : BigDecimal.ZERO;
        this.energyKrw = energyKrw != null ? energyKrw : BigDecimal.ZERO;
        this.division = division != null ? division : "PS";
    }

    public void update(BigDecimal demandKrw, BigDecimal energyKrw) {
        this.demandKrw = demandKrw;
        this.energyKrw = energyKrw;
    }
}
