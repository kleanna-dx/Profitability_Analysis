package com.company.module.rollingplanningsimulation.entity;

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
@Entity
@Table(name = "rpsim_machine_capacity")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MachineCapacity {

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
        if (this.division == null) this.division = "PS";
        if (this.validFrom == null) this.validFrom = "202401";
        if (this.validTo == null) this.validTo = "999912";
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public MachineCapacity(String division, String machineCode, BigDecimal hourlyCapacity,
                           BigDecimal basisWeightRef, String note,
                           String validFrom, String validTo, Long createdBy) {
        this.division = division != null ? division : "PS";
        this.machineCode = machineCode;
        this.hourlyCapacity = hourlyCapacity != null ? hourlyCapacity : BigDecimal.ZERO;
        this.basisWeightRef = basisWeightRef;
        this.note = note;
        this.validFrom = validFrom != null ? validFrom : "202401";
        this.validTo = validTo != null ? validTo : "999912";
        this.createdBy = createdBy;
        this.deletedYn = "N";
    }

    public void update(BigDecimal hourlyCapacity, BigDecimal basisWeightRef, String note,
                       String validFrom, String validTo, Long updatedBy) {
        this.hourlyCapacity = hourlyCapacity;
        this.basisWeightRef = basisWeightRef;
        this.note = note;
        this.validFrom = validFrom;
        this.validTo = validTo;
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
