package com.company.module.rollingplanningsimulation.dto.request;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class PwMachineUsageRatioSaveRequest {
    private String ym;
    private String division;
    private String lineCode;
    private BigDecimal usageRatio;
    private String memo;
}
