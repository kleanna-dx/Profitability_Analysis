package com.company.module.profit.repository;

import com.company.module.profit.entity.MappingInbox;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface MappingInboxRepository extends JpaRepository<MappingInbox, Long> {

    Page<MappingInbox> findByStatusOrderByOccurrenceCountDesc(String status, Pageable pageable);

    Page<MappingInbox> findByTermTypeAndStatusOrderByOccurrenceCountDesc(String termType, String status, Pageable pageable);

    Optional<MappingInbox> findByUnmappedTermAndTermType(String unmappedTerm, String termType);

    @Query("SELECT mi FROM MappingInbox mi WHERE mi.status = 'PENDING' " +
           "ORDER BY mi.occurrenceCount DESC, mi.createdAt ASC")
    Page<MappingInbox> findPendingOrderByPriority(Pageable pageable);

    @Query("SELECT mi FROM MappingInbox mi WHERE " +
           "LOWER(mi.unmappedTerm) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "ORDER BY mi.occurrenceCount DESC")
    Page<MappingInbox> searchByKeyword(@Param("keyword") String keyword, Pageable pageable);

    @Query("SELECT mi.termType, COUNT(mi) FROM MappingInbox mi WHERE mi.status = 'PENDING' GROUP BY mi.termType")
    List<Object[]> countPendingByTermType();

    @Query("SELECT COUNT(mi) FROM MappingInbox mi WHERE mi.status = :status")
    long countByStatus(@Param("status") String status);
}
