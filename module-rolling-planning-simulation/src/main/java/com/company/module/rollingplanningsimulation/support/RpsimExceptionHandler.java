package com.company.module.rollingplanningsimulation.support;

import com.company.core.common.response.ApiResponse;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 경영시뮬레이션 API 전용 오류 응답 (다른 모듈에는 영향 없음)
 * - 입력/중복 오류를 500 대신 400/409 + 메시지로 돌려줘서 화면에 원인을 보여줌
 */
@RestControllerAdvice(basePackages = "com.company.module.rollingplanningsimulation.controller")
@Slf4j
public class RpsimExceptionHandler {

    @ExceptionHandler({IllegalArgumentException.class, IllegalStateException.class})
    public ResponseEntity<ApiResponse<Void>> badRequest(RuntimeException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(ApiResponse.fail(e.getMessage()));
    }

    @ExceptionHandler(DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> conflict(DataIntegrityViolationException e) {
        String msg = e.getMostSpecificCause() != null ? e.getMostSpecificCause().getMessage() : e.getMessage();
        if (msg != null && msg.contains("Duplicate entry")) {
            msg = "같은 기준의 데이터가 이미 있습니다. (" + msg + ")";
        }
        return ResponseEntity.status(HttpStatus.CONFLICT).body(ApiResponse.fail(msg));
    }

    /** DB 오류 — 테이블/컬럼 없음, 문법, 콜레이션 등 원인 메시지를 그대로 전달 */
    @ExceptionHandler(DataAccessException.class)
    public ResponseEntity<ApiResponse<Void>> dbError(DataAccessException e) {
        String msg = e.getMostSpecificCause() != null ? e.getMostSpecificCause().getMessage() : e.getMessage();
        log.error("[RPSIM] DB 오류: {}", msg, e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(ApiResponse.fail("DB 오류: " + msg));
    }

    /** 그 외 예외 — 원인 메시지 전달 */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> unknown(Exception e) {
        Throwable root = e;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        log.error("[RPSIM] 처리 오류: {}", root.getMessage(), e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.fail(root.getClass().getSimpleName() + ": " + root.getMessage()));
    }
}
