package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BoilerCostRate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface BoilerCostRateRepository extends JpaRepository<BoilerCostRate, Long> {
    List<BoilerCostRate> findByYearAndDivision(Integer year, String division);

    // 월별 조회: 해당 월(month) + 기본(0) 모두 가져옴 → Controller에서 월별 우선 병합
    @Query("SELECT b FROM BoilerCostRate b WHERE b.year=:year AND (b.month=:month OR b.month=0) AND b.division=:division ORDER BY b.boilerCode, b.rateType, b.month DESC")
    List<BoilerCostRate> findByYearMonthAndDivision(@Param("year") int year, @Param("month") int month, @Param("division") String division);
}
