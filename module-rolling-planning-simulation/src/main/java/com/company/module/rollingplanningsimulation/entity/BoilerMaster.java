package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_boiler_master") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class BoilerMaster {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="BOILER_ID") private Long boilerId;
    @Column(name="BOILER_CODE",nullable=false,length=30) private String boilerCode;
    @Column(name="BOILER_NAME",nullable=false,length=100) private String boilerName;
    @Column(name="BOILER_TYPE",nullable=false,length=30) private String boilerType;
    @Column(name="STEAM_PER_HOUR",precision=12,scale=2) private BigDecimal steamPerHour;
    @Column(name="PRIORITY",nullable=false) private Integer priority;
    @Column(name="CAPACITY_NOTE",length=200) private String capacityNote;
    @Column(name="IS_ACTIVE") private Boolean isActive;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="DISPLAY_ORDER") private Integer displayOrder;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";if(isActive==null)isActive=true;}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public BoilerMaster(String boilerCode,String boilerName,String boilerType,BigDecimal steamPerHour,Integer priority,String capacityNote,Boolean isActive,String division,Integer displayOrder){this.boilerCode=boilerCode;this.boilerName=boilerName;this.boilerType=boilerType;this.steamPerHour=steamPerHour!=null?steamPerHour:BigDecimal.ZERO;this.priority=priority!=null?priority:99;this.capacityNote=capacityNote;this.isActive=isActive!=null?isActive:true;this.division=division!=null?division:"PS";this.displayOrder=displayOrder!=null?displayOrder:0;}
    public void update(String boilerName,String boilerType,BigDecimal steamPerHour,Integer priority,String capacityNote,Boolean isActive){this.boilerName=boilerName;this.boilerType=boilerType;this.steamPerHour=steamPerHour;this.priority=priority;this.capacityNote=capacityNote;this.isActive=isActive;}
}
