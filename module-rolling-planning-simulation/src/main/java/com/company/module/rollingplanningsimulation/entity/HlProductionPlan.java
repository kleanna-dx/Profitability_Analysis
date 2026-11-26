package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * HL 생산계획 — 현업이 년월 전체를 입력·업로드 후 확정.
 * 년월 × 생산 호기 × 자재코드 = 월 생산량(EA)
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_hl_production_plan") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class HlProductionPlan extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PROD_ID") private Long prodId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="CATEGORY",length=100) private String category;
    @Column(name="MACHINE",nullable=false,length=50) private String machine;
    @Column(name="PROD_TYPE",length=100) private String prodType;
    @Column(name="MATERIAL_CODE",nullable=false,length=50) private String materialCode;
    @Column(name="MATERIAL_NAME",length=200) private String materialName;
    @Column(name="QTY_EA",nullable=false,precision=16,scale=2) private BigDecimal qtyEa;
    @Column(name="NOTE",length=500) private String note;

    @Builder
    public HlProductionPlan(String ym, String category, String machine, String prodType, String materialCode,
                            String materialName, BigDecimal qtyEa, String note) {
        this.ym = ym; this.machine = machine; this.materialCode = materialCode;
        change(category, prodType, materialName, qtyEa, note);
    }

    /** 키(년월·생산 호기·자재코드)를 뺀 값만 바꿈 */
    public void change(String category, String prodType, String materialName, BigDecimal qtyEa, String note) {
        this.category = category; this.prodType = prodType; this.materialName = materialName;
        this.qtyEa = qtyEa != null ? qtyEa : BigDecimal.ZERO; this.note = note;
    }
}
