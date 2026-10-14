package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BoilerPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface BoilerPlanRepository extends JpaRepository<BoilerPlan, Long> {
    List<BoilerPlan> findByYearAndDivision(Integer year,String division);
}
