package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.LogiCostLocal;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface LogiCostLocalRepository extends JpaRepository<LogiCostLocal, Long> {

    List<LogiCostLocal> findByYearQuarterAndDivisionAndDeletedYn(String yearQuarter, String division, String deletedYn);

    List<LogiCostLocal> findByDeletedYnOrderByYearQuarterDesc(String deletedYn);

    Optional<LogiCostLocal> findByYearQuarterAndPortOriginAndContainerSizeAndDivisionAndDeletedYn(
            String yearQuarter, String portOrigin, String containerSize, String division, String deletedYn);
}
