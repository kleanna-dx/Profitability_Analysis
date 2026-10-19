package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_daily_operation") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class DailyOperation {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="DAILY_OP_ID") private Long dailyOpId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH",nullable=false) private Integer month;
    @Column(name="DAY",nullable=false) private Integer day;
    @Column(name="OPERATION_HOURS",precision=5,scale=2) private BigDecimal operationHours;
    @Column(name="IS_SHUTDOWN") private Boolean isShutdown;
    @Column(name="SHUTDOWN_REASON",length=100) private String shutdownReason;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";if(operationHours==null)operationHours=new BigDecimal("24");if(isShutdown==null)isShutdown=false;}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public DailyOperation(String division,String machineCode,Integer year,Integer month,Integer day,BigDecimal operationHours,Boolean isShutdown,String shutdownReason,String memo){
        this.division=division!=null?division:"PS";this.machineCode=machineCode;this.year=year;this.month=month;this.day=day;
        this.operationHours=operationHours!=null?operationHours:new BigDecimal("24");
        this.isShutdown=isShutdown!=null?isShutdown:false;this.shutdownReason=shutdownReason;this.memo=memo;
    }
    public void update(BigDecimal operationHours,Boolean isShutdown,String shutdownReason,String memo){
        this.operationHours=operationHours;this.isShutdown=isShutdown;this.shutdownReason=shutdownReason;this.memo=memo;
    }
}
