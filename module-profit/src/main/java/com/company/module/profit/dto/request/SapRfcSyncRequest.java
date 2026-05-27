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
}
