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
 * 월별 호기별 가동시간 엔티티
 * - 계획운휴 + 가동일수(정상/폐품/비계획/초출/절지) + 비가동일수(정비/세척/사고)
 * - 총일수 = 계획운휴 + 가동소계 + 비가동소계
 */
@SQLRestriction("DELETED_YN = \'N\'")
@Entity
@Table(name = "rpsim_operating_time")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OperatingTime extends BaseAuditEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "OPTIME_ID")
    private Long optimeId;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "MACHINE_CODE", nullable = false, length = 20)
    private String machineCode;

    @Column(name = "YM", nullable = false, length = 6)
    private String ym;

    @Column(name = "TOTAL_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal totalDays;

    @Column(name = "PLANNED_SHUTDOWN_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal plannedShutdownDays;

    @Column(name = "OPERATION_NORMAL_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal operationNormalDays;

    @Column(name = "OPERATION_WASTE_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal operationWasteDays;

    @Column(name = "OPERATION_UNPLANNED_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal operationUnplannedDays;

    @Column(name = "OPERATION_STARTUP_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal operationStartupDays;

    @Column(name = "OPERATION_TRIMMING_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal operationTrimmingDays;

    @Column(name = "DOWNTIME_REPAIR_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal downtimeRepairDays;

    @Column(name = "DOWNTIME_CLEANING_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal downtimeCleaningDays;

    @Column(name = "DOWNTIME_ACCIDENT_DAYS", nullable = false, precision = 6, scale = 2)
    private BigDecimal downtimeAccidentDays;










    @Builder
    public OperatingTime(String division, String machineCode, String ym,
                         BigDecimal totalDays, BigDecimal plannedShutdownDays,
                         BigDecimal operationNormalDays, BigDecimal operationWasteDays,
                         BigDecimal operationUnplannedDays, BigDecimal operationStartupDays,
                         BigDecimal operationTrimmingDays,
                         BigDecimal downtimeRepairDays, BigDecimal downtimeCleaningDays,
                         BigDecimal downtimeAccidentDays) {
        this.division = division;
        this.machineCode = machineCode;
        this.ym = ym;
        this.totalDays = totalDays != null ? totalDays : BigDecimal.ZERO;
        this.plannedShutdownDays = plannedShutdownDays != null ? plannedShutdownDays : BigDecimal.ZERO;
        this.operationNormalDays = operationNormalDays != null ? operationNormalDays : BigDecimal.ZERO;
        this.operationWasteDays = operationWasteDays != null ? operationWasteDays : BigDecimal.ZERO;
        this.operationUnplannedDays = operationUnplannedDays != null ? operationUnplannedDays : BigDecimal.ZERO;
        this.operationStartupDays = operationStartupDays != null ? operationStartupDays : BigDecimal.ZERO;
        this.operationTrimmingDays = operationTrimmingDays != null ? operationTrimmingDays : BigDecimal.ZERO;
        this.downtimeRepairDays = downtimeRepairDays != null ? downtimeRepairDays : BigDecimal.ZERO;
        this.downtimeCleaningDays = downtimeCleaningDays != null ? downtimeCleaningDays : BigDecimal.ZERO;
        this.downtimeAccidentDays = downtimeAccidentDays != null ? downtimeAccidentDays : BigDecimal.ZERO;
    }

    public void update(BigDecimal totalDays, BigDecimal plannedShutdownDays,
                       BigDecimal operationNormalDays, BigDecimal operationWasteDays,
                       BigDecimal operationUnplannedDays, BigDecimal operationStartupDays,
                       BigDecimal operationTrimmingDays,
                       BigDecimal downtimeRepairDays, BigDecimal downtimeCleaningDays,
                       BigDecimal downtimeAccidentDays) {
        this.totalDays = totalDays;
        this.plannedShutdownDays = plannedShutdownDays;
        this.operationNormalDays = operationNormalDays;
        this.operationWasteDays = operationWasteDays;
        this.operationUnplannedDays = operationUnplannedDays;
        this.operationStartupDays = operationStartupDays;
        this.operationTrimmingDays = operationTrimmingDays;
        this.downtimeRepairDays = downtimeRepairDays;
        this.downtimeCleaningDays = downtimeCleaningDays;
        this.downtimeAccidentDays = downtimeAccidentDays;
    }


}
