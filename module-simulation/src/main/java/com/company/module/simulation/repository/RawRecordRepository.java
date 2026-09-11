package com.company.module.simulation.repository;

import com.company.module.simulation.entity.RawRecord;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface RawRecordRepository extends JpaRepository<RawRecord, Long> {

    Page<RawRecord> findByCalendarYm(String calendarYm, Pageable pageable);

    List<RawRecord> findByCalendarYmAndMachineCode(String calendarYm, String machineCode);

    @Query("SELECT DISTINCT r.calendarYm FROM RawRecord r ORDER BY r.calendarYm DESC")
    List<String> findDistinctCalendarYm();

    @Query("SELECT DISTINCT r.machineCode FROM RawRecord r WHERE r.calendarYm = :ym ORDER BY r.machineCode")
    List<String> findDistinctMachineCodeByYm(@Param("ym") String ym);

    /**
     * 지종별 원재료비 집계 (P/L 시뮬레이터용)
     * product_level2_name 기준으로 그룹핑, SC는 고평량/저평량 분리
     */
    @Query(value = """
        SELECT
            CASE
                WHEN r.PRODUCT_LEVEL2_NAME LIKE 'SC%' AND CAST(r.PRODUCT_LEVEL4_NAME AS UNSIGNED) >= 300
                    THEN 'SC고평량'
                WHEN r.PRODUCT_LEVEL2_NAME LIKE 'SC%' AND CAST(r.PRODUCT_LEVEL4_NAME AS UNSIGNED) < 300
                    THEN 'SC저평량'
                ELSE r.PRODUCT_LEVEL2_NAME
            END AS product,
            SUM(r.PRODUCTION_QTY) / 1000 AS production_ton,
            SUM(r.ISSUE_AMOUNT) AS material_cost
        FROM rpsim_raw_record r
        WHERE r.CALENDAR_YM = :ym
            AND (:machine = 'ALL' OR r.MACHINE_CODE = :machine)
            AND r.PRODUCTION_QTY > 0
        GROUP BY product
        ORDER BY material_cost DESC
        """, nativeQuery = true)
    List<Object[]> findMaterialByProduct(@Param("ym") String ym, @Param("machine") String machine);

    /**
     * 월별 총 생산량/원재료비 집계
     */
    @Query(value = """
        SELECT
            SUM(r.PRODUCTION_QTY) AS total_production_kg,
            SUM(r.ISSUE_AMOUNT) AS total_material_cost
        FROM rpsim_raw_record r
        WHERE r.CALENDAR_YM = :ym
            AND (:machine = 'ALL' OR r.MACHINE_CODE = :machine)
            AND r.PRODUCTION_QTY > 0
        """, nativeQuery = true)
    Object[] findMonthlyTotals(@Param("ym") String ym, @Param("machine") String machine);

    long countByCalendarYm(String calendarYm);

    void deleteByCalendarYm(String calendarYm);
}
