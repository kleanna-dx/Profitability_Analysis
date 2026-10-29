package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_energy_monthly") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class EnergyMonthly extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="ENERGY_ID") private Long energyId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="STEAM_REQUIRED_TON",precision=18,scale=2) private BigDecimal steamRequiredTon;
    @Column(name="STEAM_PRODUCED_TON",precision=18,scale=2) private BigDecimal steamProducedTon;
    @Column(name="STEAM_SURPLUS_TON",precision=18,scale=2) private BigDecimal steamSurplusTon;
    @Column(name="COGEN_COST_KRW",precision=18,scale=2) private BigDecimal cogenCostKrw;
    @Column(name="LNG_BOILER_COST_KRW",precision=18,scale=2) private BigDecimal lngBoilerCostKrw;
    @Column(name="INCIN_COST_KRW",precision=18,scale=2) private BigDecimal incinCostKrw;
    @Column(name="EXTERNAL_COST_KRW",precision=18,scale=2) private BigDecimal externalCostKrw;
    @Column(name="BURNER_LNG_COST_KRW",precision=18,scale=2) private BigDecimal burnerLngCostKrw;
    @Column(name="DEDUCTION_TOTAL_KRW",precision=18,scale=2) private BigDecimal deductionTotalKrw;
    @Column(name="ENERGY_TOTAL_KRW",precision=18,scale=2) private BigDecimal energyTotalKrw;
    @Column(name="COST_PER_TON_STEAM",precision=12,scale=2) private BigDecimal costPerTonSteam;
    @Column(name="COST_PER_TON_PROD",precision=12,scale=2) private BigDecimal costPerTonProd;
    @Column(name="CALC_STATUS",nullable=false,length=20) private String calcStatus;
    @PrePersist protected void onCreate(){if(division==null)division="PS";if(calcStatus==null)calcStatus="DRAFT";}
    @Builder public EnergyMonthly(String ym,String division,String calcStatus){this.ym=ym;this.division=division!=null?division:"PS";this.calcStatus=calcStatus!=null?calcStatus:"DRAFT";}
    public void updateCalc(BigDecimal steamRequiredTon,BigDecimal steamProducedTon,BigDecimal steamSurplusTon,BigDecimal cogenCostKrw,BigDecimal lngBoilerCostKrw,BigDecimal incinCostKrw,BigDecimal externalCostKrw,BigDecimal burnerLngCostKrw,BigDecimal deductionTotalKrw,BigDecimal energyTotalKrw,BigDecimal costPerTonSteam,BigDecimal costPerTonProd,String calcStatus){this.steamRequiredTon=steamRequiredTon;this.steamProducedTon=steamProducedTon;this.steamSurplusTon=steamSurplusTon;this.cogenCostKrw=cogenCostKrw;this.lngBoilerCostKrw=lngBoilerCostKrw;this.incinCostKrw=incinCostKrw;this.externalCostKrw=externalCostKrw;this.burnerLngCostKrw=burnerLngCostKrw;this.deductionTotalKrw=deductionTotalKrw;this.energyTotalKrw=energyTotalKrw;this.costPerTonSteam=costPerTonSteam;this.costPerTonProd=costPerTonProd;this.calcStatus=calcStatus;}
}
