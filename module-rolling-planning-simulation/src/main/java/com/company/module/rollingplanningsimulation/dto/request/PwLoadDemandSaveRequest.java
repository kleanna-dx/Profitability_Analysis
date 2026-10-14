package com.company.module.rollingplanningsimulation.dto.request;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class PwLoadDemandSaveRequest {
    private String ym;
    private String division;
    private String loadClass;
    private BigDecimal hourlyUsageKw;
    private String memo;
}
