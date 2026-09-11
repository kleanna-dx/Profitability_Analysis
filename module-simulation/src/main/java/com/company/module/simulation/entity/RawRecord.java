package com.company.module.simulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * SAP BW 원본 데이터 엔티티 (핵심 테이블)
 * - 원부재료비 실적 데이터 전체 37개 컬럼 저장
 * - calendar_ym + machine_code + material_code 기준 조회
 */
@Entity
@Table(name = "rpsim_raw_record")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class RawRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "RECORD_ID")
    private Long recordId;

    @Column(name = "CALENDAR_YM", nullable = false, length = 6)
    private String calendarYm;

    @Column(name = "PROCESS_CODE", length = 20)
    private String processCode;

    @Column(name = "PROCESS_NAME", length = 100)
    private String processName;

    @Column(name = "MACHINE_CODE", length = 20)
    private String machineCode;

    @Column(name = "MACHINE_NAME", length = 100)
    private String machineName;

    @Column(name = "PRODUCT_LEVEL1", length = 20)
    private String productLevel1;

    @Column(name = "PRODUCT_LEVEL1_NAME", length = 100)
    private String productLevel1Name;

    @Column(name = "PRODUCT_LEVEL2", length = 20)
    private String productLevel2;

    @Column(name = "PRODUCT_LEVEL2_NAME", length = 100)
    private String productLevel2Name;

    @Column(name = "PRODUCT_LEVEL3", length = 20)
    private String productLevel3;

    @Column(name = "PRODUCT_LEVEL3_NAME", length = 100)
    private String productLevel3Name;

    @Column(name = "PRODUCT_LEVEL4", length = 20)
    private String productLevel4;

    @Column(name = "PRODUCT_LEVEL4_NAME", length = 100)
    private String productLevel4Name;

    @Column(name = "MATERIAL_CODE", length = 50)
    private String materialCode;

    @Column(name = "MATERIAL_NAME", length = 200)
    private String materialName;

    @Column(name = "MATERIAL_GROUP", length = 50)
    private String materialGroup;

    @Column(name = "MATERIAL_GROUP_NAME", length = 100)
    private String materialGroupName;

    @Column(name = "MATERIAL_GROUP_MAJOR", length = 50)
    private String materialGroupMajor;

    @Column(name = "MATERIAL_GROUP_MAJOR_NAME", length = 100)
    private String materialGroupMajorName;

    @Column(name = "PRODUCT_TYPE_CODE", length = 20)
    private String productTypeCode;

    @Column(name = "PRODUCT_TYPE_NAME", length = 100)
    private String productTypeName;

    @Column(name = "PLAN_UNIT_CONSUMPTION", precision = 18, scale = 6)
    private BigDecimal planUnitConsumption;

    @Column(name = "COMPONENT_QTY", precision = 18, scale = 6)
    private BigDecimal componentQty;

    @Column(name = "BASE_QTY", precision = 18, scale = 6)
    private BigDecimal baseQty;

    @Column(name = "PLAN_UNIT_CONSUMPTION_WASTE", precision = 18, scale = 6)
    private BigDecimal planUnitConsumptionWaste;

    @Column(name = "PLAN_UNIT_PRICE", precision = 18, scale = 4)
    private BigDecimal planUnitPrice;

    @Column(name = "PLAN_ALLOC_QTY", precision = 18, scale = 6)
    private BigDecimal planAllocQty;

    @Column(name = "TOTAL_PRODUCTION", precision = 18, scale = 4)
    private BigDecimal totalProduction;

    @Column(name = "PRODUCTION_QTY", precision = 18, scale = 4)
    private BigDecimal productionQty;

    @Column(name = "WASTE_QTY", precision = 18, scale = 4)
    private BigDecimal wasteQty;

    @Column(name = "ACTUAL_UNIT_CONSUMPTION", precision = 18, scale = 6)
    private BigDecimal actualUnitConsumption;

    @Column(name = "ACTUAL_ALLOC_QTY", precision = 18, scale = 6)
    private BigDecimal actualAllocQty;

    @Column(name = "ACTUAL_UNIT_PRICE", precision = 18, scale = 4)
    private BigDecimal actualUnitPrice;

    @Column(name = "ISSUE_QTY", precision = 18, scale = 4)
    private BigDecimal issueQty;

    @Column(name = "ISSUE_AMOUNT", precision = 18, scale = 4)
    private BigDecimal issueAmount;

    @Column(name = "PLAN_VS_USAGE_DIFF", precision = 18, scale = 4)
    private BigDecimal planVsUsageDiff;

    @Column(name = "PLAN_VS_PRICE_DIFF", precision = 18, scale = 4)
    private BigDecimal planVsPriceDiff;

    @Column(name = "DATA_SOURCE", nullable = false, length = 20)
    private String dataSource;

    @Column(name = "FILE_NAME", length = 300)
    private String fileName;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.dataSource == null) this.dataSource = "SAP_BW";
    }

    @Builder
    public RawRecord(String calendarYm, String machineCode, String machineName,
                     String processCode, String processName,
                     String productLevel1, String productLevel1Name,
                     String productLevel2, String productLevel2Name,
                     String productLevel3, String productLevel3Name,
                     String productLevel4, String productLevel4Name,
                     String materialCode, String materialName,
                     String materialGroup, String materialGroupName,
                     String materialGroupMajor, String materialGroupMajorName,
                     String productTypeCode, String productTypeName,
                     BigDecimal planUnitConsumption, BigDecimal componentQty, BigDecimal baseQty,
                     BigDecimal planUnitConsumptionWaste, BigDecimal planUnitPrice,
                     BigDecimal planAllocQty, BigDecimal totalProduction,
                     BigDecimal productionQty, BigDecimal wasteQty,
                     BigDecimal actualUnitConsumption, BigDecimal actualAllocQty,
                     BigDecimal actualUnitPrice, BigDecimal issueQty, BigDecimal issueAmount,
                     BigDecimal planVsUsageDiff, BigDecimal planVsPriceDiff,
                     String dataSource, String fileName) {
        this.calendarYm = calendarYm;
        this.machineCode = machineCode;
        this.machineName = machineName;
        this.processCode = processCode;
        this.processName = processName;
        this.productLevel1 = productLevel1;
        this.productLevel1Name = productLevel1Name;
        this.productLevel2 = productLevel2;
        this.productLevel2Name = productLevel2Name;
        this.productLevel3 = productLevel3;
        this.productLevel3Name = productLevel3Name;
        this.productLevel4 = productLevel4;
        this.productLevel4Name = productLevel4Name;
        this.materialCode = materialCode;
        this.materialName = materialName;
        this.materialGroup = materialGroup;
        this.materialGroupName = materialGroupName;
        this.materialGroupMajor = materialGroupMajor;
        this.materialGroupMajorName = materialGroupMajorName;
        this.productTypeCode = productTypeCode;
        this.productTypeName = productTypeName;
        this.planUnitConsumption = planUnitConsumption;
        this.componentQty = componentQty;
        this.baseQty = baseQty;
        this.planUnitConsumptionWaste = planUnitConsumptionWaste;
        this.planUnitPrice = planUnitPrice;
        this.planAllocQty = planAllocQty;
        this.totalProduction = totalProduction;
        this.productionQty = productionQty;
        this.wasteQty = wasteQty;
        this.actualUnitConsumption = actualUnitConsumption;
        this.actualAllocQty = actualAllocQty;
        this.actualUnitPrice = actualUnitPrice;
        this.issueQty = issueQty;
        this.issueAmount = issueAmount;
        this.planVsUsageDiff = planVsUsageDiff;
        this.planVsPriceDiff = planVsPriceDiff;
        this.dataSource = dataSource != null ? dataSource : "SAP_BW";
        this.fileName = fileName;
    }
}
