package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.dto.request.PwMachineUsageRatioSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwMachineUsageRatioResponse;
import com.company.module.rollingplanningsimulation.entity.PwMachineUsageRatio;
import com.company.module.rollingplanningsimulation.repository.PwMachineUsageRatioRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class PwMachineUsageRatioService {
    private final PwMachineUsageRatioRepository repository;
    public List<PwMachineUsageRatioResponse> getList(String ym, String division) {
        return repository.findByYmAndDivision(ym, division).stream().map(PwMachineUsageRatioResponse::from).toList();
    }
    @Transactional
    public PwMachineUsageRatioResponse save(PwMachineUsageRatioSaveRequest req) {
        PwMachineUsageRatio e = PwMachineUsageRatio.builder().ym(req.getYm()).division(req.getDivision())
            .lineCode(req.getLineCode()).usageRatio(req.getUsageRatio()).memo(req.getMemo()).build();
        return PwMachineUsageRatioResponse.from(repository.save(e));
    }
    @Transactional
    public void delete(Long id) { repository.deleteById(id); }
}
