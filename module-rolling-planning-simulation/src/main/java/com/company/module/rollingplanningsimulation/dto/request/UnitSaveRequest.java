package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;

@Getter @Setter
public class UnitSaveRequest {
    @NotBlank(message = "호기코드는 필수입니다") private String unitCode;
    @NotBlank(message = "호기명은 필수입니다") private String unitName;
    private String division;
    private String description;
    private Boolean isActive;
}
