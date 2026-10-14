package com.company.module.rollingplanningsimulation.dto.response;
import com.company.module.rollingplanningsimulation.entity.PwMachineUsageRatio;
import lombok.Builder; import lombok.Getter;
import java.math.BigDecimal;

@Getter @Builder
public class PwMachineUsageRatioResponse {
    private Long ratioId; private String ym; private String division;
    private String lineCode; private BigDecimal usageRatio; private String memo;
    public static PwMachineUsageRatioResponse from(PwMachineUsageRatio e) {
        return PwMachineUsageRatioResponse.builder().ratioId(e.getRatioId()).ym(e.getYm())
            .division(e.getDivision()).lineCode(e.getLineCode())
            .usageRatio(e.getUsageRatio()).memo(e.getMemo()).build();
    }
}
