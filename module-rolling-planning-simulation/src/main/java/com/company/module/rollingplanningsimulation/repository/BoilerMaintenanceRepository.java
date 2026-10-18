package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BoilerMaintenance;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface BoilerMaintenanceRepository extends JpaRepository<BoilerMaintenance, Long> {
    List<BoilerMaintenance> findByDivision(String division);
    List<BoilerMaintenance> findByYearAndDivision(Integer year, String division);
    List<BoilerMaintenance> findByYearAndMonthAndDivision(Integer year, Integer month, String division);
    List<BoilerMaintenance> findByBoilerCodeAndYearAndDivision(String boilerCode, Integer year, String division);
}
