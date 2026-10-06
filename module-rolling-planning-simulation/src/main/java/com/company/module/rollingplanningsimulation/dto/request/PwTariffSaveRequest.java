package com.company.module.rollingplanningsimulation.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class PwTariffSaveRequest {
    @NotNull(message = "연도는 필수입니다") private Integer year;
    @NotBlank(message = "시즌은 필수입니다") private String season;
    @NotBlank(message = "시간대는 필수입니다") private String timeZone;
    private BigDecimal demandKrw;
    private BigDecimal energyKrw;
    private String division;
}
