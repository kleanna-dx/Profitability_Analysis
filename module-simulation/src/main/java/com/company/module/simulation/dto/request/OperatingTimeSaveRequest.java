package com.company.module.simulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;

import java.math.BigDecimal;

@Getter
@Setter
public class OperatingTimeSaveRequest {

    @NotBlank(message = "사업부는 필수입니다")
    private String division;

    @NotBlank(message = "호기코드는 필수입니다")
    private String machineCode;

    @NotBlank(message = "연월(YYYYMM)은 필수입니다")
    private String ym;

    @NotNull
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
}
