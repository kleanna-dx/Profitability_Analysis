package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * HL 판매계획 (SKU별) — 년월 × 영업팀 × 거래처 × 자재코드 = BOX 수량 · BOX당 단가(장려금 제외)
 * 순매출 = BOX 수량 × BOX당 단가 (서버 계산, 직접 입력 안 받음)
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_hl_sales_plan") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class HlSalesPlan extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PLAN_ID") private Long planId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="SALES_TEAM",nullable=false,length=100) private String salesTeam;
    @Column(name="CUSTOMER_CODE",nullable=false,length=30) private String customerCode;
    @Column(name="CUSTOMER_NAME",length=200) private String customerName;
    @Column(name="CATEGORY",length=100) private String category;
    @Column(name="MATERIAL_CODE",nullable=false,length=50) private String materialCode;
    @Column(name="BOX_QTY",nullable=false,precision=14,scale=2) private BigDecimal boxQty;
    @Column(name="BOX_PRICE",nullable=false,precision=14,scale=2) private BigDecimal boxPrice;
    @Column(name="NET_SALES",nullable=false,precision=18,scale=2) private BigDecimal netSales;
    @Column(name="NOTE",length=500) private String note;

    @Builder
    public HlSalesPlan(String ym, String salesTeam, String customerCode, String customerName, String category,
                       String materialCode, BigDecimal boxQty, BigDecimal boxPrice, String note) {
        this.ym = ym; this.salesTeam = salesTeam; this.customerCode = customerCode; this.materialCode = materialCode;
        change(customerName, category, boxQty, boxPrice, note);
    }

    /** 키(년월·영업팀·거래처코드·자재코드)를 뺀 값만 바꿈. 순매출은 다시 계산 */
    public void change(String customerName, String category, BigDecimal boxQty, BigDecimal boxPrice, String note) {
        this.customerName = customerName; this.category = category;
        this.boxQty = boxQty; this.boxPrice = boxPrice; this.note = note;
        this.netSales = netSales(boxQty, boxPrice);
    }

    public static BigDecimal netSales(BigDecimal qty, BigDecimal price) {
        if (qty == null || price == null) return BigDecimal.ZERO;
        return qty.multiply(price).setScale(2, java.math.RoundingMode.HALF_UP);
    }
}
