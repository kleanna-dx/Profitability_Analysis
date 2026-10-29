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
 * 호기별 시간당 생산능력 엔티티
 * - 호기코드, 시간당 생산능력(톤/시간), 기준 평량, 유효기간
 */
@SQLRestriction("DELETED_YN = \'N\'")
@Entity
@Table(name = "rpsim_machine_capacity")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MachineCapacity extends BaseAuditEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "CAPACITY_ID")
    private Long capacityId;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "MACHINE_CODE", nullable = false, length = 20)
    private String machineCode;

    @Column(name = "HOURLY_CAPACITY", nullable = false, precision = 12, scale = 4)
    private BigDecimal hourlyCapacity;

    @Column(name = "BASIS_WEIGHT_REF", precision = 10, scale = 2)
    private BigDecimal basisWeightRef;

    @Column(name = "NOTE", length = 500)
    private String note;

    @Column(name = "VALID_FROM", nullable = false, length = 6)
    private String validFrom;

    @Column(name = "VALID_TO", nullable = false, length = 6)
    private String validTo;








    @PrePersist
    protected void onCreate() {
        if (this.division == null) this.division = "PS";
        if (this.validFrom == null) this.validFrom = "202401";
        if (this.validTo == null) this.validTo = "999912";
    }


    @Builder
    public MachineCapacity(String division, String machineCode, BigDecimal hourlyCapacity,
                           BigDecimal basisWeightRef, String note,
                           String validFrom, String validTo) {
        this.division = division != null ? division : "PS";
        this.machineCode = machineCode;
        this.hourlyCapacity = hourlyCapacity != null ? hourlyCapacity : BigDecimal.ZERO;
        this.basisWeightRef = basisWeightRef;
        this.note = note;
        this.validFrom = validFrom != null ? validFrom : "202401";
        this.validTo = validTo != null ? validTo : "999912";
    }

    public void update(BigDecimal hourlyCapacity, BigDecimal basisWeightRef, String note,
                       String validFrom, String validTo) {
        this.hourlyCapacity = hourlyCapacity;
        this.basisWeightRef = basisWeightRef;
        this.note = note;
        this.validFrom = validFrom;
        this.validTo = validTo;
    }


}
