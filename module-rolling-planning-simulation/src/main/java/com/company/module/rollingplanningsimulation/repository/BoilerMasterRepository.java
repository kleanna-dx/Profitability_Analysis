package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BoilerMaster;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface BoilerMasterRepository extends JpaRepository<BoilerMaster, Long> {
    List<BoilerMaster> findByDivision(String division);
    List<BoilerMaster> findByDivisionAndIsActiveOrderByPriorityAsc(String division, Boolean isActive);
}
