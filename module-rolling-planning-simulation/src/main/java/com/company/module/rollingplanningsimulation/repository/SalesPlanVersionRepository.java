package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SalesPlanVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
public interface SalesPlanVersionRepository extends JpaRepository<SalesPlanVersion, Long> {
    List<SalesPlanVersion> findByDivisionAndStartYmAndStatus(String division, String startYm, String status);
    List<SalesPlanVersion> findByDivisionOrderByVersionIdDesc(String division);
    /** 해당 월을 포함하는 ACTIVE 버전 중 시작월이 가장 늦은 것 */
    Optional<SalesPlanVersion> findFirstByDivisionAndStatusAndStartYmLessThanEqualAndEndYmGreaterThanEqualOrderByStartYmDescVersionIdDesc(
            String division, String status, String ym1, String ym2);
}
