package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.BoilerMaster;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface BoilerMasterRepository extends JpaRepository<BoilerMaster, Long> {
    List<BoilerMaster> findByDivision(String division);
    List<BoilerMaster> findByDivisionAndIsActiveOrderByPriorityAsc(String division, Boolean isActive);

    // 월별 조회: 해당 연/월 데이터 우선, 없으면 기본(year=0,month=0) 포함
    @Query("SELECT b FROM BoilerMaster b WHERE b.division = :division " +
           "AND ((b.year = :year AND b.month = :month) OR (b.year = 0 AND b.month = 0)) " +
           "ORDER BY b.priority ASC")
    List<BoilerMaster> findByDivisionAndYearMonth(@Param("division") String division,
                                                   @Param("year") int year,
                                                   @Param("month") int month);
}
