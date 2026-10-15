package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.MachineSpeed;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface MachineSpeedRepository extends JpaRepository<MachineSpeed, Long> {
    List<MachineSpeed> findByYearAndDivisionOrderByMachineCodeAscProductAsc(Integer year, String division);
}
