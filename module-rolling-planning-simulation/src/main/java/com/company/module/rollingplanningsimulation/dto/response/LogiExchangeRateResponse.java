package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.LogiExchangeRate;
import lombok.Builder;
import lombok.Getter;
import java.math.BigDecimal;

@Getter @Builder
public class LogiExchangeRateResponse {
    private Long exchangeId;
    private Integer year;
    private Integer month;
    private String division;
    private String currency;
    private BigDecimal rate;
    private String memo;

    public static LogiExchangeRateResponse from(LogiExchangeRate e) {
        return LogiExchangeRateResponse.builder().exchangeId(e.getExchangeId())
                .year(e.getYear()).month(e.getMonth()).division(e.getDivision())
                .currency(e.getCurrency()).rate(e.getRate()).memo(e.getMemo()).build();
    }
}
