package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.DailySteamAlloc;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

public interface DailySteamAllocRepository extends JpaRepository<DailySteamAlloc, Long> {
    List<DailySteamAlloc> findByYearAndMonthAndDivisionOrderByDayAscBoilerCodeAsc(
        Integer year, Integer month, String division);

    @Modifying @Transactional
    @Query("DELETE FROM DailySteamAlloc d WHERE d.year=:year AND d.month=:month AND d.division=:division AND d.isLocked=false")
    int deleteUnlocked(@Param("year") int year, @Param("month") int month, @Param("division") String division);

    @Modifying @Transactional
    @Query("UPDATE DailySteamAlloc d SET d.isLocked=true, d.lockedBy=:userId, d.lockedAt=CURRENT_TIMESTAMP WHERE d.year=:year AND d.month=:month AND d.division=:division")
    int lockAll(@Param("year") int year, @Param("month") int month, @Param("division") String division, @Param("userId") String userId);

    @Modifying @Transactional
    @Query("UPDATE DailySteamAlloc d SET d.isLocked=false, d.lockedBy=null, d.lockedAt=null WHERE d.year=:year AND d.month=:month AND d.division=:division")
    int unlockAll(@Param("year") int year, @Param("month") int month, @Param("division") String division);
}
