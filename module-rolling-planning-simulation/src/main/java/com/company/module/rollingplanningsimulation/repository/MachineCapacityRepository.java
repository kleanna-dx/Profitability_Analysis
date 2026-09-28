package com.company.module.rollingplanningsimulation.repository;

import com.company.module.rollingplanningsimulation.entity.MachineCapacity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface MachineCapacityRepository extends JpaRepository<MachineCapacity, Long> {

    List<MachineCapacity> findByDivisionAndDeletedYnOrderByMachineCode(String division, String deletedYn);

    List<MachineCapacity> findByDivisionAndMachineCodeAndDeletedYn(String division, String machineCode, String deletedYn);
}
