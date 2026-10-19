package com.company.module.rollingplanningsimulation.repository;
import com.company.module.rollingplanningsimulation.entity.ProductionPlan;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import java.util.List;

public interface ProductionPlanRepository extends JpaRepository<ProductionPlan, Long> {
    List<ProductionPlan> findByYearAndMonthAndMachineCodeAndDivision(Integer year, Integer month, String machineCode, String division);
    List<ProductionPlan> findByYearAndMonthAndDivision(Integer year, Integer month, String division);

    /** 잠금된 계획만 조회 */
    List<ProductionPlan> findByYearAndMonthAndDivisionAndIsLocked(Integer year, Integer month, String division, Boolean isLocked);

    /** 호기/월 단위 일괄 잠금 */
    @Modifying @Query("UPDATE ProductionPlan p SET p.isLocked=true, p.lockedBy=:userId, p.lockedAt=CURRENT_TIMESTAMP WHERE p.year=:year AND p.month=:month AND p.machineCode=:mc AND p.division=:div")
    int lockByMachineCode(@Param("year") Integer year, @Param("month") Integer month, @Param("mc") String mc, @Param("div") String div, @Param("userId") String userId);

    /** 호기/월 단위 일괄 잠금해제 */
    @Modifying @Query("UPDATE ProductionPlan p SET p.isLocked=false, p.lockedBy=null, p.lockedAt=null WHERE p.year=:year AND p.month=:month AND p.machineCode=:mc AND p.division=:div")
    int unlockByMachineCode(@Param("year") Integer year, @Param("month") Integer month, @Param("mc") String mc, @Param("div") String div);
}
