package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.LogiRate;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface LogiRateRepository extends JpaRepository<LogiRate, Long> {

    List<LogiRate> findByYearQuarterAndDeletedYnOrderBySortOrder(String yearQuarter, String deletedYn);

    List<LogiRate> findByDeletedYnOrderByYearQuarterDescSortOrderAsc(String deletedYn);
}
