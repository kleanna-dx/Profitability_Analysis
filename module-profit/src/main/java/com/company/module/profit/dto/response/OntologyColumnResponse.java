package com.company.module.profit.dto.response;

import com.company.module.profit.entity.OntologyColumn;
import com.company.module.profit.entity.OntologySynonym;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Getter
@Builder
public class OntologyColumnResponse {

    private Long ontologyColumnId;
    private String columnName;
    private String tableName;
    private String columnDescription;
    private String dataType;
    private String columnGroup;
    private Integer sortOrder;
    private Boolean isActive;
    private String createdBy;
    private String updatedBy;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    private List<SynonymResponse> synonyms;

    @Getter
    @Builder
    public static class SynonymResponse {
        private Long synonymId;
        private String synonymText;
        private String synonymSource;
        private Boolean isActive;
        private LocalDateTime createdAt;

        public static SynonymResponse from(OntologySynonym synonym) {
            return SynonymResponse.builder()
                    .synonymId(synonym.getSynonymId())
                    .synonymText(synonym.getSynonymText())
                    .synonymSource(synonym.getSynonymSource())
                    .isActive(synonym.getIsActive())
                    .createdAt(synonym.getCreatedAt())
                    .build();
        }
    }

    public static OntologyColumnResponse from(OntologyColumn entity) {
        return OntologyColumnResponse.builder()
                .ontologyColumnId(entity.getOntologyColumnId())
                .columnName(entity.getColumnName())
                .tableName(entity.getTableName())
                .columnDescription(entity.getColumnDescription())
                .dataType(entity.getDataType())
                .columnGroup(entity.getColumnGroup())
                .sortOrder(entity.getSortOrder())
                .isActive(entity.getIsActive())
                .createdBy(entity.getCreatedBy())
                .updatedBy(entity.getUpdatedBy())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .synonyms(entity.getSynonyms() != null
                        ? entity.getSynonyms().stream()
                            .map(SynonymResponse::from)
                            .collect(Collectors.toList())
                        : List.of())
                .build();
    }
}
