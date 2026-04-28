package com.company.module.profit.dto.request;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class QueryFeedbackRequest {

    @NotNull(message = "피드백 점수는 필수입니다")
    @Min(value = 1, message = "최소 1점입니다")
    @Max(value = 5, message = "최대 5점입니다")
    private Integer score;

    @Size(max = 1000, message = "피드백 코멘트는 1000자 이하입니다")
    private String comment;
}
