package com.company.module.profit.dto.response;

import com.company.module.profit.entity.JoinCondition;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Builder
public class JoinConditionResponse {

    private Long joinConditionId;
    private String joinName;
    private String leftColumn;
    private String leftTable;
    private String rightColumn;
    private String rightTable;
    private String joinType;
    private String operator;
    private Integer sortOrder;
    private Boolean isActive;
    private String createdBy;
    private String updatedBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public static JoinConditionResponse from(JoinCondition entity) {
        return JoinConditionResponse.builder()
                .joinConditionId(entity.getJoinConditionId())
                .joinName(entity.getJoinName())
                .leftColumn(entity.getLeftColumn())
                .leftTable(entity.getLeftTable())
                .rightColumn(entity.getRightColumn())
                .rightTable(entity.getRightTable())
                .joinType(entity.getJoinType())
                .operator(entity.getOperator())
                .sortOrder(entity.getSortOrder())
                .isActive(entity.getIsActive())
                .createdBy(entity.getCreatedBy())
                .updatedBy(entity.getUpdatedBy())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }
}
