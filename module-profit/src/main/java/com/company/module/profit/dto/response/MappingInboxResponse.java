package com.company.module.profit.dto.response;

import com.company.module.profit.entity.MappingInbox;
import lombok.Builder;
import lombok.Getter;

import java.time.LocalDateTime;

@Getter
@Builder
public class MappingInboxResponse {

    private Long inboxId;
    private String unmappedTerm;
    private String termType;
    private String originalQuery;
    private String suggestedColumn;
    private String suggestedMetricCode;
    private Integer occurrenceCount;
    private String status;
    private String resolvedBy;
    private LocalDateTime resolvedAt;
    private String resolutionNote;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public static MappingInboxResponse from(MappingInbox entity) {
        return MappingInboxResponse.builder()
                .inboxId(entity.getInboxId())
                .unmappedTerm(entity.getUnmappedTerm())
                .termType(entity.getTermType())
                .originalQuery(entity.getOriginalQuery())
                .suggestedColumn(entity.getSuggestedColumn())
                .suggestedMetricCode(entity.getSuggestedMetricCode())
                .occurrenceCount(entity.getOccurrenceCount())
                .status(entity.getStatus())
                .resolvedBy(entity.getResolvedBy())
                .resolvedAt(entity.getResolvedAt())
                .resolutionNote(entity.getResolutionNote())
                .createdAt(entity.getCreatedAt())
                .updatedAt(entity.getUpdatedAt())
                .build();
    }
}
