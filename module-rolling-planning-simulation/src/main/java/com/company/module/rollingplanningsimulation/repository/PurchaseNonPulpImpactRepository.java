package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PurchaseNonPulpImpact;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PurchaseNonPulpImpactRepository extends JpaRepository<PurchaseNonPulpImpact, Long> {
    List<PurchaseNonPulpImpact> findByVersionIdOrderByYmAscExcelRowNoAsc(Long versionId);
}
