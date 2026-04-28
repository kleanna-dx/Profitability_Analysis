package com.company.module.profit.dto.response;

import com.company.module.profit.entity.BatchStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Builder
public class BatchStatusResponse {

    private Long batchId;
    private String batchName;
    private String batchType;
    private String sourceSystem;
    private String targetTable;
    private String status;
    private Long totalRows;
    private Long processedRows;
    private Long errorRows;
    private Integer periodYear;
    private Integer periodMonth;
    private String errorMessage;
    private LocalDateTime startedAt;
    private LocalDateTime completedAt;
    private Long executionTimeMs;
    private String createdBy;
    private LocalDateTime createdAt;

    public static BatchStatusResponse from(BatchStatus entity) {
        return BatchStatusResponse.builder()
                .batchId(entity.getBatchId())
                .batchName(entity.getBatchName())
                .batchType(entity.getBatchType())
                .sourceSystem(entity.getSourceSystem())
                .targetTable(entity.getTargetTable())
                .status(entity.getStatus())
                .totalRows(entity.getTotalRows())
                .processedRows(entity.getProcessedRows())
                .errorRows(entity.getErrorRows())
                .periodYear(entity.getPeriodYear())
                .periodMonth(entity.getPeriodMonth())
                .errorMessage(entity.getErrorMessage())
                .startedAt(entity.getStartedAt())
                .completedAt(entity.getCompletedAt())
                .executionTimeMs(entity.getExecutionTimeMs())
                .createdBy(entity.getCreatedBy())
                .createdAt(entity.getCreatedAt())
                .build();
    }
}
