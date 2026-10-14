package com.company.module.rollingplanningsimulation.dto.response;
import com.company.module.rollingplanningsimulation.entity.PwLoadDemand;
import lombok.Builder; import lombok.Getter;
import java.math.BigDecimal;

@Getter @Builder
public class PwLoadDemandResponse {
    private Long loadDemandId; private String ym; private String division;
    private String loadClass; private BigDecimal hourlyUsageKw; private String memo;
    public static PwLoadDemandResponse from(PwLoadDemand e) {
        return PwLoadDemandResponse.builder().loadDemandId(e.getLoadDemandId()).ym(e.getYm())
            .division(e.getDivision()).loadClass(e.getLoadClass())
            .hourlyUsageKw(e.getHourlyUsageKw()).memo(e.getMemo()).build();
    }
}
