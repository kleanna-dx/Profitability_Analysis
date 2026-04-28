package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 매핑 인박스 엔티티
 * - 자연어 질의 중 매핑되지 않은 표현을 수집
 * - 관리자가 검수하여 Ontology/Metric 사전을 개선
 * - 미매핑 표현 → 승인 → 사전 반영 흐름
 */
@Entity
@Table(name = "profit_mapping_inbox")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class MappingInbox {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "INBOX_ID")
    private Long inboxId;

    @Column(name = "UNMAPPED_TERM", nullable = false, length = 300)
    private String unmappedTerm;

    @Column(name = "TERM_TYPE", nullable = false, length = 30)
    private String termType;

    @Column(name = "ORIGINAL_QUERY", length = 2000)
    private String originalQuery;

    @Column(name = "SUGGESTED_COLUMN", length = 100)
    private String suggestedColumn;

    @Column(name = "SUGGESTED_METRIC_CODE", length = 100)
    private String suggestedMetricCode;

    @Column(name = "OCCURRENCE_COUNT", nullable = false)
    private Integer occurrenceCount;

    @Column(name = "STATUS", nullable = false, length = 20)
    private String status;

    @Column(name = "RESOLVED_BY", length = 50)
    private String resolvedBy;

    @Column(name = "RESOLVED_AT")
    private LocalDateTime resolvedAt;

    @Column(name = "RESOLUTION_NOTE", length = 500)
    private String resolutionNote;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.status == null) {
            this.status = "PENDING";
        }
        if (this.occurrenceCount == null) {
            this.occurrenceCount = 1;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public MappingInbox(String unmappedTerm, String termType, String originalQuery,
                        String suggestedColumn, String suggestedMetricCode) {
        this.unmappedTerm = unmappedTerm;
        this.termType = termType;
        this.originalQuery = originalQuery;
        this.suggestedColumn = suggestedColumn;
        this.suggestedMetricCode = suggestedMetricCode;
        this.occurrenceCount = 1;
        this.status = "PENDING";
    }

    public void incrementCount() {
        this.occurrenceCount++;
    }

    public void approve(String resolvedBy, String resolutionNote) {
        this.status = "APPROVED";
        this.resolvedBy = resolvedBy;
        this.resolvedAt = LocalDateTime.now();
        this.resolutionNote = resolutionNote;
    }

    public void reject(String resolvedBy, String resolutionNote) {
        this.status = "REJECTED";
        this.resolvedBy = resolvedBy;
        this.resolvedAt = LocalDateTime.now();
        this.resolutionNote = resolutionNote;
    }

    public void updateSuggestion(String suggestedColumn, String suggestedMetricCode) {
        this.suggestedColumn = suggestedColumn;
        this.suggestedMetricCode = suggestedMetricCode;
    }
}
