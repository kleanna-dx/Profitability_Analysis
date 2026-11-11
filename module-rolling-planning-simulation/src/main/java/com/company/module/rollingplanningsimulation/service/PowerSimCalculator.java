package com.company.module.rollingplanningsimulation.service;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.YearMonth;
import java.util.*;

/**
 * 호기별 생산량 기반 전력비 시뮬레이션 — 순수 계산 엔진 (DB·Spring 의존 없음)
 *
 * <pre>
 * 월 전체시간 = 해당 월 일수 × 24 (윤년 자동)
 * 시간당 생산성 = 입력값(단위/h) 또는 일 생산성 ÷ 입력한 1일 기준시간, 생산성 단위 → 생산량 단위 명시 변환 (질량만)
 * 예상 가동시간 = 계획 생산량 ÷ 시간당 생산성          (생산량 0 → 0h, 가동률·효율 추가 적용 없음)
 * 예상 운휴시간 = 월 전체시간 − 예상 가동시간            (가동시간 &gt; 월 전체시간 → 생산 불가, 음수 운휴 계산 안 함)
 * (생산팀이 통보한 가동시간을 직접 입력하면 그 값을 쓰고, 생산량 ÷ 생산성과 5% 넘게 다르면 경고)
 * 예상 전력사용량 = 가동시간 × 가동 kW + 운휴시간 × 운휴 kW + 고정 사용량(근거 필수) + 사용량 조정값(사유 필수)
 *   고정 사용량: 생산과 무관한 월 사용량 (예: 라미네이팅 23,000kWh, 제지2에서 분리한 −23,000kWh) — 엑셀 05.이동계획 R~AH 열 수식 반영
 * 호기 전력비 = 예상 전력사용량 × 월 평균단가 → 원 단위 반올림 후 합산
 * 공장 최종 = 호기 전력비 합계 + 수동 가산금 − 수동 차감금
 * </pre>
 * 미입력(null)과 0을 구분 — 미입력 값을 0으로 바꿔 정상 결과처럼 보이게 하지 않는다.
 * 오류가 하나라도 있으면 합계는 null(계산 미완료).
 */
public final class PowerSimCalculator {

    private PowerSimCalculator() {}

    public static final MathContext MC = MathContext.DECIMAL128;
    public static final String HOUR = "HOUR", DAY = "DAY";
    public static final String ADD = "ADD", DEDUCT = "DEDUCT";
    public static final String OK = "OK", ERROR = "ERROR", CAPACITY_EXCEEDED = "CAPACITY_EXCEEDED";
    /** 기타 정산 항목 구분 — BASE_FEE/ESS/SETTLEMENT 는 단가 산정범위 플래그와 대조 */
    public static final List<String> CATEGORIES = List.of("BASE_FEE", "ESS", "SETTLEMENT", "OTHER");
    public static final Map<String, String> CATEGORY_LABEL = Map.of("BASE_FEE", "기본요금", "ESS", "ESS", "SETTLEMENT", "정산금(DR·복합보일러 등)", "OTHER", "기타");
    private static final BigDecimal H24 = BigDecimal.valueOf(24);

    /** 질량 단위 → kg (물리 상수, 업무값 아님). 그 외 단위는 같은 단위끼리만 허용 */
    private static final Map<String, BigDecimal> MASS_KG = Map.of(
            "ton", new BigDecimal("1000"), "t", new BigDecimal("1000"), "톤", new BigDecimal("1000"),
            "kg", BigDecimal.ONE, "g", new BigDecimal("0.001"));

    // ================================================================ 입력

    /** 월 평균 전력단가 + 산정범위 (Y/N 플래그는 필수) */
    public record Price(BigDecimal krwPerKwh, String vatIncluded, String baseFeeIncluded, String essIncluded,
                        String settlementIncluded, String scopeDesc) {}

    /**
     * 호기(공정 단위 설비) 1행.
     * productivityBasis: HOUR(단위/h) / DAY(단위/일 — dayBasisHours 필수). productivityUnit: 생산성의 단위 (예: ton)
     */
    public record Line(String lineCode, String lineName, String processName, String prodUnit, BigDecimal qty,
                       BigDecimal productivityValue, String productivityBasis, String productivityUnit, BigDecimal dayBasisHours,
                       BigDecimal runKw, BigDecimal idleKw, BigDecimal adjKwh, String adjReason,
                       BigDecimal fixedKwh, String fixedNote, BigDecimal runHoursInput) {
        /** 고정 사용량·가동시간 직접 입력 없이 */
        public Line(String lineCode, String lineName, String processName, String prodUnit, BigDecimal qty,
                    BigDecimal productivityValue, String productivityBasis, String productivityUnit, BigDecimal dayBasisHours,
                    BigDecimal runKw, BigDecimal idleKw, BigDecimal adjKwh, String adjReason) {
            this(lineCode, lineName, processName, prodUnit, qty, productivityValue, productivityBasis, productivityUnit, dayBasisHours,
                    runKw, idleKw, adjKwh, adjReason, null, null, null);
        }
    }

    /** 수동 가산·차감 항목 (금액 0 이상, 세금 계산 없이 그대로 반영) */
    public record Adjust(String itemName, String direction, BigDecimal amountKrw, String category, String vatIncluded, String memo) {}

    public record Input(int year, int month, Price price, List<Line> lines, List<Adjust> adjusts) {}

    // ================================================================ 결과

    public record LineResult(String lineCode, String lineName, String processName, String prodUnit, BigDecimal qty,
                             BigDecimal productivityPerHour, BigDecimal runHours, BigDecimal idleHours,
                             BigDecimal runKwh, BigDecimal idleKwh, BigDecimal adjKwh, BigDecimal totalKwh, BigDecimal costKrw,
                             String status, List<String> errors, List<String> warnings,
                             BigDecimal fixedKwh, BigDecimal calcRunHours, String runHoursSource) {}

    public record ProcessResult(String processName, int lineCount, boolean complete, BigDecimal totalKwh, BigDecimal costKrw) {}

    public record AdjustResult(String itemName, String direction, BigDecimal amountKrw, String category, String vatIncluded,
                               String memo, List<String> errors) {}

    public record Result(int year, int month, BigDecimal monthHours, BigDecimal priceKrwPerKwh,
                         List<LineResult> lines, List<ProcessResult> processes, List<AdjustResult> adjusts,
                         boolean complete, BigDecimal totalKwh, BigDecimal lineCostSum,
                         BigDecimal addTotal, BigDecimal deductTotal, BigDecimal finalCost,
                         List<String> errors, List<String> warnings) {}

    public record LineDelta(String lineCode, BigDecimal kwh, BigDecimal costKrw) {}

    public record Delta(boolean available, String reason, BigDecimal kwh, BigDecimal lineCost, BigDecimal finalCost, List<LineDelta> lines) {}

    // ================================================================ 공통

    public static BigDecimal monthHours(int year, int month) {
        return BigDecimal.valueOf(YearMonth.of(year, month).lengthOfMonth()).multiply(H24);
    }

    private static boolean blank(String s) { return s == null || s.isBlank(); }
    private static String norm(String u) { return u == null ? null : u.trim().toLowerCase(Locale.ROOT); }
    private static boolean yn(String v) { return "Y".equals(v) || "N".equals(v); }

    /** 표시용 (오류 문구 안) — 내부 계산값은 반올림하지 않음 */
    static String fmt(BigDecimal v) {
        if (v == null) return "-";
        BigDecimal r = v.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros();
        return String.format("%,." + Math.max(0, r.scale()) + "f", r);
    }

    /**
     * 생산성 단위 → 생산량 단위 배수. 같은 단위 1, 질량끼리 환산, 그 외 null(변환 불가)
     * 예: 생산성 ton, 생산량 kg → 1000
     */
    public static BigDecimal unitFactor(String fromUnit, String toUnit) {
        String f = norm(fromUnit), t = norm(toUnit);
        if (f == null || t == null || f.isEmpty() || t.isEmpty()) return null;
        if (f.equals(t)) return BigDecimal.ONE;
        BigDecimal fk = MASS_KG.get(f), tk = MASS_KG.get(t);
        if (fk == null || tk == null) return null;
        return fk.divide(tk, MC);
    }

    /** 시간당 생산성 (생산량 단위/h). 문제가 있으면 errors 에 넣고 null */
    public static BigDecimal productivityPerHour(Line l, List<String> errors) {
        BigDecimal v = l.productivityValue();
        if (v == null) { errors.add("생산성 미입력 — 생산량이 있으면 시간당 생산성이 필요합니다"); return null; }
        if (v.signum() <= 0) { errors.add("생산성은 0보다 커야 합니다: " + fmt(v)); return null; }
        if (blank(l.productivityUnit())) { errors.add("생산성 단위 미입력"); return null; }
        String basis = l.productivityBasis() == null ? null : l.productivityBasis().trim().toUpperCase(Locale.ROOT);
        BigDecimal perHour;
        if (HOUR.equals(basis)) perHour = v;
        else if (DAY.equals(basis)) {
            BigDecimal h = l.dayBasisHours();
            if (h == null) { errors.add("일 생산성의 1일 기준시간(h) 미입력 — 1일을 24시간으로 간주하지 않습니다"); return null; }
            if (h.signum() <= 0 || h.compareTo(H24) > 0) { errors.add("1일 기준시간은 0 초과 24 이하입니다: " + fmt(h)); return null; }
            perHour = v.divide(h, MC);
        } else { errors.add("생산성 기준(시간당/일당) 미입력"); return null; }
        BigDecimal factor = unitFactor(l.productivityUnit(), l.prodUnit());
        if (factor == null) {
            errors.add("단위 불일치: 생산량 단위 '" + l.prodUnit() + "' / 생산성 단위 '" + l.productivityUnit() + "' — 변환할 수 없어 계산하지 않습니다");
            return null;
        }
        return perHour.multiply(factor, MC);
    }

    // ================================================================ 호기 계산

    public static LineResult calcLine(Line l, BigDecimal monthHours, BigDecimal price) {
        List<String> err = new ArrayList<>(), warn = new ArrayList<>();
        BigDecimal qty = l.qty();
        if (blank(l.prodUnit())) err.add("생산량 단위 미입력");
        if (qty == null) err.add("생산량 미입력 (0이면 0을 입력하세요)");
        else if (qty.signum() < 0) err.add("생산량은 0 이상이어야 합니다: " + fmt(qty));
        if (l.runKw() == null) err.add("가동 중 평균전력(kW) 미입력");
        else if (l.runKw().signum() < 0) err.add("가동 중 평균전력은 0 이상이어야 합니다");
        if (l.idleKw() == null) err.add("운휴 중 평균전력(kW) 미입력");
        else if (l.idleKw().signum() < 0) err.add("운휴 중 평균전력은 0 이상이어야 합니다");
        if (l.runKw() != null && l.idleKw() != null && l.idleKw().compareTo(l.runKw()) > 0)
            warn.add("운휴 평균전력(" + fmt(l.idleKw()) + "kW)이 가동 평균전력(" + fmt(l.runKw()) + "kW)보다 큽니다 — 기준값을 확인하세요");

        BigDecimal hIn = l.runHoursInput();
        if (hIn != null) {
            if (hIn.signum() < 0) err.add("가동시간은 0 이상이어야 합니다: " + fmt(hIn));
            else if (hIn.compareTo(monthHours) > 0) err.add("입력 가동시간 " + fmt(hIn) + "h가 월 전체시간 " + fmt(monthHours) + "h를 넘습니다");
            else if (qty != null && qty.signum() > 0 && hIn.signum() == 0) err.add("생산량이 있는데 가동시간이 0입니다");
        }
        BigDecimal pph = null;
        boolean needPph = hIn == null && qty != null && qty.signum() > 0 && !blank(l.prodUnit());
        if (needPph) pph = productivityPerHour(l, err);
        else if (l.productivityValue() != null && !blank(l.prodUnit())) pph = productivityPerHour(l, new ArrayList<>()); // 표시·비교용
        BigDecimal calcH = qty == null ? null : qty.signum() == 0 ? BigDecimal.ZERO : pph == null ? null : qty.divide(pph, MC);

        BigDecimal adj = l.adjKwh() == null ? BigDecimal.ZERO : l.adjKwh();
        if (adj.signum() != 0 && blank(l.adjReason())) err.add("사용량 조정값(" + fmt(adj) + " kWh)의 사유를 입력하세요");
        BigDecimal fixed = l.fixedKwh() == null ? BigDecimal.ZERO : l.fixedKwh();
        if (fixed.signum() != 0 && blank(l.fixedNote())) err.add("고정 사용량(" + fmt(fixed) + " kWh)의 근거를 입력하세요");

        BigDecimal runH = null, idleH = null, runKwh = null, idleKwh = null, total = null, cost = null;
        String status = OK;
        if (err.isEmpty()) {
            if (hIn != null) {
                runH = hIn;
                if (calcH != null && hIn.signum() > 0 && calcH.subtract(hIn).abs().compareTo(hIn.multiply(new BigDecimal("0.05"))) > 0)
                    warn.add("입력 가동시간 " + fmt(hIn) + "h와 생산량 ÷ 생산성 " + fmt(calcH) + "h가 5% 이상 다릅니다 — 생산성 또는 가동시간을 확인하세요");
            } else runH = calcH;
            if (runH.compareTo(monthHours) > 0) {
                status = CAPACITY_EXCEEDED;
                err.add("생산 불가: 필요 가동시간 " + fmt(runH) + "h > 월 전체시간 " + fmt(monthHours) + "h — 현재 생산성으로 이 생산량을 생산할 수 없습니다");
            } else {
                idleH = monthHours.subtract(runH, MC);
                runKwh = runH.multiply(l.runKw(), MC);
                idleKwh = idleH.multiply(l.idleKw(), MC);
                total = runKwh.add(idleKwh, MC).add(fixed, MC).add(adj, MC);
                if (total.signum() < 0) {
                    err.add("최종 전력사용량이 음수입니다 (" + fmt(total) + " kWh) — 사용량 조정값을 확인하세요");
                    total = null;
                } else if (price != null) {
                    cost = total.multiply(price, MC).setScale(0, RoundingMode.HALF_UP); // 호기별 최종 금액에서 원 단위 반올림
                }
            }
        }
        if (!err.isEmpty() && !CAPACITY_EXCEEDED.equals(status)) status = ERROR;
        if (!OK.equals(status)) { idleH = null; runKwh = null; idleKwh = null; total = null; cost = null; if (ERROR.equals(status)) runH = null; }
        return new LineResult(l.lineCode(), l.lineName(), l.processName(), l.prodUnit(), qty, pph, runH, idleH, runKwh, idleKwh,
                l.adjKwh() == null ? BigDecimal.ZERO : l.adjKwh(), total, cost, status, List.copyOf(err), List.copyOf(warn),
                fixed, calcH, hIn != null ? "INPUT" : "CALC");
    }

    // ================================================================ 전체 계산

    public static Result calculate(Input in) {
        List<String> errors = new ArrayList<>(), warnings = new ArrayList<>();
        BigDecimal monthHours = monthHours(in.year(), in.month());

        // ── 단가 ──
        Price p = in.price();
        BigDecimal price = null;
        if (p == null || p.krwPerKwh() == null) errors.add(in.year() + "." + String.format("%02d", in.month()) + " 평균 전력단가 미입력 — 전력비를 계산할 수 없습니다");
        else if (p.krwPerKwh().signum() < 0) errors.add("평균 전력단가는 0 이상이어야 합니다");
        else {
            price = p.krwPerKwh();
            if (blank(p.scopeDesc())) errors.add("평균단가 산정범위 설명이 없습니다 — 단가 기준정보에 입력하세요");
            if (!yn(p.vatIncluded()) || !yn(p.baseFeeIncluded()) || !yn(p.essIncluded()) || !yn(p.settlementIncluded()))
                errors.add("평균단가 산정범위(부가세·기본요금·ESS·정산금 포함 여부)가 모두 입력되지 않았습니다");
        }

        // ── 호기 ──
        List<Line> lines = in.lines() == null ? List.of() : in.lines();
        if (lines.isEmpty()) errors.add("계산할 호기가 없습니다 — 전력 기준정보에 호기를 등록하세요");
        List<LineResult> lrs = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (Line l : lines) {
            LineResult r = calcLine(l, monthHours, price);
            if (!seen.add(String.valueOf(l.lineCode()))) {
                List<String> e = new ArrayList<>(r.errors()); e.add("같은 호기가 두 번 있습니다: " + l.lineCode());
                r = new LineResult(r.lineCode(), r.lineName(), r.processName(), r.prodUnit(), r.qty(), r.productivityPerHour(),
                        null, null, null, null, r.adjKwh(), null, null, ERROR, List.copyOf(e), r.warnings(), r.fixedKwh(), r.calcRunHours(), r.runHoursSource());
            }
            lrs.add(r);
        }

        // ── 수동 가산·차감 ──
        List<AdjustResult> ars = new ArrayList<>();
        BigDecimal addT = BigDecimal.ZERO, dedT = BigDecimal.ZERO;
        boolean adjOk = true;
        for (Adjust a : in.adjusts() == null ? List.<Adjust>of() : in.adjusts()) {
            List<String> e = new ArrayList<>();
            if (blank(a.itemName())) e.add("항목명 미입력");
            if (!ADD.equals(a.direction()) && !DEDUCT.equals(a.direction())) e.add("구분(가산/차감) 미입력");
            if (a.amountKrw() == null) e.add("금액 미입력");
            else if (a.amountKrw().signum() < 0) e.add("금액은 0 이상으로 입력하세요 (차감은 구분으로 지정)");
            if (blank(a.memo())) e.add("입력 근거/메모 미입력");
            if (a.category() == null || !CATEGORIES.contains(a.category())) e.add("항목 구분 미입력");
            if (!yn(a.vatIncluded())) e.add("부가세 포함 여부 미입력");
            if (p != null && price != null && e.isEmpty()) {
                if (yn(p.vatIncluded()) && !p.vatIncluded().equals(a.vatIncluded()))
                    e.add("부가세 기준 불일치 — 단가는 부가세 " + ("Y".equals(p.vatIncluded()) ? "포함" : "별도") + ", 이 항목은 " + ("Y".equals(a.vatIncluded()) ? "포함" : "별도") + " (산정 범위가 다른 단가와 조정 항목을 함께 쓸 수 없습니다)");
                String flag = switch (a.category()) {
                    case "BASE_FEE" -> p.baseFeeIncluded();
                    case "ESS" -> p.essIncluded();
                    case "SETTLEMENT" -> p.settlementIncluded();
                    default -> "N";
                };
                if ("Y".equals(flag)) e.add(CATEGORY_LABEL.get(a.category()) + "은(는) 평균단가에 이미 포함되어 있습니다 — 다시 입력하면 중복 반영됩니다");
            }
            if (!e.isEmpty()) adjOk = false;
            else if (ADD.equals(a.direction())) addT = addT.add(a.amountKrw());
            else dedT = dedT.add(a.amountKrw());
            ars.add(new AdjustResult(a.itemName(), a.direction(), a.amountKrw(), a.category(), a.vatIncluded(), a.memo(), List.copyOf(e)));
        }
        if (!adjOk) errors.add("기타 가산·차감 항목에 오류가 있습니다");

        // ── 공정별 / 전체 ──
        boolean linesOk = !lrs.isEmpty() && lrs.stream().allMatch(r -> OK.equals(r.status()));
        boolean costOk = linesOk && lrs.stream().allMatch(r -> r.costKrw() != null);
        long badLines = lrs.stream().filter(r -> !OK.equals(r.status())).count();
        if (badLines > 0) errors.add("오류가 있는 호기 " + badLines + "개 — 전체 합계는 계산 미완료입니다");

        Map<String, List<LineResult>> byProc = new LinkedHashMap<>();
        for (LineResult r : lrs) byProc.computeIfAbsent(blank(r.processName()) ? "(공정 미지정)" : r.processName(), k -> new ArrayList<>()).add(r);
        List<ProcessResult> prs = new ArrayList<>();
        byProc.forEach((proc, rs) -> {
            boolean ok = rs.stream().allMatch(r -> OK.equals(r.status()));
            boolean cOk = ok && rs.stream().allMatch(r -> r.costKrw() != null);
            prs.add(new ProcessResult(proc, rs.size(), cOk,
                    ok ? rs.stream().map(LineResult::totalKwh).reduce(BigDecimal.ZERO, BigDecimal::add) : null,
                    cOk ? rs.stream().map(LineResult::costKrw).reduce(BigDecimal.ZERO, BigDecimal::add) : null));
        });

        BigDecimal totalKwh = linesOk ? lrs.stream().map(LineResult::totalKwh).reduce(BigDecimal.ZERO, BigDecimal::add) : null;
        boolean complete = errors.isEmpty() && costOk;
        BigDecimal lineCostSum = costOk ? lrs.stream().map(LineResult::costKrw).reduce(BigDecimal.ZERO, BigDecimal::add) : null;
        BigDecimal finalCost = complete ? lineCostSum.add(addT).subtract(dedT) : null;
        if (finalCost != null && finalCost.signum() < 0) warnings.add("공장 최종 예상비용이 음수입니다 — 차감금을 확인하세요");
        return new Result(in.year(), in.month(), monthHours, price, List.copyOf(lrs), List.copyOf(prs), List.copyOf(ars), complete,
                totalKwh, lineCostSum, adjOk ? addT : null, adjOk ? dedT : null, finalCost, List.copyOf(errors), List.copyOf(warnings));
    }

    /** 기준 대비 증감 (시뮬 − 기준). 둘 다 계산 완료여야 전체 증감 표시 */
    public static Delta delta(Result base, Result sim) {
        List<LineDelta> lds = new ArrayList<>();
        Map<String, LineResult> bm = new HashMap<>();
        for (LineResult r : base.lines()) bm.put(r.lineCode(), r);
        for (LineResult s : sim.lines()) {
            LineResult b = bm.get(s.lineCode());
            if (b == null || b.totalKwh() == null || s.totalKwh() == null) { lds.add(new LineDelta(s.lineCode(), null, null)); continue; }
            lds.add(new LineDelta(s.lineCode(), s.totalKwh().subtract(b.totalKwh()),
                    b.costKrw() != null && s.costKrw() != null ? s.costKrw().subtract(b.costKrw()) : null));
        }
        if (!base.complete()) return new Delta(false, "기준(기준 생산량) 계산이 완료되지 않았습니다", null, null, null, List.copyOf(lds));
        if (!sim.complete()) return new Delta(false, "시뮬 계산이 완료되지 않았습니다", null, null, null, List.copyOf(lds));
        return new Delta(true, null, sim.totalKwh().subtract(base.totalKwh()), sim.lineCostSum().subtract(base.lineCostSum()),
                sim.finalCost().subtract(base.finalCost()), List.copyOf(lds));
    }
}
