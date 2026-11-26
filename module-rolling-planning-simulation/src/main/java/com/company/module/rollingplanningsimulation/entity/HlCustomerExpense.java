package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** HL 거래처별 장려금·마케팅비 — 기획팀이 년월 전체를 올림 (영업팀 구분 없음). 년월 × 거래처 = 1행 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_hl_customer_expense") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class HlCustomerExpense extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="EXPENSE_ID") private Long expenseId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="CUSTOMER_CODE",nullable=false,length=30) private String customerCode;
    @Column(name="CUSTOMER_NAME",length=200) private String customerName;
    @Column(name="INCENTIVE_AMT",nullable=false,precision=18,scale=2) private BigDecimal incentiveAmt;
    @Column(name="MARKETING_AMT",nullable=false,precision=18,scale=2) private BigDecimal marketingAmt;
    @Column(name="NOTE",length=500) private String note;

    @Builder
    public HlCustomerExpense(String ym, String customerCode, String customerName,
                             BigDecimal incentiveAmt, BigDecimal marketingAmt, String note) {
        this.ym = ym; this.customerCode = customerCode;
        change(customerName, incentiveAmt, marketingAmt, note);
    }

    /** 키(년월·거래처코드)를 뺀 값만 바꿈 */
    public void change(String customerName, BigDecimal incentiveAmt, BigDecimal marketingAmt, String note) {
        this.customerName = customerName;
        this.incentiveAmt = incentiveAmt != null ? incentiveAmt : BigDecimal.ZERO;
        this.marketingAmt = marketingAmt != null ? marketingAmt : BigDecimal.ZERO;
        this.note = note;
    }
}
