package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.request.LogiExchangeRateSaveRequest;
import com.company.module.rollingplanningsimulation.dto.response.LogiExchangeRateResponse;
import com.company.module.rollingplanningsimulation.entity.LogiExchangeRate;
import com.company.module.rollingplanningsimulation.repository.LogiExchangeRateRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service @RequiredArgsConstructor @Transactional(readOnly = true)
public class LogiExchangeRateService {
    private final LogiExchangeRateRepository repo;

    public List<LogiExchangeRateResponse> getByYear(Integer year, String division) {
        return repo.findByYearAndDivisionOrderByMonth(year, division != null ? division : "PS").stream().map(LogiExchangeRateResponse::from).toList();
    }

    @Transactional
    public LogiExchangeRateResponse save(LogiExchangeRateSaveRequest request) {
        String div = request.getDivision() != null ? request.getDivision() : "PS";
        String cur = request.getCurrency() != null ? request.getCurrency() : "USD";
        LogiExchangeRate entity = repo.findByYearAndMonthAndDivisionAndCurrency(request.getYear(), request.getMonth(), div, cur).orElse(null);
        if (entity != null) {
            entity.update(request.getRate(), request.getMemo());
            return LogiExchangeRateResponse.from(entity);
        }
        LogiExchangeRate newEntity = LogiExchangeRate.builder()
                .year(request.getYear()).month(request.getMonth()).division(div)
                .currency(cur).rate(request.getRate()).memo(request.getMemo()).build();
        return LogiExchangeRateResponse.from(repo.save(newEntity));
    }
}
