package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.request.LogiCostLocalSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.LogiCostLocalResponse;
import com.company.module.rollingplanningsimulation.entity.LogiCostLocal;
import com.company.module.rollingplanningsimulation.repository.LogiCostLocalRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class LogiCostLocalService {
    private final LogiCostLocalRepository repo;

    public List<LogiCostLocalResponse> getList(String yearQuarter, String division) {
        if (yearQuarter != null && !yearQuarter.isEmpty()) {
            return repo.findByYearQuarterAndDivisionAndDeletedYn(yearQuarter, division != null ? division : "PS", "N").stream().map(LogiCostLocalResponse::from).toList();
        }
        return repo.findByDeletedYnOrderByYearQuarterDesc("N").stream().map(LogiCostLocalResponse::from).toList();
    }

    @Transactional
    public LogiCostLocalResponse save(LogiCostLocalSaveRequest request, Long currentUserId) {
        LogiCostLocal entity = LogiCostLocal.builder()
                .yearQuarter(request.getYearQuarter()).portOrigin(request.getPortOrigin())
                .containerSize(request.getContainerSize()).division(request.getDivision())
                .containerFeeKrw(request.getContainerFeeKrw()).extraFeeKrw(request.getExtraFeeKrw())
                .memo(request.getMemo()).createdBy(currentUserId).build();
        return LogiCostLocalResponse.from(repo.save(entity));
    }

    @Transactional
    public LogiCostLocalResponse update(Long id, LogiCostLocalSaveRequest request, Long currentUserId) {
        LogiCostLocal entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("국내운임 데이터를 찾을 수 없습니다: " + id));
        entity.update(request.getContainerFeeKrw(), request.getExtraFeeKrw(), request.getMemo(), currentUserId);
        return LogiCostLocalResponse.from(entity);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        LogiCostLocal entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("국내운임 데이터를 찾을 수 없습니다: " + id));
        entity.delete(currentUserId);
    }
}
