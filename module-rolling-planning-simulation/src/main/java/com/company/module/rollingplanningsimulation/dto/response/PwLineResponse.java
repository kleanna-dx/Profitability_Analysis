package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.PwLine;
import lombok.Builder;
import lombok.Getter;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter @Builder
public class PwLineResponse {
    private Long pwLineId;
    private String lineCode;
    private String lineName;
    private String lineGroup;
    private String unitType;
    private BigDecimal kwhPerHourRun;
    private BigDecimal kwhPerHourStby;
    private Integer displayOrder;
    private Boolean isActive;
    private String division;
    private LocalDateTime createdAt;

    public static PwLineResponse from(PwLine e) {
        return PwLineResponse.builder().pwLineId(e.getPwLineId()).lineCode(e.getLineCode())
                .lineName(e.getLineName()).lineGroup(e.getLineGroup()).unitType(e.getUnitType())
                .kwhPerHourRun(e.getKwhPerHourRun()).kwhPerHourStby(e.getKwhPerHourStby())
                .displayOrder(e.getDisplayOrder()).isActive(e.getIsActive())
                .division(e.getDivision()).createdAt(e.getCreatedAt()).build();
    }
}
