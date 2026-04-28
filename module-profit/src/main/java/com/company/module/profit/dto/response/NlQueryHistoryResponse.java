package com.company.module.profit.dto.response;

import com.company.module.profit.entity.NlQueryHistory;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Builder
public class NlQueryHistoryResponse {

    private Long queryHistoryId;
    private Long userId;
    private String userName;
    private String naturalQuery;
    private String generatedSql;
    private String queryMode;
    private Integer resultCount;
    private String resultSummary;
    private String metricsUsed;
    private String filtersUsed;
    private String dataSource;
    private Long executionTimeMs;
    private String status;
    private String errorMessage;
    private Integer feedbackScore;
    private String feedbackComment;
    private Boolean isBookmarked;
    private LocalDateTime createdAt;

    public static NlQueryHistoryResponse from(NlQueryHistory entity) {
        return NlQueryHistoryResponse.builder()
                .queryHistoryId(entity.getQueryHistoryId())
                .userId(entity.getUserId())
                .userName(entity.getUserName())
                .naturalQuery(entity.getNaturalQuery())
                .generatedSql(entity.getGeneratedSql())
                .queryMode(entity.getQueryMode())
                .resultCount(entity.getResultCount())
                .resultSummary(entity.getResultSummary())
                .metricsUsed(entity.getMetricsUsed())
                .filtersUsed(entity.getFiltersUsed())
                .dataSource(entity.getDataSource())
                .executionTimeMs(entity.getExecutionTimeMs())
                .status(entity.getStatus())
                .errorMessage(entity.getErrorMessage())
                .feedbackScore(entity.getFeedbackScore())
                .feedbackComment(entity.getFeedbackComment())
                .isBookmarked(entity.getIsBookmarked())
                .createdAt(entity.getCreatedAt())
                .build();
    }
}
