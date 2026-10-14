package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BoilerCostRate;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface BoilerCostRateRepository extends JpaRepository<BoilerCostRate, Long> {
    List<BoilerCostRate> findByYearAndDivision(Integer year,String division);
}
