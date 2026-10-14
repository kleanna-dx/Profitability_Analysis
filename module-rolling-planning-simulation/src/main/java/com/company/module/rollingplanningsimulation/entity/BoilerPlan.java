package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_boiler_plan") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class BoilerPlan {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PLAN_ID") private Long planId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH",nullable=false) private Integer month;
    @Column(name="BOILER_CODE",nullable=false,length=30) private String boilerCode;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="TOTAL_DAYS",precision=6,scale=2) private BigDecimal totalDays;
    @Column(name="SHUTDOWN_DAYS",precision=6,scale=2) private BigDecimal shutdownDays;
    @Column(name="OPERATION_DAYS",precision=6,scale=2) private BigDecimal operationDays;
    @Column(name="OPERATION_HOURS",precision=8,scale=2) private BigDecimal operationHours;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public BoilerPlan(Integer year,Integer month,String boilerCode,String division,BigDecimal totalDays,BigDecimal shutdownDays,BigDecimal operationDays,BigDecimal operationHours,String memo){this.year=year;this.month=month;this.boilerCode=boilerCode;this.division=division!=null?division:"PS";this.totalDays=totalDays;this.shutdownDays=shutdownDays;this.operationDays=operationDays;this.operationHours=operationHours;this.memo=memo;}
    public void update(BigDecimal totalDays,BigDecimal shutdownDays,BigDecimal operationDays,BigDecimal operationHours,String memo){this.totalDays=totalDays;this.shutdownDays=shutdownDays;this.operationDays=operationDays;this.operationHours=operationHours;this.memo=memo;}
}
