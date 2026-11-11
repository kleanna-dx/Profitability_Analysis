package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal;

/**
 * 기준정보 › 호기별 전력 kW (월별) — 호기가 가동 중 / 운휴 중 시간당 평균 전력사용량(kW)
 * 전력비 시뮬레이션·P/L 전력비가 이 값을 사용. 해당 월 값이 없으면 다른 달 값으로 채우지 않음 (계산 미완료 + 경고)
 * UK: YEAR + MONTH + DIVISION + MACHINE_CODE (MACHINE_CODE = 호기 마스터 코드)
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_pw_line_kw") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PwLineKw extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="LINE_KW_ID") private Long lineKwId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH",nullable=false) private Integer month;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MACHINE_CODE",nullable=false,length=20) private String machineCode;
    @Column(name="RUN_KW",precision=20,scale=6) private BigDecimal runKw;
    @Column(name="IDLE_KW",precision=20,scale=6) private BigDecimal idleKw;
    @Column(name="MEMO",length=500) private String memo;
    @Builder public PwLineKw(Integer year,Integer month,String division,String machineCode,BigDecimal runKw,BigDecimal idleKw,String memo){
        this.year=year;this.month=month;this.division=division;this.machineCode=machineCode;this.runKw=runKw;this.idleKw=idleKw;this.memo=memo;
    }
}
