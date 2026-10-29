package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 분기별 해상 운임 단가 엔티티
 * - 분기(2026-Q1)/지역/국가/항구/컨테이너/운임(USD)
 */
@SQLRestriction("DELETED_YN = \'N\'")
@Entity
@Table(name = "rpsim_logi_rate")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LogiRate extends BaseAuditEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "RATE_ID")
    private Long rateId;

    @Column(name = "YEAR_QUARTER", nullable = false, length = 10)
    private String yearQuarter;

    @Column(name = "REGION", nullable = false, length = 50)
    private String region;

    @Column(name = "COUNTRY", nullable = false, length = 50)
    private String country;

    @Column(name = "PORT", nullable = false, length = 100)
    private String port;

    @Column(name = "CONTAINER_UNIT", nullable = false, length = 10)
    private String containerUnit;

    @Column(name = "VOLUME_PER_MONTH", nullable = false, precision = 12, scale = 2)
    private BigDecimal volumePerMonth;

    @Column(name = "RATE_USD", nullable = false, precision = 12, scale = 2)
    private BigDecimal rateUsd;

    @Column(name = "MEMO", length = 500)
    private String memo;

    @Column(name = "SORT_ORDER", nullable = false)
    private Integer sortOrder;








    @PrePersist
    protected void onCreate() {
        if (this.containerUnit == null) this.containerUnit = "40";
        if (this.sortOrder == null) this.sortOrder = 0;
    }


    @Builder
    public LogiRate(String yearQuarter, String region, String country, String port,
                    String containerUnit, BigDecimal volumePerMonth, BigDecimal rateUsd,
                    String memo, Integer sortOrder) {
        this.yearQuarter = yearQuarter;
        this.region = region != null ? region : "";
        this.country = country != null ? country : "";
        this.port = port;
        this.containerUnit = containerUnit != null ? containerUnit : "40";
        this.volumePerMonth = volumePerMonth != null ? volumePerMonth : BigDecimal.ZERO;
        this.rateUsd = rateUsd != null ? rateUsd : BigDecimal.ZERO;
        this.memo = memo;
        this.sortOrder = sortOrder != null ? sortOrder : 0;
    }

    public void update(String region, String country, String port,
                       String containerUnit, BigDecimal volumePerMonth, BigDecimal rateUsd,
                       String memo, Integer sortOrder) {
        this.region = region;
        this.country = country;
        this.port = port;
        this.containerUnit = containerUnit;
        this.volumePerMonth = volumePerMonth;
        this.rateUsd = rateUsd;
        this.memo = memo;
        this.sortOrder = sortOrder;
    }


}
