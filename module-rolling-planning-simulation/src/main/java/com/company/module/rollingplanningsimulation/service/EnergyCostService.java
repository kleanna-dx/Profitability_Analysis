package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.entity.*;
import com.company.module.rollingplanningsimulation.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 에너지비(스팀/연료비) 계산 서비스 — 현업 확정 플로우
 *
 * STEP 1) 생산량 × 스팀원단위 = 전체 스팀 필요량
 * STEP 2) 보일러 우선순위 기반 스팀 분배
 *         ① 폐합성소각로(15톤/hr) → ② 복합보일러(72~97톤/hr)
 *         → ③ 유동상보일러 → ④ LNG보일러(부족 시만)
 * STEP 3) LNG(버너) = 호기별 생산량 × LNG원단위 (보일러와 별개)
 * STEP 4) 설비별 운영비 집계 + 부대비용 차감 = 최종 에너지비
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class EnergyCostService {

    private final BoilerMasterRepository boilerMasterRepository;
    private final BoilerPlanRepository boilerPlanRepository;
    private final SteamUnitRateRepository steamUnitRateRepository;
    private final SteamPriceIntervalRepository steamPriceIntervalRepository;
    private final CogenDeductionRepository cogenDeductionRepository;
    private final BoilerCostRateRepository boilerCostRateRepository;
    private final BurnerLngRateRepository burnerLngRateRepository;
    private final SteamAllocRatioRepository steamAllocRatioRepository;
    private final EnergyMonthlyRepository energyMonthlyRepository;

    // ─────────────────────────────────────────────
    // STEP 1: 전체 스팀 필요량
    // ─────────────────────────────────────────────
    /**
     * 스팀필요량 = Σ(호기별 생산톤 × 스팀원단위) + Σ(기타사용량)
     * @param productionByMachine 호기별 생산량 Map (PM2→3280, PM3→5088 등)
     */
    public BigDecimal calcSteamRequired(String division, int year,
                                        Map<String, BigDecimal> productionByMachine) {
        List<SteamUnitRate> rates = steamUnitRateRepository.findByYearAndDivision(year, division);
        BigDecimal total = BigDecimal.ZERO;

        for (SteamUnitRate rate : rates) {
            BigDecimal prodTon = productionByMachine.getOrDefault(rate.getMachineCode(), BigDecimal.ZERO);
            // 호기별: 생산톤 × 스팀원단위
            BigDecimal steamForMachine = prodTon.multiply(rate.getSteamPerTon());
            // + 기타사용량 (비생산: 오프스펙·식당 등)
            BigDecimal etc = rate.getEtcUsageTon() != null ? rate.getEtcUsageTon() : BigDecimal.ZERO;
            total = total.add(steamForMachine).add(etc);
        }
        return total.setScale(2, RoundingMode.HALF_UP);
    }

    // ─────────────────────────────────────────────
    // STEP 2: 우선순위 기반 보일러 스팀 분배
    // ─────────────────────────────────────────────
    /**
     * 보일러 우선순위 순서대로 스팀을 분배
     * ① 폐합성(priority=1) → ② 복합(2) → ③ 유동상(3) → ④ LNG(4)
     * 각 보일러의 월 최대 공급량 = 시간당스팀 × 가동시간(boiler_plan)
     *
     * @return Map<보일러코드, 배분된 스팀량(톤)>
     */
    public Map<String, BigDecimal> distributeSteam(String division, int year, int month,
                                                    BigDecimal steamRequired) {
        // 우선순위 순으로 정렬된 활성 보일러
        List<BoilerMaster> boilers = boilerMasterRepository
                .findByDivisionAndIsActiveOrderByPriorityAsc(division, true);

        // 보일러별 가동계획
        List<BoilerPlan> plans = boilerPlanRepository.findByYearAndDivision(year, division);
        Map<String, BoilerPlan> planMap = plans.stream()
                .filter(p -> p.getMonth().equals(month))
                .collect(Collectors.toMap(BoilerPlan::getBoilerCode, p -> p, (a, b) -> a));

        Map<String, BigDecimal> allocation = new LinkedHashMap<>();
        BigDecimal remaining = steamRequired;

        for (BoilerMaster boiler : boilers) {
            if (remaining.compareTo(BigDecimal.ZERO) <= 0) {
                allocation.put(boiler.getBoilerCode(), BigDecimal.ZERO);
                continue;
            }

            // 이 보일러의 월 최대 공급량
            BoilerPlan plan = planMap.get(boiler.getBoilerCode());
            BigDecimal maxSupply;
            if (plan != null && plan.getOperationHours() != null) {
                maxSupply = boiler.getSteamPerHour().multiply(plan.getOperationHours());
            } else {
                // 가동계획 없으면 기본 가동일수 추정 (월 28일 × 24h)
                maxSupply = boiler.getSteamPerHour().multiply(BigDecimal.valueOf(672));
            }

            // 이 보일러가 감당할 수 있는 만큼 배분
            BigDecimal allocated = remaining.min(maxSupply);
            allocation.put(boiler.getBoilerCode(), allocated.setScale(2, RoundingMode.HALF_UP));
            remaining = remaining.subtract(allocated);

            log.info("[EnergyCost] 보일러 분배: {} (우선순위{}), 최대={}, 배분={}, 잔여={}",
                    boiler.getBoilerName(), boiler.getPriority(), maxSupply, allocated, remaining);
        }

        // 잔여 스팀이 있으면 → 모든 보일러 용량 초과 (경고)
        if (remaining.compareTo(BigDecimal.ZERO) > 0) {
            log.warn("[EnergyCost] 스팀 부족! 잔여 {}톤을 충당할 수 없음", remaining);
        }

        return allocation;
    }

    // ─────────────────────────────────────────────
    // STEP 3: LNG(버너) — 보일러와 별개
    // ─────────────────────────────────────────────
    /**
     * 버너 LNG 비용 = Σ(호기별 생산톤 × LNG원단위(㎥/톤)) × LNG단가(원/㎥)
     */
    public BigDecimal calcBurnerLngCost(String division, int year,
                                        Map<String, BigDecimal> productionByMachine) {
        List<BurnerLngRate> rates = burnerLngRateRepository.findByYearAndDivision(year, division);
        // LNG 단가: boiler_cost_rate에서 LNG 보일러의 FUEL_RATE 사용
        BigDecimal lngPrice = boilerCostRateRepository.findByYearAndDivision(year, division).stream()
                .filter(r -> "FUEL_RATE".equals(r.getRateType()) && r.getBoilerCode().contains("LNG"))
                .findFirst()
                .map(BoilerCostRate::getRateValue)
                .orElse(BigDecimal.ZERO);

        BigDecimal totalM3 = BigDecimal.ZERO;
        for (BurnerLngRate rate : rates) {
            BigDecimal prodTon = productionByMachine.getOrDefault(rate.getMachineCode(), BigDecimal.ZERO);
            totalM3 = totalM3.add(prodTon.multiply(rate.getLngPerTon()));
        }
        return totalM3.multiply(lngPrice).setScale(2, RoundingMode.HALF_UP);
    }

    // ─────────────────────────────────────────────
    // STEP 4: 설비별 운영비 집계 + 차감 = 최종
    // ─────────────────────────────────────────────
    /**
     * 전체 계산 실행
     */
    @Transactional
    public EnergyMonthly calculate(String ym, String division,
                                   Map<String, BigDecimal> productionByMachine) {
        int year = Integer.parseInt(ym.substring(0, 4));
        int month = Integer.parseInt(ym.substring(4, 6));

        // STEP 1: 스팀 필요량
        BigDecimal steamRequired = calcSteamRequired(division, year, productionByMachine);

        // STEP 2: 보일러 우선순위 분배
        Map<String, BigDecimal> steamAlloc = distributeSteam(division, year, month, steamRequired);
        BigDecimal steamProduced = steamAlloc.values().stream()
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal steamSurplus = steamProduced.subtract(steamRequired).max(BigDecimal.ZERO);

        // STEP 2-2: 보일러별 비용 계산
        List<BoilerMaster> boilers = boilerMasterRepository
                .findByDivisionAndIsActiveOrderByPriorityAsc(division, true);
        Map<String, String> boilerTypeMap = boilers.stream()
                .collect(Collectors.toMap(BoilerMaster::getBoilerCode, BoilerMaster::getBoilerType));
        List<BoilerCostRate> costRates = boilerCostRateRepository.findByYearAndDivision(year, division);

        BigDecimal cogenCost = BigDecimal.ZERO;
        BigDecimal lngBoilerCost = BigDecimal.ZERO;
        BigDecimal incinCost = BigDecimal.ZERO;
        BigDecimal externalCost = BigDecimal.ZERO;

        for (Map.Entry<String, BigDecimal> entry : steamAlloc.entrySet()) {
            String code = entry.getKey();
            BigDecimal steamTon = entry.getValue();
            if (steamTon.compareTo(BigDecimal.ZERO) <= 0) continue;

            String type = boilerTypeMap.getOrDefault(code, "");
            BigDecimal cost = calcBoilerCost(code, type, steamTon, year, division, costRates);

            switch (type) {
                case "COGEN" -> cogenCost = cogenCost.add(cost);
                case "LNG" -> lngBoilerCost = lngBoilerCost.add(cost);
                case "INCIN_SYNTH", "INCIN_FLUID" -> incinCost = incinCost.add(cost);
                case "EXTERNAL" -> externalCost = externalCost.add(cost);
            }
        }

        // 복합보일러: 유틸리티 공급 차감 적용
        BigDecimal utilityDeduct = getDeductionAmount(year, division, "UTILITY");
        cogenCost = cogenCost.add(utilityDeduct); // utilityDeduct는 음수

        // STEP 3: 버너 LNG (보일러와 별개)
        BigDecimal burnerLngCost = calcBurnerLngCost(division, year, productionByMachine);

        // STEP 4: 고정 차감 (감가상각/처분수익/지상권)
        BigDecimal deductTotal = getDeductionAmount(year, division, "DEPRECIATION")
                .add(getDeductionAmount(year, division, "DISPOSAL_GAIN"))
                .add(getDeductionAmount(year, division, "LAND_RENT"));

        // 최종 에너지비
        BigDecimal energyTotal = cogenCost.add(lngBoilerCost).add(incinCost)
                .add(externalCost).add(burnerLngCost).add(deductTotal);

        // 원단위 계산
        BigDecimal totalProd = productionByMachine.values().stream()
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        BigDecimal costPerTonSteam = steamProduced.compareTo(BigDecimal.ZERO) > 0
                ? energyTotal.divide(steamProduced, 2, RoundingMode.HALF_UP)
                        .divide(BigDecimal.valueOf(1000), 2, RoundingMode.HALF_UP) // 천원 단위
                : BigDecimal.ZERO;
        BigDecimal costPerTonProd = totalProd.compareTo(BigDecimal.ZERO) > 0
                ? energyTotal.divide(totalProd, 2, RoundingMode.HALF_UP)
                        .divide(BigDecimal.valueOf(1000), 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;

        // 저장
        EnergyMonthly summary = energyMonthlyRepository.findByYmAndDivision(ym, division)
                .orElse(EnergyMonthly.builder().ym(ym).division(division).build());
        summary.updateCalc(
                steamRequired, steamProduced, steamSurplus,
                cogenCost.setScale(2, RoundingMode.HALF_UP),
                lngBoilerCost.setScale(2, RoundingMode.HALF_UP),
                incinCost.setScale(2, RoundingMode.HALF_UP),
                externalCost.setScale(2, RoundingMode.HALF_UP),
                burnerLngCost,
                deductTotal.setScale(2, RoundingMode.HALF_UP),
                energyTotal.setScale(2, RoundingMode.HALF_UP),
                costPerTonSteam, costPerTonProd, "CALCULATED"
        );
        return energyMonthlyRepository.save(summary);
    }

    // ── 조회 ──
    public Optional<EnergyMonthly> getSummary(String ym, String division) {
        return energyMonthlyRepository.findByYmAndDivision(ym, division);
    }

    // ── Helper: 보일러 유형별 비용 계산 ──
    private BigDecimal calcBoilerCost(String boilerCode, String type, BigDecimal steamTon,
                                      int year, String division, List<BoilerCostRate> costRates) {
        switch (type) {
            case "COGEN" -> {
                // 복합보일러: 구간별 스팀단가 적용
                return calcCogenCost(steamTon, division);
            }
            case "LNG" -> {
                // LNG보일러: 스팀량 → 연료사용량 × LNG단가
                BigDecimal fuelRate = findRate(costRates, boilerCode, "FUEL_RATE");
                BigDecimal steamRate = findRate(costRates, boilerCode, "STEAM_RATE");
                // 스팀량 / 스팀효율 = 연료사용량(㎥), × LNG단가
                if (steamRate.compareTo(BigDecimal.ZERO) > 0) {
                    return steamTon.divide(steamRate, 4, RoundingMode.HALF_UP).multiply(fuelRate);
                }
                return steamTon.multiply(fuelRate);
            }
            case "INCIN_SYNTH", "INCIN_FLUID" -> {
                // 소각로: 스팀량 × 스팀단가
                BigDecimal steamRate = findRate(costRates, boilerCode, "STEAM_RATE");
                return steamTon.multiply(steamRate);
            }
            case "EXTERNAL" -> {
                // 외부보일러: 구매량 × 구매단가
                BigDecimal purchaseRate = findRate(costRates, boilerCode, "PURCHASE_RATE");
                return steamTon.multiply(purchaseRate);
            }
            default -> { return BigDecimal.ZERO; }
        }
    }

    /** 복합보일러: 구간별 스팀단가 적용 */
    private BigDecimal calcCogenCost(BigDecimal steamTon, String division) {
        // 현재 계약연도의 구간별 단가
        List<SteamPriceInterval> intervals = steamPriceIntervalRepository
                .findByDivisionOrderByContractYearAscIntervalSeqAsc(division);
        if (intervals.isEmpty()) return BigDecimal.ZERO;

        BigDecimal totalCost = BigDecimal.ZERO;
        BigDecimal remaining = steamTon;

        for (SteamPriceInterval interval : intervals) {
            if (remaining.compareTo(BigDecimal.ZERO) <= 0) break;
            BigDecimal min = interval.getMinUsageTon() != null ? interval.getMinUsageTon() : BigDecimal.ZERO;
            BigDecimal max = interval.getMaxUsageTon();
            BigDecimal intervalQty;
            if (max != null) {
                intervalQty = remaining.min(max.subtract(min).max(BigDecimal.ZERO));
            } else {
                intervalQty = remaining; // 마지막 구간 = 나머지 전부
            }
            totalCost = totalCost.add(intervalQty.multiply(interval.getPricePerTon()));
            remaining = remaining.subtract(intervalQty);
        }
        return totalCost.setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal findRate(List<BoilerCostRate> rates, String boilerCode, String rateType) {
        return rates.stream()
                .filter(r -> boilerCode.equals(r.getBoilerCode()) && rateType.equals(r.getRateType()))
                .findFirst()
                .map(BoilerCostRate::getRateValue)
                .orElse(BigDecimal.ZERO);
    }

    private BigDecimal getDeductionAmount(int year, String division, String itemType) {
        return cogenDeductionRepository.findByYearAndDivision(year, division).stream()
                .filter(d -> itemType.equals(d.getItemType()))
                .findFirst()
                .map(CogenDeduction::getMonthlyAmount)
                .orElse(BigDecimal.ZERO);
    }
}
