package com.company.module.rollingplanningsimulation.dto.response;

import com.company.module.rollingplanningsimulation.entity.LogiCostLocal;
import lombok.Builder;
import lombok.Getter;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@Getter @Builder
public class LogiCostLocalResponse {
    private Long localCostId;
    private String yearQuarter;
    private String portOrigin;
    private String containerSize;
    private String division;
    private BigDecimal containerFeeKrw;
    private BigDecimal extraFeeKrw;
    private String memo;
    private LocalDateTime createdAt;

    public static LogiCostLocalResponse from(LogiCostLocal e) {
        return LogiCostLocalResponse.builder().localCostId(e.getLocalCostId())
                .yearQuarter(e.getYearQuarter()).portOrigin(e.getPortOrigin())
                .containerSize(e.getContainerSize()).division(e.getDivision())
                .containerFeeKrw(e.getContainerFeeKrw()).extraFeeKrw(e.getExtraFeeKrw())
                .memo(e.getMemo()).createdAt(e.getCreatedAt()).build();
    }
}
