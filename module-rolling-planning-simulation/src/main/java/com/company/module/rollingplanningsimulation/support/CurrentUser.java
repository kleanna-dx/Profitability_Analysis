package com.company.module.rollingplanningsimulation.support;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

/**
 * 현재 요청 사용자 ID.
 * - 화면(simulation-test.html)이 모든 API 요청에 X-User-Id 헤더를 붙여 보냄
 * - 요청 밖(스케줄러 등)이거나 헤더가 없으면 "system"
 */
public final class CurrentUser {
    public static final String HEADER = "X-User-Id";
    public static final String SYSTEM = "system";

    private CurrentUser() {}

    public static String get() {
        try {
            if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes sra) {
                HttpServletRequest req = sra.getRequest();
                String u = req.getHeader(HEADER);
                if (u != null && !u.isBlank()) {
                    String v = URLDecoder.decode(u, StandardCharsets.UTF_8).trim();
                    return v.length() > 50 ? v.substring(0, 50) : v;
                }
            }
        } catch (Exception ignore) {
            // 요청 컨텍스트 없음
        }
        return SYSTEM;
    }
}
