package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_steam_alloc_ratio") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class SteamAllocRatio {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="ALLOC_ID") private Long allocId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="ALLOC_RATIO",precision=8,scale=6) private BigDecimal allocRatio;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public SteamAllocRatio(Integer year,String machineCode,String division,BigDecimal allocRatio,String memo){this.year=year;this.machineCode=machineCode;this.division=division!=null?division:"PS";this.allocRatio=allocRatio!=null?allocRatio:BigDecimal.ZERO;this.memo=memo;this.createdBy=createdBy;}
    public void update(BigDecimal allocRatio,String memo){this.allocRatio=allocRatio;this.memo=memo;this.createdBy=createdBy;}
}
