package com.company.module.profit.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

/**
 * 비주얼 쿼리 빌더 - 필드 목록 응답 DTO
 * - 좌측 필드 패널에 카테고리별로 그룹핑된 필드 목록 제공
 */
@Getter
@Builder
public class FieldListResponse {

    private List<FieldGroup> fieldGroups;
    private List<MetricField> metricFields;

    @Getter
    @Builder
    public static class FieldGroup {
        private String groupName;
        private int fieldCount;
        private List<FieldItem> fields;
    }

    @Getter
    @Builder
    public static class FieldItem {
        private Long ontologyColumnId;
        private String columnName;
        private String displayName;
        private String tableName;
        private String dataType;
        private String columnGroup;
    }

    @Getter
    @Builder
    public static class MetricField {
        private Long metricId;
        private String metricCode;
        private String metricName;
        private String aggregation;
        private String formula;
        private String tableName;
        private String unit;
    }
}
