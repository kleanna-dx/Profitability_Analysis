package com.company.module.rollingplanningsimulation.service;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.YearMonth;
import java.util.*;

/**
 * 공장 통합 스팀(에너지비) 계산 엔진 — DB·Spring 의존 없음 (테스트 가능).
 *
 * <ol>
 *   <li>라인 월 수요(톤) = 라인 생산량 × 라인 스팀 원단위 (원단위 미등록 = 0 + 경고)</li>
 *   <li>라인 일 수요 = 라인 월 수요 × (그날 라인 가동시간 ÷ 그 달 라인 가동시간 합). 등록 안 된 날 = 24시간, 가동시간이 하나도 없는 라인 = 전 일자 24시간 + 경고</li>
 *   <li>하루 공장 총수요 = Σ 라인 일 수요 — 사업부 구분 없이 한 번에</li>
 *   <li>보일러 배분(하루 단위, 한 번만): 우선순위 순서로 채움. 하루 케파 = 시간당 용량 × (24 − 정비시간).
 *       케파를 넘는 양은 다음 보일러로, 마지막 보일러(LNG)는 나머지 전부(케파 초과분은 경고, 비용 포함)</li>
 *   <li>보일러 비용 = 월 합계 기준. 구간단가 그룹(복합 1·2호기) = 그룹 월 합계에 BSC(보증량까지)·ASC(초과) 적용 후 배분량 비율로 나눔.
 *       스팀단가 = 톤 × 단가 × FACTOR. 연료단가(LNG) = 톤 ÷ 스팀효율(톤/㎥) × 연료단가 × FACTOR.
 *       고정단가(FIXED_HR) = 당사 귀책 정비시간 × 원/HR × FACTOR (배분량 0이어도 계산)</li>
 *   <li>보일러 비용 − 연료비 고정차감 = 스팀 비용 → 사업부별 스팀 수요 비율로 나눔 (A 방식)</li>
 *   <li>LNG 버너비 = 라인 생산량 × 버너 원단위 × LNG 단가 — 보일러 배분과 별도, 라인 사업부에 바로 귀속</li>
 * </ol>
 * 미등록 값은 다른 값으로 채우지 않음 — 0으로 계산하고 경고.
 */
public final class PlantSteamCalculator {
    private PlantSteamCalculator() {}

    public static final MathContext MC = MathContext.DECIMAL128;
    static final BigDecimal H24 = BigDecimal.valueOf(24);

    /** 라인(호기). dayHours = 일 → 가동시간. null 이면 일별 가동시간 미등록 */
    public record Line(String division, String machineCode, String machineName, BigDecimal ton, BigDecimal steamPerTon,
                       Map<Integer, BigDecimal> dayHours, BigDecimal lngPerTon) {}

    /**
     * 보일러. priceGroup = 구간단가 그룹 키(없으면 null). steamRate = 스팀단가(원/톤) 또는 LNG 이면 스팀효율(톤/㎥).
     * maintAll = 일 → 정비 정지시간(전체) / maintOurs = 일 → 당사 귀책 정비시간
     */
    public record Boiler(String code, String name, int priority, BigDecimal steamPerHour, String priceGroup,
                         BigDecimal steamRate, BigDecimal steamRateFactor, BigDecimal fuelRate, BigDecimal fuelFactor,
                         BigDecimal fixedHrRate, BigDecimal fixedHrFactor,
                         Map<Integer, BigDecimal> maintAll, Map<Integer, BigDecimal> maintOurs) {}

    /** 복합보일러 구간단가 — BSC = 기본단가(0 ~ 보증량), ASC = 초과단가(보증량 초과). 보증량 = 그룹 월 합계 기준 */
    public record IntervalPrice(BigDecimal bscPrice, BigDecimal bscFactor, BigDecimal ascPrice, BigDecimal ascFactor, BigDecimal guaranteeTon) {}

    public record Input(int year, int month, List<Line> lines, List<Boiler> boilers, Map<String, IntervalPrice> intervals,
                        BigDecimal deductKrw, BigDecimal lngPrice) {}

    public record LineResult(String division, String machineCode, String machineName, BigDecimal ton, BigDecimal steamPerTon,
                             BigDecimal demandTon, BigDecimal opHours, boolean hoursRegistered, BigDecimal unplacedTon,
                             BigDecimal burnerLngM3, BigDecimal burnerCost, BigDecimal share, BigDecimal steamCostKrw, BigDecimal costKrw) {
        LineResult withCost(BigDecimal share, BigDecimal steamCost) {
            return new LineResult(division, machineCode, machineName, ton, steamPerTon, demandTon, opHours, hoursRegistered, unplacedTon,
                    burnerLngM3, burnerCost, share, won(steamCost), won(steamCost.add(burnerCost)));
        }
    }

    public record BoilerResult(String code, String name, int priority, BigDecimal steamPerHour, BigDecimal maintHours, BigDecimal oursHours,
                               BigDecimal capacityTon, BigDecimal allocTon, BigDecimal overCapTon, BigDecimal steamCost,
                               BigDecimal fixedHrCost, BigDecimal cost, String costType) {}

    public record TierRow(String group, String name, BigDecimal fromTon, BigDecimal toTon, BigDecimal price, BigDecimal factor,
                          BigDecimal qtyTon, BigDecimal cost) {}

    public record DivisionResult(String division, BigDecimal demandTon, BigDecimal share, BigDecimal steamCost,
                                 BigDecimal burnerCost, BigDecimal total, BigDecimal ton) {}

    public record DayRow(int day, BigDecimal demandTon, Map<String, BigDecimal> alloc, BigDecimal overCapTon) {}

    public record Result(int year, int month, int days, BigDecimal totalDemandTon, BigDecimal boilerCost, BigDecimal deductKrw,
                         BigDecimal steamCost, BigDecimal burnerCost, BigDecimal totalCost, BigDecimal overCapTon, BigDecimal unplacedTon,
                         List<LineResult> lines, List<BoilerResult> boilers, List<TierRow> tiers, List<DivisionResult> divisions,
                         List<DayRow> daily, List<String> warnings) {}

    static BigDecimal nz(BigDecimal v) { return v == null ? BigDecimal.ZERO : v; }
    static BigDecimal f1(BigDecimal v) { return v == null || v.signum() == 0 ? BigDecimal.ONE : v; }
    static BigDecimal won(BigDecimal v) { return nz(v).setScale(0, RoundingMode.HALF_UP); }
    static BigDecimal clampH(BigDecimal h) {
        if (h == null || h.signum() <= 0) return BigDecimal.ZERO;
        return h.compareTo(H24) > 0 ? H24 : h;
    }

    public static Result calculate(Input in) {
        int days = YearMonth.of(in.year(), in.month()).lengthOfMonth();
        List<String> warnings = new ArrayList<>();
        List<Line> lines = in.lines() == null ? List.of() : in.lines();
        List<Boiler> boilers = new ArrayList<>(in.boilers() == null ? List.of() : in.boilers());
        boilers.sort(Comparator.comparingInt(Boiler::priority).thenComparing(Boiler::code));

        // ── 1·2. 라인 월 수요 → 일 수요
        BigDecimal[] dayDemand = new BigDecimal[days + 1];
        Arrays.fill(dayDemand, BigDecimal.ZERO);
        List<LineResult> lineRes = new ArrayList<>();
        List<String> noRate = new ArrayList<>(), noHours = new ArrayList<>(), allDown = new ArrayList<>(), noBurner = new ArrayList<>();
        BigDecimal unplaced = BigDecimal.ZERO, burnerTotal = BigDecimal.ZERO;
        BigDecimal lngPrice = in.lngPrice();
        for (Line l : lines) {
            BigDecimal ton = nz(l.ton());
            if (ton.signum() > 0 && l.steamPerTon() == null) noRate.add(l.division() + " " + l.machineCode());
            BigDecimal demand = ton.multiply(nz(l.steamPerTon()), MC);
            boolean reg = l.dayHours() != null && !l.dayHours().isEmpty();
            BigDecimal[] h = new BigDecimal[days + 1];
            BigDecimal sumH = BigDecimal.ZERO;
            for (int d = 1; d <= days; d++) {
                // 등록된 날 = 등록 시간(운휴 0), 등록 안 된 날 = 24시간 (예외만 등록하는 방식)
                h[d] = reg && l.dayHours().containsKey(d) ? clampH(l.dayHours().get(d)) : H24;
                sumH = sumH.add(h[d]);
            }
            if (!reg && demand.signum() > 0) noHours.add(l.division() + " " + l.machineCode());
            BigDecimal lineUnplaced = BigDecimal.ZERO;
            if (demand.signum() > 0) {
                if (sumH.signum() <= 0) { lineUnplaced = demand; allDown.add(l.division() + " " + l.machineCode()); }
                else for (int d = 1; d <= days; d++)
                    if (h[d].signum() > 0) dayDemand[d] = dayDemand[d].add(demand.multiply(h[d], MC).divide(sumH, MC));
            }
            unplaced = unplaced.add(lineUnplaced);
            // 버너 LNG
            BigDecimal m3 = BigDecimal.ZERO, bCost = BigDecimal.ZERO;
            if (l.lngPerTon() != null && l.lngPerTon().signum() > 0 && ton.signum() > 0) {
                m3 = ton.multiply(l.lngPerTon(), MC);
                if (lngPrice == null) noBurner.add(l.division() + " " + l.machineCode());
                bCost = m3.multiply(nz(lngPrice), MC);
            }
            burnerTotal = burnerTotal.add(bCost);
            lineRes.add(new LineResult(l.division(), l.machineCode(), l.machineName(), ton, l.steamPerTon(), demand, sumH, reg, lineUnplaced, m3, bCost,
                    BigDecimal.ZERO, BigDecimal.ZERO, won(bCost)));
        }
        if (!noRate.isEmpty()) warnings.add("스팀 원단위 미등록 — 스팀 수요 0으로 계산: " + String.join(", ", noRate));
        if (!noHours.isEmpty()) warnings.add("일별 가동시간 미등록 — 전 일자 24시간 가동으로 나눴습니다: " + String.join(", ", noHours));
        if (!allDown.isEmpty()) warnings.add("생산량이 있는데 기준월 전 일자 운휴로 등록된 라인 — 스팀 수요를 배분하지 못했습니다(비용 미반영): " + String.join(", ", allDown));
        if (!noBurner.isEmpty()) warnings.add("LNG 단가(보일러 연료단가의 LNG FUEL_RATE) 미등록 — LNG 버너비 0: " + String.join(", ", noBurner));

        // ── 3·4. 하루 총수요 → 보일러 배분 (우선순위, 마지막 보일러는 나머지 전부)
        Map<String, BigDecimal> alloc = new LinkedHashMap<>(), cap = new LinkedHashMap<>(), over = new LinkedHashMap<>();
        Map<String, BigDecimal> maintSum = new LinkedHashMap<>(), oursSum = new LinkedHashMap<>();
        for (Boiler b : boilers) {
            alloc.put(b.code(), BigDecimal.ZERO); cap.put(b.code(), BigDecimal.ZERO); over.put(b.code(), BigDecimal.ZERO);
            BigDecimal ms = BigDecimal.ZERO, os = BigDecimal.ZERO;
            for (int d = 1; d <= days; d++) {
                BigDecimal mAll = b.maintAll() == null ? BigDecimal.ZERO : clampH(b.maintAll().get(d));
                BigDecimal mOurs = b.maintOurs() == null ? BigDecimal.ZERO : clampH(b.maintOurs().get(d));
                ms = ms.add(mAll); os = os.add(mOurs.min(mAll.signum() > 0 ? mAll : mOurs));
            }
            maintSum.put(b.code(), ms); oursSum.put(b.code(), os);
        }
        List<DayRow> daily = new ArrayList<>();
        BigDecimal overTotal = BigDecimal.ZERO, shortage = BigDecimal.ZERO;
        for (int d = 1; d <= days; d++) {
            BigDecimal rem = dayDemand[d];
            Map<String, BigDecimal> da = new LinkedHashMap<>();
            BigDecimal dayOver = BigDecimal.ZERO;
            for (int i = 0; i < boilers.size(); i++) {
                Boiler b = boilers.get(i);
                BigDecimal mAll = b.maintAll() == null ? BigDecimal.ZERO : clampH(b.maintAll().get(d));
                BigDecimal c = nz(b.steamPerHour()).multiply(H24.subtract(mAll), MC);
                cap.merge(b.code(), c, BigDecimal::add);
                boolean last = i == boilers.size() - 1;
                BigDecimal take = last ? rem : rem.min(c);
                if (take.signum() < 0) take = BigDecimal.ZERO;
                if (last && take.compareTo(c) > 0) { BigDecimal o = take.subtract(c); dayOver = dayOver.add(o); over.merge(b.code(), o, BigDecimal::add); }
                da.put(b.code(), take);
                alloc.merge(b.code(), take, BigDecimal::add);
                rem = rem.subtract(take);
            }
            if (boilers.isEmpty()) shortage = shortage.add(rem);
            overTotal = overTotal.add(dayOver);
            daily.add(new DayRow(d, dayDemand[d], da, dayOver));
        }
        if (boilers.isEmpty()) warnings.add("보일러 마스터가 없어 스팀을 배분하지 못했습니다 — 보일러 비용 0");
        else if (overTotal.signum() > 0) {
            Boiler lastB = boilers.get(boilers.size() - 1);
            warnings.add((lastB.name() == null ? lastB.code() : lastB.name()) + " 케파 초과 " + overTotal.setScale(1, RoundingMode.HALF_UP).toPlainString()
                    + "톤 — 마지막 보일러가 나머지를 모두 받는 것으로 계산했습니다(비용 포함). 생산량·보일러 케파·정비계획을 확인하세요");
        }

        // ── 5. 보일러 비용 (월 합계 기준)
        Map<String, IntervalPrice> ivs = in.intervals() == null ? Map.of() : in.intervals();
        Map<String, BigDecimal> groupAlloc = new LinkedHashMap<>();
        for (Boiler b : boilers) if (b.priceGroup() != null && ivs.containsKey(b.priceGroup())) groupAlloc.merge(b.priceGroup(), alloc.get(b.code()), BigDecimal::add);
        Map<String, BigDecimal> groupCost = new LinkedHashMap<>();
        List<TierRow> tiers = new ArrayList<>();
        for (Map.Entry<String, BigDecimal> g : groupAlloc.entrySet()) {
            IntervalPrice ip = ivs.get(g.getKey());
            BigDecimal tot = g.getValue(), gt = ip.guaranteeTon();
            BigDecimal bscPrice = nz(ip.bscPrice()).multiply(f1(ip.bscFactor()), MC), ascPrice = nz(ip.ascPrice()).multiply(f1(ip.ascFactor()), MC);
            BigDecimal base, excess;
            if (gt == null || gt.signum() <= 0) {
                base = tot; excess = BigDecimal.ZERO;
                warnings.add(g.getKey() + " BSC 보증량 미등록 — 전량 기본단가(BSC)로 계산했습니다");
            } else { base = tot.min(gt); excess = tot.subtract(gt).max(BigDecimal.ZERO); }
            if (ip.bscPrice() == null && base.signum() > 0) warnings.add(g.getKey() + " BSC 기본단가 미등록 — 기본구간 0원");
            if (ip.ascPrice() == null && excess.signum() > 0) warnings.add(g.getKey() + " ASC 초과단가 미등록 — 초과구간 0원");
            BigDecimal c1 = base.multiply(bscPrice, MC), c2 = excess.multiply(ascPrice, MC);
            tiers.add(new TierRow(g.getKey(), "기본구간 (BSC)", BigDecimal.ZERO, gt, ip.bscPrice(), f1(ip.bscFactor()), base, c1));
            if (gt != null && gt.signum() > 0) tiers.add(new TierRow(g.getKey(), "초과구간 (ASC)", gt, null, ip.ascPrice(), f1(ip.ascFactor()), excess, c2));
            groupCost.put(g.getKey(), c1.add(c2));
        }
        List<BoilerResult> bRes = new ArrayList<>();
        BigDecimal boilerCost = BigDecimal.ZERO;
        List<String> noPrice = new ArrayList<>();
        for (Boiler b : boilers) {
            BigDecimal a = alloc.get(b.code()), steamCost;
            String type;
            if (b.priceGroup() != null && groupCost.containsKey(b.priceGroup())) {
                BigDecimal ga = groupAlloc.get(b.priceGroup());
                steamCost = ga.signum() > 0 ? groupCost.get(b.priceGroup()).multiply(a, MC).divide(ga, MC) : BigDecimal.ZERO;
                type = "구간단가";
            } else if (b.fuelRate() != null) {
                if (b.steamRate() == null || b.steamRate().signum() <= 0) {
                    steamCost = BigDecimal.ZERO; type = "연료단가(스팀효율 미등록)";
                    if (a.signum() > 0) noPrice.add((b.name() == null ? b.code() : b.name()) + " 스팀효율(STEAM_RATE 톤/㎥)");
                } else {
                    steamCost = a.divide(b.steamRate(), MC).multiply(b.fuelRate().multiply(f1(b.fuelFactor()), MC), MC);
                    type = "연료단가";
                }
            } else if (b.steamRate() != null) {
                steamCost = a.multiply(b.steamRate().multiply(f1(b.steamRateFactor()), MC), MC);
                type = b.steamRate().signum() > 0 ? "스팀단가" : "무상";
            } else {
                steamCost = BigDecimal.ZERO; type = b.fixedHrRate() != null ? "고정단가" : "단가 미등록";
                if (a.signum() > 0) noPrice.add(b.name() == null ? b.code() : b.name());
            }
            BigDecimal fixed = b.fixedHrRate() == null ? BigDecimal.ZERO : oursSum.get(b.code()).multiply(b.fixedHrRate().multiply(f1(b.fixedHrFactor()), MC), MC);
            if (b.fixedHrRate() != null && !"고정단가".equals(type)) type += "+고정단가";
            BigDecimal cost = steamCost.add(fixed);
            boilerCost = boilerCost.add(cost);
            bRes.add(new BoilerResult(b.code(), b.name(), b.priority(), b.steamPerHour(), maintSum.get(b.code()), oursSum.get(b.code()),
                    cap.get(b.code()), a, over.get(b.code()), steamCost, fixed, cost, type));
        }
        if (!noPrice.isEmpty()) warnings.add("보일러 단가 미등록 — 배분량 비용 0: " + String.join(", ", noPrice));

        // ── 6. 스팀 비용 → 사업부 배분 (스팀 수요 비율)
        BigDecimal deduct = nz(in.deductKrw()).abs();
        BigDecimal steamCost = boilerCost.subtract(deduct);
        BigDecimal totalDemand = BigDecimal.ZERO;
        Map<String, BigDecimal> divDemand = new TreeMap<>(), divBurner = new TreeMap<>(), divTon = new TreeMap<>();
        for (LineResult l : lineRes) {
            BigDecimal placed = l.demandTon().subtract(l.unplacedTon());
            totalDemand = totalDemand.add(placed);
            divDemand.merge(l.division(), placed, BigDecimal::add);
            divBurner.merge(l.division(), l.burnerCost(), BigDecimal::add);
            divTon.merge(l.division(), l.ton(), BigDecimal::add);
        }
        if (totalDemand.signum() <= 0 && steamCost.signum() != 0)
            warnings.add("공장 스팀 수요가 0이라 보일러 고정비·고정차감을 사업부로 나누지 못했습니다");
        List<DivisionResult> divRes = new ArrayList<>();
        for (String dv : divDemand.keySet()) {
            BigDecimal share = totalDemand.signum() > 0 ? divDemand.get(dv).divide(totalDemand, MC) : BigDecimal.ZERO;
            BigDecimal sc = steamCost.multiply(share, MC), bc = divBurner.get(dv);
            divRes.add(new DivisionResult(dv, divDemand.get(dv), share, won(sc), won(bc), won(sc.add(bc)), divTon.get(dv)));
        }
        // 라인별 = 스팀 비용 × (라인 배분 수요 ÷ 공장 수요) + 라인 버너비
        List<LineResult> lineFinal = new ArrayList<>();
        for (LineResult l : lineRes) {
            BigDecimal placed = l.demandTon().subtract(l.unplacedTon());
            BigDecimal share = totalDemand.signum() > 0 ? placed.divide(totalDemand, MC) : BigDecimal.ZERO;
            lineFinal.add(l.withCost(share, steamCost.multiply(share, MC)));
        }
        BigDecimal totalCost = steamCost.add(burnerTotal);
        return new Result(in.year(), in.month(), days, totalDemand.add(unplaced), won(boilerCost), won(deduct), won(steamCost), won(burnerTotal),
                won(totalCost), overTotal, unplaced.add(shortage), lineFinal, bRes, tiers, divRes, daily, warnings);
    }
}
