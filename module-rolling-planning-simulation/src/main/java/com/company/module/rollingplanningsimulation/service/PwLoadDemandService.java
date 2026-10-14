package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.dto.request.PwLoadDemandSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwLoadDemandResponse;
import com.company.module.rollingplanningsimulation.entity.PwLoadDemand;
import com.company.module.rollingplanningsimulation.repository.PwLoadDemandRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class PwLoadDemandService {
    private final PwLoadDemandRepository repository;
    public List<PwLoadDemandResponse> getList(String ym, String division) {
        return repository.findByYmAndDivision(ym, division).stream().map(PwLoadDemandResponse::from).toList();
    }
    @Transactional
    public PwLoadDemandResponse save(PwLoadDemandSaveRequest req) {
        PwLoadDemand e = repository.findByYmAndDivisionAndLoadClass(req.getYm(), req.getDivision(), req.getLoadClass())
            .orElse(PwLoadDemand.builder().ym(req.getYm()).division(req.getDivision()).loadClass(req.getLoadClass()).build());
        e.update(req.getHourlyUsageKw(), req.getMemo());
        return PwLoadDemandResponse.from(repository.save(e));
    }
    @Transactional
    public void delete(Long id) { repository.deleteById(id); }
}
