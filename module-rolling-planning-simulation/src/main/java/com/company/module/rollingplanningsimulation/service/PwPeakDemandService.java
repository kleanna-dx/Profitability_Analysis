package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.dto.request.PwPeakDemandSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwPeakDemandResponse;
import com.company.module.rollingplanningsimulation.entity.PwPeakDemand;
import com.company.module.rollingplanningsimulation.repository.PwPeakDemandRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class PwPeakDemandService {
    private final PwPeakDemandRepository repository;
    private final AuditSupport auditSupport;
    public List<PwPeakDemandResponse> getList(String division) {
        return repository.findAll().stream()
            .filter(e -> division.equals(e.getDivision()))
            .map(PwPeakDemandResponse::from).toList();
    }
    @Transactional
    public PwPeakDemandResponse save(PwPeakDemandSaveRequest req) {
        PwPeakDemand e = PwPeakDemand.builder().ym(req.getYm()).division(req.getDivision()).build();
        e.update(req.getMeasuredKw(), req.getEffectiveKw(), req.getCarryOriginYm(), req.getCarryExpireYm());
        return PwPeakDemandResponse.from(auditSupport.upsert(repository, e, "ym", "division"));
    }
    @Transactional
    public void delete(Long id) { auditSupport.softDelete(repository, id); }
}
