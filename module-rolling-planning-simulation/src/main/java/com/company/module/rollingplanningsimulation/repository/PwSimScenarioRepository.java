package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PwSimScenario;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PwSimScenarioRepository extends JpaRepository<PwSimScenario, Long> {
    List<PwSimScenario> findByDivisionOrderByScenarioIdDesc(String division);
}
