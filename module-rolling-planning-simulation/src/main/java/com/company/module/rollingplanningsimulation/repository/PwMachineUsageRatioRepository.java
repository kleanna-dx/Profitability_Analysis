package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwMachineUsageRatio;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PwMachineUsageRatioRepository extends JpaRepository<PwMachineUsageRatio, Long> {
    List<PwMachineUsageRatio> findByYmAndDivision(String ym, String division);
}
