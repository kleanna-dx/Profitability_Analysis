package com.company.module.rollingplanningsimulation.dto.request;
import lombok.Getter;
import lombok.Setter;
import java.math.BigDecimal;

@Getter @Setter
public class PwFixedItemSaveRequest {
    private String ym;
    private String division;
    private String itemCode;
    private String itemName;
    private BigDecimal amountKrw;
    private String calcFormula;
    private String memo;
}
