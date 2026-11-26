package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.HlProductionPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface HlProductionPlanRepository extends JpaRepository<HlProductionPlan, Long> {
    List<HlProductionPlan> findByYmOrderByMachineAscMaterialCodeAsc(String ym);
}
