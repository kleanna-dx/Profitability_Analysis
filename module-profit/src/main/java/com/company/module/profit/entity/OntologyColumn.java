package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Ontology 컬럼 엔티티
 * - BW DB 테이블의 컬럼과 자연어 동의어를 매핑하는 핵심 메타데이터
 * - 하나의 컬럼에 여러 동의어(Synonym)를 가질 수 있음
 */
@Entity
@Table(name = "profit_ontology_column")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OntologyColumn {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "ONTOLOGY_COLUMN_ID")
    private Long ontologyColumnId;

    @Column(name = "COLUMN_NAME", nullable = false, length = 100)
    private String columnName;

    @Column(name = "TABLE_NAME", nullable = false, length = 200)
    private String tableName;

    @Column(name = "COLUMN_DESCRIPTION", length = 500)
    private String columnDescription;

    @Column(name = "DATA_TYPE", length = 50)
    private String dataType;

    @Column(name = "COLUMN_GROUP", length = 100)
    private String columnGroup;

    @Column(name = "SORT_ORDER")
    private Integer sortOrder;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;

    @Column(name = "CREATED_BY", length = 50)
    private String createdBy;

    @Column(name = "UPDATED_BY", length = 50)
    private String updatedBy;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @OneToMany(mappedBy = "ontologyColumn", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<OntologySynonym> synonyms = new ArrayList<>();

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.isActive == null) {
            this.isActive = true;
        }
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public OntologyColumn(String columnName, String tableName, String columnDescription,
                          String dataType, String columnGroup, Integer sortOrder,
                          Boolean isActive, String createdBy) {
        this.columnName = columnName;
        this.tableName = tableName;
        this.columnDescription = columnDescription;
        this.dataType = dataType;
        this.columnGroup = columnGroup;
        this.sortOrder = sortOrder;
        this.isActive = isActive != null ? isActive : true;
        this.createdBy = createdBy;
    }

    public void update(String columnName, String tableName, String columnDescription,
                       String dataType, String columnGroup, Integer sortOrder,
                       Boolean isActive, String updatedBy) {
        this.columnName = columnName;
        this.tableName = tableName;
        this.columnDescription = columnDescription;
        this.dataType = dataType;
        this.columnGroup = columnGroup;
        this.sortOrder = sortOrder;
        this.isActive = isActive;
        this.updatedBy = updatedBy;
    }

    public void addSynonym(OntologySynonym synonym) {
        this.synonyms.add(synonym);
        synonym.assignColumn(this);
    }

    public void removeSynonym(OntologySynonym synonym) {
        this.synonyms.remove(synonym);
        synonym.assignColumn(null);
    }
}
