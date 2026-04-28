package com.company.module.profit.repository;

import com.company.module.profit.entity.OntologySynonym;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface OntologySynonymRepository extends JpaRepository<OntologySynonym, Long> {

    List<OntologySynonym> findByOntologyColumnOntologyColumnIdAndIsActiveTrue(Long ontologyColumnId);

    Optional<OntologySynonym> findBySynonymTextAndOntologyColumnOntologyColumnId(String synonymText, Long ontologyColumnId);

    @Query("SELECT os FROM OntologySynonym os JOIN FETCH os.ontologyColumn " +
           "WHERE LOWER(os.synonymText) = LOWER(:term) AND os.isActive = true")
    List<OntologySynonym> findByTermExact(@Param("term") String term);

    @Query("SELECT os FROM OntologySynonym os JOIN FETCH os.ontologyColumn " +
           "WHERE LOWER(os.synonymText) LIKE LOWER(CONCAT('%', :term, '%')) AND os.isActive = true")
    List<OntologySynonym> findByTermContaining(@Param("term") String term);

    @Query("SELECT COUNT(os) FROM OntologySynonym os WHERE os.ontologyColumn.ontologyColumnId = :columnId")
    long countByColumnId(@Param("columnId") Long columnId);

    void deleteByOntologyColumnOntologyColumnId(Long ontologyColumnId);
}
