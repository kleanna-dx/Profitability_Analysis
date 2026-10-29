package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.support.AuditSupport;
import com.company.module.rollingplanningsimulation.dto.request.PwTimezoneDefSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.PwTimezoneDefResponse;
import com.company.module.rollingplanningsimulation.entity.PwTimezoneDef;
import com.company.module.rollingplanningsimulation.repository.PwTimezoneDefRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class PwTimezoneDefService {
    private final PwTimezoneDefRepository repository;
    private final AuditSupport auditSupport;
    public List<PwTimezoneDefResponse> getList(String division) {
        return repository.findByYearAndDivision(java.time.Year.now().getValue(), division).stream().map(PwTimezoneDefResponse::from).toList();
    }
    public List<PwTimezoneDefResponse> getByYear(Integer year, String division) {
        return repository.findByYearAndDivision(year, division).stream().map(PwTimezoneDefResponse::from).toList();
    }
    @Transactional
    public PwTimezoneDefResponse save(PwTimezoneDefSaveRequest req) {
        PwTimezoneDef e = PwTimezoneDef.builder().year(req.getYear()).season(req.getSeason())
            .dayType(req.getDayType()).loadClass(req.getLoadClass()).startHour(req.getStartHour())
            .endHour(req.getEndHour()).hours(req.getHours()).discountRate(req.getDiscountRate())
            .memo(req.getMemo()).division(req.getDivision()).build();
        return PwTimezoneDefResponse.from(auditSupport.upsert(repository, e, "year", "season", "dayType", "loadClass", "startHour", "division"));
    }
    @Transactional
    public void delete(Long id) { auditSupport.softDelete(repository, id); }
}
