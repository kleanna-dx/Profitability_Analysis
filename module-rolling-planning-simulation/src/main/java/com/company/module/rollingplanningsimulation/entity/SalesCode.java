package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;

/**
 * 판매계획 공통 코드 (전사 공통) — CODE_TYPE: SALES_TYPE(판매구분) / PRODUCT_TYPE(제품유형) / COUNTRY(국가)
 * 새 판매구분·제품유형·국가는 화면에서 행만 추가 (소스 수정 없음).
 * COUNTRY_YN: 판매구분 전용 — 'Y' 이면 국가별 수출 시트 입력 대상
 */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_sales_code") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class SalesCode extends BaseAuditEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="CODE_ID") private Long codeId;
    @Column(name="CODE_TYPE",nullable=false,length=20) private String codeType;
    @Column(name="CODE_NAME",nullable=false,length=100) private String codeName;
    @Column(name="COUNTRY_YN",nullable=false,length=1) private String countryYn;
    @Column(name="SORT_ORDER") private Integer sortOrder;
    @Column(name="USE_YN",nullable=false,length=1) private String useYn;
    @Column(name="MEMO",length=500) private String memo;

    @Builder
    public SalesCode(String codeType, String codeName, String countryYn, Integer sortOrder, String useYn, String memo) {
        this.codeType = codeType; this.codeName = codeName;
        this.countryYn = "Y".equals(countryYn) ? "Y" : "N"; this.sortOrder = sortOrder;
        this.useYn = "N".equals(useYn) ? "N" : "Y"; this.memo = memo;
    }
}
