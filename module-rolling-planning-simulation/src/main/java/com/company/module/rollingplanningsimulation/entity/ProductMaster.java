package com.company.module.rollingplanningsimulation.entity;
import jakarta.persistence.*;
import lombok.*; import java.time.LocalDateTime;

@Entity @Table(name="rpsim_product_master") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class ProductMaster {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="PRODUCT_ID") private Long productId;
    @Column(name="PRODUCT_CODE",nullable=false,length=30) private String productCode;
    @Column(name="PRODUCT_NAME",nullable=false,length=100) private String productName;
    @Column(name="PRODUCT_GROUP",length=50) private String productGroup;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="DISPLAY_ORDER") private Integer displayOrder;
    @Column(name="IS_ACTIVE") private Boolean isActive;
    @Column(name="CREATED_BY") private String createdBy;
    @Column(name="CREATED_AT",updatable=false) private LocalDateTime createdAt;
    @Column(name="UPDATED_AT") private LocalDateTime updatedAt;
    public void setCreatedBy(String createdBy){this.createdBy=createdBy;}
    @PrePersist protected void onCreate(){createdAt=LocalDateTime.now();if(division==null)division="PS";if(isActive==null)isActive=true;}
    @PreUpdate protected void onUpdate(){updatedAt=LocalDateTime.now();}
    @Builder
    public ProductMaster(String productCode,String productName,String productGroup,String division,Integer displayOrder,Boolean isActive){
        this.productCode=productCode;this.productName=productName;this.productGroup=productGroup;
        this.division=division!=null?division:"PS";this.displayOrder=displayOrder!=null?displayOrder:0;
        this.isActive=isActive!=null?isActive:true;
    }
    public void update(String productName,String productGroup,Boolean isActive){this.productName=productName;this.productGroup=productGroup;this.isActive=isActive;}
}
