package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Metric(계산 지표) 엔티티
 * - 수익성분석에 사용되는 계산식(수식)을 정의
 * - AI가 공식을 창작하지 않고, 이 사전에 등록된 수식만 사용
 * - SQL 생성 시 SELECT, FROM, GROUP BY 절에 반영
 */
@Entity
@Table(name = "profit_metric")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Metric {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "METRIC_ID")
    private Long metricId;

    @Column(name = "METRIC_CODE", nullable = false, length = 100, unique = true)
    private String metricCode;

    @Column(name = "METRIC_NAME", nullable = false, length = 200)
    private String metricName;

    @Column(name = "AGGREGATION", nullable = false, length = 20)
    private String aggregation;

    @Column(name = "FORMULA", nullable = false, length = 2000)
    private String formula;

    @Column(name = "TABLE_NAME", nullable = false, length = 200)
    private String tableName;

    @Column(name = "DESCRIPTION", length = 1000)
    private String description;

    @Column(name = "DISPLAY_FORMAT", length = 50)
    private String displayFormat;

    @Column(name = "UNIT", length = 50)
    private String unit;

    @Column(name = "SORT_ORDER")
    private Integer sortOrder;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;

    @Column(name = "CREATED_BY", length = 50)
    private String createdBy;

    @Column(name = "UPDATED_BY", length = 50)
    private String updatedBy;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @OneToMany(mappedBy = "metric", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<MetricSynonym> synonyms = new ArrayList<>();

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.isActive == null) {
            this.isActive = true;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public Metric(String metricCode, String metricName, String aggregation,
                  String formula, String tableName, String description,
                  String displayFormat, String unit, Integer sortOrder,
                  Boolean isActive, String createdBy) {
        this.metricCode = metricCode;
        this.metricName = metricName;
        this.aggregation = aggregation;
        this.formula = formula;
        this.tableName = tableName;
        this.description = description;
        this.displayFormat = displayFormat;
        this.unit = unit;
        this.sortOrder = sortOrder;
        this.isActive = isActive != null ? isActive : true;
        this.createdBy = createdBy;
    }

    public void update(String metricCode, String metricName, String aggregation,
                       String formula, String tableName, String description,
                       String displayFormat, String unit, Integer sortOrder,
                       Boolean isActive, String updatedBy) {
        this.metricCode = metricCode;
        this.metricName = metricName;
        this.aggregation = aggregation;
        this.formula = formula;
        this.tableName = tableName;
        this.description = description;
        this.displayFormat = displayFormat;
        this.unit = unit;
        this.sortOrder = sortOrder;
        this.isActive = isActive;
        this.updatedBy = updatedBy;
    }

    public void addSynonym(MetricSynonym synonym) {
        this.synonyms.add(synonym);
        synonym.assignMetric(this);
    }

    public void removeSynonym(MetricSynonym synonym) {
        this.synonyms.remove(synonym);
        synonym.assignMetric(null);
    }
}
