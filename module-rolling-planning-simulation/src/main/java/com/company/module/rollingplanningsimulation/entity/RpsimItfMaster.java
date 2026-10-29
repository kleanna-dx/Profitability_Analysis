package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.time.LocalDateTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_itf_master") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class RpsimItfMaster extends BaseAuditEntity {
    @Id @Column(name="INTERFACE_ID",length=50) private String interfaceId;
    @Column(name="INTERFACE_NAME",nullable=false,length=200) private String interfaceName;
    @Column(name="SENDER",nullable=false,length=50) private String sender;
    @Column(name="RECEIVER",nullable=false,length=50) private String receiver;
    @Column(name="RFC_NAME",length=100) private String rfcName;
    @Column(name="RFC_FUNC_OR_URL",length=500) private String rfcFuncOrUrl;
    @Column(name="RFC_PARAM",columnDefinition="TEXT") private String rfcParam;
    @Column(name="TARGET_TABLE",length=100) private String targetTable;
    @Column(name="EXEC_MODE",nullable=false,length=20) private String execMode;
    @Column(name="IS_ACTIVE") private Boolean isActive;
    @Column(name="REMARK",columnDefinition="TEXT") private String remark;
    @PrePersist protected void onCreate(){if(isActive==null)isActive=true;if(execMode==null)execMode="REPLACE";if(receiver==null)receiver="RPSIM";}
    @Builder public RpsimItfMaster(String interfaceId,String interfaceName,String sender,String receiver,String rfcName,String rfcFuncOrUrl,String rfcParam,String targetTable,String execMode,Boolean isActive,String remark,String updatedBy){
        this.interfaceId=interfaceId;this.interfaceName=interfaceName;
        this.sender=sender!=null?sender:"MANUAL";this.receiver=receiver!=null?receiver:"RPSIM";
        this.rfcName=rfcName;this.rfcFuncOrUrl=rfcFuncOrUrl;this.rfcParam=rfcParam;
        this.targetTable=targetTable;this.execMode=execMode!=null?execMode:"REPLACE";
        this.isActive=isActive!=null?isActive:true;this.remark=remark;    }
    public void update(String interfaceName,String sender,String receiver,String rfcName,String rfcFuncOrUrl,String rfcParam,String targetTable,String execMode,Boolean isActive,String remark,String updatedBy){
        this.interfaceName=interfaceName;this.sender=sender;this.receiver=receiver;
        this.rfcName=rfcName;this.rfcFuncOrUrl=rfcFuncOrUrl;this.rfcParam=rfcParam;
        this.targetTable=targetTable;this.execMode=execMode;this.isActive=isActive;
        this.remark=remark;    }
}
