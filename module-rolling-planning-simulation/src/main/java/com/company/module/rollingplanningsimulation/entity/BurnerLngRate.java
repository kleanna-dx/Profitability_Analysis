package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_burner_lng_rate") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class BurnerLngRate {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="BURNER_RATE_ID") private Long burnerRateId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="LNG_PER_TON",precision=8,scale=4) private BigDecimal lngPerTon;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public BurnerLngRate(Integer year,String machineCode,String division,BigDecimal lngPerTon,String memo){this.year=year;this.machineCode=machineCode;this.division=division!=null?division:"PS";this.lngPerTon=lngPerTon!=null?lngPerTon:BigDecimal.ZERO;this.memo=memo;}
    public void update(BigDecimal lngPerTon,String memo){this.lngPerTon=lngPerTon;this.memo=memo;}
}
