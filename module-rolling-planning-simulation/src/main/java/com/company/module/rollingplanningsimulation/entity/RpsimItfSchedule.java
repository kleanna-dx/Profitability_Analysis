package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.time.LocalDateTime; import java.time.LocalTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_itf_schedule") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class RpsimItfSchedule extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="SCHEDULE_ID") private Long scheduleId;
    @Column(name="INTERFACE_ID",nullable=false,length=50) private String interfaceId;
    @Column(name="SCHEDULE_TYPE",nullable=false,length=20) private String scheduleType;
    @Column(name="EXEC_TIME") private LocalTime execTime;
    @Column(name="EXEC_DATETIME") private LocalDateTime execDatetime;
    @Column(name="EXEC_DAY_OF_MONTH") private Integer execDayOfMonth;
    @Column(name="TARGET_MONTH",length=6) private String targetMonth;
    @Column(name="EXEC_MODE",length=20) private String execMode;
    @Column(name="IS_ACTIVE") private Boolean isActive;
    @Column(name="LAST_RUN_AT") private LocalDateTime lastRunAt;
    @Column(name="LAST_RUN_STATUS",length=20) private String lastRunStatus;
    @Column(name="NEXT_RUN_AT") private LocalDateTime nextRunAt;
    @Column(name="REMARK",length=500) private String remark;
    @PrePersist protected void onCreate(){if(isActive==null)isActive=true;if(scheduleType==null)scheduleType="manual";}
    @Builder public RpsimItfSchedule(String interfaceId,String scheduleType,LocalTime execTime,LocalDateTime execDatetime,Integer execDayOfMonth,String targetMonth,String execMode,Boolean isActive,LocalDateTime lastRunAt,String lastRunStatus,LocalDateTime nextRunAt,String remark,String updatedBy){
        this.interfaceId=interfaceId;this.scheduleType=scheduleType!=null?scheduleType:"manual";
        this.execTime=execTime;this.execDatetime=execDatetime;this.execDayOfMonth=execDayOfMonth;
        this.targetMonth=targetMonth;this.execMode=execMode;
        this.isActive=isActive!=null?isActive:true;
        this.lastRunAt=lastRunAt;this.lastRunStatus=lastRunStatus;this.nextRunAt=nextRunAt;
        this.remark=remark;    }
    public void update(String scheduleType,LocalTime execTime,LocalDateTime execDatetime,Integer execDayOfMonth,String targetMonth,String execMode,Boolean isActive,String remark,String updatedBy){
        this.scheduleType=scheduleType;this.execTime=execTime;this.execDatetime=execDatetime;
        this.execDayOfMonth=execDayOfMonth;this.targetMonth=targetMonth;this.execMode=execMode;
        this.isActive=isActive;this.remark=remark;    }
    public void updateRunStatus(String status,LocalDateTime runAt,LocalDateTime nextRun){
        this.lastRunStatus=status;this.lastRunAt=runAt;this.nextRunAt=nextRun;
    }
}
