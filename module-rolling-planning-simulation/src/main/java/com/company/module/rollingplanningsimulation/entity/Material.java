package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 원부자재 마스터 엔티티
 * - SAP BW ZOHPP100/101 기준 필드 매핑
 * - 자재코드, 자재명, 구분(RAW/SUB), 단위, 자재그룹, 대분류
 */
@SQLRestriction("DELETED_YN = \'N\'")
@Entity
@Table(name = "rpsim_material")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Material extends BaseAuditEntity {

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

    @Column(name = "MATERIAL_GROUP", length = 20)
    private String materialGroup;

    @Column(name = "MATERIAL_GROUP_NAME", length = 200)
    private String materialGroupName;

    @Column(name = "MATERIAL_GROUP_LARGE", length = 20)
    private String materialGroupLarge;

    @Column(name = "MATERIAL_GROUP_LARGE_NAME", length = 200)
    private String materialGroupLargeName;

    @Column(name = "DESCRIPTION", length = 500)
    private String description;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;








    @PrePersist
    protected void onCreate() {
        if (this.isActive == null) this.isActive = true;
        if (this.category == null) this.category = "RAW";
        if (this.unitOfMeasure == null) this.unitOfMeasure = "kg";
    }


    @Builder
    public Material(String materialCode, String materialName, String category,
                    String unitOfMeasure, String materialGroup, String materialGroupName,
                    String materialGroupLarge, String materialGroupLargeName,
                    String description, Boolean isActive) {
        this.materialCode = materialCode;
        this.materialName = materialName;
        this.category = category != null ? category : "RAW";
        this.unitOfMeasure = unitOfMeasure != null ? unitOfMeasure : "kg";
        this.materialGroup = materialGroup;
        this.materialGroupName = materialGroupName;
        this.materialGroupLarge = materialGroupLarge;
        this.materialGroupLargeName = materialGroupLargeName;
        this.description = description;
        this.isActive = isActive != null ? isActive : true;
    }

    public void update(String materialName, String category, String unitOfMeasure,
                       String materialGroup, String materialGroupName,
                       String materialGroupLarge, String materialGroupLargeName,
                       String description, Boolean isActive) {
        this.materialName = materialName;
        this.category = category;
        this.unitOfMeasure = unitOfMeasure;
        this.materialGroup = materialGroup;
        this.materialGroupName = materialGroupName;
        this.materialGroupLarge = materialGroupLarge;
        this.materialGroupLargeName = materialGroupLargeName;
        this.description = description;
        this.isActive = isActive;
    }


}
