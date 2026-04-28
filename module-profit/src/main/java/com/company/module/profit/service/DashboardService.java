package com.company.module.profit.service;

import com.company.module.profit.dto.response.DashboardResponse;
import com.company.module.profit.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DashboardService {

    private final OntologyColumnRepository ontologyColumnRepository;
    private final OntologySynonymRepository ontologySynonymRepository;
    private final MetricRepository metricRepository;
    private final MetricSynonymRepository metricSynonymRepository;
    private final JoinConditionRepository joinConditionRepository;
    private final NlQueryHistoryRepository nlQueryHistoryRepository;
    private final BatchStatusRepository batchStatusRepository;
    private final MappingInboxRepository mappingInboxRepository;

    /**
     * 대시보드 통합 현황 데이터 조회
     */
    public DashboardResponse getDashboard() {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();

        // 사전 현황
        long totalOntologyColumns = ontologyColumnRepository.count();
        long totalSynonyms = ontologySynonymRepository.count();
        long totalMetrics = metricRepository.count();
        long totalMetricSynonyms = metricSynonymRepository.count();
        long totalJoinConditions = joinConditionRepository.count();

        // 질의 통계
        long totalQueries = nlQueryHistoryRepository.count();
        long todayQueries = nlQueryHistoryRepository.countSince(startOfDay);
        long successQueries = nlQueryHistoryRepository.countByStatus("SUCCESS");
        long failedQueries = nlQueryHistoryRepository.countByStatus("FAILED");
        Double avgExecutionTimeMs = nlQueryHistoryRepository.avgExecutionTimeSince(startOfDay);

        // 배치 상태
        List<Map<String, Object>> batchStatusSummary = batchStatusRepository.countByStatusGroup()
                .stream()
                .map(row -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("status", row[0]);
                    map.put("count", row[1]);
                    return map;
                })
                .collect(Collectors.toList());
        long runningBatches = batchStatusRepository.findRunningBatches().size();

        // 매핑 인박스 현황
        long pendingMappings = mappingInboxRepository.countByStatus("PENDING");
        List<Map<String, Object>> pendingByTermType = mappingInboxRepository.countPendingByTermType()
                .stream()
                .map(row -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("termType", row[0]);
                    map.put("count", row[1]);
                    return map;
                })
                .collect(Collectors.toList());

        // 학습 현황
        long feedbackCount = nlQueryHistoryRepository.findWithFeedback(
                org.springframework.data.domain.PageRequest.of(0, 1)).getTotalElements();

        return DashboardResponse.builder()
                .totalOntologyColumns(totalOntologyColumns)
                .totalSynonyms(totalSynonyms)
                .totalMetrics(totalMetrics)
                .totalMetricSynonyms(totalMetricSynonyms)
                .totalJoinConditions(totalJoinConditions)
                .totalQueries(totalQueries)
                .todayQueries(todayQueries)
                .successQueries(successQueries)
                .failedQueries(failedQueries)
                .avgExecutionTimeMs(avgExecutionTimeMs)
                .batchStatusSummary(batchStatusSummary)
                .runningBatches(runningBatches)
                .pendingMappings(pendingMappings)
                .pendingByTermType(pendingByTermType)
                .feedbackCount(feedbackCount)
                .builtInLearningCount(0L)
                .build();
    }
}
