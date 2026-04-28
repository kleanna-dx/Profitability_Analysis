package com.company.module.profit.service;

import com.company.core.common.exception.BusinessException;
import com.company.core.common.exception.EntityNotFoundException;
import com.company.module.profit.dto.request.MetricSaveRequest;
import com.company.module.profit.dto.response.MetricResponse;
import com.company.module.profit.entity.Metric;
import com.company.module.profit.entity.MetricSynonym;
import com.company.module.profit.repository.MetricRepository;
import com.company.module.profit.repository.MetricSynonymRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MetricService {

    private final MetricRepository metricRepository;
    private final MetricSynonymRepository metricSynonymRepository;

    /**
     * Metric 목록 조회 (페이징 + 검색)
     */
    public Page<MetricResponse> getList(String keyword, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<Metric> result;

        if (keyword != null && !keyword.isBlank()) {
            result = metricRepository.searchByKeyword(keyword.trim(), pageable);
        } else {
            result = metricRepository.findByIsActiveTrueOrderBySortOrderAsc(pageable);
        }

        return result.map(MetricResponse::from);
    }

    /**
     * Metric 단건 조회
     */
    public MetricResponse getById(Long id) {
        Metric entity = metricRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Metric을 찾을 수 없습니다. ID: " + id));
        return MetricResponse.from(entity);
    }

    /**
     * Metric 코드로 조회 (동의어 포함)
     */
    public MetricResponse getByCode(String code) {
        Metric entity = metricRepository.findByMetricCodeWithSynonyms(code)
                .orElseThrow(() -> new EntityNotFoundException("Metric을 찾을 수 없습니다. Code: " + code));
        return MetricResponse.from(entity);
    }

    /**
     * Metric 저장 (생성)
     */
    @Transactional
    public MetricResponse save(MetricSaveRequest request, String createdBy) {
        // 코드 중복 검사
        if (metricRepository.existsByMetricCode(request.getMetricCode())) {
            throw new BusinessException("이미 존재하는 Metric 코드입니다: " + request.getMetricCode());
        }

        Metric metric = Metric.builder()
                .metricCode(request.getMetricCode())
                .metricName(request.getMetricName())
                .aggregation(request.getAggregation())
                .formula(request.getFormula())
                .tableName(request.getTableName())
                .description(request.getDescription())
                .displayFormat(request.getDisplayFormat())
                .unit(request.getUnit())
                .sortOrder(request.getSortOrder())
                .isActive(request.getIsActive())
                .createdBy(createdBy)
                .build();

        // 동의어 추가
        if (request.getSynonyms() != null) {
            for (MetricSaveRequest.MetricSynonymRequest synReq : request.getSynonyms()) {
                MetricSynonym synonym = MetricSynonym.builder()
                        .synonymText(synReq.getSynonymText())
                        .synonymSource(synReq.getSynonymSource())
                        .isActive(synReq.getIsActive())
                        .build();
                metric.addSynonym(synonym);
            }
        }

        Metric saved = metricRepository.save(metric);
        return MetricResponse.from(saved);
    }

    /**
     * Metric 수정
     */
    @Transactional
    public MetricResponse update(Long id, MetricSaveRequest request, String updatedBy) {
        Metric metric = metricRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Metric을 찾을 수 없습니다. ID: " + id));

        // 코드 변경 시 중복 검사
        if (!metric.getMetricCode().equals(request.getMetricCode())
                && metricRepository.existsByMetricCode(request.getMetricCode())) {
            throw new BusinessException("이미 존재하는 Metric 코드입니다: " + request.getMetricCode());
        }

        metric.update(
                request.getMetricCode(),
                request.getMetricName(),
                request.getAggregation(),
                request.getFormula(),
                request.getTableName(),
                request.getDescription(),
                request.getDisplayFormat(),
                request.getUnit(),
                request.getSortOrder(),
                request.getIsActive(),
                updatedBy
        );

        // 기존 동의어 전체 삭제 후 재등록
        metric.getSynonyms().clear();
        if (request.getSynonyms() != null) {
            for (MetricSaveRequest.MetricSynonymRequest synReq : request.getSynonyms()) {
                MetricSynonym synonym = MetricSynonym.builder()
                        .synonymText(synReq.getSynonymText())
                        .synonymSource(synReq.getSynonymSource())
                        .isActive(synReq.getIsActive())
                        .build();
                metric.addSynonym(synonym);
            }
        }

        return MetricResponse.from(metric);
    }

    /**
     * Metric 삭제 (soft delete)
     */
    @Transactional
    public void delete(Long id, String updatedBy) {
        Metric metric = metricRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("Metric을 찾을 수 없습니다. ID: " + id));
        metric.update(
                metric.getMetricCode(), metric.getMetricName(), metric.getAggregation(),
                metric.getFormula(), metric.getTableName(), metric.getDescription(),
                metric.getDisplayFormat(), metric.getUnit(), metric.getSortOrder(),
                false, updatedBy
        );
    }

    /**
     * 전체 Metric 조회 (동의어 포함, RAG 인덱스 구축용)
     */
    public List<MetricResponse> getAllWithSynonyms() {
        return metricRepository.findAllWithSynonyms().stream()
                .map(MetricResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 테이블별 Metric 조회 (동의어 포함)
     */
    public List<MetricResponse> getByTableName(String tableName) {
        return metricRepository.findByTableNameWithSynonyms(tableName).stream()
                .map(MetricResponse::from)
                .collect(Collectors.toList());
    }
}
