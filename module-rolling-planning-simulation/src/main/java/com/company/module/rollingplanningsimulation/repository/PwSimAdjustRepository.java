package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.PwSimAdjust;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
public interface PwSimAdjustRepository extends JpaRepository<PwSimAdjust, Long> {
    List<PwSimAdjust> findByDivisionAndYmOrderByAdjustIdAsc(String division, String ym);
}
