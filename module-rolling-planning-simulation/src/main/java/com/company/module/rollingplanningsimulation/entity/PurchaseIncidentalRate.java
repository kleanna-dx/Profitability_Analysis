package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** 구매 펄프 부대비율 (연도 × 자재, 1년 동일값, 전사 공통) */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_purchase_incidental_rate") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PurchaseIncidentalRate extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="INCIDENTAL_ID") private Long incidentalId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MATERIAL_CODE",nullable=false,length=18) private String materialCode;
    @Column(name="MATERIAL_NAME",length=100) private String materialName;
    @Column(name="RATE",nullable=false,precision=8,scale=4) private BigDecimal rate;
    @Column(name="MEMO",length=500) private String memo;

    @Builder
    public PurchaseIncidentalRate(Integer year, String materialCode, String materialName, BigDecimal rate, String memo) {
        this.year = year; this.materialCode = materialCode; this.materialName = materialName; this.rate = rate; this.memo = memo;
    }
}
