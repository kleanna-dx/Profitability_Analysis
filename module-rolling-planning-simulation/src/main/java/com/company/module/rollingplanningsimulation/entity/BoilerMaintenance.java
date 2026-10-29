package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDate; import java.time.LocalDateTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_boiler_maintenance") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class BoilerMaintenance extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="MAINT_ID") private Long maintId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH",nullable=false) private Integer month;
    @Column(name="BOILER_CODE",nullable=false,length=30) private String boilerCode;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MAINT_TYPE",nullable=false,length=30) private String maintType;
    /** 귀책구분: OURS(당사 귀책 — 고정단가 운휴 산정) / PARTNER(협력사 귀책 — 운휴 미산정) */
    @Column(name="RESPONSIBILITY",length=20) private String responsibility;
    @Column(name="MAINT_NAME",length=200) private String maintName;
    @Column(name="START_DATE") private LocalDate startDate;
    @Column(name="END_DATE") private LocalDate endDate;
    @Column(name="MAINT_HOURS",precision=8,scale=2) private BigDecimal maintHours;
    @Column(name="MEMO",length=500) private String memo;
    @PrePersist protected void onCreate(){if(division==null)division="PS";if(maintType==null)maintType="REGULAR";if(maintHours==null)maintHours=BigDecimal.ZERO;}
    @Builder public BoilerMaintenance(Integer year,Integer month,String boilerCode,String division,String maintType,String responsibility,String maintName,LocalDate startDate,LocalDate endDate,BigDecimal maintHours,String memo){this.year=year;this.month=month;this.boilerCode=boilerCode;this.division=division!=null?division:"PS";this.maintType=maintType!=null?maintType:"REGULAR";this.responsibility=responsibility;this.maintName=maintName;this.startDate=startDate;this.endDate=endDate;this.maintHours=maintHours!=null?maintHours:BigDecimal.ZERO;this.memo=memo;}
    public void update(Integer year,Integer month,String boilerCode,String maintType,String maintName,LocalDate startDate,LocalDate endDate,BigDecimal maintHours,String memo){this.year=year;this.month=month;this.boilerCode=boilerCode;this.maintType=maintType;this.maintName=maintName;this.startDate=startDate;this.endDate=endDate;this.maintHours=maintHours;this.memo=memo;}
}
