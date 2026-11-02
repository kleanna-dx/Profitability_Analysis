package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.MaterialForecast;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MaterialForecastRepository extends JpaRepository<MaterialForecast, Long> {
    List<MaterialForecast> findByYmAndDivisionAndMachineCode(String ym, String division, String machineCode);
}
