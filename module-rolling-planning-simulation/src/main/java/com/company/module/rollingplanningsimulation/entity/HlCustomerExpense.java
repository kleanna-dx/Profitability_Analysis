package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** HL 거래처별 장려금(판매처에 꼭 내는 금액)·마케팅비 — 년월 × 영업팀 × 거래처 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_hl_customer_expense") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class HlCustomerExpense extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="EXPENSE_ID") private Long expenseId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="SALES_TEAM",nullable=false,length=100) private String salesTeam;
    @Column(name="CUSTOMER_CODE",nullable=false,length=30) private String customerCode;
    @Column(name="CUSTOMER_NAME",length=200) private String customerName;
    @Column(name="INCENTIVE_AMT",nullable=false,precision=18,scale=2) private BigDecimal incentiveAmt;
    @Column(name="MARKETING_AMT",nullable=false,precision=18,scale=2) private BigDecimal marketingAmt;
    @Column(name="NOTE",length=500) private String note;

    @Builder
    public HlCustomerExpense(String ym, String salesTeam, String customerCode, String customerName,
                             BigDecimal incentiveAmt, BigDecimal marketingAmt, String note) {
        this.ym = ym; this.salesTeam = salesTeam; this.customerCode = customerCode;
        change(customerName, incentiveAmt, marketingAmt, note);
    }

    /** 키(년월·영업팀·거래처코드)를 뺀 값만 바꿈 */
    public void change(String customerName, BigDecimal incentiveAmt, BigDecimal marketingAmt, String note) {
        this.customerName = customerName;
        this.incentiveAmt = incentiveAmt != null ? incentiveAmt : BigDecimal.ZERO;
        this.marketingAmt = marketingAmt != null ? marketingAmt : BigDecimal.ZERO;
        this.note = note;
    }
}
