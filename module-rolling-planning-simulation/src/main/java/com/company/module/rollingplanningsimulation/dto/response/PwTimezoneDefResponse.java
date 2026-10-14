package com.company.module.rollingplanningsimulation.dto.response;
import com.company.module.rollingplanningsimulation.entity.PwTimezoneDef;
import lombok.Builder; import lombok.Getter;
import java.math.BigDecimal;

@Getter @Builder
public class PwTimezoneDefResponse {
    private Long timezoneDefId; private Integer year; private String season; private String dayType;
    private String loadClass; private Integer startHour; private Integer endHour;
    private BigDecimal hours; private BigDecimal discountRate; private String memo; private String division;
    public static PwTimezoneDefResponse from(PwTimezoneDef e) {
        return PwTimezoneDefResponse.builder().timezoneDefId(e.getTimezoneDefId()).year(e.getYear())
            .season(e.getSeason()).dayType(e.getDayType()).loadClass(e.getLoadClass())
            .startHour(e.getStartHour()).endHour(e.getEndHour()).hours(e.getHours())
            .discountRate(e.getDiscountRate()).memo(e.getMemo()).division(e.getDivision()).build();
    }
}
