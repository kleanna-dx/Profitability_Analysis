package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;

/**
 * 폐품률 마스터 (연도×호기×지종별)
 * - 1년간 고정값
 * - 양품 생산계획 = 이론생산성(톤/일) × (1 - 폐품률/100) × 정상가동시간(h) ÷ 24
 */
@Entity @Table(name="rpsim_waste_rate") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class WasteRate {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="WASTE_RATE_ID") private Long wasteRateId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="PRODUCT",length=50) private String product;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="WASTE_RATE_PCT",nullable=false,precision=6,scale=3) private BigDecimal wasteRatePct;
    @Column(name="NOTE",length=200) private String note;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder
    public WasteRate(Integer year,String machineCode,String product,String division,
                     BigDecimal wasteRatePct,String note){
        this.year=year;this.machineCode=machineCode;this.product=product;
        this.division=division!=null?division:"PS";
        this.wasteRatePct=wasteRatePct!=null?wasteRatePct:BigDecimal.ZERO;this.note=note;
    }
    public void update(BigDecimal wasteRatePct,String note){this.wasteRatePct=wasteRatePct;this.note=note;}
}
