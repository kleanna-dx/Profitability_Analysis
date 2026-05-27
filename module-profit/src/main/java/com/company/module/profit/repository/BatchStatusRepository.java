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

    /** 전체 목록 (최신순) */
    Page<BatchStatus> findByOrderByCreatedAtDesc(Pageable pageable);

    /** 상태별 필터 */
    Page<BatchStatus> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    /** 작업유형별 필터 */
    Page<BatchStatus> findByJobTypeOrderByCreatedAtDesc(String jobType, Pageable pageable);

    /** 상태 + 작업유형 필터 */
    @Query("SELECT bs FROM BatchStatus bs WHERE bs.status = :status " +
           "AND bs.jobType = :jobType ORDER BY bs.createdAt DESC")
    Page<BatchStatus> findByStatusAndJobType(@Param("status") String status,
                                              @Param("jobType") String jobType,
                                              Pageable pageable);

    /** 입력년월(cmonth)별 조회 */
    List<BatchStatus> findByCmonthOrderByCreatedAtDesc(String cmonth);

    /** 날짜 범위별 조회 */
    @Query("SELECT bs FROM BatchStatus bs WHERE bs.createdAt BETWEEN :startDate AND :endDate " +
           "ORDER BY bs.createdAt DESC")
    List<BatchStatus> findByDateRange(@Param("startDate") LocalDateTime startDate,
                                       @Param("endDate") LocalDateTime endDate);

    /** 상태별 건수 통계 */
    @Query("SELECT bs.status, COUNT(bs) FROM BatchStatus bs GROUP BY bs.status")
    List<Object[]> countByStatusGroup();

    /** 실행 중인 배치 조회 */
    @Query("SELECT bs FROM BatchStatus bs WHERE bs.status = 'running'")
    List<BatchStatus> findRunningBatches();
}
