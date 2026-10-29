package com.company.module.rollingplanningsimulation.support;

import com.company.core.common.response.ApiResponse;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 경영시뮬레이션 API 전용 오류 응답 (다른 모듈에는 영향 없음)
 * - 입력/중복 오류를 500 대신 400/409 + 메시지로 돌려줘서 화면에 원인을 보여줌
 */
@RestControllerAdvice(basePackages = "com.company.module.rollingplanningsimulation.controller")
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
}
