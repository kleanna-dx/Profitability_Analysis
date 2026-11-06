package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PurchaseIncidentalRate;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.Collection;
import java.util.List;
public interface PurchaseIncidentalRateRepository extends JpaRepository<PurchaseIncidentalRate, Long> {
    List<PurchaseIncidentalRate> findByYearOrderByMaterialCodeAsc(Integer year);
    List<PurchaseIncidentalRate> findByYearIn(Collection<Integer> years);
}
