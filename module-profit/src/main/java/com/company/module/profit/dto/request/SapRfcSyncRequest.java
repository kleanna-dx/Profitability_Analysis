package com.company.module.profit.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

/**
 * SAP RFC 동기화 실행 요청 DTO
 */
@Getter
@Setter
public class SapRfcSyncRequest {

    /** 입력년월 (YYYYMM, 예: 202604) */
    @NotBlank(message = "입력년월(cmonth)은 필수입니다")
    @Pattern(regexp = "^\\d{6}$", message = "입력년월은 YYYYMM 형식이어야 합니다 (예: 202604)")
    private String cmonth;

    /** 실행 모드: replace(기존 삭제 후 INSERT), append(추가), dry-run(테스트) */
    @Pattern(regexp = "^(replace|append|dry-run)$",
             message = "mode는 replace, append, dry-run 중 하나여야 합니다")
    private String mode = "replace";

    /**
     * Node.js batch_jobs 레코드 ID (선택)
     * - Node.js가 이미 batch_jobs에 INSERT한 경우 해당 ID 전달
     * - 전달 시 Spring Boot가 새 레코드를 만들지 않고 기존 레코드를 업데이트
     */
    private Long jobId;
}
