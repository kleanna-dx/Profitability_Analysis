package com.company.module.rollingplanningsimulation.dto.request;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class PwPeakDemandSaveRequest {
    private String ym;
    private String division;
    private BigDecimal measuredKw;
    private BigDecimal effectiveKw;
    private String carryOriginYm;
    private String carryExpireYm;
    private String memo;
}
