package com.company.module.profit.service;

import com.company.module.profit.dto.response.DashboardStatsResponse;
import com.company.module.profit.repository.*;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class DashboardService {

    private final OntologyColumnRepository ontologyColumnRepository;
    private final MetricRepository metricRepository;
    private final JoinConditionRepository joinConditionRepository;
    private final NlQueryHistoryRepository nlQueryHistoryRepository;
    private final BatchStatusRepository batchStatusRepository;
    private final MappingInboxRepository mappingInboxRepository;

    /**
     * 대시보드 통합 현황 데이터 조회
     */
    public DashboardStatsResponse getDashboard() {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();

        // 질의 통계
        long totalQueries = nlQueryHistoryRepository.count();
        long todayQueries = nlQueryHistoryRepository.countSince(startOfDay);
        long successQueries = nlQueryHistoryRepository.countByStatus("SUCCESS");
        long failedQueries = nlQueryHistoryRepository.countByStatus("FAILED");
        Double avgExecutionTimeMs = nlQueryHistoryRepository.avgExecutionTimeSince(startOfDay);

        // 배치 상태
        Map<String, Long> batchStatusCounts = batchStatusRepository.countByStatusGroup()
                .stream()
                .collect(Collectors.toMap(
                        row -> (String) row[0],
                        row -> (Long) row[1],
                        (a, b) -> a,
                        HashMap::new
                ));
        long runningBatches = batchStatusRepository.findRunningBatches().size();

        // 매핑 인박스 현황
        long pendingMappings = mappingInboxRepository.countByStatus("PENDING");
        Map<String, Long> pendingMappingsByType = mappingInboxRepository.countPendingByTermType()
                .stream()
                .collect(Collectors.toMap(
                        row -> (String) row[0],
                        row -> (Long) row[1],
                        (a, b) -> a,
                        HashMap::new
                ));

        return DashboardStatsResponse.builder()
                .totalQueries(totalQueries)
                .todayQueries(todayQueries)
                .successQueries(successQueries)
                .failedQueries(failedQueries)
                .avgExecutionTimeMs(avgExecutionTimeMs)
                .totalOntologyColumns(ontologyColumnRepository.count())
                .totalMetrics(metricRepository.count())
                .totalJoinConditions(joinConditionRepository.count())
                .pendingMappings(pendingMappings)
                .runningBatches(runningBatches)
                .batchStatusCounts(batchStatusCounts)
                .pendingMappingsByType(pendingMappingsByType)
                .build();
    }
}
