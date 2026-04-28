package com.company.module.profit.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class MetricSaveRequest {

    @NotBlank(message = "Metric 코드는 필수입니다")
    @Size(max = 100, message = "Metric 코드는 100자 이하입니다")
    private String metricCode;

    @NotBlank(message = "Metric 이름은 필수입니다")
    @Size(max = 200, message = "Metric 이름은 200자 이하입니다")
    private String metricName;

    @NotBlank(message = "집계 방식은 필수입니다")
    @Size(max = 20, message = "집계 방식은 20자 이하입니다")
    private String aggregation;

    @NotBlank(message = "계산식은 필수입니다")
    @Size(max = 2000, message = "계산식은 2000자 이하입니다")
    private String formula;

    @NotBlank(message = "테이블명은 필수입니다")
    @Size(max = 200, message = "테이블명은 200자 이하입니다")
    private String tableName;

    @Size(max = 1000)
    private String description;

    @Size(max = 50)
    private String displayFormat;

    @Size(max = 50)
    private String unit;

    private Integer sortOrder;

    private Boolean isActive = true;

    @Valid
    private List<MetricSynonymRequest> synonyms;

    @Getter
    @Setter
    public static class MetricSynonymRequest {
        @NotBlank(message = "동의어 텍스트는 필수입니다")
        @Size(max = 200, message = "동의어 텍스트는 200자 이하입니다")
        private String synonymText;

        @Size(max = 50)
        private String synonymSource;

        private Boolean isActive = true;
    }
}
