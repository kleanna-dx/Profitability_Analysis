package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.math.RoundingMode; import java.time.LocalDateTime;

/**
 * 제지 생산 선속 (호기별/지종별 초지기 선속)
 * 이론 생산량(톤/일) = 평량(g/m²) × 0.001 × 0.001 × 지폭(mm) × 0.001 × 선속(m/min) × 1440
 */
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_machine_speed") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class MachineSpeed extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="SPEED_ID") private Long speedId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="PRODUCT",nullable=false,length=50) private String product;
    @Column(name="BASIS_WEIGHT",precision=8,scale=2) private BigDecimal basisWeight;
    @Column(name="TRIM_WIDTH",precision=8,scale=2) private BigDecimal trimWidth;
    @Column(name="SPEED",precision=8,scale=2) private BigDecimal speed;
    @Column(name="THEORY_PROD_TPD",precision=12,scale=4) private BigDecimal theoryProdTpd;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="NOTE",length=200) private String note;

    @PrePersist protected void onCreate(){
        if(division==null)division="PS";
        calcTheoryProd();
    }
    @PreUpdate protected void onUpdate(){
        calcTheoryProd();
    }

    /** 이론 생산량 자동 계산 */
    private void calcTheoryProd(){
        // 평량·지폭·선속 중 하나라도 없으면 계산하지 않음 (기본값으로 채우지 않음)
        if(basisWeight==null || trimWidth==null || speed==null
                || basisWeight.signum()<=0 || trimWidth.signum()<=0 || speed.signum()<=0){
            theoryProdTpd = null;
            return;
        }
        {
            // 평량(g/m²)×0.001×0.001 × 지폭(mm)×0.001 × 선속(m/min) × 1440
            theoryProdTpd = basisWeight
                .multiply(new BigDecimal("0.000001"))
                .multiply(trimWidth)
                .multiply(new BigDecimal("0.001"))
                .multiply(speed)
                .multiply(new BigDecimal("1440"))
                .setScale(4, RoundingMode.HALF_UP);
        }
    }


    @Builder
    public MachineSpeed(Integer year,String machineCode,String product,BigDecimal basisWeight,
                        BigDecimal trimWidth,BigDecimal speed,String division,String note){
        this.year=year;this.machineCode=machineCode;this.product=product;
        this.basisWeight=basisWeight!=null?basisWeight:BigDecimal.ZERO;
        this.trimWidth=trimWidth; // PM마다 다름 — 기본값 없음
        this.speed=speed!=null?speed:BigDecimal.ZERO;
        this.division=division!=null?division:"PS";this.note=note;
        calcTheoryProd();
    }

    public void update(String product,BigDecimal basisWeight,BigDecimal trimWidth,
                       BigDecimal speed,String note){
        this.product=product;this.basisWeight=basisWeight;this.trimWidth=trimWidth;
        this.speed=speed;this.note=note;
        calcTheoryProd();
    }
}
