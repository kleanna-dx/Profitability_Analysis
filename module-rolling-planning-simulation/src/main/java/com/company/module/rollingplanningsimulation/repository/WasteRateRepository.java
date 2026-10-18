package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.WasteRate;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface WasteRateRepository extends JpaRepository<WasteRate, Long> {
    List<WasteRate> findByYearAndDivision(Integer year, String division);
}
