package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_itf_history") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class RpsimItfHistory {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="HISTORY_ID") private Long historyId;
    @Column(name="INTERFACE_ID",nullable=false,length=50) private String interfaceId;
    @Column(name="INTERFACE_NAME",length=200) private String interfaceName;
    @Column(name="JOB_TYPE",length=50) private String jobType;
    @Column(name="EXEC_MODE",length=20) private String execMode;
    @Column(name="STATUS",nullable=false,length=20) private String status;
    @Column(name="STARTED_AT") private LocalDateTime startedAt;
    @Column(name="COMPLETED_AT") private LocalDateTime completedAt;
    @Column(name="DURATION_MS") private Integer durationMs;
    @Column(name="PROCESS_COUNT") private Integer processCount;
    @Column(name="ERROR_MESSAGE",columnDefinition="TEXT") private String errorMessage;
    @Column(name="EXECUTED_BY",length=50) private String executedBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    public void setCreatedBy(String executedBy){this.executedBy=executedBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(status==null)status="pending";if(jobType==null)jobType="MANUAL_SYNC";}
    @Builder public RpsimItfHistory(String interfaceId,String interfaceName,String jobType,String execMode,String status,LocalDateTime startedAt,LocalDateTime completedAt,Integer durationMs,Integer processCount,String errorMessage,String executedBy){
        this.interfaceId=interfaceId;this.interfaceName=interfaceName;
        this.jobType=jobType!=null?jobType:"MANUAL_SYNC";this.execMode=execMode!=null?execMode:"replace";
        this.status=status!=null?status:"pending";
        this.startedAt=startedAt;this.completedAt=completedAt;
        this.durationMs=durationMs!=null?durationMs:0;this.processCount=processCount!=null?processCount:0;
        this.errorMessage=errorMessage;this.executedBy=executedBy;
    }
    public void complete(String status,LocalDateTime completedAt,int durationMs,int processCount,String errorMessage){
        this.status=status;this.completedAt=completedAt;this.durationMs=durationMs;this.processCount=processCount;this.errorMessage=errorMessage;
    }
}
