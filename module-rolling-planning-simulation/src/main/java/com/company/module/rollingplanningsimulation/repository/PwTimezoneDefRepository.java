package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwTimezoneDef;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PwTimezoneDefRepository extends JpaRepository<PwTimezoneDef, Long> {
    List<PwTimezoneDef> findByYearAndDivision(Integer year, String division);
    List<PwTimezoneDef> findByYearAndSeasonAndDivision(Integer year, String season, String division);
}
