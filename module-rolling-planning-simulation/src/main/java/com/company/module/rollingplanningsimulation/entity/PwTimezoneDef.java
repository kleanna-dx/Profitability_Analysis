package com.company.module.rollingplanningsimulation.entity;

import jakarta.persistence.*;
import lombok.AccessLevel;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;

/**
 * 부하별 시간대 정의
 * - 계절별·요일구분별 경부하/중부하/최대부하 시간 구간
 * - 코드 하드코딩 금지, 이 테이블 데이터로만 관리
 */
@Entity
@Table(name = "rpsim_pw_timezone_def")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class PwTimezoneDef {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @Column(name = "TIMEZONE_DEF_ID")
    private Long timezoneDefId;

    @Column(name = "YEAR", nullable = false)
    private Integer year;

    @Column(name = "SEASON", nullable = false, length = 20)
    private String season;

    @Column(name = "DAY_TYPE", nullable = false, length = 20)
    private String dayType;

    @Column(name = "LOAD_CLASS", nullable = false, length = 20)
    private String loadClass;

    @Column(name = "START_HOUR", nullable = false)
    private Integer startHour;

    @Column(name = "END_HOUR", nullable = false)
    private Integer endHour;

    @Column(name = "HOURS", nullable = false, precision = 4, scale = 1)
    private BigDecimal hours;

    @Column(name = "DISCOUNT_RATE", nullable = false, precision = 5, scale = 4)
    private BigDecimal discountRate;

    @Column(name = "MEMO", length = 200)
    private String memo;

    @Column(name = "DIVISION", nullable = false, length = 20)
    private String division;

    @Column(name = "CREATED_AT", nullable = false, updatable = false)
    private LocalDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        this.createdAt = LocalDateTime.now();
        if (this.division == null) this.division = "PS";
        if (this.discountRate == null) this.discountRate = BigDecimal.ZERO;
    }

    @Builder
    public PwTimezoneDef(Integer year, String season, String dayType, String loadClass,
                         Integer startHour, Integer endHour, BigDecimal hours,
                         BigDecimal discountRate, String memo, String division) {
        this.year = year;
        this.season = season;
        this.dayType = dayType;
        this.loadClass = loadClass;
        this.startHour = startHour;
        this.endHour = endHour;
        this.hours = hours;
        this.discountRate = discountRate != null ? discountRate : BigDecimal.ZERO;
        this.memo = memo;
        this.division = division != null ? division : "PS";
    }
}
