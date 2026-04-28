package com.company.module.profit.service;

import com.company.core.common.exception.BusinessException;
import com.company.core.common.exception.EntityNotFoundException;
import com.company.module.profit.dto.request.MappingInboxResolveRequest;
import com.company.module.profit.dto.response.MappingInboxResponse;
import com.company.module.profit.entity.MappingInbox;
import com.company.module.profit.repository.MappingInboxRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class MappingInboxService {

    private final MappingInboxRepository mappingInboxRepository;

    /**
     * 미매핑 용어 등록 (자연어 질의 중 매핑 실패 시 자동 호출)
     * - 이미 등록된 용어면 발생 횟수만 증가
     */
    @Transactional
    public MappingInboxResponse reportUnmapped(String unmappedTerm, String termType, String originalQuery) {
        Optional<MappingInbox> existing = mappingInboxRepository
                .findByUnmappedTermAndTermType(unmappedTerm, termType);

        if (existing.isPresent()) {
            MappingInbox inbox = existing.get();
            inbox.incrementCount();
            return MappingInboxResponse.from(inbox);
        }

        MappingInbox inbox = MappingInbox.builder()
                .unmappedTerm(unmappedTerm)
                .termType(termType)
                .originalQuery(originalQuery)
                .build();

        MappingInbox saved = mappingInboxRepository.save(inbox);
        return MappingInboxResponse.from(saved);
    }

    /**
     * 미매핑 인박스 목록 조회 (페이징 + 필터)
     */
    public Page<MappingInboxResponse> getList(String status, String termType, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        Page<MappingInbox> result;

        if (termType != null && status != null) {
            result = mappingInboxRepository.findByTermTypeAndStatusOrderByOccurrenceCountDesc(
                    termType, status, pageable);
        } else if (status != null) {
            result = mappingInboxRepository.findByStatusOrderByOccurrenceCountDesc(status, pageable);
        } else {
            result = mappingInboxRepository.findPendingOrderByPriority(pageable);
        }

        return result.map(MappingInboxResponse::from);
    }

    /**
     * 미매핑 인박스 검색
     */
    public Page<MappingInboxResponse> search(String keyword, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return mappingInboxRepository.searchByKeyword(keyword, pageable)
                .map(MappingInboxResponse::from);
    }

    /**
     * 미매핑 인박스 단건 조회
     */
    public MappingInboxResponse getById(Long id) {
        MappingInbox entity = mappingInboxRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("매핑 인박스 항목을 찾을 수 없습니다. ID: " + id));
        return MappingInboxResponse.from(entity);
    }

    /**
     * 미매핑 항목 처리 (승인/거절)
     */
    @Transactional
    public MappingInboxResponse resolve(Long id, MappingInboxResolveRequest request, String resolvedBy) {
        MappingInbox inbox = mappingInboxRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("매핑 인박스 항목을 찾을 수 없습니다. ID: " + id));

        if (!"PENDING".equals(inbox.getStatus())) {
            throw new BusinessException("이미 처리된 항목입니다. 현재 상태: " + inbox.getStatus());
        }

        // 제안 컬럼/메트릭 업데이트
        if (request.getSuggestedColumn() != null || request.getSuggestedMetricCode() != null) {
            inbox.updateSuggestion(request.getSuggestedColumn(), request.getSuggestedMetricCode());
        }

        if ("APPROVED".equalsIgnoreCase(request.getAction())) {
            inbox.approve(resolvedBy, request.getResolutionNote());
        } else if ("REJECTED".equalsIgnoreCase(request.getAction())) {
            inbox.reject(resolvedBy, request.getResolutionNote());
        } else {
            throw new BusinessException("유효하지 않은 처리 상태입니다. APPROVED 또는 REJECTED를 입력해주세요.");
        }

        return MappingInboxResponse.from(inbox);
    }

    /**
     * 대기 중인 미매핑 항목 수
     */
    public long countPending() {
        return mappingInboxRepository.countByStatus("PENDING");
    }

    /**
     * 유형별 대기 항목 수 통계
     */
    public List<Map<String, Object>> countPendingByTermType() {
        return mappingInboxRepository.countPendingByTermType().stream()
                .map(row -> {
                    Map<String, Object> map = new HashMap<>();
                    map.put("termType", row[0]);
                    map.put("count", row[1]);
                    return map;
                })
                .collect(Collectors.toList());
    }
}
