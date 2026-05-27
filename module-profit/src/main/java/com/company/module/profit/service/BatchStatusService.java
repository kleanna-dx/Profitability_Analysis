package com.company.module.profit.service;

import com.company.core.common.exception.EntityNotFoundException;
import com.company.module.profit.dto.response.BatchStatusResponse;
import com.company.module.profit.entity.BatchStatus;
import com.company.module.profit.repository.BatchStatusRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 배치 작업 이력 서비스
 * - batch_jobs 테이블 조회/관리 (Node.js와 테이블 공유)
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class BatchStatusService {

    private final BatchStatusRepository batchStatusRepository;

    /**
     * 배치 목록 조회 (페이징 + 필터)
     */
    public Page<BatchStatusResponse> getList(String status, String jobType, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<BatchStatus> result;

        if (status != null && jobType != null) {
            result = batchStatusRepository.findByStatusAndJobType(status, jobType, pageable);
        } else if (status != null) {
            result = batchStatusRepository.findByStatusOrderByCreatedAtDesc(status, pageable);
        } else if (jobType != null) {
            result = batchStatusRepository.findByJobTypeOrderByCreatedAtDesc(jobType, pageable);
        } else {
            result = batchStatusRepository.findByOrderByCreatedAtDesc(pageable);
        }

        return result.map(BatchStatusResponse::from);
    }

    /**
     * 배치 상태 단건 조회
     */
    public BatchStatusResponse getById(Long id) {
        BatchStatus entity = batchStatusRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("배치 작업을 찾을 수 없습니다. ID: " + id));
        return BatchStatusResponse.from(entity);
    }

    /**
     * 입력년월(cmonth)별 배치 조회
     */
    public List<BatchStatusResponse> getByCmonth(String cmonth) {
        return batchStatusRepository.findByCmonthOrderByCreatedAtDesc(cmonth).stream()
                .map(BatchStatusResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 날짜 범위별 배치 조회
     */
    public List<BatchStatusResponse> getByDateRange(LocalDateTime startDate, LocalDateTime endDate) {
        return batchStatusRepository.findByDateRange(startDate, endDate).stream()
                .map(BatchStatusResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 상태별 배치 수 통계
     */
    public List<Map<String, Object>> getStatusSummary() {
        return batchStatusRepository.countByStatusGroup().stream()
                .map(row -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("status", row[0]);
                    map.put("count", row[1]);
                    return map;
                })
                .collect(Collectors.toList());
    }

    /**
     * 현재 실행 중인 배치 수
     */
    public long countRunning() {
        return batchStatusRepository.findRunningBatches().size();
    }
}
