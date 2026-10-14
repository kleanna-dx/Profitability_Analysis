package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwMonthlySummary;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Optional;

public interface PwMonthlySummaryRepository extends JpaRepository<PwMonthlySummary, Long> {
    Optional<PwMonthlySummary> findByYmAndDivision(String ym, String division);
    long countByYmAndDivision(String ym, String division);
}
