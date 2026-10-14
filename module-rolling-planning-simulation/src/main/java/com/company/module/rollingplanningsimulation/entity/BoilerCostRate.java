package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_boiler_cost_rate") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class BoilerCostRate {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="COST_RATE_ID") private Long costRateId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="BOILER_CODE",nullable=false,length=30) private String boilerCode;
    @Column(name="RATE_TYPE",nullable=false,length=30) private String rateType;
    @Column(name="RATE_NAME",nullable=false,length=100) private String rateName;
    @Column(name="RATE_VALUE",precision=18,scale=4) private BigDecimal rateValue;
    @Column(name="RATE_UNIT",length=50) private String rateUnit;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public BoilerCostRate(Integer year,String boilerCode,String rateType,String rateName,BigDecimal rateValue,String rateUnit,String division,String memo){this.year=year;this.boilerCode=boilerCode;this.rateType=rateType;this.rateName=rateName;this.rateValue=rateValue!=null?rateValue:BigDecimal.ZERO;this.rateUnit=rateUnit;this.division=division!=null?division:"PS";this.memo=memo;}
    public void update(String rateName,BigDecimal rateValue,String rateUnit,String memo){this.rateName=rateName;this.rateValue=rateValue;this.rateUnit=rateUnit;this.memo=memo;}
}
