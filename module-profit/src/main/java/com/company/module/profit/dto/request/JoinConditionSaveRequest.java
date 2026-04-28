package com.company.module.profit.dto.request;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class JoinConditionSaveRequest {

    @Size(max = 200, message = "JOIN 이름은 200자 이하입니다")
    private String joinName;

    @NotBlank(message = "Left 컬럼은 필수입니다")
    @Size(max = 100, message = "Left 컬럼은 100자 이하입니다")
    private String leftColumn;

    @NotBlank(message = "Left 테이블은 필수입니다")
    @Size(max = 200, message = "Left 테이블은 200자 이하입니다")
    private String leftTable;

    @NotBlank(message = "Right 컬럼은 필수입니다")
    @Size(max = 100, message = "Right 컬럼은 100자 이하입니다")
    private String rightColumn;

    @NotBlank(message = "Right 테이블은 필수입니다")
    @Size(max = 200, message = "Right 테이블은 200자 이하입니다")
    private String rightTable;

    @NotBlank(message = "JOIN 타입은 필수입니다")
    @Size(max = 20, message = "JOIN 타입은 20자 이하입니다")
    private String joinType = "INNER";

    @Size(max = 10, message = "Operator는 10자 이하입니다")
    private String operator = "=";

    private Integer sortOrder;

    private Boolean isActive = true;
}
