package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 부하별 시간당 사용량 (월별 관리)
 * - 경부하/중부하/최대부하 시간당 사용량(kW)
 * - 보정 규칙: 세 부하 합계 ≠ 총 전력사용량이면 비례 배분
 */
@Entity
@Table(name = "rpsim_pw_load_demand")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwLoadDemand {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "LOAD_DEMAND_ID")
    private Long loadDemandId;

    @Column(name = "YM", nullable = false, length = 6)
    private String ym;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "LOAD_CLASS", nullable = false, length = 20)
    private String loadClass;

    @Column(name = "HOURLY_USAGE_KW", nullable = false, precision = 12, scale = 2)
    private BigDecimal hourlyUsageKw;

    @Column(name = "MEMO", length = 200)
    private String memo;

    @Column(name = "CREATED_BY") private String createdBy;
    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.division == null) this.division = "PS";
    }

    @PreUpdate
    protected void onUpdate() { this.updatedAt = LocalDateTime.now(); }

    @Builder
    public PwLoadDemand(String ym, String division, String loadClass,
                        BigDecimal hourlyUsageKw, String memo) {
        this.ym = ym;
        this.division = division != null ? division : "PS";
        this.loadClass = loadClass;
        this.hourlyUsageKw = hourlyUsageKw != null ? hourlyUsageKw : BigDecimal.ZERO;
        this.memo = memo;
    }

    public void update(BigDecimal hourlyUsageKw, String memo) {
        this.hourlyUsageKw = hourlyUsageKw;
        this.memo = memo;
    }
}
