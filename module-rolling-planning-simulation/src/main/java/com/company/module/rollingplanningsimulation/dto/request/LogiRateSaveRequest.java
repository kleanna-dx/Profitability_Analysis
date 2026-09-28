package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class LogiRateSaveRequest {
    @NotBlank(message = "분기는 필수입니다") private String yearQuarter;
    private String region;
    private String country;
    @NotBlank(message = "항구는 필수입니다") private String port;
    private String containerUnit;
    private BigDecimal volumePerMonth;
    private BigDecimal rateUsd;
    private String memo;
    private Integer sortOrder;
}
