package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.LogiRate;
import lombok.Builder;
import lombok.Getter;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter @Builder
public class LogiRateResponse {
    private Long rateId;
    private String yearQuarter;
    private String region;
    private String country;
    private String port;
    private String containerUnit;
    private BigDecimal volumePerMonth;
    private BigDecimal rateUsd;
    private String memo;
    private Integer sortOrder;
    private LocalDateTime createdAt;

    public static LogiRateResponse from(LogiRate e) {
        return LogiRateResponse.builder().rateId(e.getRateId()).yearQuarter(e.getYearQuarter())
                .region(e.getRegion()).country(e.getCountry()).port(e.getPort())
                .containerUnit(e.getContainerUnit()).volumePerMonth(e.getVolumePerMonth())
                .rateUsd(e.getRateUsd()).memo(e.getMemo()).sortOrder(e.getSortOrder())
                .createdAt(e.getCreatedAt()).build();
    }
}
