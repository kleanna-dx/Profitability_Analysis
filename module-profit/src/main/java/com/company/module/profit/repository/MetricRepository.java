package com.company.module.profit.repository;

import com.company.module.profit.entity.Metric;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface MetricRepository extends JpaRepository<Metric, Long> {

    Optional<Metric> findByMetricCode(String metricCode);

    Page<Metric> findByIsActiveTrueOrderBySortOrderAsc(Pageable pageable);

    @Query("SELECT m FROM Metric m WHERE m.isActive = true " +
           "AND (LOWER(m.metricCode) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "OR LOWER(m.metricName) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "OR LOWER(m.description) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    Page<Metric> searchByKeyword(@Param("keyword") String keyword, Pageable pageable);

    List<Metric> findByTableNameAndIsActiveTrue(String tableName);

    @Query("SELECT m FROM Metric m LEFT JOIN FETCH m.synonyms WHERE m.isActive = true")
    List<Metric> findAllWithSynonyms();

    @Query("SELECT m FROM Metric m LEFT JOIN FETCH m.synonyms WHERE m.metricCode = :code AND m.isActive = true")
    Optional<Metric> findByMetricCodeWithSynonyms(@Param("code") String code);

    @Query("SELECT m FROM Metric m LEFT JOIN FETCH m.synonyms WHERE m.tableName = :tableName AND m.isActive = true")
    List<Metric> findByTableNameWithSynonyms(@Param("tableName") String tableName);

    boolean existsByMetricCode(String metricCode);
}
