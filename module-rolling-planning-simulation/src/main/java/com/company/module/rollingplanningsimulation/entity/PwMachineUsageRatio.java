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
 * 설비별 전력사용 배분 비율 (월별 갱신 가능)
 * - 총 전기요금 × 설비별 비율 → 설비별 전력비
 * - 전 설비 합계 = 1.0
 */
@SQLRestriction("DELETED_YN = \'N\'")
@Entity
@Table(name = "rpsim_pw_machine_usage_ratio")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwMachineUsageRatio extends BaseAuditEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "RATIO_ID")
    private Long ratioId;

    @Column(name = "YM", nullable = false, length = 6)
    private String ym;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "LINE_CODE", nullable = false, length = 20)
    private String lineCode;

    @Column(name = "USAGE_RATIO", nullable = false, precision = 8, scale = 6)
    private BigDecimal usageRatio;

    @Column(name = "MEMO", length = 200)
    private String memo;



    @PrePersist
    protected void onCreate() {
        if (this.division == null) this.division = "PS";
    }


    @Builder
    public PwMachineUsageRatio(String ym, String division, String lineCode,
                               BigDecimal usageRatio, String memo) {
        this.ym = ym;
        this.division = division != null ? division : "PS";
        this.lineCode = lineCode;
        this.usageRatio = usageRatio != null ? usageRatio : BigDecimal.ZERO;
        this.memo = memo;
    }

    public void update(BigDecimal usageRatio, String memo) {
        this.usageRatio = usageRatio;
        this.memo = memo;
    }
}
