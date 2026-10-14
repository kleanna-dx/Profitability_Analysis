package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwLoadDemand;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface PwLoadDemandRepository extends JpaRepository<PwLoadDemand, Long> {
    List<PwLoadDemand> findByYmAndDivision(String ym, String division);
    Optional<PwLoadDemand> findByYmAndDivisionAndLoadClass(String ym, String division, String loadClass);
}
