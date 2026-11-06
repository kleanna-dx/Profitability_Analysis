package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;

/** 구매 지급통화 마스터 (전사 공통) — BASE_YN='Y' 이면 환율 없이 원/톤 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_purchase_currency") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PurchaseCurrency extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="CURRENCY_ID") private Long currencyId;
    @Column(name="CURRENCY_CODE",nullable=false,length=10) private String currencyCode;
    @Column(name="CURRENCY_NAME",length=50) private String currencyName;
    @Column(name="BASE_YN",nullable=false,length=1) private String baseYn;
    @Column(name="SORT_ORDER") private Integer sortOrder;
    @Column(name="USE_YN",nullable=false,length=1) private String useYn;

    @Builder
    public PurchaseCurrency(String currencyCode, String currencyName, String baseYn, Integer sortOrder, String useYn) {
        this.currencyCode = currencyCode; this.currencyName = currencyName;
        this.baseYn = "Y".equals(baseYn) ? "Y" : "N"; this.sortOrder = sortOrder;
        this.useYn = "N".equals(useYn) ? "N" : "Y";
    }
}
