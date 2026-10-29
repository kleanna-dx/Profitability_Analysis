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
 * 최대수요전력 이력 (12개월 캐리 규칙)
 * - 월 측정 최대수요가 현재 유효값보다 크면 교체 → 12개월간 유지
 * - 기본요금 = effectiveKw × 8,190원
 */
@SQLRestriction("DELETED_YN = \'N\'")
@Entity
@Table(name = "rpsim_pw_peak_demand")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwPeakDemand extends BaseAuditEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "PEAK_DEMAND_ID")
    private Long peakDemandId;

    @Column(name = "YM", nullable = false, length = 6)
    private String ym;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "MEASURED_KW", nullable = false, precision = 12, scale = 2)
    private BigDecimal measuredKw;

    @Column(name = "EFFECTIVE_KW", nullable = false, precision = 12, scale = 2)
    private BigDecimal effectiveKw;

    @Column(name = "CARRY_ORIGIN_YM", length = 6)
    private String carryOriginYm;

    @Column(name = "CARRY_EXPIRE_YM", length = 6)
    private String carryExpireYm;

    @Column(name = "MEMO", length = 200)
    private String memo;



    @PrePersist
    protected void onCreate() {
        if (this.division == null) this.division = "PS";
    }


    @Builder
    public PwPeakDemand(String ym, String division, BigDecimal measuredKw,
                        BigDecimal effectiveKw, String carryOriginYm,
                        String carryExpireYm, String memo) {
        this.ym = ym;
        this.division = division != null ? division : "PS";
        this.measuredKw = measuredKw;
        this.effectiveKw = effectiveKw;
        this.carryOriginYm = carryOriginYm;
        this.carryExpireYm = carryExpireYm;
        this.memo = memo;
    }

    public void update(BigDecimal measuredKw, BigDecimal effectiveKw,
                       String carryOriginYm, String carryExpireYm) {
        this.measuredKw = measuredKw;
        this.effectiveKw = effectiveKw;
        this.carryOriginYm = carryOriginYm;
        this.carryExpireYm = carryExpireYm;
    }
}
