package com.company.module.rollingplanningsimulation.dto.response;
import com.company.module.rollingplanningsimulation.entity.PwPeakDemand;
import lombok.Builder; import lombok.Getter;
import java.math.BigDecimal;

@Getter @Builder
public class PwPeakDemandResponse {
    private Long peakDemandId; private String ym; private String division;
    private BigDecimal measuredKw; private BigDecimal effectiveKw;
    private String carryOriginYm; private String carryExpireYm; private String memo;
    public static PwPeakDemandResponse from(PwPeakDemand e) {
        return PwPeakDemandResponse.builder().peakDemandId(e.getPeakDemandId()).ym(e.getYm())
            .division(e.getDivision()).measuredKw(e.getMeasuredKw()).effectiveKw(e.getEffectiveKw())
            .carryOriginYm(e.getCarryOriginYm()).carryExpireYm(e.getCarryExpireYm()).memo(e.getMemo()).build();
    }
}
