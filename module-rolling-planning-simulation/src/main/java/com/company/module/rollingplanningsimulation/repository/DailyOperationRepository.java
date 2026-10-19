package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.DailyOperation;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;

public interface DailyOperationRepository extends JpaRepository<DailyOperation, Long> {
    List<DailyOperation> findByYearAndMonthAndDivision(Integer year, Integer month, String division);
    List<DailyOperation> findByYearAndMonthAndMachineCodeAndDivision(Integer year, Integer month, String machineCode, String division);
    Optional<DailyOperation> findByYearAndMonthAndDayAndMachineCodeAndDivision(Integer year, Integer month, Integer day, String machineCode, String division);
}
