package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * 구매 이동계획 펄프 수불 (버전 × 월 × 사업부 × 자재)
 * IN_QTY = 구매 + 이동 합계, MOVE_IN_QTY = 그중 반대 사업부에서 이동, OUT_QTY = 이동 보낸 수량 포함
 * 통화·단가·입고금액은 구매분(IN − MOVE_IN)만
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_purchase_pulp_plan") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PurchasePulpPlan extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PLAN_ID") private Long planId;
    @Column(name="VERSION_ID",nullable=false) private Long versionId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MATERIAL_CODE",nullable=false,length=18) private String materialCode;
    @Column(name="MATERIAL_NAME",length=100) private String materialName;
    @Column(name="MATL_GROUP_NM",length=100) private String matlGroupNm;
    @Column(name="IN_QTY_TON",precision=18,scale=3) private BigDecimal inQtyTon;
    @Column(name="MOVE_IN_QTY_TON",precision=18,scale=3) private BigDecimal moveInQtyTon;
    @Column(name="PAY_CURRENCY",length=10) private String payCurrency;
    @Column(name="UNIT_PRICE_FC",precision=18,scale=4) private BigDecimal unitPriceFc;
    @Column(name="OFFER_MONTH",length=20) private String offerMonth;
    @Column(name="IN_AMOUNT_MKRW",precision=18,scale=6) private BigDecimal inAmountMkrw;
    @Column(name="OUT_QTY_TON",precision=18,scale=3) private BigDecimal outQtyTon;
    @Column(name="NOTE",length=1000) private String note;
    @Column(name="EXCEL_ROW_NO") private Integer excelRowNo;

    @Builder
    public PurchasePulpPlan(Long versionId, String ym, String division, String materialCode, String materialName,
                            String matlGroupNm, BigDecimal inQtyTon, BigDecimal moveInQtyTon, String payCurrency,
                            BigDecimal unitPriceFc, String offerMonth, BigDecimal inAmountMkrw, BigDecimal outQtyTon,
                            String note, Integer excelRowNo) {
        this.versionId = versionId; this.ym = ym; this.division = division; this.materialCode = materialCode;
        this.materialName = materialName; this.matlGroupNm = matlGroupNm; this.inQtyTon = inQtyTon;
        this.moveInQtyTon = moveInQtyTon; this.payCurrency = payCurrency; this.unitPriceFc = unitPriceFc;
        this.offerMonth = offerMonth; this.inAmountMkrw = inAmountMkrw; this.outQtyTon = outQtyTon;
        this.note = note; this.excelRowNo = excelRowNo;
    }
}
