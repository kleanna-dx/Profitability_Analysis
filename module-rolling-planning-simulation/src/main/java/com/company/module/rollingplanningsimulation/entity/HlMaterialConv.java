package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;

/**
 * 기준정보 › HL 환산단위 — 자재코드별 1 EA 중량(kg).
 * HL 생산계획 월 생산량(EA) × 1 EA 중량 ÷ 1000 = 생산량(톤) → 전력비·에너지비 계산에 사용.
 * 자재 마스터 RFC 가 생기기 전까지 현업이 입력.
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_hl_material_conv") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class HlMaterialConv extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="CONV_ID") private Long convId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MATERIAL_CODE",nullable=false,length=50) private String materialCode;
    @Column(name="MATERIAL_NAME",length=200) private String materialName;
    @Column(name="KG_PER_EA",nullable=false,precision=14,scale=6) private BigDecimal kgPerEa;
    @Column(name="MEMO",length=500) private String memo;

    @Builder
    public HlMaterialConv(String division, String materialCode, String materialName, BigDecimal kgPerEa, String memo) {
        this.division = division; this.materialCode = materialCode;
        this.materialName = materialName; this.kgPerEa = kgPerEa; this.memo = memo;
    }
}
