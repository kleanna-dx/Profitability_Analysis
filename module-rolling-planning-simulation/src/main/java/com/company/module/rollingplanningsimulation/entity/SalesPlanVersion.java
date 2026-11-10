package com.company.module.rollingplanningsimulation.entity;
import org.hibernate.annotations.SQLRestriction;
import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDate;

/** 판매계획 업로드 버전 (사업부별, 업로드 1건 = 1행). STATUS: ACTIVE / REPLACED */
@SQLRestriction("DELETED_YN = 'N'")
@Entity @Table(name="rpsim_sales_plan_version") @Getter @NoArgsConstructor(access=AccessLevel.PROTECTED)
public class SalesPlanVersion extends BaseAuditEntity {
    public static final String ACTIVE = "ACTIVE";
    public static final String REPLACED = "REPLACED";

    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="VERSION_ID") private Long versionId;
    @Column(name="DIVISION",nullable=false,length=20) private String division;
    @Column(name="START_YM",nullable=false,length=6) private String startYm;
    @Column(name="END_YM",nullable=false,length=6) private String endYm;
    @Column(name="WRITE_DATE") private LocalDate writeDate;
    @Column(name="FILE_NAME",length=255) private String fileName;
    @Column(name="STATUS",nullable=false,length=10) private String status;
    @Column(name="GRADE_ROWS") private Integer gradeRows;
    @Column(name="COUNTRY_ROWS") private Integer countryRows;
    @Column(name="WARNINGS",columnDefinition="TEXT") private String warnings;

    @Builder
    public SalesPlanVersion(String division, String startYm, String endYm, LocalDate writeDate, String fileName) {
        this.division = division; this.startYm = startYm; this.endYm = endYm; this.writeDate = writeDate;
        this.fileName = fileName; this.status = ACTIVE;
    }
    public void markReplaced() { this.status = REPLACED; }
    public void changeStats(int gradeRows, int countryRows, String warnings) {
        this.gradeRows = gradeRows; this.countryRows = countryRows; this.warnings = warnings;
    }
}
