package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.request.PwLineSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwLineResponse;
import com.company.module.rollingplanningsimulation.entity.PwLine;
import com.company.module.rollingplanningsimulation.repository.PwLineRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class PwLineService {
    private final PwLineRepository repo;

    public List<PwLineResponse> getList(String division) {
        return repo.findByDivisionAndDeletedYnOrderByDisplayOrder(division != null ? division : "PS", "N").stream().map(PwLineResponse::from).toList();
    }

    @Transactional
    public PwLineResponse save(PwLineSaveRequest request, Long currentUserId) {
        PwLine entity = PwLine.builder()
                .lineCode(request.getLineCode()).lineName(request.getLineName()).lineGroup(request.getLineGroup())
                .unitType(request.getUnitType()).kwhPerHourRun(request.getKwhPerHourRun())
                .kwhPerHourStby(request.getKwhPerHourStby()).displayOrder(request.getDisplayOrder())
                .isActive(request.getIsActive()).division(request.getDivision()).createdBy(currentUserId).build();
        return PwLineResponse.from(repo.save(entity));
    }

    @Transactional
    public PwLineResponse update(Long id, PwLineSaveRequest request, Long currentUserId) {
        PwLine entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("전력 라인을 찾을 수 없습니다: " + id));
        entity.update(request.getLineName(), request.getLineGroup(), request.getUnitType(), request.getKwhPerHourRun(), request.getKwhPerHourStby(), request.getDisplayOrder(), request.getIsActive(), currentUserId);
        return PwLineResponse.from(entity);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        PwLine entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("전력 라인을 찾을 수 없습니다: " + id));
        entity.delete(currentUserId);
    }
}
