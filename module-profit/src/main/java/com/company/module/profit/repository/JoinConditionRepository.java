package com.company.module.profit.repository;

import com.company.module.profit.entity.JoinCondition;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface JoinConditionRepository extends JpaRepository<JoinCondition, Long> {

    Page<JoinCondition> findByIsActiveTrueOrderBySortOrderAsc(Pageable pageable);

    @Query("SELECT jc FROM JoinCondition jc WHERE jc.isActive = true " +
           "AND (LOWER(jc.leftTable) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "OR LOWER(jc.rightTable) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "OR LOWER(jc.joinName) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    Page<JoinCondition> searchByKeyword(@Param("keyword") String keyword, Pageable pageable);

    List<JoinCondition> findByLeftTableAndIsActiveTrue(String leftTable);

    List<JoinCondition> findByRightTableAndIsActiveTrue(String rightTable);

    @Query("SELECT jc FROM JoinCondition jc WHERE jc.isActive = true " +
           "AND (jc.leftTable = :tableName OR jc.rightTable = :tableName)")
    List<JoinCondition> findByTableInvolved(@Param("tableName") String tableName);

    @Query("SELECT jc FROM JoinCondition jc WHERE jc.isActive = true " +
           "AND ((jc.leftTable = :table1 AND jc.rightTable = :table2) " +
           "OR (jc.leftTable = :table2 AND jc.rightTable = :table1))")
    List<JoinCondition> findByTablePair(@Param("table1") String table1, @Param("table2") String table2);

    List<JoinCondition> findByIsActiveTrueOrderBySortOrderAsc();
}
