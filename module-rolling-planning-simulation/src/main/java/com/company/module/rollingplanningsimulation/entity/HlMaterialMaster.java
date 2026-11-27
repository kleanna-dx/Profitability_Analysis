package com.company.module.rollingplanningsimulation.entity;
import com.company.module.rollingplanningsimulation.support.HlConversion;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.util.List;

/**
 * 기준정보 › HL 자재 마스터 — SAP 자재 마스터 양식(엑셀 업로드 · 향후 RFC)과 같은 항목.
 * 단위 환산(EA > BAG > BOX > PAL) + 순중량(기본단위 1개당) → 1EA 중량(kg) = 생산계획 EA → 톤 환산에 사용.
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_hl_material_master") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class HlMaterialMaster extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="MAT_ID") private Long matId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="BRAND",length=100) private String brand;
    @Column(name="MATERIAL_CODE",nullable=false,length=50) private String materialCode;
    @Column(name="MATERIAL_NAME",length=300) private String materialName;
    @Column(name="CONV_QTY1",precision=16,scale=4) private BigDecimal convQty1;
    @Column(name="CONV_UNIT1",length=10) private String convUnit1;
    @Column(name="BASE_QTY1",precision=16,scale=4) private BigDecimal baseQty1;
    @Column(name="BASE_UNIT1",length=10) private String baseUnit1;
    @Column(name="CONV_QTY2",precision=16,scale=4) private BigDecimal convQty2;
    @Column(name="CONV_UNIT2",length=10) private String convUnit2;
    @Column(name="BASE_QTY2",precision=16,scale=4) private BigDecimal baseQty2;
    @Column(name="BASE_UNIT2",length=10) private String baseUnit2;
    @Column(name="CONV_QTY5",precision=16,scale=4) private BigDecimal convQty5;
    @Column(name="CONV_UNIT5",length=10) private String convUnit5;
    @Column(name="BASE_QTY5",precision=16,scale=4) private BigDecimal baseQty5;
    @Column(name="BASE_UNIT5",length=10) private String baseUnit5;
    @Column(name="NET_WEIGHT",precision=16,scale=6) private BigDecimal netWeight;
    @Column(name="WEIGHT_UNIT",length=10) private String weightUnit;
    @Column(name="BASE_MACHINE",length=100) private String baseMachine;
    @Column(name="HIER1_CODE",length=50) private String hier1Code;
    @Column(name="HIER1_NAME",length=200) private String hier1Name;
    @Column(name="HIER3_CODE",length=50) private String hier3Code;
    @Column(name="HIER3_NAME",length=200) private String hier3Name;
    @Column(name="HIER_CODE",length=50) private String hierCode;
    @Column(name="HIER_NAME",length=200) private String hierName;

    @Builder
    public HlMaterialMaster(String division, String brand, String materialCode, String materialName,
                            BigDecimal convQty1, String convUnit1, BigDecimal baseQty1, String baseUnit1,
                            BigDecimal convQty2, String convUnit2, BigDecimal baseQty2, String baseUnit2,
                            BigDecimal convQty5, String convUnit5, BigDecimal baseQty5, String baseUnit5,
                            BigDecimal netWeight, String weightUnit, String baseMachine,
                            String hier1Code, String hier1Name, String hier3Code, String hier3Name, String hierCode, String hierName) {
        this.division = division; this.brand = brand; this.materialCode = materialCode; this.materialName = materialName;
        this.convQty1 = convQty1; this.convUnit1 = convUnit1; this.baseQty1 = baseQty1; this.baseUnit1 = baseUnit1;
        this.convQty2 = convQty2; this.convUnit2 = convUnit2; this.baseQty2 = baseQty2; this.baseUnit2 = baseUnit2;
        this.convQty5 = convQty5; this.convUnit5 = convUnit5; this.baseQty5 = baseQty5; this.baseUnit5 = baseUnit5;
        this.netWeight = netWeight; this.weightUnit = weightUnit; this.baseMachine = baseMachine;
        this.hier1Code = hier1Code; this.hier1Name = hier1Name; this.hier3Code = hier3Code; this.hier3Name = hier3Name;
        this.hierCode = hierCode; this.hierName = hierName;
    }

    public List<HlConversion.Conv> convs() {
        return List.of(new HlConversion.Conv(convQty1, convUnit1, baseQty1, baseUnit1),
                new HlConversion.Conv(convQty2, convUnit2, baseQty2, baseUnit2),
                new HlConversion.Conv(convQty5, convUnit5, baseQty5, baseUnit5));
    }

    /** 응답 전용 계산값 (DB 컬럼 아님) */
    public HlConversion.Weight weight() { return HlConversion.kgPerEa(netWeight, weightUnit, convs()); }
    public BigDecimal getKgPerEa() { return weight().kgPerEa(); }
    public BigDecimal getEaPerBase() { return weight().eaPerBase(); }
    public String getBaseUnit() { return HlConversion.baseUnit(convs()); }
    public String getConvText() { return HlConversion.convText(convs()); }
    public String getWeightIssue() { return weight().issue(); }
}
