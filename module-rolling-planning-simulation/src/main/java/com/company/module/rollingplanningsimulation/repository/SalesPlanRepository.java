package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SalesPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface SalesPlanRepository extends JpaRepository<SalesPlan, Long> {
    List<SalesPlan> findByVersionIdOrderByExcelRowNoAsc(Long versionId);
    List<SalesPlan> findByVersionIdAndYmOrderByExcelRowNoAsc(Long versionId, String ym);
}
