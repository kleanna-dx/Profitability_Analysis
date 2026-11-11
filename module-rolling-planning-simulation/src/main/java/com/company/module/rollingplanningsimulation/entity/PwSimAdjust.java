package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * 생산량 기반 전력비 — 기타 가산·차감 (사업부 × 월, 현업 입력값 그대로 · 세금 계산 없음 · 호기 배부 없음)
 * DIRECTION: ADD / DEDUCT, AMOUNT_KRW &gt;= 0, CATEGORY: BASE_FEE / ESS / SETTLEMENT / OTHER (단가 산정범위와 중복 확인용)
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_pw_sim_adjust") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PwSimAdjust extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="ADJUST_ID") private Long adjustId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="ITEM_NAME",nullable=false,length=200) private String itemName;
    @Column(name="DIRECTION",nullable=false,length=10) private String direction;
    @Column(name="AMOUNT_KRW",nullable=false,precision=18,scale=0) private BigDecimal amountKrw;
    @Column(name="CATEGORY",nullable=false,length=20) private String category;
    @Column(name="VAT_INCLUDED_YN",nullable=false,length=1) private String vatIncludedYn;
    @Column(name="MEMO",nullable=false,length=1000) private String memo;

    @Builder
    public PwSimAdjust(String division, String ym, String itemName, String direction, BigDecimal amountKrw, String category,
                       String vatIncludedYn, String memo) {
        this.division = division; this.ym = ym; this.itemName = itemName; this.direction = direction; this.amountKrw = amountKrw;
        this.category = category; this.vatIncludedYn = vatIncludedYn; this.memo = memo;
    }
}
