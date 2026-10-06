package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 원부자재 마스터 엔티티
 * - 자재코드, 자재명, 구분(RAW/SUB), 단위(kg/L/EA)
 */
@Entity
@Table(name = "rpsim_material")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Material {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "MATERIAL_ID")
    private Long materialId;

    @Column(name = "MATERIAL_CODE", nullable = false, length = 50)
    private String materialCode;

    @Column(name = "MATERIAL_NAME", nullable = false, length = 200)
    private String materialName;

    @Column(name = "CATEGORY", nullable = false, length = 20)
    private String category;

    @Column(name = "UNIT_OF_MEASURE", nullable = false, length = 20)
    private String unitOfMeasure;

    @Column(name = "DESCRIPTION", length = 500)
    private String description;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "CREATED_BY")
    private Long createdBy;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @Column(name = "UPDATED_BY")
    private Long updatedBy;

    @Column(name = "DELETED_YN", nullable = false, length = 1)
    private String deletedYn;

    @Column(name = "DELETED_AT")
    private LocalDateTime deletedAt;

    @Column(name = "DELETED_BY")
    private Long deletedBy;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.deletedYn == null) this.deletedYn = "N";
        if (this.isActive == null) this.isActive = true;
        if (this.category == null) this.category = "RAW";
        if (this.unitOfMeasure == null) this.unitOfMeasure = "kg";
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public Material(String materialCode, String materialName, String category,
                    String unitOfMeasure, String description, Boolean isActive, Long createdBy) {
        this.materialCode = materialCode;
        this.materialName = materialName;
        this.category = category != null ? category : "RAW";
        this.unitOfMeasure = unitOfMeasure != null ? unitOfMeasure : "kg";
        this.description = description;
        this.isActive = isActive != null ? isActive : true;
        this.createdBy = createdBy;
        this.deletedYn = "N";
    }

    public void update(String materialName, String category, String unitOfMeasure,
                       String description, Boolean isActive, Long updatedBy) {
        this.materialName = materialName;
        this.category = category;
        this.unitOfMeasure = unitOfMeasure;
        this.description = description;
        this.isActive = isActive;
        this.updatedBy = updatedBy;
    }

    public void delete(Long deletedBy) {
        this.deletedYn = "Y";
        this.deletedBy = deletedBy;
        this.deletedAt = LocalDateTime.now();
    }

    public void restore(Long updatedBy) {
        this.deletedYn = "N";
        this.deletedBy = null;
        this.deletedAt = null;
        this.updatedBy = updatedBy;
    }
}
