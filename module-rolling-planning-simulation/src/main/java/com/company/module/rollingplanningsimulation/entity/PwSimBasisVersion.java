package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/**
 * 생산량 기반 전력비 — 기준정보 버전 (사업부별).
 * STATUS: DRAFT(검토용 초기값 — 확정 아님) / APPROVED(현업 승인 — 잠금, 수정하려면 복사해서 새 버전)
 * SOURCE: MANUAL / EXCEL (엑셀에서 읽은 값은 항상 DRAFT 로 시작)
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_pw_sim_basis_version") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PwSimBasisVersion extends BaseAuditEntity {
    public static final String DRAFT = "DRAFT", APPROVED = "APPROVED";
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="VERSION_ID") private Long versionId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="VERSION_NAME",nullable=false,length=100) private String versionName;
    @Column(name="APPLY_YM",length=6) private String applyYm;
    @Column(name="STATUS",nullable=false,length=10) private String status;
    @Column(name="SOURCE",nullable=false,length=10) private String source;
    @Column(name="SOURCE_FILE",length=255) private String sourceFile;
    @Column(name="APPROVED_BY",length=50) private String approvedBy;
    @Column(name="APPROVED_AT") private LocalDateTime approvedAt;
    @Column(name="MEMO",length=1000) private String memo;

    @Builder
    public PwSimBasisVersion(String division, String versionName, String applyYm, String source, String sourceFile, String memo) {
        this.division = division; this.versionName = versionName; this.applyYm = applyYm;
        this.status = DRAFT; this.source = source == null ? "MANUAL" : source; this.sourceFile = sourceFile; this.memo = memo;
    }
    public void changeMeta(String versionName, String applyYm, String memo) { this.versionName = versionName; this.applyYm = applyYm; this.memo = memo; }
    public void approve(String user) { this.status = APPROVED; this.approvedBy = user; this.approvedAt = LocalDateTime.now(); }
    public boolean isApproved() { return APPROVED.equals(status); }
}
