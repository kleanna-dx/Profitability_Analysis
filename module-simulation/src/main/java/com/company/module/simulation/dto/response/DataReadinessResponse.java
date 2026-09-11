package com.company.module.simulation.dto.response;

import lombok.Builder;
import lombok.Getter;

import java.util.List;

/**
 * 데이터 준비 현황 대시보드 응답 DTO
 */
@Getter
@Builder
public class DataReadinessResponse {

    private String ym;
    private String division;
    private List<ModuleStatus> modules;

    @Getter
    @Builder
    public static class ModuleStatus {
        private String moduleCode;
        private String moduleName;
        private String status;     // READY / PARTIAL / EMPTY
        private long recordCount;
        private String lastUpdated;
        private String description;
    }
}
