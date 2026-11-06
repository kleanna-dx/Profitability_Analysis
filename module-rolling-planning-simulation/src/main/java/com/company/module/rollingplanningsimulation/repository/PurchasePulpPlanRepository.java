package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PurchasePulpPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PurchasePulpPlanRepository extends JpaRepository<PurchasePulpPlan, Long> {
    List<PurchasePulpPlan> findByVersionIdOrderByExcelRowNoAscYmAsc(Long versionId);
}
