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

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class BatchStatusService {

    private final BatchStatusRepository batchStatusRepository;

    /**
     * 배치 상태 목록 조회 (페이징 + 필터)
     */
    public Page<BatchStatusResponse> getList(String status, String batchType, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<BatchStatus> result;

        if (status != null && batchType != null) {
            result = batchStatusRepository.findByStatusAndBatchType(status, batchType, pageable);
        } else if (status != null) {
            result = batchStatusRepository.findByStatusOrderByCreatedAtDesc(status, pageable);
        } else if (batchType != null) {
            result = batchStatusRepository.findByBatchTypeOrderByCreatedAtDesc(batchType, pageable);
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
                .orElseThrow(() -> new EntityNotFoundException("배치 상태를 찾을 수 없습니다. ID: " + id));
        return BatchStatusResponse.from(entity);
    }

    /**
     * 배치 등록 (배치 시작 전)
     */
    @Transactional
    public BatchStatusResponse create(String batchName, String batchType, String sourceSystem,
                                       String targetTable, Long totalRows,
                                       Integer periodYear, Integer periodMonth, String createdBy) {
        BatchStatus batch = BatchStatus.builder()
                .batchName(batchName)
                .batchType(batchType)
                .sourceSystem(sourceSystem)
                .targetTable(targetTable)
                .totalRows(totalRows)
                .periodYear(periodYear)
                .periodMonth(periodMonth)
                .createdBy(createdBy)
                .build();

        BatchStatus saved = batchStatusRepository.save(batch);
        return BatchStatusResponse.from(saved);
    }

    /**
     * 배치 시작
     */
    @Transactional
    public BatchStatusResponse start(Long batchId) {
        BatchStatus batch = batchStatusRepository.findById(batchId)
                .orElseThrow(() -> new EntityNotFoundException("배치 상태를 찾을 수 없습니다. ID: " + batchId));
        batch.start();
        return BatchStatusResponse.from(batch);
    }

    /**
     * 배치 완료
     */
    @Transactional
    public BatchStatusResponse complete(Long batchId, Long processedRows, Long errorRows) {
        BatchStatus batch = batchStatusRepository.findById(batchId)
                .orElseThrow(() -> new EntityNotFoundException("배치 상태를 찾을 수 없습니다. ID: " + batchId));
        batch.complete(processedRows, errorRows);
        return BatchStatusResponse.from(batch);
    }

    /**
     * 배치 실패
     */
    @Transactional
    public BatchStatusResponse fail(Long batchId, String errorMessage) {
        BatchStatus batch = batchStatusRepository.findById(batchId)
                .orElseThrow(() -> new EntityNotFoundException("배치 상태를 찾을 수 없습니다. ID: " + batchId));
        batch.fail(errorMessage);
        return BatchStatusResponse.from(batch);
    }

    /**
     * 기간별 배치 조회
     */
    public List<BatchStatusResponse> getByPeriod(Integer year, Integer month) {
        return batchStatusRepository.findByPeriod(year, month).stream()
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
