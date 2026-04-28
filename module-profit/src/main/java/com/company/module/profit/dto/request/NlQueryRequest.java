package com.company.module.profit.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class NlQueryRequest {

    @NotBlank(message = "자연어 질의는 필수입니다")
    @Size(max = 2000, message = "질의는 2000자 이하입니다")
    private String naturalQuery;

    @Size(max = 20)
    private String queryMode = "NLQ";

    @Size(max = 2000)
    private String additionalPrompt;

    private Integer maxRows = 1000;

    private String sortColumn;

    private String sortDirection = "DESC";
}
