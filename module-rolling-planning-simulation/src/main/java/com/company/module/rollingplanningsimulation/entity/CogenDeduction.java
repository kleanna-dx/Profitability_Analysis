package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.math.BigDecimal; import java.time.LocalDateTime;
@Entity @Table(name="rpsim_cogen_deduction") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class CogenDeduction {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="DEDUCTION_ID") private Long deductionId;
    @Column(name="YEAR",nullable=false) private Integer year;
    @Column(name="MONTH") private Integer month;
    @Column(name="ITEM_TYPE",nullable=false,length=30) private String itemType;
    @Column(name="ITEM_NAME",nullable=false,length=100) private String itemName;
    @Column(name="MONTHLY_AMOUNT",precision=18,scale=2) private BigDecimal monthlyAmount;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="MEMO",length=200) private String memo;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder public CogenDeduction(Integer year,Integer month,String itemType,String itemName,BigDecimal monthlyAmount,String division,String memo){this.year=year;this.month=month!=null?month:0;this.itemType=itemType;this.itemName=itemName;this.monthlyAmount=monthlyAmount!=null?monthlyAmount:BigDecimal.ZERO;this.division=division!=null?division:"PS";this.memo=memo;this.createdBy=createdBy;}
    public void update(String itemName,BigDecimal monthlyAmount,String memo,Integer month){this.itemName=itemName;this.monthlyAmount=monthlyAmount;this.memo=memo;if(month!=null)this.month=month;}
}
