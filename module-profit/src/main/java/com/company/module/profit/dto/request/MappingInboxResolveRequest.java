package com.company.module.profit.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class MappingInboxResolveRequest {

    @NotBlank(message = "처리 상태는 필수입니다 (APPROVED / REJECTED)")
    @Size(max = 20)
    private String action;

    @Size(max = 100)
    private String suggestedColumn;

    @Size(max = 100)
    private String suggestedMetricCode;

    @Size(max = 500, message = "처리 메모는 500자 이하입니다")
    private String resolutionNote;
}
