package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * 원부재료비 차월 예상 — 수기입력 저장값
 * ROW_TYPE: PROD = 지종별 차월 생산량(ITEM_CODE=지종) / MAT = 자재별 차월값(ITEM_CODE=자재코드)
 * UK: YM(예상월) + DIVISION + MACHINE_CODE + ROW_TYPE + ITEM_CODE
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_material_forecast") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class MaterialForecast extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="FORECAST_ID") private Long forecastId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="ROW_TYPE",nullable=false,length=10) private String rowType;
    @Column(name="ITEM_CODE",nullable=false,length=50) private String itemCode;
    @Column(name="ITEM_NAME",length=200) private String itemName;
    @Column(name="PROD_TON",precision=18,scale=3) private BigDecimal prodTon;
    @Column(name="USAGE_QTY",precision=20,scale=3) private BigDecimal usageQty;
    @Column(name="UNIT_RATE",precision=18,scale=4) private BigDecimal unitRate;
    @Column(name="RECEIPT_PRICE",precision=18,scale=4) private BigDecimal receiptPrice;
    @Column(name="OPENING_PRICE",precision=18,scale=4) private BigDecimal openingPrice;
    @Column(name="USE_PRICE",precision=18,scale=4) private BigDecimal usePrice;
    @Column(name="ISSUE_NOTE",length=1000) private String issueNote;

    @Builder
    public MaterialForecast(String ym, String division, String machineCode, String rowType, String itemCode, String itemName,
                            BigDecimal prodTon, BigDecimal usageQty, BigDecimal unitRate, BigDecimal receiptPrice,
                            BigDecimal openingPrice, BigDecimal usePrice, String issueNote) {
        this.ym = ym; this.division = division; this.machineCode = machineCode; this.rowType = rowType;
        this.itemCode = itemCode; this.itemName = itemName; this.prodTon = prodTon; this.usageQty = usageQty;
        this.unitRate = unitRate; this.receiptPrice = receiptPrice; this.openingPrice = openingPrice;
        this.usePrice = usePrice; this.issueNote = issueNote;
    }
}
