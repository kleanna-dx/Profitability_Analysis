package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * 생산량 기반 전력비 — 기준정보 호기 (버전 × 호기). 숫자 칸은 NULL = 미입력 (0 과 구분)
 * PRODUCTIVITY_BASIS: HOUR(단위/h) / DAY(단위/일 — DAY_BASIS_HOURS 필수)
 * SCOPE_MEMO: 평균전력에 포함된 공용설비 범위 설명
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_pw_sim_basis_line") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PwSimBasisLine extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="LINE_ID") private Long lineId;
    @Column(name="VERSION_ID",nullable=false) private Long versionId;
    @Column(name="LINE_CODE",nullable=false,length=30) private String lineCode;
    @Column(name="LINE_NAME",length=100) private String lineName;
    @Column(name="PROCESS_NAME",length=100) private String processName;
    @Column(name="PROD_UNIT",length=20) private String prodUnit;
    @Column(name="PRODUCTIVITY_VALUE",precision=20,scale=6) private BigDecimal productivityValue;
    @Column(name="PRODUCTIVITY_BASIS",length=10) private String productivityBasis;
    @Column(name="PRODUCTIVITY_UNIT",length=20) private String productivityUnit;
    @Column(name="DAY_BASIS_HOURS",precision=6,scale=3) private BigDecimal dayBasisHours;
    @Column(name="RUN_KW",precision=20,scale=6) private BigDecimal runKw;
    @Column(name="IDLE_KW",precision=20,scale=6) private BigDecimal idleKw;
    /** 생산과 무관한 월 고정 사용량(kWh, 음수 가능 — 다른 호기로 분리한 양). FIXED_NOTE 필수 */
    @Column(name="FIXED_KWH",precision=20,scale=6) private BigDecimal fixedKwh;
    @Column(name="FIXED_NOTE",length=500) private String fixedNote;
    /** 엑셀 원본의 생산량·가동시간 (참고용 — 시뮬 기준 생산량 초기값) */
    @Column(name="REF_QTY",precision=24,scale=6) private BigDecimal refQty;
    @Column(name="REF_RUN_HOURS",precision=12,scale=4) private BigDecimal refRunHours;
    @Column(name="SCOPE_MEMO",length=1000) private String scopeMemo;
    @Column(name="SOURCE_NOTE",length=500) private String sourceNote;
    @Column(name="SORT_ORDER") private Integer sortOrder;

    @Builder
    public PwSimBasisLine(Long versionId, String lineCode, String lineName, String processName, String prodUnit,
                          BigDecimal productivityValue, String productivityBasis, String productivityUnit, BigDecimal dayBasisHours,
                          BigDecimal runKw, BigDecimal idleKw, BigDecimal fixedKwh, String fixedNote, BigDecimal refQty, BigDecimal refRunHours,
                          String scopeMemo, String sourceNote, Integer sortOrder) {
        this.versionId = versionId; this.lineCode = lineCode; this.lineName = lineName; this.processName = processName;
        this.prodUnit = prodUnit; this.productivityValue = productivityValue; this.productivityBasis = productivityBasis;
        this.productivityUnit = productivityUnit; this.dayBasisHours = dayBasisHours; this.runKw = runKw; this.idleKw = idleKw;
        this.fixedKwh = fixedKwh; this.fixedNote = fixedNote; this.refQty = refQty; this.refRunHours = refRunHours;
        this.scopeMemo = scopeMemo; this.sourceNote = sourceNote; this.sortOrder = sortOrder;
    }
}
