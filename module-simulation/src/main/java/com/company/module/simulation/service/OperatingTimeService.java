package com.company.module.simulation.service;

import com.company.module.simulation.dto.request.OperatingTimeSaveRequest;
import com.company.module.simulation.dto.response.OperatingTimeResponse;
import com.company.module.simulation.entity.OperatingTime;
import com.company.module.simulation.repository.OperatingTimeRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class OperatingTimeService {

    private final OperatingTimeRepository operatingTimeRepository;

    /**
     * 특정 호기의 연간 가동시간 조회
     */
    public List<OperatingTimeResponse> getByMachine(String division, String machineCode) {
        return operatingTimeRepository
                .findByDivisionAndMachineCodeAndDeletedYnOrderByYm(division, machineCode, "N")
                .stream()
                .map(OperatingTimeResponse::from)
                .toList();
    }

    /**
     * 특정 월의 전체 호기 가동시간 조회
     */
    public List<OperatingTimeResponse> getByYm(String division, String ym) {
        return operatingTimeRepository
                .findByDivisionAndYmAndDeletedYnOrderByMachineCode(division, ym, "N")
                .stream()
                .map(OperatingTimeResponse::from)
                .toList();
    }

    /**
     * 가동시간 저장/수정 (Upsert)
     */
    @Transactional
    public OperatingTimeResponse save(OperatingTimeSaveRequest request, Long currentUserId) {
        OperatingTime entity = operatingTimeRepository
                .findByDivisionAndMachineCodeAndYmAndDeletedYn(
                        request.getDivision(), request.getMachineCode(), request.getYm(), "N")
                .orElse(null);

        if (entity != null) {
            entity.update(
                    request.getTotalDays(),
                    request.getPlannedShutdownDays(),
                    request.getOperationNormalDays(),
                    request.getOperationWasteDays(),
                    request.getOperationUnplannedDays(),
                    request.getOperationStartupDays(),
                    request.getOperationTrimmingDays(),
                    request.getDowntimeRepairDays(),
                    request.getDowntimeCleaningDays(),
                    request.getDowntimeAccidentDays(),
                    currentUserId);
        } else {
            entity = OperatingTime.builder()
                    .division(request.getDivision())
                    .machineCode(request.getMachineCode())
                    .ym(request.getYm())
                    .totalDays(request.getTotalDays())
                    .plannedShutdownDays(request.getPlannedShutdownDays())
                    .operationNormalDays(request.getOperationNormalDays())
                    .operationWasteDays(request.getOperationWasteDays())
                    .operationUnplannedDays(request.getOperationUnplannedDays())
                    .operationStartupDays(request.getOperationStartupDays())
                    .operationTrimmingDays(request.getOperationTrimmingDays())
                    .downtimeRepairDays(request.getDowntimeRepairDays())
                    .downtimeCleaningDays(request.getDowntimeCleaningDays())
                    .downtimeAccidentDays(request.getDowntimeAccidentDays())
                    .createdBy(currentUserId)
                    .build();
        }

        OperatingTime saved = operatingTimeRepository.save(entity);
        return OperatingTimeResponse.from(saved);
    }
}
