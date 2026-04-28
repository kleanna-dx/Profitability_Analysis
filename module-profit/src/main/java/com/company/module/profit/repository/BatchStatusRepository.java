package com.company.module.profit.repository;

import com.company.module.profit.entity.BatchStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface BatchStatusRepository extends JpaRepository<BatchStatus, Long> {

    Page<BatchStatus> findByOrderByCreatedAtDesc(Pageable pageable);

    Page<BatchStatus> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    Page<BatchStatus> findByBatchTypeOrderByCreatedAtDesc(String batchType, Pageable pageable);

    @Query("SELECT bs FROM BatchStatus bs WHERE bs.status = :status " +
           "AND bs.batchType = :batchType ORDER BY bs.createdAt DESC")
    Page<BatchStatus> findByStatusAndBatchType(@Param("status") String status,
                                                @Param("batchType") String batchType,
                                                Pageable pageable);

    @Query("SELECT bs FROM BatchStatus bs WHERE bs.periodYear = :year " +
           "AND (:month IS NULL OR bs.periodMonth = :month) ORDER BY bs.createdAt DESC")
    List<BatchStatus> findByPeriod(@Param("year") Integer year, @Param("month") Integer month);

    @Query("SELECT bs FROM BatchStatus bs WHERE bs.createdAt BETWEEN :startDate AND :endDate " +
           "ORDER BY bs.createdAt DESC")
    List<BatchStatus> findByDateRange(@Param("startDate") LocalDateTime startDate,
                                       @Param("endDate") LocalDateTime endDate);

    @Query("SELECT bs.status, COUNT(bs) FROM BatchStatus bs GROUP BY bs.status")
    List<Object[]> countByStatusGroup();

    @Query("SELECT bs FROM BatchStatus bs WHERE bs.status = 'RUNNING'")
    List<BatchStatus> findRunningBatches();

    @Query("SELECT bs FROM BatchStatus bs WHERE bs.targetTable = :tableName ORDER BY bs.createdAt DESC")
    Page<BatchStatus> findByTargetTable(@Param("tableName") String tableName, Pageable pageable);
}
