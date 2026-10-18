package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.OperatingTime;
import lombok.Builder;
import lombok.Getter;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;

@Getter
@Builder
public class OperatingTimeResponse {

    private Long optimeId;
    private String division;
    private String machineCode;
    private String ym;

    // 분(min) 단위 — 입력 원본
    private BigDecimal totalMin;
    private BigDecimal plannedShutdownMin;
    private BigDecimal operationNormalMin;
    private BigDecimal operationWasteMin;
    private BigDecimal operationUnplannedMin;
    private BigDecimal operationStartupMin;
    private BigDecimal operationTrimmingMin;
    private BigDecimal downtimeRepairMin;
    private BigDecimal downtimeCleaningMin;
    private BigDecimal downtimeAccidentMin;

    // 시간(h) 단위 — 자동 환산 (÷60)
    private BigDecimal totalHours;
    private BigDecimal plannedShutdownHours;
    private BigDecimal operationNormalHours;
    private BigDecimal operationWasteHours;
    private BigDecimal operationStartupHours;
    private BigDecimal operationTrimmingHours;
    private BigDecimal downtimeRepairHours;
    private BigDecimal downtimeCleaningHours;
    private BigDecimal downtimeAccidentHours;

    // 소계 (자동 계산)
    private BigDecimal operationSubtotalMin;
    private BigDecimal downtimeSubtotalMin;
    private BigDecimal operationSubtotalHours;
    private BigDecimal downtimeSubtotalHours;

    private LocalDateTime createdAt;

    private static final BigDecimal SIXTY = BigDecimal.valueOf(60);

    private static BigDecimal toHours(BigDecimal min) {
        return min != null ? min.divide(SIXTY, 2, RoundingMode.HALF_UP) : BigDecimal.ZERO;
    }

    public static OperatingTimeResponse from(OperatingTime e) {
        BigDecimal opSub = safe(e.getOperationNormalDays()).add(safe(e.getOperationWasteDays()))
                .add(safe(e.getOperationUnplannedDays())).add(safe(e.getOperationStartupDays()))
                .add(safe(e.getOperationTrimmingDays()));
        BigDecimal dtSub = safe(e.getDowntimeRepairDays()).add(safe(e.getDowntimeCleaningDays()))
                .add(safe(e.getDowntimeAccidentDays()));

        return OperatingTimeResponse.builder()
                .optimeId(e.getOptimeId())
                .division(e.getDivision())
                .machineCode(e.getMachineCode())
                .ym(e.getYm())
                // 분
                .totalMin(e.getTotalDays())
                .plannedShutdownMin(e.getPlannedShutdownDays())
                .operationNormalMin(e.getOperationNormalDays())
                .operationWasteMin(e.getOperationWasteDays())
                .operationUnplannedMin(e.getOperationUnplannedDays())
                .operationStartupMin(e.getOperationStartupDays())
                .operationTrimmingMin(e.getOperationTrimmingDays())
                .downtimeRepairMin(e.getDowntimeRepairDays())
                .downtimeCleaningMin(e.getDowntimeCleaningDays())
                .downtimeAccidentMin(e.getDowntimeAccidentDays())
                // 시간
                .totalHours(toHours(e.getTotalDays()))
                .plannedShutdownHours(toHours(e.getPlannedShutdownDays()))
                .operationNormalHours(toHours(e.getOperationNormalDays()))
                .operationWasteHours(toHours(e.getOperationWasteDays()))
                .operationStartupHours(toHours(e.getOperationStartupDays()))
                .operationTrimmingHours(toHours(e.getOperationTrimmingDays()))
                .downtimeRepairHours(toHours(e.getDowntimeRepairDays()))
                .downtimeCleaningHours(toHours(e.getDowntimeCleaningDays()))
                .downtimeAccidentHours(toHours(e.getDowntimeAccidentDays()))
                // 소계
                .operationSubtotalMin(opSub)
                .downtimeSubtotalMin(dtSub)
                .operationSubtotalHours(toHours(opSub))
                .downtimeSubtotalHours(toHours(dtSub))
                .createdAt(e.getCreatedAt())
                .build();
    }

    private static BigDecimal safe(BigDecimal v) { return v != null ? v : BigDecimal.ZERO; }
}
