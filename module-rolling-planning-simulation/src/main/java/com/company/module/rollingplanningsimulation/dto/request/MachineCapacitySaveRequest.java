package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class MachineCapacitySaveRequest {
    private String division;
    @NotBlank(message = "호기코드는 필수입니다") private String machineCode;
    @NotNull(message = "시간당 생산능력은 필수입니다") private BigDecimal hourlyCapacity;
    private BigDecimal basisWeightRef;
    private String note;
    private String validFrom;
    private String validTo;
}
