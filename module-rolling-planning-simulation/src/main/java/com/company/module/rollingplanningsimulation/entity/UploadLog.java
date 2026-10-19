package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.time.LocalDateTime;

@Entity @Table(name="rpsim_upload_log") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class UploadLog {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="LOG_ID") private Long logId;
    @Column(name="UPLOAD_BATCH_ID",nullable=false,length=50) private String uploadBatchId;
    @Column(name="REF_TYPE",nullable=false,length=50) private String refType;
    @Column(name="ROW_INDEX") private Integer rowIndex;
    @Column(name="ROW_DATA",columnDefinition="TEXT") private String rowData;
    @Column(name="STATUS",nullable=false,length=10) private String status;
    @Column(name="ERROR_MESSAGE",length=500) private String errorMessage;
    @Column(name="UPLOADED_BY",length=50) private String uploadedBy;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";if(status==null)status="FAIL";}
    @Builder
    public UploadLog(String uploadBatchId,String refType,Integer rowIndex,String rowData,String status,String errorMessage,String uploadedBy,String division){
        this.uploadBatchId=uploadBatchId;this.refType=refType;this.rowIndex=rowIndex;this.rowData=rowData;
        this.status=status!=null?status:"FAIL";this.errorMessage=errorMessage;this.uploadedBy=uploadedBy;this.division=division!=null?division:"PS";
    }
}
