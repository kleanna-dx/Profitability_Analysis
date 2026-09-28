package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 호기(생산설비) 마스터 엔티티
 * - 호기코드(M01, M02 등), 사업부(PS/HL), 활성 여부 관리
 */
@Entity
@Table(name = "rpsim_unit")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Unit {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "UNIT_ID")
    private Long unitId;

    @Column(name = "UNIT_CODE", nullable = false, length = 20)
    private String unitCode;

    @Column(name = "UNIT_NAME", nullable = false, length = 100)
    private String unitName;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

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
        if (this.division == null) this.division = "PS";
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public Unit(String unitCode, String unitName, String division,
                String description, Boolean isActive, Long createdBy) {
        this.unitCode = unitCode;
        this.unitName = unitName;
        this.division = division != null ? division : "PS";
        this.description = description;
        this.isActive = isActive != null ? isActive : true;
        this.createdBy = createdBy;
        this.deletedYn = "N";
    }

    public void update(String unitName, String division, String description,
                       Boolean isActive, Long updatedBy) {
        this.unitName = unitName;
        this.division = division;
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
