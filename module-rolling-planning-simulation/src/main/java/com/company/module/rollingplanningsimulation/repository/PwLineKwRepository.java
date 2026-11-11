package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.PwLineKw;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface PwLineKwRepository extends JpaRepository<PwLineKw, Long> {
    List<PwLineKw> findByYearAndDivisionOrderByMonthAscMachineCodeAsc(Integer year, String division);
    List<PwLineKw> findByYearAndMonthAndDivisionOrderByMachineCodeAsc(Integer year, Integer month, String division);
}
