package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** 판매계획 — 버전 × 년월 × 판매구분 × 제품유형 × 지종 = 판매량(톤) */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_sales_plan") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class SalesPlan extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PLAN_ID") private Long planId;
    @Column(name="VERSION_ID",nullable=false) private Long versionId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="SALES_TYPE",nullable=false,length=100) private String salesType;
    @Column(name="PRODUCT_TYPE",nullable=false,length=100) private String productType;
    @Column(name="GRADE_NAME",nullable=false,length=100) private String gradeName;
    @Column(name="QTY_TON",nullable=false,precision=14,scale=3) private BigDecimal qtyTon;
    @Column(name="NOTE",length=500) private String note;
    @Column(name="EXCEL_ROW_NO") private Integer excelRowNo;

    @Builder
    public SalesPlan(Long versionId, String ym, String division, String salesType, String productType, String gradeName,
                     BigDecimal qtyTon, String note, Integer excelRowNo) {
        this.versionId = versionId; this.ym = ym; this.division = division; this.salesType = salesType;
        this.productType = productType; this.gradeName = gradeName; this.qtyTon = qtyTon; this.note = note; this.excelRowNo = excelRowNo;
    }
}
