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
    private String description;
    private Boolean isActive;
    private LocalDateTime createdAt;

    public static MaterialResponse from(Material e) {
        return MaterialResponse.builder().materialId(e.getMaterialId()).materialCode(e.getMaterialCode())
                .materialName(e.getMaterialName()).category(e.getCategory())
                .unitOfMeasure(e.getUnitOfMeasure()).description(e.getDescription())
                .isActive(e.getIsActive()).createdAt(e.getCreatedAt()).build();
    }
}
