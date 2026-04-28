package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 배치 상태 엔티티
 * - SAP 마감 → BW DB DATA 생성 배치의 실행 상태를 추적
 * - 데이터 검증/정합성 체크 결과를 기록
 * - Staging Table 적재 이력 관리
 */
@Entity
@Table(name = "profit_batch_status")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BatchStatus {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "BATCH_ID")
    private Long batchId;

    @Column(name = "BATCH_NAME", nullable = false, length = 200)
    private String batchName;

    @Column(name = "BATCH_TYPE", nullable = false, length = 50)
    private String batchType;

    @Column(name = "SOURCE_SYSTEM", length = 100)
    private String sourceSystem;

    @Column(name = "TARGET_TABLE", length = 200)
    private String targetTable;

    @Column(name = "STATUS", nullable = false, length = 20)
    private String status;

    @Column(name = "TOTAL_ROWS")
    private Long totalRows;

    @Column(name = "PROCESSED_ROWS")
    private Long processedRows;

    @Column(name = "ERROR_ROWS")
    private Long errorRows;

    @Column(name = "PERIOD_YEAR")
    private Integer periodYear;

    @Column(name = "PERIOD_MONTH")
    private Integer periodMonth;

    @Column(name = "ERROR_MESSAGE", columnDefinition = "TEXT")
    private String errorMessage;

    @Column(name = "STARTED_AT")
    private LocalDateTime startedAt;

    @Column(name = "COMPLETED_AT")
    private LocalDateTime completedAt;

    @Column(name = "EXECUTION_TIME_MS")
    private Long executionTimeMs;

    @Column(name = "CREATED_BY", length = 50)
    private String createdBy;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.status == null) {
            this.status = "PENDING";
        }
    }

    @Builder
    public BatchStatus(String batchName, String batchType, String sourceSystem,
                       String targetTable, String status, Long totalRows,
                       Integer periodYear, Integer periodMonth, String createdBy) {
        this.batchName = batchName;
        this.batchType = batchType;
        this.sourceSystem = sourceSystem;
        this.targetTable = targetTable;
        this.status = status != null ? status : "PENDING";
        this.totalRows = totalRows;
        this.periodYear = periodYear;
        this.periodMonth = periodMonth;
        this.createdBy = createdBy;
        this.processedRows = 0L;
        this.errorRows = 0L;
    }

    public void start() {
        this.status = "RUNNING";
        this.startedAt = LocalDateTime.now();
    }

    public void complete(Long processedRows, Long errorRows) {
        this.status = errorRows > 0 ? "COMPLETED_WITH_ERRORS" : "COMPLETED";
        this.processedRows = processedRows;
        this.errorRows = errorRows;
        this.completedAt = LocalDateTime.now();
        if (this.startedAt != null) {
            this.executionTimeMs = java.time.Duration.between(this.startedAt, this.completedAt).toMillis();
        }
    }

    public void fail(String errorMessage) {
        this.status = "FAILED";
        this.errorMessage = errorMessage;
        this.completedAt = LocalDateTime.now();
        if (this.startedAt != null) {
            this.executionTimeMs = java.time.Duration.between(this.startedAt, this.completedAt).toMillis();
        }
    }
}
