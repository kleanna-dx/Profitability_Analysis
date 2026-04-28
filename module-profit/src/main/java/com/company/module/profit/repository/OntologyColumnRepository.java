package com.company.module.profit.repository;

import com.company.module.profit.entity.OntologyColumn;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface OntologyColumnRepository extends JpaRepository<OntologyColumn, Long> {

    Page<OntologyColumn> findByIsActiveTrueOrderBySortOrderAsc(Pageable pageable);

    @Query("SELECT oc FROM OntologyColumn oc WHERE oc.isActive = true " +
           "AND (LOWER(oc.columnName) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "OR LOWER(oc.tableName) LIKE LOWER(CONCAT('%', :keyword, '%')) " +
           "OR LOWER(oc.columnDescription) LIKE LOWER(CONCAT('%', :keyword, '%')))")
    Page<OntologyColumn> searchByKeyword(@Param("keyword") String keyword, Pageable pageable);

    List<OntologyColumn> findByTableNameAndIsActiveTrue(String tableName);

    List<OntologyColumn> findByColumnGroupAndIsActiveTrue(String columnGroup);

    Optional<OntologyColumn> findByColumnNameAndTableName(String columnName, String tableName);

    @Query("SELECT DISTINCT oc.tableName FROM OntologyColumn oc WHERE oc.isActive = true ORDER BY oc.tableName")
    List<String> findDistinctTableNames();

    @Query("SELECT DISTINCT oc.columnGroup FROM OntologyColumn oc WHERE oc.columnGroup IS NOT NULL AND oc.isActive = true ORDER BY oc.columnGroup")
    List<String> findDistinctColumnGroups();

    @Query("SELECT oc FROM OntologyColumn oc LEFT JOIN FETCH oc.synonyms WHERE oc.isActive = true")
    List<OntologyColumn> findAllWithSynonyms();

    @Query("SELECT oc FROM OntologyColumn oc LEFT JOIN FETCH oc.synonyms WHERE oc.tableName = :tableName AND oc.isActive = true")
    List<OntologyColumn> findByTableNameWithSynonyms(@Param("tableName") String tableName);
}
