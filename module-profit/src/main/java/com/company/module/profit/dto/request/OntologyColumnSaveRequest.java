package com.company.module.profit.dto.request;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.util.List;

@Getter
@Setter
public class OntologyColumnSaveRequest {

    @NotBlank(message = "컬럼명은 필수입니다")
    @Size(max = 100, message = "컬럼명은 100자 이하입니다")
    private String columnName;

    @NotBlank(message = "테이블명은 필수입니다")
    @Size(max = 200, message = "테이블명은 200자 이하입니다")
    private String tableName;

    @Size(max = 500, message = "설명은 500자 이하입니다")
    private String columnDescription;

    @Size(max = 50)
    private String dataType;

    @Size(max = 100)
    private String columnGroup;

    private Integer sortOrder;

    private Boolean isActive = true;

    @Valid
    private List<SynonymRequest> synonyms;

    @Getter
    @Setter
    public static class SynonymRequest {
        @NotBlank(message = "동의어 텍스트는 필수입니다")
        @Size(max = 200, message = "동의어 텍스트는 200자 이하입니다")
        private String synonymText;

        @Size(max = 50)
        private String synonymSource;

        private Boolean isActive = true;
    }
}
