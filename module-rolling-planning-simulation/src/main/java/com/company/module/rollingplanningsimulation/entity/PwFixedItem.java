package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 전력비 고정층 항목 (환급/지급)
 * - 부호 규칙: 지출 +, 환급/차감 −
 * - ITEM_CODE: DR_REFUND, LOAD_CUT, BOILER_DEDUCT, ESS_PAYMENT, POWER_FIXED
 */
@Entity
@Table(name = "rpsim_pw_fixed_item")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwFixedItem {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "FIXED_ITEM_ID")
    private Long fixedItemId;

    @Column(name = "YM", nullable = false, length = 6)
    private String ym;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "ITEM_CODE", nullable = false, length = 30)
    private String itemCode;

    @Column(name = "ITEM_NAME", nullable = false, length = 100)
    private String itemName;

    @Column(name = "AMOUNT_KRW", nullable = false, precision = 18, scale = 2)
    private BigDecimal amountKrw;

    @Column(name = "CALC_FORMULA", length = 500)
    private String calcFormula;

    @Column(name = "MEMO", length = 500)
    private String memo;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.division == null) this.division = "PS";
    }

    @PreUpdate
    protected void onUpdate() { this.updatedAt = LocalDateTime.now(); }

    @Builder
    public PwFixedItem(String ym, String division, String itemCode, String itemName,
                       BigDecimal amountKrw, String calcFormula, String memo) {
        this.ym = ym;
        this.division = division != null ? division : "PS";
        this.itemCode = itemCode;
        this.itemName = itemName;
        this.amountKrw = amountKrw != null ? amountKrw : BigDecimal.ZERO;
        this.calcFormula = calcFormula;
        this.memo = memo;
    }

    public void update(String itemName, BigDecimal amountKrw, String calcFormula, String memo) {
        this.itemName = itemName;
        this.amountKrw = amountKrw;
        this.calcFormula = calcFormula;
        this.memo = memo;
    }
}
