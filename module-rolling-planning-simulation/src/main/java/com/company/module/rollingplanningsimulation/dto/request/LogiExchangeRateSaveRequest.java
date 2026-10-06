package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class LogiExchangeRateSaveRequest {
    @NotNull(message = "연도는 필수입니다") private Integer year;
    @NotNull(message = "월은 필수입니다") private Integer month;
    private String division;
    private String currency;
    @NotNull(message = "환율은 필수입니다") private BigDecimal rate;
    private String memo;
}
