package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BoilerMaster;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface BoilerMasterRepository extends JpaRepository<BoilerMaster, Long> {
    List<BoilerMaster> findByDivision(String division);
    List<BoilerMaster> findByDivisionAndIsActiveOrderByPriorityAsc(String division, Boolean isActive);

    // 월별 조회: 해당 연/월 데이터만 (연도 0 / 월 0 기본값은 사용하지 않음)
    @Query("SELECT b FROM BoilerMaster b WHERE b.division = :division " +
           "AND b.year = :year AND b.month = :month " +
           "ORDER BY b.priority ASC")
    List<BoilerMaster> findByDivisionAndYearMonth(@Param("division") String division,
                                                   @Param("year") int year,
                                                   @Param("month") int month);
}
