package com.company.module.profit.controller;

import com.company.core.common.response.ApiResponse;
import com.company.module.profit.dto.request.NlQueryRequest;
import com.company.module.profit.dto.request.QueryFeedbackRequest;
import com.company.module.profit.dto.response.NlQueryHistoryResponse;
import com.company.module.profit.service.NlQueryHistoryService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/profit-api/queries")
@RequiredArgsConstructor
public class NlQueryController {

    private final NlQueryHistoryService nlQueryHistoryService;

    /* ───────── 질의 이력 목록 조회 ───────── */

    @GetMapping
    public ResponseEntity<ApiResponse<Page<NlQueryHistoryResponse>>> getList(
            @RequestParam(required = false) String q,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(ApiResponse.success(nlQueryHistoryService.getList(q, page, size)));
    }

    /* ───────── 단건 조회 ───────── */

    @GetMapping("/{id}")
    public ResponseEntity<ApiResponse<NlQueryHistoryResponse>> getById(@PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(nlQueryHistoryService.getById(id)));
    }

    /* ───────── 사용자별 이력 조회 ───────── */

    @GetMapping("/my")
    public ResponseEntity<ApiResponse<Page<NlQueryHistoryResponse>>> getMyQueries(
            @AuthenticationPrincipal UserDetails userDetails,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        // UserDetails에서 userId 추출 (플랫폼 구현에 따라 변경 가능)
        Long userId = extractUserId(userDetails);
        return ResponseEntity.ok(ApiResponse.success(
                nlQueryHistoryService.getByUserId(userId, page, size)));
    }

    /* ───────── 북마크된 질의 목록 ───────── */

    @GetMapping("/bookmarks")
    public ResponseEntity<ApiResponse<List<NlQueryHistoryResponse>>> getBookmarked(
            @AuthenticationPrincipal UserDetails userDetails) {
        Long userId = extractUserId(userDetails);
        return ResponseEntity.ok(ApiResponse.success(
                nlQueryHistoryService.getBookmarked(userId)));
    }

    /* ───────── 최근 성공 질의 (예시 질문용) ───────── */

    @GetMapping("/recent-success")
    public ResponseEntity<ApiResponse<List<NlQueryHistoryResponse>>> getRecentSuccessful(
            @RequestParam(defaultValue = "10") int limit) {
        return ResponseEntity.ok(ApiResponse.success(
                nlQueryHistoryService.getRecentSuccessful(limit)));
    }

    /* ───────── 피드백 포함 질의 (학습 관리용) ───────── */

    @GetMapping("/with-feedback")
    public ResponseEntity<ApiResponse<Page<NlQueryHistoryResponse>>> getWithFeedback(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return ResponseEntity.ok(ApiResponse.success(
                nlQueryHistoryService.getWithFeedback(page, size)));
    }

    /* ───────── 자연어 질의 실행 ───────── */

    @PostMapping("/execute")
    public ResponseEntity<ApiResponse<NlQueryHistoryResponse>> executeQuery(
            @Valid @RequestBody NlQueryRequest request,
            @AuthenticationPrincipal UserDetails userDetails) {
        Long userId = extractUserId(userDetails);
        String userName = userDetails.getUsername();

        // 1단계: 질의 기록 생성
        NlQueryHistoryResponse record = nlQueryHistoryService.createQueryRecord(
                request, userId, userName);

        // TODO: 2단계 - AI Agent 연동 (SQL 생성 → 검증 → 실행 → 결과 반환)
        // 이 부분은 AI Agent 서비스 구현 시 연결됩니다.
        // - Ontology/Metric/Join Dictionary 기반 용어 매핑
        // - SQL 생성 및 검증
        // - BW DB 데이터 조회
        // - 결과 표/차트 데이터 생성
        // - 미매핑 표현은 MappingInbox로 전송

        return ResponseEntity.ok(ApiResponse.success(record));
    }

    /* ───────── 피드백 등록 ───────── */

    @PostMapping("/{id}/feedback")
    public ResponseEntity<ApiResponse<NlQueryHistoryResponse>> addFeedback(
            @PathVariable Long id,
            @Valid @RequestBody QueryFeedbackRequest request) {
        return ResponseEntity.ok(ApiResponse.success(
                nlQueryHistoryService.addFeedback(id, request)));
    }

    /* ───────── 북마크 토글 ───────── */

    @PatchMapping("/{id}/bookmark")
    public ResponseEntity<ApiResponse<NlQueryHistoryResponse>> toggleBookmark(
            @PathVariable Long id) {
        return ResponseEntity.ok(ApiResponse.success(
                nlQueryHistoryService.toggleBookmark(id)));
    }

    /* ───────── 내부 헬퍼 ───────── */

    /**
     * UserDetails에서 userId를 추출하는 헬퍼 메서드
     * 플랫폼의 UserDetails 구현에 따라 적절히 변경 필요
     */
    private Long extractUserId(UserDetails userDetails) {
        // 플랫폼 core의 CustomUserDetails 구현에 맞춰 수정
        // 예: ((CustomUserDetails) userDetails).getUserId()
        // 현재는 기본값 반환
        try {
            return Long.parseLong(userDetails.getUsername());
        } catch (NumberFormatException e) {
            return 0L;
        }
    }
}
