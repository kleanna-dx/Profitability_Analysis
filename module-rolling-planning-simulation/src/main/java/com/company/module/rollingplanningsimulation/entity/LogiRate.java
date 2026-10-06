package com.company.module.rollingplanningsimulation.entity;

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
@Entity
@Table(name = "rpsim_logi_rate")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LogiRate {

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

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "CREATED_BY")
    private Long createdBy;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @Column(name = "UPDATED_BY")
    private Long updatedBy;

    @Column(name = "DELETED_YN", nullable = false, length = 1)
    private String deletedYn;

    @Column(name = "DELETED_AT")
    private LocalDateTime deletedAt;

    @Column(name = "DELETED_BY")
    private Long deletedBy;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.deletedYn == null) this.deletedYn = "N";
        if (this.containerUnit == null) this.containerUnit = "40";
        if (this.sortOrder == null) this.sortOrder = 0;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public LogiRate(String yearQuarter, String region, String country, String port,
                    String containerUnit, BigDecimal volumePerMonth, BigDecimal rateUsd,
                    String memo, Integer sortOrder, Long createdBy) {
        this.yearQuarter = yearQuarter;
        this.region = region != null ? region : "";
        this.country = country != null ? country : "";
        this.port = port;
        this.containerUnit = containerUnit != null ? containerUnit : "40";
        this.volumePerMonth = volumePerMonth != null ? volumePerMonth : BigDecimal.ZERO;
        this.rateUsd = rateUsd != null ? rateUsd : BigDecimal.ZERO;
        this.memo = memo;
        this.sortOrder = sortOrder != null ? sortOrder : 0;
        this.createdBy = createdBy;
        this.deletedYn = "N";
    }

    public void update(String region, String country, String port,
                       String containerUnit, BigDecimal volumePerMonth, BigDecimal rateUsd,
                       String memo, Integer sortOrder, Long updatedBy) {
        this.region = region;
        this.country = country;
        this.port = port;
        this.containerUnit = containerUnit;
        this.volumePerMonth = volumePerMonth;
        this.rateUsd = rateUsd;
        this.memo = memo;
        this.sortOrder = sortOrder;
        this.updatedBy = updatedBy;
    }

    public void delete(Long deletedBy) {
        this.deletedYn = "Y";
        this.deletedBy = deletedBy;
        this.deletedAt = LocalDateTime.now();
    }

    public void restore(Long updatedBy) {
        this.deletedYn = "N";
        this.deletedBy = null;
        this.deletedAt = null;
        this.updatedBy = updatedBy;
    }
}
