package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.*;
import com.company.module.rollingplanningsimulation.repository.*;
import com.company.module.rollingplanningsimulation.service.PlantSteamCalculator.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Function;

/**
 * 공장 통합 에너지비(스팀) — PS·HL 생산량을 합쳐 보일러 배분을 한 번만 하고, 비용을 사업부 스팀 수요 비율로 나눔.
 *
 * <ul>
 *   <li>생산량: 사업부별로 전력비와 같은 규칙 ({@link PowerSimService#divisionQty}) — STEP3 확정 호기 = 확정 생산계획,
 *       미확정 호기 = P/L 시뮬레이터 입력(요청한 사업부만), 그 외 = 생산계획</li>
 *   <li>스팀 라인: 그 해 스팀 원단위가 한 번이라도 등록된 호기. 원단위가 없는 호기(가공·생리대 등)는 스팀 미사용으로 제외하고 목록 표시</li>
 *   <li>보일러 기준정보(마스터·연료단가·정비·고정차감) = 공장 공통(DIVISION='PLANT'). 아직 PLANT 데이터가 없으면 PS 데이터를 쓰고 안내</li>
 *   <li>계산 = {@link PlantSteamCalculator}. 저장하지 않음</li>
 * </ul>
 */
@Service
@RequiredArgsConstructor
public class PlantEnergyService {

    public static final String PLANT = "PLANT";
    static final BigDecimal H24 = BigDecimal.valueOf(24);

    private final PowerSimService powerSim;
    private final UnitRepository unitRepo;
    private final SteamUnitRateRepository steamRepo;
    private final DailyOperationRepository dailyRepo;
    private final BoilerMasterRepository boilerRepo;
    private final BoilerCostRateRepository rateRepo;
    private final BoilerMaintenanceRepository maintRepo;
    private final CogenDeductionRepository deductRepo;
    private final BurnerLngRateRepository burnerRepo;

    static String str(Object o) { return PowerSimService.str(o); }
    static String low(String s) { return s == null ? "" : s.trim().toLowerCase(Locale.ROOT); }
    static String groupCode(String code) { return code == null ? "" : code.replaceAll("[-_]\\d+$", ""); }

    /** 보일러 기준정보: 공장 공통(PLANT) 우선, 없으면 PS 데이터 + 안내 */
    <T> List<T> plantOrPs(Function<String, List<T>> f, String label, List<String> notes) {
        List<T> l = f.apply(PLANT);
        if (l != null && !l.isEmpty()) return l;
        List<T> ps = f.apply("PS");
        if (ps != null && !ps.isEmpty())
            notes.add(label + ": 공장 공통(PLANT) 데이터가 없어 PS로 저장된 데이터를 사용했습니다 — 공장 공통으로 바꾸는 UPDATE를 실행하세요");
        return ps == null ? List.of() : ps;
    }

    /**
     * body: {ym, division(보고 있는 사업부 — P/L 입력 생산량을 쓸 사업부), machine(ALL/호기), products:[{product, plan, sim}]}
     * 응답: base(생산계획 기준) / sim(P/L 입력 반영) 계산 결과, 사업부별 생산량 출처, 제외 라인, 경고
     */
    public Map<String, Object> calculate(Map<String, Object> body) {
        String ym = PowerSimService.ym(body.get("ym"));
        String viewDiv = str(body.get("division")) == null ? null : PowerSimService.division(body.get("division"));
        String machine = str(body.get("machine"));
        List<PowerSimService.ProductSim> products = new ArrayList<>();
        if (body.get("products") instanceof List<?> l)
            for (Object o : l) if (o instanceof Map<?, ?> m) {
                BigDecimal sim = PowerSimService.num(m.get("sim"), "지종 시뮬 생산량");
                if (sim != null && sim.signum() < 0) throw new IllegalArgumentException("시뮬 생산량은 0 이상이어야 합니다: " + m.get("product"));
                products.add(new PowerSimService.ProductSim(str(m.get("product")), PowerSimService.num(m.get("plan"), "지종 생산계획"), sim));
            }
        int y = Integer.parseInt(ym.substring(0, 4)), mo = Integer.parseInt(ym.substring(4));
        List<String> warnings = new ArrayList<>(), notes = new ArrayList<>();

        // ── 공장 공통 기준정보
        List<BoilerMaster> boilers = plantOrPs(d -> boilerRepo.findByDivisionAndYearMonth(d, y, mo), "보일러 마스터", notes).stream()
                .filter(b -> !Boolean.FALSE.equals(b.getIsActive())).toList();
        List<BoilerCostRate> rates = plantOrPs(d -> rateRepo.findByYearMonthAndDivision(y, mo, d), "보일러 연료단가", notes);
        List<BoilerMaintenance> maints = plantOrPs(d -> maintRepo.findByDivision(d), "보일러 정비계획", notes);
        List<CogenDeduction> deducts = plantOrPs(d -> deductRepo.findByYearMonthAndDivision(y, mo, d), "연료비 고정차감", notes);
        if (boilers.isEmpty()) warnings.add(y + "." + String.format("%02d", mo) + " 보일러 마스터가 없습니다 — [기준정보 › 보일러 마스터]에 해당 월 보일러를 등록하세요");

        List<Boiler> engBoilers = new ArrayList<>();
        Map<String, IntervalPrice> intervals = new LinkedHashMap<>();
        Map<String, Map<Integer, BigDecimal>> maintAll = new HashMap<>(), maintOurs = new HashMap<>();
        for (BoilerMaintenance m : maints) {
            Map<Integer, BigDecimal> st = dailyStops(m.getStartDate(), m.getEndDate(), m.getMaintHours(), y, mo);
            if (st.isEmpty()) continue;
            st.forEach((d, h) -> maintAll.computeIfAbsent(m.getBoilerCode(), k -> new HashMap<>()).merge(d, h, (a, b) -> a.add(b).min(H24)));
            if ("OURS".equals(normResp(m.getResponsibility())))
                st.forEach((d, h) -> maintOurs.computeIfAbsent(m.getBoilerCode(), k -> new HashMap<>()).merge(d, h, (a, b) -> a.add(b).min(H24)));
        }
        for (BoilerMaster b : boilers) {
            String code = b.getBoilerCode(), grp = groupCode(code);
            BoilerCostRate fuel = findRate(rates, code, "FUEL_RATE"), steam = findRate(rates, code, "STEAM_RATE"), fixed = findRate(rates, code, "FIXED_HR");
            String ivKey = hasInterval(rates, code) ? code : hasInterval(rates, grp) ? grp : null;
            if (ivKey != null && !intervals.containsKey(ivKey)) {
                BoilerCostRate bsc = exactRate(rates, ivKey, "INTERVAL"), asc = exactRate(rates, ivKey, "INTERVAL_ASC"), g = exactRate(rates, ivKey, "BSC_GUARANTEE");
                intervals.put(ivKey, new IntervalPrice(bsc == null ? null : bsc.getRateValue(), bsc == null ? null : bsc.getFactor(),
                        asc == null ? null : asc.getRateValue(), asc == null ? null : asc.getFactor(), g == null ? null : g.getRateValue()));
            }
            engBoilers.add(new Boiler(code, b.getBoilerName(), b.getPriority() == null ? 99 : b.getPriority(), b.getSteamPerHour(), ivKey,
                    steam == null ? null : steam.getRateValue(), steam == null ? null : steam.getFactor(),
                    fuel == null ? null : fuel.getRateValue(), fuel == null ? null : fuel.getFactor(),
                    fixed == null ? null : fixed.getRateValue(), fixed == null ? null : fixed.getFactor(),
                    maintAll.getOrDefault(code, Map.of()), maintOurs.getOrDefault(code, Map.of())));
        }
        BigDecimal deduct = deducts.stream().map(d -> d.getMonthlyAmount() == null ? BigDecimal.ZERO : d.getMonthlyAmount().abs()).reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal lngPrice = rates.stream().filter(r -> "FUEL_RATE".equals(r.getRateType()) && r.getBoilerCode() != null && r.getBoilerCode().toUpperCase(Locale.ROOT).contains("LNG"))
                .findFirst().map(r -> r.getRateValue() == null ? null : r.getRateValue().multiply(r.getFactor() == null || r.getFactor().signum() == 0 ? BigDecimal.ONE : r.getFactor()))
                .orElse(null);

        // ── 사업부별 라인 (생산량 · 스팀 원단위 · 일별 가동시간 · 버너 원단위)
        List<Line> baseLines = new ArrayList<>(), simLines = new ArrayList<>();
        Map<String, Object> sources = new LinkedHashMap<>();
        List<Map<String, Object>> excluded = new ArrayList<>();
        boolean provisional = false;
        for (String div : PurchasePlanService.DIVISIONS) {
            boolean me = div.equals(viewDiv);
            PowerSimService.DivQty q = powerSim.divisionQty(div, ym, me ? products : List.of(), me ? machine : null);
            warnings.addAll(q.warnings());
            sources.put(div, q.source());
            if (!"LOCKED".equals(q.source().get("code"))) provisional = true;

            Map<String, String> names = new HashMap<>();
            unitRepo.findByDivisionAndDeletedYnOrderByUnitCode(div, "N").forEach(u -> names.put(low(u.getUnitCode()), u.getUnitName()));
            Map<String, BigDecimal> rateNow = new HashMap<>();
            Map<String, String> steamCodes = new LinkedHashMap<>();   // 그 해 스팀 원단위가 있는 호기 = 스팀 라인
            for (SteamUnitRate r : steamRepo.findByYearAndDivision(y, div)) steamCodes.putIfAbsent(low(r.getMachineCode()), r.getMachineCode());
            for (SteamUnitRate r : steamRepo.findByYearAndMonthAndDivision(y, mo, div)) rateNow.putIfAbsent(low(r.getMachineCode()), r.getSteamPerTon());
            Map<String, Map<Integer, BigDecimal>> hours = new HashMap<>();
            for (DailyOperation op : dailyRepo.findByYearAndMonthAndDivision(y, mo, div)) {
                if (op.getDay() == null) continue;
                BigDecimal h = Boolean.TRUE.equals(op.getIsShutdown()) || op.getOperationHours() == null || op.getOperationHours().signum() <= 0
                        ? BigDecimal.ZERO : op.getOperationHours().min(H24);
                hours.computeIfAbsent(low(op.getMachineCode()), k -> new HashMap<>()).put(op.getDay(), h);
            }
            Map<String, BigDecimal> burner = new HashMap<>();
            burnerRepo.findByYearAndMonthAndDivisionOrderByMachineCodeAsc(y, mo, div).forEach(b -> burner.putIfAbsent(low(b.getMachineCode()), b.getLngPerTon()));

            Map<String, BigDecimal> baseTon = lowerMap(q.base()), simTon = lowerMap(q.sim());
            for (Map.Entry<String, String> e : steamCodes.entrySet()) {
                String k = e.getKey(), code = e.getValue();
                String nm = names.getOrDefault(k, code);
                baseLines.add(new Line(div, code, nm, baseTon.getOrDefault(k, BigDecimal.ZERO), rateNow.get(k), hours.get(k), burner.get(k)));
                simLines.add(new Line(div, code, nm, simTon.getOrDefault(k, BigDecimal.ZERO), rateNow.get(k), hours.get(k), burner.get(k)));
            }
            // 생산량은 있는데 스팀 원단위가 그 해 한 번도 없는 호기 → 스팀 미사용으로 제외
            Set<String> seen = new HashSet<>();
            for (Map<String, BigDecimal> mp : List.of(simTon, baseTon))
                for (Map.Entry<String, BigDecimal> e : mp.entrySet()) {
                    if (steamCodes.containsKey(e.getKey()) || !seen.add(e.getKey()) || e.getValue() == null || e.getValue().signum() <= 0) continue;
                    Map<String, Object> x = new LinkedHashMap<>();
                    x.put("division", div); x.put("machineCode", e.getKey().toUpperCase(Locale.ROOT)); x.put("machineName", names.get(e.getKey()));
                    x.put("ton", simTon.getOrDefault(e.getKey(), BigDecimal.ZERO));
                    excluded.add(x);
                }
        }
        if (baseLines.isEmpty()) warnings.add(y + "년 스팀 원단위가 등록된 호기가 없습니다 — [인터페이스 관리]에서 에너지팀 원단위를 받거나 [기준정보 › 스팀사용 원단위]에 등록하세요");

        Result base = PlantSteamCalculator.calculate(new Input(y, mo, baseLines, engBoilers, intervals, deduct, lngPrice));
        Result sim = PlantSteamCalculator.calculate(new Input(y, mo, simLines, engBoilers, intervals, deduct, lngPrice));
        warnings.addAll(sim.warnings());

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("ym", ym);
        res.put("division", viewDiv);
        res.put("provisional", provisional);
        res.put("sources", sources);
        res.put("excluded", excluded);
        res.put("warnings", warnings);
        res.put("notes", notes);
        res.put("base", base);
        res.put("sim", sim);
        res.put("notice", "공장 전체(PS+HL) 스팀 수요를 합쳐 보일러를 한 번만 배분하고, 비용은 사업부 스팀 수요 비율(평균단가)로 나눕니다 — "
                + "한 사업부 생산량을 바꾸면 공장 평균단가가 바뀌어 다른 사업부 에너지비도 바뀝니다");
        return res;
    }

    static Map<String, BigDecimal> lowerMap(Map<String, BigDecimal> m) {
        Map<String, BigDecimal> o = new HashMap<>();
        if (m != null) m.forEach((k, v) -> o.merge(low(k), v == null ? BigDecimal.ZERO : v, BigDecimal::add));
        return o;
    }

    static String normResp(String v) {
        String s = v == null ? "" : v.trim().toUpperCase(Locale.ROOT);
        if (s.equals("OURS") || s.contains("당사")) return "OURS";
        if (s.equals("PARTNER") || s.contains("협력")) return "PARTNER";
        return "";
    }

    static BoilerCostRate exactRate(List<BoilerCostRate> rates, String code, String type) {
        for (BoilerCostRate r : rates) if (code.equals(r.getBoilerCode()) && type.equals(r.getRateType())) return r;
        return null;
    }
    /** 보일러 코드 → 없으면 그룹 코드(복합 1·2호기 → BLR-COGEN) */
    static BoilerCostRate findRate(List<BoilerCostRate> rates, String code, String type) {
        BoilerCostRate r = exactRate(rates, code, type);
        return r != null ? r : exactRate(rates, groupCode(code), type);
    }
    static boolean hasInterval(List<BoilerCostRate> rates, String code) {
        for (BoilerCostRate r : rates)
            if (code.equals(r.getBoilerCode()) && List.of("INTERVAL", "INTERVAL_ASC", "BSC_GUARANTEE").contains(r.getRateType())) return true;
        return false;
    }

    /**
     * 정비 → 기준월 일별 정지시간. 시작일 0시부터 정비시간만큼 연속 정지(하루 최대 24h). 정비시간이 비면 기간 전체.
     * 월을 걸치는 정비는 이번 달 부분만
     */
    static Map<Integer, BigDecimal> dailyStops(LocalDate s, LocalDate e, BigDecimal maintHours, int y, int mo) {
        Map<Integer, BigDecimal> out = new HashMap<>();
        if (s == null || e == null || s.isAfter(e)) return out;
        BigDecimal periodH = H24.multiply(BigDecimal.valueOf(ChronoUnit.DAYS.between(s, e) + 1));
        BigDecimal remain = maintHours != null && maintHours.signum() > 0 ? maintHours.min(periodH) : periodH;
        LocalDate t = s;
        while (remain.signum() > 0) {
            BigDecimal h = remain.min(H24);
            if (t.getYear() == y && t.getMonthValue() == mo) out.merge(t.getDayOfMonth(), h, BigDecimal::add);
            remain = remain.subtract(h);
            t = t.plusDays(1);
        }
        return out;
    }
}
