package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@SQLRestriction("DELETED_YN = \'N\'")
@Entity @Table(name="rpsim_line_steam_ratio") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class LineSteamRatio extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="RATIO_ID") private Long ratioId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="STEAM_RATIO",precision=6,scale=3) private BigDecimal steamRatio;
    @Column(name="MEMO",length=200) private String memo;
    @PrePersist protected void onCreate(){if(division==null)division="PS";}
    @Builder public LineSteamRatio(Integer year,String division,String machineCode,BigDecimal steamRatio,String memo){
        this.year=year;this.division=division!=null?division:"PS";this.machineCode=machineCode;
        this.steamRatio=steamRatio!=null?steamRatio:BigDecimal.ZERO;this.memo=memo;
    }
    public void update(BigDecimal steamRatio,String memo){this.steamRatio=steamRatio;this.memo=memo;}
}
