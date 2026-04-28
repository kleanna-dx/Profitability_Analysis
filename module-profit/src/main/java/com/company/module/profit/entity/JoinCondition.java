package com.company.module.profit.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * JOIN 조건 엔티티
 * - BW 데이터 테이블 간의 연결 조건을 정의
 * - SQL 생성 시 ON 절에 자동 적용
 * - JOIN Type: INNER(교집합) / LEFT(기준테이블 유지)
 */
@Entity
@Table(name = "profit_join_condition")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class JoinCondition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "JOIN_CONDITION_ID")
    private Long joinConditionId;

    @Column(name = "JOIN_NAME", length = 200)
    private String joinName;

    @Column(name = "LEFT_COLUMN", nullable = false, length = 100)
    private String leftColumn;

    @Column(name = "LEFT_TABLE", nullable = false, length = 200)
    private String leftTable;

    @Column(name = "RIGHT_COLUMN", nullable = false, length = 100)
    private String rightColumn;

    @Column(name = "RIGHT_TABLE", nullable = false, length = 200)
    private String rightTable;

    @Column(name = "JOIN_TYPE", nullable = false, length = 20)
    private String joinType;

    @Column(name = "OPERATOR", nullable = false, length = 10)
    private String operator;

    @Column(name = "SORT_ORDER")
    private Integer sortOrder;

    @Column(name = "IS_ACTIVE", nullable = false)
    private Boolean isActive;

    @Column(name = "CREATED_BY", length = 50)
    private String createdBy;

    @Column(name = "UPDATED_BY", length = 50)
    private String updatedBy;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "UPDATED_AT")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        this.updatedAt = LocalDateTime.now();
        if (this.isActive == null) {
            this.isActive = true;
        }
        if (this.operator == null) {
            this.operator = "=";
        }
        if (this.joinType == null) {
            this.joinType = "INNER";
        }
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    @Builder
    public JoinCondition(String joinName, String leftColumn, String leftTable,
                         String rightColumn, String rightTable, String joinType,
                         String operator, Integer sortOrder, Boolean isActive,
                         String createdBy) {
        this.joinName = joinName;
        this.leftColumn = leftColumn;
        this.leftTable = leftTable;
        this.rightColumn = rightColumn;
        this.rightTable = rightTable;
        this.joinType = joinType != null ? joinType : "INNER";
        this.operator = operator != null ? operator : "=";
        this.sortOrder = sortOrder;
        this.isActive = isActive != null ? isActive : true;
        this.createdBy = createdBy;
    }

    public void update(String joinName, String leftColumn, String leftTable,
                       String rightColumn, String rightTable, String joinType,
                       String operator, Integer sortOrder, Boolean isActive,
                       String updatedBy) {
        this.joinName = joinName;
        this.leftColumn = leftColumn;
        this.leftTable = leftTable;
        this.rightColumn = rightColumn;
        this.rightTable = rightTable;
        this.joinType = joinType;
        this.operator = operator;
        this.sortOrder = sortOrder;
        this.isActive = isActive;
        this.updatedBy = updatedBy;
    }
}
