package com.company.module.profit.service;

import com.company.core.common.exception.EntityNotFoundException;
import com.company.module.profit.dto.request.NlQueryRequest;
import com.company.module.profit.dto.request.QueryFeedbackRequest;
import com.company.module.profit.dto.response.NlQueryHistoryResponse;
import com.company.module.profit.entity.NlQueryHistory;
import com.company.module.profit.repository.NlQueryHistoryRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class NlQueryHistoryService {

    private final NlQueryHistoryRepository nlQueryHistoryRepository;

    /**
     * 자연어 질의 이력 생성 (질문 접수)
     */
    @Transactional
    public NlQueryHistoryResponse createQuery(NlQueryRequest request, Long userId, String userName) {
        NlQueryHistory history = NlQueryHistory.builder()
                .userId(userId)
                .userName(userName)
                .naturalQuery(request.getNaturalQuery())
                .queryMode(request.getQueryMode())
                .status("PENDING")
                .build();

        NlQueryHistory saved = nlQueryHistoryRepository.save(history);
        return NlQueryHistoryResponse.from(saved);
    }

    /**
     * 질의 완료 처리 (SQL 생성 → 실행 → 결과 저장)
     */
    @Transactional
    public NlQueryHistoryResponse completeQuery(Long queryHistoryId, String generatedSql,
                                                 Integer resultCount, String resultSummary,
                                                 String metricsUsed, String filtersUsed,
                                                 String dataSource, Long executionTimeMs) {
        NlQueryHistory history = nlQueryHistoryRepository.findById(queryHistoryId)
                .orElseThrow(() -> new EntityNotFoundException("질의 이력을 찾을 수 없습니다. ID: " + queryHistoryId));

        history.completeQuery(generatedSql, resultCount, resultSummary,
                metricsUsed, filtersUsed, dataSource, executionTimeMs);

        return NlQueryHistoryResponse.from(history);
    }

    /**
     * 질의 실패 처리
     */
    @Transactional
    public NlQueryHistoryResponse failQuery(Long queryHistoryId, String errorMessage) {
        NlQueryHistory history = nlQueryHistoryRepository.findById(queryHistoryId)
                .orElseThrow(() -> new EntityNotFoundException("질의 이력을 찾을 수 없습니다. ID: " + queryHistoryId));

        history.failQuery(errorMessage);
        return NlQueryHistoryResponse.from(history);
    }

    /**
     * 사용자별 질의 이력 조회 (페이징)
     */
    public Page<NlQueryHistoryResponse> getByUserId(Long userId, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return nlQueryHistoryRepository.findByUserIdOrderByCreatedAtDesc(userId, pageable)
                .map(NlQueryHistoryResponse::from);
    }

    /**
     * 질의 이력 검색
     */
    public Page<NlQueryHistoryResponse> search(String keyword, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return nlQueryHistoryRepository.searchByKeyword(keyword, pageable)
                .map(NlQueryHistoryResponse::from);
    }

    /**
     * 질의 이력 단건 조회
     */
    public NlQueryHistoryResponse getById(Long id) {
        NlQueryHistory entity = nlQueryHistoryRepository.findById(id)
                .orElseThrow(() -> new EntityNotFoundException("질의 이력을 찾을 수 없습니다. ID: " + id));
        return NlQueryHistoryResponse.from(entity);
    }

    /**
     * 피드백 등록
     */
    @Transactional
    public NlQueryHistoryResponse addFeedback(Long queryHistoryId, QueryFeedbackRequest request) {
        NlQueryHistory history = nlQueryHistoryRepository.findById(queryHistoryId)
                .orElseThrow(() -> new EntityNotFoundException("질의 이력을 찾을 수 없습니다. ID: " + queryHistoryId));

        history.addFeedback(request.getScore(), request.getComment());
        return NlQueryHistoryResponse.from(history);
    }

    /**
     * 북마크 토글
     */
    @Transactional
    public NlQueryHistoryResponse toggleBookmark(Long queryHistoryId) {
        NlQueryHistory history = nlQueryHistoryRepository.findById(queryHistoryId)
                .orElseThrow(() -> new EntityNotFoundException("질의 이력을 찾을 수 없습니다. ID: " + queryHistoryId));

        history.toggleBookmark();
        return NlQueryHistoryResponse.from(history);
    }

    /**
     * 북마크된 질의 이력 조회
     */
    public List<NlQueryHistoryResponse> getBookmarked(Long userId) {
        return nlQueryHistoryRepository.findByIsBookmarkedTrueAndUserIdOrderByCreatedAtDesc(userId)
                .stream()
                .map(NlQueryHistoryResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 최근 성공 질의 조회 (추천용)
     */
    public List<NlQueryHistoryResponse> getRecentSuccessful(int limit) {
        Pageable pageable = PageRequest.of(0, limit);
        return nlQueryHistoryRepository.findRecentSuccessful(pageable)
                .stream()
                .map(NlQueryHistoryResponse::from)
                .collect(Collectors.toList());
    }

    /**
     * 오늘 질의 수 조회
     */
    public long countToday() {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        return nlQueryHistoryRepository.countSince(startOfDay);
    }

    /**
     * 상태별 질의 수 조회
     */
    public long countByStatus(String status) {
        return nlQueryHistoryRepository.countByStatus(status);
    }

    /**
     * 평균 실행 시간 조회 (오늘)
     */
    public Double getAvgExecutionTimeToday() {
        LocalDateTime startOfDay = LocalDate.now().atStartOfDay();
        return nlQueryHistoryRepository.avgExecutionTimeSince(startOfDay);
    }

    /**
     * 질의 이력 목록 조회 (검색 + 페이징)
     * - NlQueryController.getList()에서 호출
     */
    public Page<NlQueryHistoryResponse> getList(String keyword, int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        if (keyword != null && !keyword.isBlank()) {
            return nlQueryHistoryRepository.searchByKeyword(keyword.trim(), pageable)
                    .map(NlQueryHistoryResponse::from);
        }
        return nlQueryHistoryRepository.findByStatusOrderByCreatedAtDesc("SUCCESS", pageable)
                .map(NlQueryHistoryResponse::from);
    }

    /**
     * 질의 기록 생성 (NlQueryController.executeQuery에서 호출)
     * - createQuery의 별칭: 동일 로직
     */
    @Transactional
    public NlQueryHistoryResponse createQueryRecord(NlQueryRequest request, Long userId, String userName) {
        return createQuery(request, userId, userName);
    }

    /**
     * 피드백 포함 질의 이력 조회 (학습 관리용)
     */
    public Page<NlQueryHistoryResponse> getWithFeedback(int page, int size) {
        Pageable pageable = PageRequest.of(page, size);
        return nlQueryHistoryRepository.findWithFeedback(pageable)
                .map(NlQueryHistoryResponse::from);
    }
}
