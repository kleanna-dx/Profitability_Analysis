package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PurchasePlanVersion;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
public interface PurchasePlanVersionRepository extends JpaRepository<PurchasePlanVersion, Long> {
    List<PurchasePlanVersion> findByStartYmAndStatus(String startYm, String status);
    List<PurchasePlanVersion> findAllByOrderByVersionIdDesc();
    /** 해당 월을 포함하는 ACTIVE 버전 중 시작월이 가장 늦은 것 */
    Optional<PurchasePlanVersion> findFirstByStatusAndStartYmLessThanEqualAndEndYmGreaterThanEqualOrderByStartYmDescVersionIdDesc(
            String status, String ym1, String ym2);
}
