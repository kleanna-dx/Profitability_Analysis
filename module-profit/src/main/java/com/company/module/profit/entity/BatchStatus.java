package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 배치 작업 이력 엔티티
 * - Node.js nlq-server와 동일한 batch_jobs 테이블 사용
 * - SAP RFC 동기화 배치의 실행 상태를 추적
 *
 * <p>상태값 (Node.js ENUM과 동일):</p>
 * <ul>
 *   <li>pending  — 작업 대기</li>
 *   <li>running  — 실행 중</li>
 *   <li>success  — 성공</li>
 *   <li>failed   — 실패</li>
 *   <li>cancelled — 취소</li>
 * </ul>
 */
@Entity
@Table(name = "batch_jobs")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class BatchStatus {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "id")
    private Long id;

    /** 작업유형 (SAP_RFC_SYNC 등) */
    @Column(name = "job_type", nullable = false, length = 50)
    private String jobType;

    /** 입력년월 YYYYMM */
    @Column(name = "cmonth", nullable = false, length = 6)
    private String cmonth;

    /** 실행모드: replace / append / dry-run */
    @Column(name = "mode", nullable = false, length = 20)
    private String mode;

    /** 상태: pending, running, success, failed, cancelled */
    @Column(name = "status", nullable = false, length = 20)
    private String status;

    @Column(name = "started_at")
    private LocalDateTime startedAt;

    @Column(name = "finished_at")
    private LocalDateTime finishedAt;

    /** T_DATA 수신 행 수 */
    @Column(name = "total_rows")
    private Integer totalRows;

    /** DB INSERT 행 수 */
    @Column(name = "inserted_rows")
    private Integer insertedRows;

    /** DELETE한 기존 행 수 */
    @Column(name = "deleted_rows")
    private Integer deletedRows;

    @Column(name = "error_message", columnDefinition = "TEXT")
    private String errorMessage;

    /** 실행 로그 */
    @Column(name = "log_text", columnDefinition = "LONGTEXT")
    private String logText;

    @Column(name = "created_by", length = 50)
    private String createdBy;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.status == null) {
            this.status = "pending";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public BatchStatus(String jobType, String cmonth, String mode,
                       String status, String createdBy) {
        this.jobType = jobType != null ? jobType : "SAP_RFC_SYNC";
        this.cmonth = cmonth;
        this.mode = mode != null ? mode : "replace";
        this.status = status != null ? status : "pending";
        this.createdBy = createdBy;
        this.totalRows = 0;
        this.insertedRows = 0;
        this.deletedRows = 0;
    }

    // ── 상태 전이 메서드 ──

    public void start() {
        this.status = "running";
        this.startedAt = LocalDateTime.now();
    }

    public void complete(int totalRows, int insertedRows, int deletedRows) {
        this.status = "success";
        this.totalRows = totalRows;
        this.insertedRows = insertedRows;
        this.deletedRows = deletedRows;
        this.finishedAt = LocalDateTime.now();
    }

    public void fail(String errorMessage) {
        this.status = "failed";
        this.errorMessage = errorMessage;
        this.finishedAt = LocalDateTime.now();
    }

    public void cancel() {
        this.status = "cancelled";
        this.finishedAt = LocalDateTime.now();
    }

    public void appendLog(String log) {
        if (this.logText == null) {
            this.logText = log;
        } else {
            this.logText += "\n" + log;
        }
    }

    // ── 하위호환용 getter (기존 코드 대응) ──

    /** 기존 batchId → id */
    public Long getBatchId() {
        return this.id;
    }

    /** 기존 batchType → jobType */
    public String getBatchType() {
        return this.jobType;
    }

    /** 기존 processedRows → insertedRows */
    public Integer getProcessedRows() {
        return this.insertedRows;
    }

    /** 실행 시간 (ms) 계산 */
    public Long getExecutionTimeMs() {
        if (this.startedAt != null && this.finishedAt != null) {
            return java.time.Duration.between(this.startedAt, this.finishedAt).toMillis();
        }
        return null;
    }
}
