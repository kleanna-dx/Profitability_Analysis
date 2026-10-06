package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.request.LogiRateSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.LogiRateResponse;
import com.company.module.rollingplanningsimulation.entity.LogiRate;
import com.company.module.rollingplanningsimulation.repository.LogiRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class LogiRateService {
    private final LogiRateRepository repo;

    public List<LogiRateResponse> getByQuarter(String yearQuarter) {
        if (yearQuarter != null && !yearQuarter.isEmpty()) {
            return repo.findByYearQuarterAndDeletedYnOrderBySortOrder(yearQuarter, "N").stream().map(LogiRateResponse::from).toList();
        }
        return repo.findByDeletedYnOrderByYearQuarterDescSortOrderAsc("N").stream().map(LogiRateResponse::from).toList();
    }

    @Transactional
    public LogiRateResponse save(LogiRateSaveRequest request, Long currentUserId) {
        LogiRate entity = LogiRate.builder()
                .yearQuarter(request.getYearQuarter()).region(request.getRegion()).country(request.getCountry())
                .port(request.getPort()).containerUnit(request.getContainerUnit())
                .volumePerMonth(request.getVolumePerMonth()).rateUsd(request.getRateUsd())
                .memo(request.getMemo()).sortOrder(request.getSortOrder()).createdBy(currentUserId).build();
        return LogiRateResponse.from(repo.save(entity));
    }

    @Transactional
    public LogiRateResponse update(Long id, LogiRateSaveRequest request, Long currentUserId) {
        LogiRate entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("운임 데이터를 찾을 수 없습니다: " + id));
        entity.update(request.getRegion(), request.getCountry(), request.getPort(), request.getContainerUnit(), request.getVolumePerMonth(), request.getRateUsd(), request.getMemo(), request.getSortOrder(), currentUserId);
        return LogiRateResponse.from(entity);
    }

    @Transactional
    public void delete(Long id, Long currentUserId) {
        LogiRate entity = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("운임 데이터를 찾을 수 없습니다: " + id));
        entity.delete(currentUserId);
    }
}
