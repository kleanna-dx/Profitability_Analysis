package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.Unit;
import lombok.Builder;
import lombok.Getter;
import java.time.LocalDateTime;

@Getter @Builder
public class UnitResponse {
    private Long unitId;
    private String unitCode;
    private String unitName;
    private String division;
    private String description;
    private Boolean isActive;
    private LocalDateTime createdAt;

    public static UnitResponse from(Unit e) {
        return UnitResponse.builder().unitId(e.getUnitId()).unitCode(e.getUnitCode())
                .unitName(e.getUnitName()).division(e.getDivision())
                .description(e.getDescription()).isActive(e.getIsActive())
                .createdAt(e.getCreatedAt()).build();
    }
}
