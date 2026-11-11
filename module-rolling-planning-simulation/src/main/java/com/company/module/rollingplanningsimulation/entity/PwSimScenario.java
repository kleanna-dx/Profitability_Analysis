package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * 생산량 기반 전력비 — 저장 시나리오. 저장 시점의 입력(생산량·적용 생산성·평균전력·단가·조정값·가산차감·기준정보 버전)과
 * 계산 결과를 JSON 스냅샷으로 보관 → 기준정보가 나중에 바뀌어도 결과가 바뀌지 않음. 저장 시각 = CREATED_AT
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_pw_sim_scenario") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PwSimScenario extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="SCENARIO_ID") private Long scenarioId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="SCENARIO_NAME",nullable=false,length=200) private String scenarioName;
    @Column(name="BASIS_VERSION_ID") private Long basisVersionId;
    @Column(name="BASIS_VERSION_NAME",length=100) private String basisVersionName;
    @Column(name="BASIS_STATUS",length=10) private String basisStatus;
    @Column(name="COMPLETE_YN",nullable=false,length=1) private String completeYn;
    @Column(name="TOTAL_KWH",precision=24,scale=6) private BigDecimal totalKwh;
    @Column(name="FINAL_COST_KRW",precision=18,scale=0) private BigDecimal finalCostKrw;
    @Column(name="INPUT_JSON",nullable=false,columnDefinition="LONGTEXT") private String inputJson;
    @Column(name="RESULT_JSON",nullable=false,columnDefinition="LONGTEXT") private String resultJson;
    @Column(name="MEMO",length=1000) private String memo;

    @Builder
    public PwSimScenario(String division, String ym, String scenarioName, Long basisVersionId, String basisVersionName, String basisStatus,
                         String completeYn, BigDecimal totalKwh, BigDecimal finalCostKrw, String inputJson, String resultJson, String memo) {
        this.division = division; this.ym = ym; this.scenarioName = scenarioName; this.basisVersionId = basisVersionId;
        this.basisVersionName = basisVersionName; this.basisStatus = basisStatus; this.completeYn = completeYn; this.totalKwh = totalKwh;
        this.finalCostKrw = finalCostKrw; this.inputJson = inputJson; this.resultJson = resultJson; this.memo = memo;
    }
}
