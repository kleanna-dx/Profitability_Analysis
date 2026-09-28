package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.PwTariff;
import lombok.Builder;
import lombok.Getter;
import java.math.BigDecimal;

@Getter @Builder
public class PwTariffResponse {
    private Long tariffId;
    private Integer year;
    private String season;
    private String timeZone;
    private BigDecimal demandKrw;
    private BigDecimal energyKrw;
    private String division;

    public static PwTariffResponse from(PwTariff e) {
        return PwTariffResponse.builder().tariffId(e.getTariffId()).year(e.getYear())
                .season(e.getSeason()).timeZone(e.getTimeZone())
                .demandKrw(e.getDemandKrw()).energyKrw(e.getEnergyKrw())
                .division(e.getDivision()).build();
    }
}
