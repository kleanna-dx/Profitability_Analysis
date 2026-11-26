package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDateTime;

/** HL 마감 — 년월 × 영업팀 × 구분(SALES=판매계획 / EXPENSE=장려금·마케팅비). 마감되면 입력·업로드 불가 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_hl_sales_close") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class HlSalesClose extends BaseAuditEntity {
    public static final String SALES = "SALES";
    public static final String EXPENSE = "EXPENSE";

    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="CLOSE_ID") private Long closeId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="SALES_TEAM",nullable=false,length=100) private String salesTeam;
    @Column(name="CLOSE_TYPE",nullable=false,length=20) private String closeType;
    @Column(name="IS_CLOSED",nullable=false,length=1) private String isClosed;
    @Column(name="CLOSED_BY",length=50) private String closedBy;
    @Column(name="CLOSED_AT") private LocalDateTime closedAt;

    @Builder
    public HlSalesClose(String ym, String salesTeam, String closeType) {
        this.ym = ym; this.salesTeam = salesTeam; this.closeType = closeType; this.isClosed = "N";
    }

    public boolean closed() { return "Y".equals(isClosed); }
    public void close(String userId) { this.isClosed = "Y"; this.closedBy = userId; this.closedAt = LocalDateTime.now(); }
    public void reopen() { this.isClosed = "N"; this.closedBy = null; this.closedAt = null; }
}
