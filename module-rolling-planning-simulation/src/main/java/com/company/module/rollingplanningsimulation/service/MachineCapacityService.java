package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.request.MachineCapacitySaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.MachineCapacityResponse;
import com.company.module.rollingplanningsimulation.entity.MachineCapacity;
import com.company.module.rollingplanningsimulation.repository.MachineCapacityRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class MachineCapacityService {
    private final MachineCapacityRepository repo;

    public List<MachineCapacityResponse> getList(String division) {
        return repo.findByDivisionAndDeletedYnOrderByMachineCode(division != null ? division : "PS", "N").stream().map(MachineCapacityResponse::from).toList();
    }

    @Transactional
    public MachineCapacityResponse save(MachineCapacitySaveRequest request, Long currentUserId) {
        MachineCapacity entity = MachineCapacity.builder()
                .division(request.getDivision()).machineCode(request.getMachineCode())
                .hourlyCapacity(request.getHourlyCapacity()).basisWeightRef(request.getBasisWeightRef())
                .note(request.getNote()).validFrom(request.getValidFrom()).validTo(request.getValidTo())
                .createdBy(currentUserId).build();
        return MachineCapacityResponse.from(repo.save(entity));
    }

    @Transactional
    public MachineCapacityResponse update(Long id, MachineCapacitySaveRequest request, Long currentUserId) {
        MachineCapacity entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("생산능력 데이터를 찾을 수 없습니다: " + id));
        entity.update(request.getHourlyCapacity(), request.getBasisWeightRef(), request.getNote(), request.getValidFrom(), request.getValidTo(), currentUserId);
        return MachineCapacityResponse.from(entity);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        MachineCapacity entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("생산능력 데이터를 찾을 수 없습니다: " + id));
        entity.delete(currentUserId);
    }
}
