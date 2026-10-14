package com.company.module.rollingplanningsimulation.service;
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
    public List<PwPeakDemandResponse> getList(String division) {
        return repository.findAll().stream()
            .filter(e -> division.equals(e.getDivision()))
            .map(PwPeakDemandResponse::from).toList();
    }
    @Transactional
    public PwPeakDemandResponse save(PwPeakDemandSaveRequest req) {
        PwPeakDemand e = repository.findByYmAndDivision(req.getYm(), req.getDivision())
            .orElse(PwPeakDemand.builder().ym(req.getYm()).division(req.getDivision()).build());
        e.update(req.getMeasuredKw(), req.getEffectiveKw(), req.getCarryOriginYm(), req.getCarryExpireYm());
        return PwPeakDemandResponse.from(repository.save(e));
    }
    @Transactional
    public void delete(Long id) { repository.deleteById(id); }
}
