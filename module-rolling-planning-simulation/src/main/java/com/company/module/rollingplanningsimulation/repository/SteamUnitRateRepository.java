package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.SteamUnitRate;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface SteamUnitRateRepository extends JpaRepository<SteamUnitRate, Long> {
    List<SteamUnitRate> findByYearAndDivision(Integer year, String division);

    /** 특정 연도 + 월 조회 */
    List<SteamUnitRate> findByYearAndMonthAndDivision(Integer year, Integer month, String division);

    /** 특정 연도의 특정 월 + 연간(month IS NULL) 데이터 모두 조회 */
    @Query("SELECT s FROM SteamUnitRate s WHERE s.year = :year AND s.division = :division AND (s.month = :month OR s.month IS NULL)")
    List<SteamUnitRate> findByYearAndMonthOrNullAndDivision(@Param("year") Integer year, @Param("month") Integer month, @Param("division") String division);

    /** 복수 연도 + 특정 월 조회 (당해 + 전년 동월 한번에) */
    @Query("SELECT s FROM SteamUnitRate s WHERE s.year IN :years AND s.division = :division AND (s.month = :month OR s.month IS NULL) ORDER BY s.year DESC, s.month ASC NULLS LAST, s.machineCode ASC")
    List<SteamUnitRate> findByYearsAndMonthAndDivision(@Param("years") List<Integer> years, @Param("month") Integer month, @Param("division") String division);
}
