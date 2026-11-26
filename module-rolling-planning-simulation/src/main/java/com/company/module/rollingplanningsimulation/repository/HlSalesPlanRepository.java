package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.HlSalesPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
public interface HlSalesPlanRepository extends JpaRepository<HlSalesPlan, Long> {
    List<HlSalesPlan> findByYmOrderBySalesTeamAscCustomerCodeAscMaterialCodeAsc(String ym);
    List<HlSalesPlan> findByYmAndSalesTeamOrderByCustomerCodeAscMaterialCodeAsc(String ym, String salesTeam);
    @Query("SELECT DISTINCT p.salesTeam FROM HlSalesPlan p ORDER BY p.salesTeam")
    List<String> findTeams();
}
