package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.Material;
import lombok.Builder;
import lombok.Getter;
import java.time.LocalDateTime;

@Getter @Builder
public class MaterialResponse {
    private Long materialId;
    private String materialCode;
    private String materialName;
    private String category;
    private String unitOfMeasure;
    private String materialGroup;
    private String materialGroupName;
    private String materialGroupLarge;
    private String materialGroupLargeName;
    private String description;
    private Boolean isActive;
    private LocalDateTime createdAt;

    public static MaterialResponse from(Material e) {
        return MaterialResponse.builder()
                .materialId(e.getMaterialId())
                .materialCode(e.getMaterialCode())
                .materialName(e.getMaterialName())
                .category(e.getCategory())
                .unitOfMeasure(e.getUnitOfMeasure())
                .materialGroup(e.getMaterialGroup())
                .materialGroupName(e.getMaterialGroupName())
                .materialGroupLarge(e.getMaterialGroupLarge())
                .materialGroupLargeName(e.getMaterialGroupLargeName())
                .description(e.getDescription())
                .isActive(e.getIsActive())
                .createdAt(e.getCreatedAt())
                .build();
    }
}
