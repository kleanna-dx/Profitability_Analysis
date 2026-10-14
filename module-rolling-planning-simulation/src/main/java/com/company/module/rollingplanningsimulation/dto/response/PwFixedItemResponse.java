package com.company.module.rollingplanningsimulation.dto.response;
import com.company.module.rollingplanningsimulation.entity.PwFixedItem;
import lombok.Builder; import lombok.Getter;
import java.math.BigDecimal;

@Getter @Builder
public class PwFixedItemResponse {
    private Long fixedItemId; private String ym; private String division;
    private String itemCode; private String itemName; private BigDecimal amountKrw;
    private String calcFormula; private String memo;
    public static PwFixedItemResponse from(PwFixedItem e) {
        return PwFixedItemResponse.builder().fixedItemId(e.getFixedItemId()).ym(e.getYm())
            .division(e.getDivision()).itemCode(e.getItemCode()).itemName(e.getItemName())
            .amountKrw(e.getAmountKrw()).calcFormula(e.getCalcFormula()).memo(e.getMemo()).build();
    }
}
