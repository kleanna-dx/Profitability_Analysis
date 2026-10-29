package com.company.module.rollingplanningsimulation.entity;

import com.company.module.rollingplanningsimulation.support.CurrentUser;
import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.persistence.Column;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Transient;
import lombok.Getter;

import java.time.LocalDateTime;

/**
 * 공통 감사(Audit) 필드 — 모든 rpsim_ 테이블 공통
 * 생성자/생성일자/수정자/수정일자/삭제자/삭제일자 + 삭제여부(DELETED_YN)
 *
 * <p>삭제는 행을 지우지 않고 DELETED_YN='Y' 로 표시(소프트 삭제)한다.
 * 소프트 삭제 대상 Entity 는 @SQLRestriction("DELETED_YN = 'N'") 으로 조회에서 제외된다.</p>
 */
@MappedSuperclass
@Getter
public abstract class BaseAuditEntity {

    @Column(name = "CREATED_BY", length = 50, updatable = false)
    private String createdBy;

    @Column(name = "CREATED_AT", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_BY", length = 50)
    private String updatedBy;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @Column(name = "DELETED_YN", length = 1)
    private String deletedYn;

    @Column(name = "DELETED_BY", length = 50)
    private String deletedBy;

    @Column(name = "DELETED_AT")
    private LocalDateTime deletedAt;

    /** 응답 전용: 이번 저장이 기존 행 덮어쓰기였는지 (DB 컬럼 아님) */
    @Transient
    private boolean upserted;

    public void markUpserted() {
        this.upserted = true;
        this.updatedAt = LocalDateTime.now();
        this.updatedBy = CurrentUser.get();
    }

    /** 생성자 지정 (미지정 시 저장 시점의 요청 사용자) */
    public void setCreatedBy(String createdBy) {
        if (createdBy != null && !createdBy.isBlank()) this.createdBy = createdBy;
    }

    /** 소프트 삭제 */
    public void softDelete(String deletedBy) {
        this.deletedYn = "Y";
        this.deletedBy = deletedBy;
        this.deletedAt = LocalDateTime.now();
    }

    /** 소프트 삭제 복구 */
    public void restoreDeleted() {
        this.deletedYn = "N";
        this.deletedBy = null;
        this.deletedAt = null;
    }

    @JsonIgnore
    public boolean isDeleted() {
        return "Y".equals(deletedYn);
    }

    @PrePersist
    protected void auditPrePersist() {
        if (this.createdAt == null) this.createdAt = LocalDateTime.now();
        if (this.createdBy == null || this.createdBy.isBlank()) this.createdBy = CurrentUser.get();
        if (this.deletedYn == null) this.deletedYn = "N";
    }

    @PreUpdate
    protected void auditPreUpdate() {
        this.updatedAt = LocalDateTime.now();
        this.updatedBy = CurrentUser.get();
    }
}
