package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** 구매 이동계획 환율 (월별, 전사 공통) — 물류 환율(rpsim_logi_exchange_rate)과 별도 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_purchase_exchange_rate") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PurchaseExchangeRate extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="RATE_ID") private Long rateId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="CURRENCY_CODE",nullable=false,length=10) private String currencyCode;
    @Column(name="RATE",nullable=false,precision=14,scale=4) private BigDecimal rate;
    @Column(name="MEMO",length=500) private String memo;

    @Builder
    public PurchaseExchangeRate(String ym, String currencyCode, BigDecimal rate, String memo) {
        this.ym = ym; this.currencyCode = currencyCode; this.rate = rate; this.memo = memo;
    }
}
