package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwPeakDemand;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface PwPeakDemandRepository extends JpaRepository<PwPeakDemand, Long> {
    Optional<PwPeakDemand> findByYmAndDivision(String ym, String division);
    Optional<PwPeakDemand> findTopByDivisionOrderByYmDesc(String division);
}
