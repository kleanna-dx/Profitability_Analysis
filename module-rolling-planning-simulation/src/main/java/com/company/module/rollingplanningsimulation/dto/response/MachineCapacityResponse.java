package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.MachineCapacity;
import lombok.Builder;
import lombok.Getter;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter @Builder
public class MachineCapacityResponse {
    private Long capacityId;
    private String division;
    private String machineCode;
    private BigDecimal hourlyCapacity;
    private BigDecimal basisWeightRef;
    private String note;
    private String validFrom;
    private String validTo;
    private LocalDateTime createdAt;

    public static MachineCapacityResponse from(MachineCapacity e) {
        return MachineCapacityResponse.builder().capacityId(e.getCapacityId())
                .division(e.getDivision()).machineCode(e.getMachineCode())
                .hourlyCapacity(e.getHourlyCapacity()).basisWeightRef(e.getBasisWeightRef())
                .note(e.getNote()).validFrom(e.getValidFrom()).validTo(e.getValidTo())
                .createdAt(e.getCreatedAt()).build();
    }
}
