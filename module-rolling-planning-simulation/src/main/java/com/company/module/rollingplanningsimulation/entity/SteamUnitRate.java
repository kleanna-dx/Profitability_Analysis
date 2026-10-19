package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_steam_unit_rate") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class SteamUnitRate {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="RATE_ID") private Long rateId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH") private Integer month;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="STEAM_PER_TON",precision=8,scale=4) private BigDecimal steamPerTon;
    @Column(name="ETC_USAGE_TON",precision=12,scale=2) private BigDecimal etcUsageTon;
    @Column(name="LIMIT_NOTE",length=500) private String limitNote;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public SteamUnitRate(Integer year,Integer month,String machineCode,String division,BigDecimal steamPerTon,BigDecimal etcUsageTon,String limitNote,String memo){this.year=year;this.month=month;this.machineCode=machineCode;this.division=division!=null?division:"PS";this.steamPerTon=steamPerTon!=null?steamPerTon:BigDecimal.ZERO;this.etcUsageTon=etcUsageTon!=null?etcUsageTon:BigDecimal.ZERO;this.limitNote=limitNote;this.memo=memo;this.createdBy=createdBy;}
    public void update(BigDecimal steamPerTon,BigDecimal etcUsageTon,String limitNote,String memo){this.steamPerTon=steamPerTon;this.etcUsageTon=etcUsageTon;this.limitNote=limitNote;this.memo=memo;this.createdBy=createdBy;}
}
