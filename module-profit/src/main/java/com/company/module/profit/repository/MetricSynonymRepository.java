package com.company.module.profit.repository;

import com.company.module.profit.entity.MetricSynonym;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface MetricSynonymRepository extends JpaRepository<MetricSynonym, Long> {

    List<MetricSynonym> findByMetricMetricIdAndIsActiveTrue(Long metricId);

    Optional<MetricSynonym> findBySynonymTextAndMetricMetricId(String synonymText, Long metricId);

    @Query("SELECT ms FROM MetricSynonym ms JOIN FETCH ms.metric " +
           "WHERE LOWER(ms.synonymText) = LOWER(:term) AND ms.isActive = true")
    List<MetricSynonym> findByTermExact(@Param("term") String term);

    @Query("SELECT ms FROM MetricSynonym ms JOIN FETCH ms.metric " +
           "WHERE LOWER(ms.synonymText) LIKE LOWER(CONCAT('%', :term, '%')) AND ms.isActive = true")
    List<MetricSynonym> findByTermContaining(@Param("term") String term);

    @Query("SELECT COUNT(ms) FROM MetricSynonym ms WHERE ms.metric.metricId = :metricId")
    long countByMetricId(@Param("metricId") Long metricId);

    void deleteByMetricMetricId(Long metricId);
}
