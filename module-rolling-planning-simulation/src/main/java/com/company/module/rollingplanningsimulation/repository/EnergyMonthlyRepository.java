package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.EnergyMonthly;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface EnergyMonthlyRepository extends JpaRepository<EnergyMonthly, Long> {
    Optional<EnergyMonthly> findByYmAndDivision(String ym, String division);
    List<EnergyMonthly> findByDivision(String division);
}
