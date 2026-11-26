package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.HlCustomerExpense;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import java.util.List;
public interface HlCustomerExpenseRepository extends JpaRepository<HlCustomerExpense, Long> {
    List<HlCustomerExpense> findByYmOrderBySalesTeamAscCustomerCodeAsc(String ym);
    List<HlCustomerExpense> findByYmAndSalesTeamOrderByCustomerCodeAsc(String ym, String salesTeam);
    @Query("SELECT DISTINCT e.salesTeam FROM HlCustomerExpense e ORDER BY e.salesTeam")
    List<String> findTeams();
}
