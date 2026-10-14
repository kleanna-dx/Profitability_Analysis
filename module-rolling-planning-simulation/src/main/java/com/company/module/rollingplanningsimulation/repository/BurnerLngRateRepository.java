package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BurnerLngRate;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface BurnerLngRateRepository extends JpaRepository<BurnerLngRate, Long> {
    List<BurnerLngRate> findByYearAndDivision(Integer year,String division);
}
