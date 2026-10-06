package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.request.MaterialSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.MaterialResponse;
import com.company.module.rollingplanningsimulation.entity.Material;
import com.company.module.rollingplanningsimulation.repository.MaterialRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class MaterialService {
    private final MaterialRepository materialRepository;

    public Page<MaterialResponse> getList(String q, int page, int size) {
        return materialRepository.findByDeletedYnAndMaterialNameContaining("N", q == null ? "" : q, PageRequest.of(page, size)).map(MaterialResponse::from);
    }

    @Transactional
    public MaterialResponse save(MaterialSaveRequest request, Long currentUserId) {
        Material entity = Material.builder()
                .materialCode(request.getMaterialCode()).materialName(request.getMaterialName())
                .category(request.getCategory()).unitOfMeasure(request.getUnitOfMeasure())
                .description(request.getDescription()).isActive(request.getIsActive())
                .createdBy(currentUserId).build();
        return MaterialResponse.from(materialRepository.save(entity));
    }

    @Transactional
    public MaterialResponse update(Long id, MaterialSaveRequest request, Long currentUserId) {
        Material entity = materialRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("자재를 찾을 수 없습니다: " + id));
        entity.update(request.getMaterialName(), request.getCategory(), request.getUnitOfMeasure(), request.getDescription(), request.getIsActive(), currentUserId);
        return MaterialResponse.from(entity);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        Material entity = materialRepository.findById(id).orElseThrow(() -> new IllegalArgumentException("자재를 찾을 수 없습니다: " + id));
        entity.delete(currentUserId);
    }
}
