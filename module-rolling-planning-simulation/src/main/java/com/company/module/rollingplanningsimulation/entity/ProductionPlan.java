package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_production_plan") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class ProductionPlan {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PLAN_ID") private Long planId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH",nullable=false) private Integer month;
    @Column(name="PRODUCT",nullable=false,length=50) private String product;
    @Column(name="BASIS_WEIGHT",precision=8,scale=2) private BigDecimal basisWeight;
    @Column(name="TRIM_WIDTH",precision=8,scale=2) private BigDecimal trimWidth;
    @Column(name="THEORY_PROD_TPD",precision=10,scale=2) private BigDecimal theoryProdTpd;
    @Column(name="WASTE_RATE_PCT",precision=5,scale=2) private BigDecimal wasteRatePct;
    @Column(name="GOOD_TON",precision=12,scale=2) private BigDecimal goodTon;
    @Column(name="OPERATION_DAYS",precision=5,scale=1) private BigDecimal operationDays;
    @Column(name="IS_LOCKED") private Boolean isLocked;
    @Column(name="LOCKED_BY",length=50) private String lockedBy;
    @Column(name="LOCKED_AT") private LocalDateTime lockedAt;
    @Column(name="CREATED_BY",length=50) private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";if(isLocked==null)isLocked=false;if(goodTon==null)goodTon=BigDecimal.ZERO;}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    public void updateGoodTon(BigDecimal goodTon,BigDecimal operationDays){this.goodTon=goodTon;this.operationDays=operationDays;}
    public void lock(String userId){this.isLocked=true;this.lockedBy=userId;this.lockedAt=LocalDateTime.now();}
    public void unlock(){this.isLocked=false;this.lockedBy=null;this.lockedAt=null;}
    @Builder public ProductionPlan(String division,String machineCode,Integer year,Integer month,String product,BigDecimal basisWeight,BigDecimal trimWidth,BigDecimal theoryProdTpd,BigDecimal wasteRatePct,BigDecimal goodTon,BigDecimal operationDays,String createdBy){
        this.division=division!=null?division:"PS";this.machineCode=machineCode;this.year=year;this.month=month;this.product=product;
        this.basisWeight=basisWeight;this.trimWidth=trimWidth;this.theoryProdTpd=theoryProdTpd;this.wasteRatePct=wasteRatePct;
        this.goodTon=goodTon!=null?goodTon:BigDecimal.ZERO;this.operationDays=operationDays;this.isLocked=false;this.createdBy=createdBy;
    }
}
