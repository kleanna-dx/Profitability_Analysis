package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/** 구매 이동계획 펄프외 손익영향 (백만원, 악화 = 음수) */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_purchase_non_pulp_impact") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class PurchaseNonPulpImpact extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="IMPACT_ID") private Long impactId;
    @Column(name="VERSION_ID",nullable=false) private Long versionId;
    @Column(name="YM",nullable=false,length=6) private String ym;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="ITEM_GROUP",nullable=false,length=100) private String itemGroup;
    @Column(name="MATL_GROUP_NM",length=100) private String matlGroupNm;
    @Column(name="ITEM_NAME",length=200) private String itemName;
    @Column(name="CONTENT",length=1000) private String content;
    @Column(name="IMPACT_MKRW",nullable=false,precision=18,scale=6) private BigDecimal impactMkrw;
    @Column(name="NOTE",length=1000) private String note;
    @Column(name="EXCEL_ROW_NO") private Integer excelRowNo;

    @Builder
    public PurchaseNonPulpImpact(Long versionId, String ym, String division, String itemGroup, String matlGroupNm,
                                 String itemName, String content, BigDecimal impactMkrw, String note, Integer excelRowNo) {
        this.versionId = versionId; this.ym = ym; this.division = division; this.itemGroup = itemGroup;
        this.matlGroupNm = matlGroupNm; this.itemName = itemName; this.content = content;
        this.impactMkrw = impactMkrw; this.note = note; this.excelRowNo = excelRowNo;
    }
}
