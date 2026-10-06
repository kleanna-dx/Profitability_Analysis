package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.LogiExchangeRate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface LogiExchangeRateRepository extends JpaRepository<LogiExchangeRate, Long> {

    List<LogiExchangeRate> findByYearAndDivisionOrderByMonth(Integer year, String division);

    Optional<LogiExchangeRate> findByYearAndMonthAndDivisionAndCurrency(Integer year, Integer month, String division, String currency);
}
