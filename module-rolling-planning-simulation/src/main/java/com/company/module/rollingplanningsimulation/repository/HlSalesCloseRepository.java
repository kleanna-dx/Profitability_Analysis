package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.HlSalesClose;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;
import java.util.Optional;
public interface HlSalesCloseRepository extends JpaRepository<HlSalesClose, Long> {
    List<HlSalesClose> findByYmOrderBySalesTeamAsc(String ym);
    Optional<HlSalesClose> findFirstByYmAndSalesTeamAndCloseType(String ym, String salesTeam, String closeType);
}
