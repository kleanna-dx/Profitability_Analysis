package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 출발항별 컨테이너/부대비용 단가 엔티티
 * - 분기/출발항(광양/부산)/컨테이너 규격/비용
 */
@Entity
@Table(name = "rpsim_logi_cost_local")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class LogiCostLocal {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "LOCAL_COST_ID")
    private Long localCostId;

    @Column(name = "YEAR_QUARTER", nullable = false, length = 10)
    private String yearQuarter;

    @Column(name = "PORT_ORIGIN", nullable = false, length = 50)
    private String portOrigin;

    @Column(name = "CONTAINER_SIZE", nullable = false, length = 10)
    private String containerSize;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "CONTAINER_FEE_KRW", nullable = false, precision = 18, scale = 2)
    private BigDecimal containerFeeKrw;

    @Column(name = "EXTRA_FEE_KRW", nullable = false, precision = 18, scale = 2)
    private BigDecimal extraFeeKrw;

    @Column(name = "MEMO", length = 500)
    private String memo;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "CREATED_BY")
    private Long createdBy;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @Column(name = "UPDATED_BY")
    private Long updatedBy;

    @Column(name = "DELETED_YN", nullable = false, length = 1)
    private String deletedYn;

    @Column(name = "DELETED_AT")
    private LocalDateTime deletedAt;

    @Column(name = "DELETED_BY")
    private Long deletedBy;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.deletedYn == null) this.deletedYn = "N";
        if (this.division == null) this.division = "PS";
        if (this.containerSize == null) this.containerSize = "20ft";
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public LogiCostLocal(String yearQuarter, String portOrigin, String containerSize,
                         String division, BigDecimal containerFeeKrw, BigDecimal extraFeeKrw,
                         String memo, Long createdBy) {
        this.yearQuarter = yearQuarter;
        this.portOrigin = portOrigin;
        this.containerSize = containerSize != null ? containerSize : "20ft";
        this.division = division != null ? division : "PS";
        this.containerFeeKrw = containerFeeKrw != null ? containerFeeKrw : BigDecimal.ZERO;
        this.extraFeeKrw = extraFeeKrw != null ? extraFeeKrw : BigDecimal.ZERO;
        this.memo = memo;
        this.createdBy = createdBy;
        this.deletedYn = "N";
    }

    public void update(BigDecimal containerFeeKrw, BigDecimal extraFeeKrw,
                       String memo, Long updatedBy) {
        this.containerFeeKrw = containerFeeKrw;
        this.extraFeeKrw = extraFeeKrw;
        this.memo = memo;
        this.updatedBy = updatedBy;
    }

    public void delete(Long deletedBy) {
        this.deletedYn = "Y";
        this.deletedBy = deletedBy;
        this.deletedAt = LocalDateTime.now();
    }

    public void restore(Long updatedBy) {
        this.deletedYn = "N";
        this.deletedBy = null;
        this.deletedAt = null;
        this.updatedBy = updatedBy;
    }
}
