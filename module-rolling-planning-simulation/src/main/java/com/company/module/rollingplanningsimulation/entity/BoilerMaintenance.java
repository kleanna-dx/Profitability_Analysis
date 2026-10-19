package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_boiler_maintenance") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class BoilerMaintenance {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="MAINT_ID") private Long maintId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH",nullable=false) private Integer month;
    @Column(name="BOILER_CODE",nullable=false,length=30) private String boilerCode;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MAINT_TYPE",nullable=false,length=30) private String maintType;
    @Column(name="MAINT_NAME",length=200) private String maintName;
    @Column(name="START_DATE") private LocalDate startDate;
    @Column(name="END_DATE") private LocalDate endDate;
    @Column(name="MAINT_HOURS",precision=8,scale=2) private BigDecimal maintHours;
    @Column(name="CAPACITY_REDUCTION",precision=5,scale=2) private BigDecimal capacityReduction;
    @Column(name="MEMO",length=500) private String memo;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";if(maintType==null)maintType="REGULAR";if(maintHours==null)maintHours=BigDecimal.ZERO;if(capacityReduction==null)capacityReduction=new BigDecimal("100");}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public BoilerMaintenance(Integer year,Integer month,String boilerCode,String division,String maintType,String maintName,LocalDate startDate,LocalDate endDate,BigDecimal maintHours,BigDecimal capacityReduction,String memo){this.year=year;this.month=month;this.boilerCode=boilerCode;this.division=division!=null?division:"PS";this.maintType=maintType!=null?maintType:"REGULAR";this.maintName=maintName;this.startDate=startDate;this.endDate=endDate;this.maintHours=maintHours!=null?maintHours:BigDecimal.ZERO;this.capacityReduction=capacityReduction!=null?capacityReduction:new BigDecimal("100");this.memo=memo;this.createdBy=createdBy;}
    public void update(Integer year,Integer month,String boilerCode,String maintType,String maintName,LocalDate startDate,LocalDate endDate,BigDecimal maintHours,BigDecimal capacityReduction,String memo){this.year=year;this.month=month;this.boilerCode=boilerCode;this.maintType=maintType;this.maintName=maintName;this.startDate=startDate;this.endDate=endDate;this.maintHours=maintHours;this.capacityReduction=capacityReduction;this.memo=memo;this.createdBy=createdBy;}
}
