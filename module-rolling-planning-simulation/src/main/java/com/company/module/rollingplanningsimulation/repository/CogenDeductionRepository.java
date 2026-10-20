package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.CogenDeduction;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface CogenDeductionRepository extends JpaRepository<CogenDeduction, Long> {
    List<CogenDeduction> findByYearAndDivision(Integer year, String division);

    // 월별 조회: 해당 월 데이터 + 월 구분 없는 데이터(month=0) 모두 반환
    @Query("SELECT c FROM CogenDeduction c WHERE c.year = :year AND c.division = :division " +
           "AND (c.month = :month OR c.month = 0 OR c.month IS NULL) " +
           "ORDER BY c.itemType ASC")
    List<CogenDeduction> findByYearMonthAndDivision(@Param("year") int year,
                                                     @Param("month") int month,
                                                     @Param("division") String division);
}
