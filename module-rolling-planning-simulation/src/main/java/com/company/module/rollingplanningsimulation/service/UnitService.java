package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.request.UnitSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.UnitResponse;
import com.company.module.rollingplanningsimulation.entity.Unit;
import com.company.module.rollingplanningsimulation.repository.UnitRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class UnitService {
    private final UnitRepository unitRepository;

    public List<UnitResponse> getList(String division) {
        if (division != null && !division.isEmpty()) {
            return unitRepository.findByDivisionAndDeletedYnOrderByUnitCode(division, "N").stream().map(UnitResponse::from).toList();
        }
        return unitRepository.findByDeletedYnOrderByDivisionAscUnitCodeAsc("N").stream().map(UnitResponse::from).toList();
    }

    @Transactional
    public UnitResponse save(UnitSaveRequest request, Long currentUserId) {
        Unit entity = Unit.builder()
                .unitCode(request.getUnitCode()).unitName(request.getUnitName())
                .division(request.getDivision()).description(request.getDescription())
                .isActive(request.getIsActive()).createdBy(currentUserId).build();
        return UnitResponse.from(unitRepository.save(entity));
    }

    @Transactional
    public UnitResponse update(Long id, UnitSaveRequest request, Long currentUserId) {
        Unit entity = unitRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("호기를 찾을 수 없습니다: " + id));
        entity.update(request.getUnitName(), request.getDivision(), request.getDescription(), request.getIsActive(), currentUserId);
        return UnitResponse.from(entity);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        Unit entity = unitRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("호기를 찾을 수 없습니다: " + id));
        entity.delete(currentUserId);
    }
}
