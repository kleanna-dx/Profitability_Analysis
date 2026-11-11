package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** 생산량 기반 전력비 — 월별 적용 평균 전력단가 (사업부 × 월) + 산정범위 (Y/N 필수, 설명 필수) */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_pw_sim_price") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PwSimPrice extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PRICE_ID") private Long priceId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="PRICE_KRW_PER_KWH",nullable=false,precision=20,scale=10) private BigDecimal priceKrwPerKwh;
    @Column(name="VAT_INCLUDED_YN",nullable=false,length=1) private String vatIncludedYn;
    @Column(name="BASE_FEE_INCLUDED_YN",nullable=false,length=1) private String baseFeeIncludedYn;
    @Column(name="ESS_INCLUDED_YN",nullable=false,length=1) private String essIncludedYn;
    @Column(name="SETTLEMENT_INCLUDED_YN",nullable=false,length=1) private String settlementIncludedYn;
    @Column(name="SCOPE_DESC",nullable=false,length=1000) private String scopeDesc;
    @Column(name="MEMO",length=1000) private String memo;

    @Builder
    public PwSimPrice(String division, String ym, BigDecimal priceKrwPerKwh, String vatIncludedYn, String baseFeeIncludedYn,
                      String essIncludedYn, String settlementIncludedYn, String scopeDesc, String memo) {
        this.division = division; this.ym = ym; this.priceKrwPerKwh = priceKrwPerKwh; this.vatIncludedYn = vatIncludedYn;
        this.baseFeeIncludedYn = baseFeeIncludedYn; this.essIncludedYn = essIncludedYn; this.settlementIncludedYn = settlementIncludedYn;
        this.scopeDesc = scopeDesc; this.memo = memo;
    }
}
