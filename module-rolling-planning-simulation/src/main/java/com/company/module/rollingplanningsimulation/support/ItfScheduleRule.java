package com.company.module.rollingplanningsimulation.support;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * 인터페이스 수행 스케줄 규칙 — 다음 실행 시각 계산 / 대상년월 결정 / 입력 검증
 *
 * <ul>
 *   <li>시간 기준: 한국시간(Asia/Seoul)</li>
 *   <li>daily: 매일 EXEC_TIME</li>
 *   <li>monthly: 매월 EXEC_DAY_OF_MONTH일 EXEC_TIME (그 달에 없는 날이면 말일)</li>
 *   <li>once: EXEC_DATETIME 1회</li>
 *   <li>manual: 자동 실행 안 함</li>
 * </ul>
 * 대상년월(TARGET_MONTH): CUR=실행일 기준 당월 / PREV=실행일 기준 전월 / yyyymm=고정
 */
public final class ItfScheduleRule {
    private ItfScheduleRule() {}

    public static final ZoneId ZONE = ZoneId.of("Asia/Seoul");
    public static final String CUR = "CUR";
    public static final String PREV = "PREV";
    private static final DateTimeFormatter YM = DateTimeFormatter.ofPattern("yyyyMM");

    public static LocalDateTime now() {
        return LocalDateTime.now(ZONE).withNano(0);
    }

    /** 자동 실행 대상 주기인지 */
    public static boolean isAuto(String type) {
        return "daily".equals(type) || "monthly".equals(type) || "once".equals(type);
    }

    /**
     * from 이후(초과) 첫 실행 시각. 계산할 수 없으면 null
     * once 는 lastRunAt 이 실행일시 이후면 이미 수행한 것으로 보고 null
     */
    public static LocalDateTime next(String type, LocalTime time, Integer dayOfMonth,
                                     LocalDateTime onceAt, LocalDateTime lastRunAt, LocalDateTime from) {
        if (type == null) return null;
        switch (type) {
            case "daily": {
                if (time == null) return null;
                LocalDateTime c = from.toLocalDate().atTime(time);
                return c.isAfter(from) ? c : c.plusDays(1);
            }
            case "monthly": {
                if (time == null || dayOfMonth == null) return null;
                LocalDate m = from.toLocalDate().withDayOfMonth(1);
                for (int i = 0; i < 3; i++) {
                    LocalDate d = m.plusMonths(i);
                    LocalDateTime c = d.withDayOfMonth(Math.min(dayOfMonth, d.lengthOfMonth())).atTime(time);
                    if (c.isAfter(from)) return c;
                }
                return null;
            }
            case "once":
                if (onceAt == null) return null;
                if (lastRunAt != null && !lastRunAt.isBefore(onceAt)) return null;
                return onceAt;
            default:
                return null;
        }
    }

    /** 실행 시점 기준 대상년월(yyyyMM) */
    public static String resolveTargetMonth(String rule, LocalDateTime runAt) {
        String r = rule == null ? "" : rule.trim().toUpperCase();
        if (PREV.equals(r)) return runAt.minusMonths(1).format(YM);
        if (r.matches("\\d{6}")) return r;
        return runAt.format(YM); // CUR 또는 미입력 → 당월
    }

    /** 대상년월 입력 정규화 — CUR / PREV / yyyymm (yyyy.mm 도 허용). 빈 값은 null */
    public static String normalizeTargetMonth(Object v) {
        if (v == null) return null;
        String s = v.toString().trim().toUpperCase();
        if (s.isEmpty()) return null;
        if (CUR.equals(s) || PREV.equals(s)) return s;
        String d = s.replace(".", "");
        if (d.matches("\\d{6}")) {
            int y = Integer.parseInt(d.substring(0, 4)), m = Integer.parseInt(d.substring(4));
            if (y >= 2000 && y <= 2100 && m >= 1 && m <= 12) return d;
        }
        throw new IllegalArgumentException("대상년월은 당월(CUR) / 전월(PREV) / yyyy.mm 중 하나로 입력하세요: " + v);
    }

    /** 주기별 필수값 검증 */
    public static void validate(String type, LocalTime time, Integer dayOfMonth, LocalDateTime onceAt) {
        if (type == null || !(type.equals("manual") || isAuto(type)))
            throw new IllegalArgumentException("수행 주기는 manual / daily / monthly / once 중 하나입니다: " + type);
        if (("daily".equals(type) || "monthly".equals(type)) && time == null)
            throw new IllegalArgumentException("실행 시각(HH:mm)을 입력하세요.");
        if ("monthly".equals(type) && (dayOfMonth == null || dayOfMonth < 1 || dayOfMonth > 31))
            throw new IllegalArgumentException("매월 실행일(1~31)을 입력하세요.");
        if ("once".equals(type) && onceAt == null)
            throw new IllegalArgumentException("1회 실행일시(yyyy-mm-dd HH:mm)를 입력하세요.");
    }
}
