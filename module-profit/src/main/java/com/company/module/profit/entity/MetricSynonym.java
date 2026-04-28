package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Metric 동의어 엔티티
 * - Metric에 대한 자연어 동의어 매핑 (예: NETSALES → 순매출, 매출액)
 * - 사용자가 "순매출"이라고 입력하면 NETSALES Metric으로 매핑
 */
@Entity
@Table(name = "profit_metric_synonym")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MetricSynonym {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "METRIC_SYNONYM_ID")
    private Long metricSynonymId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "METRIC_ID", nullable = false)
    private Metric metric;

    @Column(name = "SYNONYM_TEXT", nullable = false, length = 200)
    private String synonymText;

    @Column(name = "SYNONYM_SOURCE", length = 50)
    private String synonymSource;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.isActive == null) {
            this.isActive = true;
        }
    }

    @Builder
    public MetricSynonym(Metric metric, String synonymText,
                         String synonymSource, Boolean isActive) {
        this.metric = metric;
        this.synonymText = synonymText;
        this.synonymSource = synonymSource;
        this.isActive = isActive != null ? isActive : true;
    }

    public void assignMetric(Metric metric) {
        this.metric = metric;
    }

    public void update(String synonymText, String synonymSource, Boolean isActive) {
        this.synonymText = synonymText;
        this.synonymSource = synonymSource;
        this.isActive = isActive;
    }
}
