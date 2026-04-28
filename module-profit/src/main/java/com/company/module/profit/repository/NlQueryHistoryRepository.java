package com.company.module.profit.repository;

import com.company.module.profit.entity.NlQueryHistory;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;

public interface NlQueryHistoryRepository extends JpaRepository<NlQueryHistory, Long> {

    Page<NlQueryHistory> findByUserIdOrderByCreatedAtDesc(Long userId, Pageable pageable);

    Page<NlQueryHistory> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    @Query("SELECT nqh FROM NlQueryHistory nqh WHERE " +
           "LOWER(nqh.naturalQuery) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "ORDER BY nqh.createdAt DESC")
    Page<NlQueryHistory> searchByKeyword(@Param("keyword") String keyword, Pageable pageable);

    @Query("SELECT nqh FROM NlQueryHistory nqh WHERE nqh.userId = :userId " +
           "AND nqh.createdAt BETWEEN :startDate AND :endDate " +
           "ORDER BY nqh.createdAt DESC")
    List<NlQueryHistory> findByUserIdAndDateRange(
            @Param("userId") Long userId,
            @Param("startDate") LocalDateTime startDate,
            @Param("endDate") LocalDateTime endDate);

    List<NlQueryHistory> findByIsBookmarkedTrueAndUserIdOrderByCreatedAtDesc(Long userId);

    @Query("SELECT nqh FROM NlQueryHistory nqh WHERE nqh.feedbackScore IS NOT NULL " +
           "ORDER BY nqh.createdAt DESC")
    Page<NlQueryHistory> findWithFeedback(Pageable pageable);

    @Query("SELECT nqh FROM NlQueryHistory nqh WHERE nqh.status = 'SUCCESS' " +
           "ORDER BY nqh.createdAt DESC")
    List<NlQueryHistory> findRecentSuccessful(Pageable pageable);

    @Query("SELECT COUNT(nqh) FROM NlQueryHistory nqh WHERE nqh.status = :status")
    long countByStatus(@Param("status") String status);

    @Query("SELECT COUNT(nqh) FROM NlQueryHistory nqh WHERE nqh.createdAt >= :since")
    long countSince(@Param("since") LocalDateTime since);

    @Query("SELECT AVG(nqh.executionTimeMs) FROM NlQueryHistory nqh WHERE nqh.status = 'SUCCESS' AND nqh.createdAt >= :since")
    Double avgExecutionTimeSince(@Param("since") LocalDateTime since);
}
