package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SalesPlanCountry;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface SalesPlanCountryRepository extends JpaRepository<SalesPlanCountry, Long> {
    List<SalesPlanCountry> findByVersionIdOrderByExcelRowNoAsc(Long versionId);
    List<SalesPlanCountry> findByVersionIdAndYmOrderByExcelRowNoAsc(Long versionId, String ym);
}
