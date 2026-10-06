package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 전력비 호기(라인) 마스터 엔티티
 * - 호기코드, 라인그룹, 가동/운휴 시 시간당 kWh
 */
@Entity
@Table(name = "rpsim_pw_line")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwLine {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "PW_LINE_ID")
    private Long pwLineId;

    @Column(name = "LINE_CODE", nullable = false, length = 20)
    private String lineCode;

    @Column(name = "LINE_NAME", nullable = false, length = 100)
    private String lineName;

    @Column(name = "LINE_GROUP", nullable = false, length = 50)
    private String lineGroup;

    @Column(name = "UNIT_TYPE", nullable = false, length = 10)
    private String unitType;

    @Column(name = "KWH_PER_HOUR_RUN", nullable = false, precision = 12, scale = 4)
    private BigDecimal kwhPerHourRun;

    @Column(name = "KWH_PER_HOUR_STBY", nullable = false, precision = 12, scale = 4)
    private BigDecimal kwhPerHourStby;

    @Column(name = "DISPLAY_ORDER", nullable = false)
    private Integer displayOrder;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

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
        if (this.isActive == null) this.isActive = true;
        if (this.division == null) this.division = "PS";
        if (this.unitType == null) this.unitType = "kg";
        if (this.displayOrder == null) this.displayOrder = 0;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public PwLine(String lineCode, String lineName, String lineGroup, String unitType,
                  BigDecimal kwhPerHourRun, BigDecimal kwhPerHourStby,
                  Integer displayOrder, Boolean isActive, String division, Long createdBy) {
        this.lineCode = lineCode;
        this.lineName = lineName;
        this.lineGroup = lineGroup;
        this.unitType = unitType != null ? unitType : "kg";
        this.kwhPerHourRun = kwhPerHourRun != null ? kwhPerHourRun : BigDecimal.ZERO;
        this.kwhPerHourStby = kwhPerHourStby != null ? kwhPerHourStby : BigDecimal.ZERO;
        this.displayOrder = displayOrder != null ? displayOrder : 0;
        this.isActive = isActive != null ? isActive : true;
        this.division = division != null ? division : "PS";
        this.createdBy = createdBy;
        this.deletedYn = "N";
    }

    public void update(String lineName, String lineGroup, String unitType,
                       BigDecimal kwhPerHourRun, BigDecimal kwhPerHourStby,
                       Integer displayOrder, Boolean isActive, Long updatedBy) {
        this.lineName = lineName;
        this.lineGroup = lineGroup;
        this.unitType = unitType;
        this.kwhPerHourRun = kwhPerHourRun;
        this.kwhPerHourStby = kwhPerHourStby;
        this.displayOrder = displayOrder;
        this.isActive = isActive;
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
