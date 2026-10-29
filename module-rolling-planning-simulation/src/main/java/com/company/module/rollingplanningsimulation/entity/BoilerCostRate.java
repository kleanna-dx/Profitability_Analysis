package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_boiler_cost_rate") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class BoilerCostRate extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="COST_RATE_ID") private Long costRateId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH") private Integer month;
    @Column(name="BOILER_CODE",nullable=false,length=30) private String boilerCode;
    @Column(name="RATE_TYPE",nullable=false,length=30) private String rateType;
    @Column(name="RATE_NAME",nullable=false,length=100) private String rateName;
    @Column(name="RATE_VALUE",precision=18,scale=4) private BigDecimal rateValue;
    @Column(name="RATE_UNIT",length=50) private String rateUnit;
    @Column(name="FACTOR",precision=10,scale=4) private BigDecimal factor;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MEMO",length=200) private String memo;
    @PrePersist protected void onCreate(){if(division==null)division="PS";}
    @Builder public BoilerCostRate(Integer year,Integer month,String boilerCode,String rateType,String rateName,BigDecimal rateValue,String rateUnit,BigDecimal factor,String division,String memo){
        this.year=year;this.month=month!=null?month:0;this.boilerCode=boilerCode;this.rateType=rateType;this.rateName=rateName;
        this.rateValue=rateValue!=null?rateValue:BigDecimal.ZERO;this.rateUnit=rateUnit;
        this.factor=factor!=null?factor:BigDecimal.ONE;
        this.division=division!=null?division:"PS";this.memo=memo;
    }
    public void update(String rateName,BigDecimal rateValue,String rateUnit,BigDecimal factor,String memo,Integer year,Integer month){
        this.rateName=rateName;this.rateValue=rateValue;this.rateUnit=rateUnit;this.memo=memo;
        if(factor!=null) this.factor=factor;
        if(year!=null) this.year=year;
        if(month!=null) this.month=month;
    }
}
