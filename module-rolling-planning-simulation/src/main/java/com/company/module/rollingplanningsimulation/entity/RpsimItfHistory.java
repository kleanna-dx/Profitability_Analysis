package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.time.LocalDateTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_itf_history") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class RpsimItfHistory extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="HISTORY_ID") private Long historyId;
    @Column(name="INTERFACE_ID",nullable=false,length=50) private String interfaceId;
    @Column(name="INTERFACE_NAME",length=200) private String interfaceName;
    @Column(name="JOB_TYPE",length=50) private String jobType;
    @Column(name="RFC_NAME",length=100) private String rfcName;
    @Column(name="TARGET_TABLE",length=100) private String targetTable;
    @Column(name="CMONTH",length=6) private String cmonth;
    @Column(name="EXEC_MODE",length=20) private String execMode;
    @Column(name="STATUS",nullable=false,length=20) private String status;
    @Column(name="STARTED_AT") private LocalDateTime startedAt;
    @Column(name="COMPLETED_AT") private LocalDateTime completedAt;
    @Column(name="DURATION_MS") private Integer durationMs;
    @Column(name="PROCESS_COUNT") private Integer processCount;
    @Column(name="INSERTED_ROWS") private Integer insertedRows;
    @Column(name="DELETED_ROWS") private Integer deletedRows;
    @Column(name="ERROR_MESSAGE",columnDefinition="TEXT") private String errorMessage;
    @Column(name="LOG_TEXT",columnDefinition="LONGTEXT") private String logText;
    @Column(name="EXECUTED_BY",length=50) private String executedBy;
    @Override public void setCreatedBy(String executedBy){super.setCreatedBy(executedBy);this.executedBy=executedBy;}
    @PrePersist protected void onCreate(){if(status==null)status="pending";if(jobType==null)jobType="MANUAL_SYNC";}
    @Builder public RpsimItfHistory(String interfaceId,String interfaceName,String jobType,String rfcName,String targetTable,String cmonth,String execMode,String status,LocalDateTime startedAt,LocalDateTime completedAt,Integer durationMs,Integer processCount,Integer insertedRows,Integer deletedRows,String errorMessage,String logText,String executedBy){
        this.interfaceId=interfaceId;this.interfaceName=interfaceName;
        this.jobType=jobType!=null?jobType:"MANUAL_SYNC";this.rfcName=rfcName;this.targetTable=targetTable;this.cmonth=cmonth;
        this.execMode=execMode!=null?execMode:"replace";this.status=status!=null?status:"pending";
        this.startedAt=startedAt;this.completedAt=completedAt;
        this.durationMs=durationMs!=null?durationMs:0;this.processCount=processCount!=null?processCount:0;
        this.insertedRows=insertedRows!=null?insertedRows:0;this.deletedRows=deletedRows!=null?deletedRows:0;
        this.errorMessage=errorMessage;this.logText=logText;this.executedBy=executedBy;super.setCreatedBy(executedBy);
    }
    public void complete(String status,LocalDateTime completedAt,int durationMs,int processCount,String errorMessage){
        this.status=status;this.completedAt=completedAt;this.durationMs=durationMs;this.processCount=processCount;this.errorMessage=errorMessage;
    }
    public void completeDetail(String status,LocalDateTime completedAt,int durationMs,int insertedRows,int deletedRows,String errorMessage,String logText){
        this.status=status;this.completedAt=completedAt;this.durationMs=durationMs;
        this.insertedRows=insertedRows;this.deletedRows=deletedRows;
        this.processCount=insertedRows;this.errorMessage=errorMessage;
        if(logText!=null){this.logText=this.logText!=null?this.logText+"\n"+logText:logText;}
    }
    public void appendLog(String msg){
        String ts=java.time.LocalDateTime.now().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"));
        String line="["+ts+"] "+msg;
        this.logText=this.logText!=null?this.logText+"\n"+line:line;
    }
}
