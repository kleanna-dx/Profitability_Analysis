package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 자연어 질의 이력 엔티티
 * - 사용자의 자연어 질문 → SQL 변환 → 실행 결과를 기록
 * - 학습 데이터로 활용: 시스템을 점점 똑똑하게 만드는 핵심 데이터
 * - 답변에는 계산식, 필터, 데이터 출처를 포함
 */
@Entity
@Table(name = "profit_nl_query_history")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class NlQueryHistory {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "QUERY_HISTORY_ID")
    private Long queryHistoryId;

    @Column(name = "USER_ID")
    private Long userId;

    @Column(name = "USER_NAME", length = 100)
    private String userName;

    @Column(name = "NATURAL_QUERY", nullable = false, length = 2000)
    private String naturalQuery;

    @Column(name = "GENERATED_SQL", columnDefinition = "TEXT")
    private String generatedSql;

    @Column(name = "QUERY_MODE", length = 20)
    private String queryMode;

    @Column(name = "RESULT_COUNT")
    private Integer resultCount;

    @Column(name = "RESULT_SUMMARY", columnDefinition = "TEXT")
    private String resultSummary;

    @Column(name = "METRICS_USED", length = 1000)
    private String metricsUsed;

    @Column(name = "FILTERS_USED", length = 1000)
    private String filtersUsed;

    @Column(name = "DATA_SOURCE", length = 500)
    private String dataSource;

    @Column(name = "EXECUTION_TIME_MS")
    private Long executionTimeMs;

    @Column(name = "STATUS", nullable = false, length = 20)
    private String status;

    @Column(name = "ERROR_MESSAGE", length = 2000)
    private String errorMessage;

    @Column(name = "FEEDBACK_SCORE")
    private Integer feedbackScore;

    @Column(name = "FEEDBACK_COMMENT", length = 1000)
    private String feedbackComment;

    @Column(name = "IS_BOOKMARKED", nullable = false)
    private Boolean isBookmarked;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.status == null) {
            this.status = "PENDING";
        }
        if (this.isBookmarked == null) {
            this.isBookmarked = false;
        }
        if (this.queryMode == null) {
            this.queryMode = "NLQ";
        }
    }

    @Builder
    public NlQueryHistory(Long userId, String userName, String naturalQuery,
                          String generatedSql, String queryMode, Integer resultCount,
                          String resultSummary, String metricsUsed, String filtersUsed,
                          String dataSource, Long executionTimeMs, String status,
                          String errorMessage) {
        this.userId = userId;
        this.userName = userName;
        this.naturalQuery = naturalQuery;
        this.generatedSql = generatedSql;
        this.queryMode = queryMode != null ? queryMode : "NLQ";
        this.resultCount = resultCount;
        this.resultSummary = resultSummary;
        this.metricsUsed = metricsUsed;
        this.filtersUsed = filtersUsed;
        this.dataSource = dataSource;
        this.executionTimeMs = executionTimeMs;
        this.status = status != null ? status : "PENDING";
        this.errorMessage = errorMessage;
        this.isBookmarked = false;
    }

    public void completeQuery(String generatedSql, Integer resultCount,
                              String resultSummary, String metricsUsed,
                              String filtersUsed, String dataSource,
                              Long executionTimeMs) {
        this.generatedSql = generatedSql;
        this.resultCount = resultCount;
        this.resultSummary = resultSummary;
        this.metricsUsed = metricsUsed;
        this.filtersUsed = filtersUsed;
        this.dataSource = dataSource;
        this.executionTimeMs = executionTimeMs;
        this.status = "SUCCESS";
    }

    public void failQuery(String errorMessage) {
        this.status = "FAILED";
        this.errorMessage = errorMessage;
    }

    public void addFeedback(Integer score, String comment) {
        this.feedbackScore = score;
        this.feedbackComment = comment;
    }

    public void toggleBookmark() {
        this.isBookmarked = !this.isBookmarked;
    }
}
