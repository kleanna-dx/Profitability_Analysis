package com.company.module.profit.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.Map;

/**
 * 대시보드 통계 응답 DTO
 * - 시스템 전체 현황을 한눈에 보여주는 집계 데이터
 */
@Getter
@Builder
public class DashboardStatsResponse {

    private long totalQueries;
    private long successQueries;
    private long failedQueries;
    private long todayQueries;
    private Double avgExecutionTimeMs;
    private long totalOntologyColumns;
    private long totalMetrics;
    private long totalJoinConditions;
    private long pendingMappings;
    private long runningBatches;
    private Map<String, Long> batchStatusCounts;
    private Map<String, Long> pendingMappingsByType;
}
