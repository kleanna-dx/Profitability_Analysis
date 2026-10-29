package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_daily_steam_alloc") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class DailySteamAlloc extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="ALLOC_ID") private Long allocId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH",nullable=false) private Integer month;
    @Column(name="DAY",nullable=false) private Integer day;
    @Column(name="BOILER_CODE",nullable=false,length=30) private String boilerCode;
    @Column(name="ALLOC_TON",precision=12,scale=2) private BigDecimal allocTon;
    @Column(name="ALLOC_TPH",precision=12,scale=4) private BigDecimal allocTph;
    @Column(name="DAILY_DEMAND",precision=12,scale=2) private BigDecimal dailyDemand;
    @Column(name="IS_SHUTDOWN") private Boolean isShutdown;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="IS_LOCKED") private Boolean isLocked;
    @Column(name="LOCKED_BY",length=50) private String lockedBy;
    @Column(name="LOCKED_AT") private LocalDateTime lockedAt;
    @PrePersist protected void onCreate(){if(division==null)division="PS";}
    @Builder public DailySteamAlloc(Integer year,Integer month,Integer day,String boilerCode,BigDecimal allocTon,BigDecimal allocTph,BigDecimal dailyDemand,Boolean isShutdown,String memo,String division,Boolean isLocked,String lockedBy,LocalDateTime lockedAt){
        this.year=year;this.month=month;this.day=day;this.boilerCode=boilerCode;
        this.allocTon=allocTon!=null?allocTon:BigDecimal.ZERO;this.allocTph=allocTph!=null?allocTph:BigDecimal.ZERO;
        this.dailyDemand=dailyDemand!=null?dailyDemand:BigDecimal.ZERO;this.isShutdown=isShutdown!=null?isShutdown:false;
        this.memo=memo;this.division=division!=null?division:"PS";
        this.isLocked=isLocked!=null?isLocked:false;this.lockedBy=lockedBy;this.lockedAt=lockedAt;
    }
}
