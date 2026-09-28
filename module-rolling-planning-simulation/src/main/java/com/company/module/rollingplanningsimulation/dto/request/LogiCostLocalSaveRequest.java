package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class LogiCostLocalSaveRequest {
    @NotBlank(message = "분기는 필수입니다") private String yearQuarter;
    @NotBlank(message = "출발항은 필수입니다") private String portOrigin;
    private String containerSize;
    private String division;
    private BigDecimal containerFeeKrw;
    private BigDecimal extraFeeKrw;
    private String memo;
}
