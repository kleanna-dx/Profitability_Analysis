package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;

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
@SQLRestriction("DELETED_YN = \'N\'")
@Entity
@Table(name = "rpsim_unit")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Unit extends BaseAuditEntity {

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








    @PrePersist
    protected void onCreate() {
        if (this.isActive == null) this.isActive = true;
        if (this.division == null) this.division = "PS";
    }


    @Builder
    public Unit(String unitCode, String unitName, String division,
                String description, Boolean isActive) {
        this.unitCode = unitCode;
        this.unitName = unitName;
        this.division = division != null ? division : "PS";
        this.description = description;
        this.isActive = isActive != null ? isActive : true;
    }

    public void update(String unitName, String division, String description,
                       Boolean isActive) {
        this.unitName = unitName;
        this.division = division;
        this.description = description;
        this.isActive = isActive;
    }


}
