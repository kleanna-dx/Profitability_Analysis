package com.company.module.rollingplanningsimulation.dto.request;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class PwTimezoneDefSaveRequest {
    private Integer year;
    private String season;
    private String dayType;
    private String loadClass;
    private Integer startHour;
    private Integer endHour;
    private BigDecimal hours;
    private BigDecimal discountRate;
    private String memo;
    private String division;
}
