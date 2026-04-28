package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Ontology 동의어 엔티티
 * - 하나의 컬럼에 여러 자연어 표현(동의어)을 매핑
 * - 사용자 질문에서 해당 동의어가 등장하면 실제 DB 컬럼으로 매핑
 */
@Entity
@Table(name = "profit_ontology_synonym")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class OntologySynonym {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "SYNONYM_ID")
    private Long synonymId;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "ONTOLOGY_COLUMN_ID", nullable = false)
    private OntologyColumn ontologyColumn;

    @Column(name = "SYNONYM_TEXT", nullable = false, length = 200)
    private String synonymText;

    @Column(name = "SYNONYM_SOURCE", length = 50)
    private String synonymSource;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.isActive == null) {
            this.isActive = true;
        }
    }

    @Builder
    public OntologySynonym(OntologyColumn ontologyColumn, String synonymText,
                           String synonymSource, Boolean isActive) {
        this.ontologyColumn = ontologyColumn;
        this.synonymText = synonymText;
        this.synonymSource = synonymSource;
        this.isActive = isActive != null ? isActive : true;
    }

    public void assignColumn(OntologyColumn ontologyColumn) {
        this.ontologyColumn = ontologyColumn;
    }

    public void update(String synonymText, String synonymSource, Boolean isActive) {
        this.synonymText = synonymText;
        this.synonymSource = synonymSource;
        this.isActive = isActive;
    }
}
