package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 월별 적용 환율 엔티티
 * - 연도/월/사업부/통화별 환율(원/통화)
 */
@Entity
@Table(name = "rpsim_logi_exchange_rate")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LogiExchangeRate {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "EXCHANGE_ID")
    private Long exchangeId;

    @Column(name = "YEAR", nullable = false)
    private Integer year;

    @Column(name = "MONTH", nullable = false)
    private Integer month;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "CURRENCY", nullable = false, length = 10)
    private String currency;

    @Column(name = "RATE", nullable = false, precision = 12, scale = 4)
    private BigDecimal rate;

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
        if (this.currency == null) this.currency = "USD";
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public LogiExchangeRate(Integer year, Integer month, String division,
                            String currency, BigDecimal rate, String memo) {
        this.year = year;
        this.month = month;
        this.division = division != null ? division : "PS";
        this.currency = currency != null ? currency : "USD";
        this.rate = rate != null ? rate : new BigDecimal("1350");
        this.memo = memo;
    }

    public void update(BigDecimal rate, String memo) {
        this.rate = rate;
        this.memo = memo;
    }
}
