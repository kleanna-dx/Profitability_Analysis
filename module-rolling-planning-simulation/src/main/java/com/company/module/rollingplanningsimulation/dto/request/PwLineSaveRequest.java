package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class PwLineSaveRequest {
    @NotBlank(message = "호기코드는 필수입니다") private String lineCode;
    @NotBlank(message = "호기명은 필수입니다") private String lineName;
    @NotBlank(message = "라인그룹은 필수입니다") private String lineGroup;
    private String unitType;
    private BigDecimal kwhPerHourRun;
    private BigDecimal kwhPerHourStby;
    private Integer displayOrder;
    private Boolean isActive;
    private String division;
}
