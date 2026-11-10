package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;

/** 판매 지종 (사업부별) — 사업부 × 제품유형 × 지종. PROD_PRODUCT = 연결되는 생산 지종 (상품 등은 비움) */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_sales_grade") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class SalesGrade extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="GRADE_ID") private Long gradeId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="PRODUCT_TYPE",nullable=false,length=100) private String productType;
    @Column(name="GRADE_NAME",nullable=false,length=100) private String gradeName;
    @Column(name="PROD_PRODUCT",length=100) private String prodProduct;
    @Column(name="SORT_ORDER") private Integer sortOrder;
    @Column(name="USE_YN",nullable=false,length=1) private String useYn;
    @Column(name="MEMO",length=500) private String memo;

    @Builder
    public SalesGrade(String division, String productType, String gradeName, String prodProduct, Integer sortOrder, String useYn, String memo) {
        this.division = division; this.productType = productType; this.gradeName = gradeName; this.prodProduct = prodProduct;
        this.sortOrder = sortOrder; this.useYn = "N".equals(useYn) ? "N" : "Y"; this.memo = memo;
    }
}
