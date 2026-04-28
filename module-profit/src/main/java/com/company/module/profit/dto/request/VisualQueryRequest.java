package com.company.module.profit.dto.request;

import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

/**
 * 비주얼 쿼리 빌더 요청 DTO
 * - 드래그앤드롭으로 필드를 선택하고, 조건을 설정하여 데이터 조회
 */
@Getter
@Setter
public class VisualQueryRequest {

    private List<String> selectColumns;

    private List<FilterCondition> filterConditions;

    @Size(max = 2000)
    private String additionalPrompt;

    private String sortColumn;

    private String sortDirection = "DESC";

    private Integer maxRows = 1000;

    @Getter
    @Setter
    public static class FilterCondition {
        private String columnName;
        private String operator;
        private String value;
        private String logicalOperator = "AND";
    }
}
