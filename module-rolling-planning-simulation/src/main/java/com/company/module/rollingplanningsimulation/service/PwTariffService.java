package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.support.AuditSupport;

import com.company.module.rollingplanningsimulation.dto.request.PwTariffSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwTariffResponse;
import com.company.module.rollingplanningsimulation.entity.PwTariff;
import com.company.module.rollingplanningsimulation.repository.PwTariffRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class PwTariffService {
    private final PwTariffRepository repo;
    private final AuditSupport auditSupport;

    public List<PwTariffResponse> getByYear(Integer year, String division) {
        return repo.findByYearAndDivisionOrderBySeasonAscTimeZoneAsc(year, division != null ? division : "PS").stream().map(PwTariffResponse::from).toList();
    }

    @Transactional
    public PwTariffResponse save(PwTariffSaveRequest request) {
        PwTariff newEntity = PwTariff.builder()
                .year(request.getYear()).season(request.getSeason()).timeZone(request.getTimeZone())
                .demandKrw(request.getDemandKrw()).energyKrw(request.getEnergyKrw())
                .division(request.getDivision()).build();
        return PwTariffResponse.from(auditSupport.upsert(repo, newEntity, "year", "season", "timeZone", "division"));
    }
}
