package com.company.module.simulation.repository;

import com.company.module.simulation.entity.OperatingTime;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface OperatingTimeRepository extends JpaRepository<OperatingTime, Long> {

    List<OperatingTime> findByDivisionAndMachineCodeAndDeletedYnOrderByYm(
            String division, String machineCode, String deletedYn);

    Optional<OperatingTime> findByDivisionAndMachineCodeAndYmAndDeletedYn(
            String division, String machineCode, String ym, String deletedYn);

    List<OperatingTime> findByDivisionAndYmAndDeletedYnOrderByMachineCode(
            String division, String ym, String deletedYn);
}
