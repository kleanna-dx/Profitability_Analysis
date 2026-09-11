package com.company.module.simulation.dto.response;

import com.company.module.simulation.entity.OperatingTime;
import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter
@Builder
public class OperatingTimeResponse {

    private Long optimeId;
    private String division;
    private String machineCode;
    private String ym;
    private BigDecimal totalDays;
    private BigDecimal plannedShutdownDays;
    private BigDecimal operationNormalDays;
    private BigDecimal operationWasteDays;
    private BigDecimal operationUnplannedDays;
    private BigDecimal operationStartupDays;
    private BigDecimal operationTrimmingDays;
    private BigDecimal downtimeRepairDays;
    private BigDecimal downtimeCleaningDays;
    private BigDecimal downtimeAccidentDays;
    private LocalDateTime createdAt;

    public static OperatingTimeResponse from(OperatingTime entity) {
        return OperatingTimeResponse.builder()
                .optimeId(entity.getOptimeId())
                .division(entity.getDivision())
                .machineCode(entity.getMachineCode())
                .ym(entity.getYm())
                .totalDays(entity.getTotalDays())
                .plannedShutdownDays(entity.getPlannedShutdownDays())
                .operationNormalDays(entity.getOperationNormalDays())
                .operationWasteDays(entity.getOperationWasteDays())
                .operationUnplannedDays(entity.getOperationUnplannedDays())
                .operationStartupDays(entity.getOperationStartupDays())
                .operationTrimmingDays(entity.getOperationTrimmingDays())
                .downtimeRepairDays(entity.getDowntimeRepairDays())
                .downtimeCleaningDays(entity.getDowntimeCleaningDays())
                .downtimeAccidentDays(entity.getDowntimeAccidentDays())
                .createdAt(entity.getCreatedAt())
                .build();
    }
}
