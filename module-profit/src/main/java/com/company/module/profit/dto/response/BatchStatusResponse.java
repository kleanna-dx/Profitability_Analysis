package com.company.module.profit.dto.response;

import com.company.module.profit.entity.BatchStatus;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

/**
 * 배치 작업 이력 응답 DTO
 * - batch_jobs 테이블과 1:1 대응
 */
@Getter
@Builder
public class BatchStatusResponse {

    private Long id;
    private String jobType;
    private String cmonth;
    private String mode;
    private String status;
    private LocalDateTime startedAt;
    private LocalDateTime finishedAt;
    private Integer totalRows;
    private Integer insertedRows;
    private Integer deletedRows;
    private String errorMessage;
    private String logText;
    private String createdBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /** 실행 시간 (초) — Node.js elapsed_sec와 동일 */
    private Long elapsedSec;

    public static BatchStatusResponse from(BatchStatus entity) {
        Long elapsed = null;
        if (entity.getStartedAt() != null) {
            LocalDateTime end = entity.getFinishedAt() != null
                    ? entity.getFinishedAt() : LocalDateTime.now();
            elapsed = java.time.Duration.between(entity.getStartedAt(), end).getSeconds();
        }

        return BatchStatusResponse.builder()
                .id(entity.getId())
                .jobType(entity.getJobType())
                .cmonth(entity.getCmonth())
                .mode(entity.getMode())
                .status(entity.getStatus())
                .startedAt(entity.getStartedAt())
                .finishedAt(entity.getFinishedAt())
                .totalRows(entity.getTotalRows())
                .insertedRows(entity.getInsertedRows())
                .deletedRows(entity.getDeletedRows())
                .errorMessage(entity.getErrorMessage())
                .logText(entity.getLogText())
                .createdBy(entity.getCreatedBy())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .elapsedSec(elapsed)
                .build();
    }

    // ── Node.js 폴링 호환용 alias getter ──

    /** Node.js가 batchId로 참조 */
    public Long getBatchId() {
        return this.id;
    }

    /** Node.js가 processedRows로 참조 */
    public Integer getProcessedRows() {
        return this.insertedRows;
    }

    /** Node.js가 errorRows로 참조 (batch_jobs에는 없으므로 항상 0) */
    public Integer getErrorRows() {
        return 0;
    }
}
