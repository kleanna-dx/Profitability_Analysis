package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter @Setter
public class MaterialSaveRequest {
    @NotBlank(message = "자재코드는 필수입니다") private String materialCode;
    @NotBlank(message = "자재명은 필수입니다") private String materialName;
    private String category;
    private String unitOfMeasure;
    private String description;
    private Boolean isActive;
}
