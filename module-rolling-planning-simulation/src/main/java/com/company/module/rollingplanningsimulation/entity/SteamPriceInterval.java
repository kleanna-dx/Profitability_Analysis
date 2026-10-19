package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_steam_price_interval") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class SteamPriceInterval {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PRICE_ID") private Long priceId;
    @Column(name="CONTRACT_YEAR",nullable=false,length=10) private String contractYear;
    @Column(name="BOILER_CODE",length=30) private String boilerCode;
    @Column(name="INTERVAL_SEQ",nullable=false) private Integer intervalSeq;
    @Column(name="INTERVAL_NAME",nullable=false,length=100) private String intervalName;
    @Column(name="MIN_USAGE_TON",precision=12,scale=2) private BigDecimal minUsageTon;
    @Column(name="MAX_USAGE_TON",precision=12,scale=2) private BigDecimal maxUsageTon;
    @Column(name="PRICE_PER_TON",precision=12,scale=2) private BigDecimal pricePerTon;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @Builder public SteamPriceInterval(String contractYear,String boilerCode,Integer intervalSeq,String intervalName,BigDecimal minUsageTon,BigDecimal maxUsageTon,BigDecimal pricePerTon,String division,String memo){this.contractYear=contractYear;this.boilerCode=boilerCode;this.intervalSeq=intervalSeq;this.intervalName=intervalName;this.minUsageTon=minUsageTon;this.maxUsageTon=maxUsageTon;this.pricePerTon=pricePerTon!=null?pricePerTon:BigDecimal.ZERO;this.division=division!=null?division:"PS";this.memo=memo;this.createdBy=createdBy;}
}
