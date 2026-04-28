package com.company.module.profit.dto.response;

import com.company.module.profit.entity.Metric;
import com.company.module.profit.entity.MetricSynonym;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Getter
@Builder
public class MetricResponse {

    private Long metricId;
    private String metricCode;
    private String metricName;
    private String aggregation;
    private String formula;
    private String tableName;
    private String description;
    private String displayFormat;
    private String unit;
    private Integer sortOrder;
    private Boolean isActive;
    private String createdBy;
    private String updatedBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private List<MetricSynonymResponse> synonyms;

    @Getter
    @Builder
    public static class MetricSynonymResponse {
        private Long metricSynonymId;
        private String synonymText;
        private String synonymSource;
        private Boolean isActive;
        private LocalDateTime createdAt;

        public static MetricSynonymResponse from(MetricSynonym synonym) {
            return MetricSynonymResponse.builder()
                    .metricSynonymId(synonym.getMetricSynonymId())
                    .synonymText(synonym.getSynonymText())
                    .synonymSource(synonym.getSynonymSource())
                    .isActive(synonym.getIsActive())
                    .createdAt(synonym.getCreatedAt())
                    .build();
        }
    }

    public static MetricResponse from(Metric entity) {
        return MetricResponse.builder()
                .metricId(entity.getMetricId())
                .metricCode(entity.getMetricCode())
                .metricName(entity.getMetricName())
                .aggregation(entity.getAggregation())
                .formula(entity.getFormula())
                .tableName(entity.getTableName())
                .description(entity.getDescription())
                .displayFormat(entity.getDisplayFormat())
                .unit(entity.getUnit())
                .sortOrder(entity.getSortOrder())
                .isActive(entity.getIsActive())
                .createdBy(entity.getCreatedBy())
                .updatedBy(entity.getUpdatedBy())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .synonyms(entity.getSynonyms() != null
                        ? entity.getSynonyms().stream()
                            .map(MetricSynonymResponse::from)
                            .collect(Collectors.toList())
                        : List.of())
                .build();
    }
}
