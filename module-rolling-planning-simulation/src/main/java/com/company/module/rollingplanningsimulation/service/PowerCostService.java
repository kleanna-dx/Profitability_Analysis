package com.company.module.rollingplanningsimulation.service;
import com.company.module.rollingplanningsimulation.support.AuditSupport;

import com.company.module.rollingplanningsimulation.entity.*;
import com.company.module.rollingplanningsimulation.repository.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 전력비 계산 서비스 — 현업 담당자 인터뷰 확정 수식 기반
 *
 * [변동층: 한전 전기요금]
 *  1) 설비별 총 전력사용량
 *  2) 부하별 가용시간 (달력 자동 계산)
 *  3) 부하별 사용량 배분 (비례 보정)
 *  4) 요금 계산 (에너지+기본+역률+전력기금)
 *  5) 설비별 배분
 *
 * [고정층: 환급·지급]
 *  DR환급, 부하차단, 복합보일러 차감, ESS 지급
 *
 * 월 총 전력비 = 변동층 + 고정층
 */
@Slf4j
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class PowerCostService {

    private final PwLineRepository pwLineRepository;
    private final PwTariffRepository pwTariffRepository;
    private final PwTimezoneDefRepository timezoneDefRepository;
    private final PwLoadDemandRepository loadDemandRepository;
    private final PwPeakDemandRepository peakDemandRepository;
    private final PwMachineUsageRatioRepository machineUsageRatioRepository;
    private final PwFixedItemRepository fixedItemRepository;
    private final PwMonthlySummaryRepository monthlySummaryRepository;
    private final PwResultRepository pwResultRepository;
    private final AuditSupport auditSupport;
    private final OperatingTimeRepository operatingTimeRepository;

    /** 기본요금 단가 (원/kW) — 산업용(을) 고압A 기준 */
    private static final BigDecimal DEMAND_CHARGE_PER_KW = new BigDecimal("8190");
    /** 전력기금 비율 */
    private static final BigDecimal POWER_FUND_RATE = new BigDecimal("0.027");

    // ─────────────────────────────────────────────
    // 1) 설비별 총 전력사용량
    // ─────────────────────────────────────────────
    /**
     * 설비별 월 사용량 = (가동시간 × kwhPerHourRun) + (운휴시간 × kwhPerHourStby)
     * 총 전력사용량 = 전 설비 합계
     */
    public BigDecimal calcTotalUsageKwh(String ym, String division,
                                        Map<String, BigDecimal> runHoursOverride,
                                        Map<String, BigDecimal> stbyHoursOverride) {
        List<PwLine> lines = pwLineRepository.findByDivisionAndDeletedYnOrderByDisplayOrder(division, "N");
        BigDecimal total = BigDecimal.ZERO;

        for (PwLine line : lines) {
            if (!Boolean.TRUE.equals(line.getIsActive())) continue;
            String code = line.getLineCode();

            BigDecimal runH = runHoursOverride != null && runHoursOverride.containsKey(code)
                    ? runHoursOverride.get(code) : getRunHoursFromOptime(ym, division, code);
            BigDecimal stbyH = stbyHoursOverride != null && stbyHoursOverride.containsKey(code)
                    ? stbyHoursOverride.get(code) : getStbyHoursFromOptime(ym, division, code);

            BigDecimal lineKwh = runH.multiply(line.getKwhPerHourRun())
                    .add(stbyH.multiply(line.getKwhPerHourStby()));
            total = total.add(lineKwh);
        }
        return total;
    }

    // ─────────────────────────────────────────────
    // 2) 부하별 가용시간 (달력 자동 계산)
    // ─────────────────────────────────────────────
    /**
     * 대상 월의 평일/토요일/공휴일 일수 × 부하별 시간대 정의 → 부하별 월 가용시간(h)
     */
    public Map<String, BigDecimal> calcLoadAvailHours(String ym, String division) {
        int year = Integer.parseInt(ym.substring(0, 4));
        int month = Integer.parseInt(ym.substring(4, 6));
        YearMonth yearMonth = YearMonth.of(year, month);

        // 요일별 일수 계산
        int weekdays = 0, saturdays = 0, holidays = 0;
        for (int d = 1; d <= yearMonth.lengthOfMonth(); d++) {
            DayOfWeek dow = LocalDate.of(year, month, d).getDayOfWeek();
            if (dow == DayOfWeek.SUNDAY) holidays++;
            else if (dow == DayOfWeek.SATURDAY) saturdays++;
            else weekdays++;
        }
        // 공휴일은 일요일만 기본 반영, 추가 공휴일은 추후 테이블 확장 가능

        // 계절 결정
        String season = determineSeason(month);

        // 시간대 정의 조회
        List<PwTimezoneDef> defs = timezoneDefRepository.findByYearAndSeasonAndDivision(year, season, division);
        if (defs.isEmpty()) {
            log.warn("[PowerCost] 시간대 정의 없음: year={}, season={}, division={}", year, season, division);
            return Map.of("peak", BigDecimal.ZERO, "mid", BigDecimal.ZERO, "off", BigDecimal.ZERO);
        }

        Map<String, BigDecimal> result = new HashMap<>();
        result.put("peak", BigDecimal.ZERO);
        result.put("mid", BigDecimal.ZERO);
        result.put("off", BigDecimal.ZERO);

        for (PwTimezoneDef def : defs) {
            int dayCount = switch (def.getDayType()) {
                case "weekday" -> weekdays;
                case "saturday" -> saturdays;
                case "holiday" -> holidays;
                default -> 0;
            };
            BigDecimal availH = def.getHours().multiply(BigDecimal.valueOf(dayCount));
            // 할인율 적용 시 실효 시간 조정 (할인은 요금 계산 시 반영, 여기서는 시간만)
            String lc = def.getLoadClass();
            result.merge(lc, availH, BigDecimal::add);
        }
        return result;
    }

    // ─────────────────────────────────────────────
    // 3) 부하별 사용량 배분 (비례 보정)
    // ─────────────────────────────────────────────
    /**
     * 부하별 사용량 = hourlyUsageKw × 가용시간
     * 보정: 세 부하 합계 ≠ 총 전력사용량이면 비례 배분
     */
    public Map<String, BigDecimal> calcLoadUsage(String ym, String division, BigDecimal totalUsageKwh) {
        Map<String, BigDecimal> availHours = calcLoadAvailHours(ym, division);
        List<PwLoadDemand> demands = loadDemandRepository.findByYmAndDivision(ym, division);

        Map<String, BigDecimal> rawUsage = new HashMap<>();
        BigDecimal rawTotal = BigDecimal.ZERO;
        for (String lc : List.of("peak", "mid", "off")) {
            BigDecimal hourlyKw = demands.stream()
                    .filter(d -> lc.equals(d.getLoadClass()))
                    .findFirst()
                    .map(PwLoadDemand::getHourlyUsageKw)
                    .orElse(BigDecimal.ZERO);
            BigDecimal usage = hourlyKw.multiply(availHours.getOrDefault(lc, BigDecimal.ZERO));
            rawUsage.put(lc, usage);
            rawTotal = rawTotal.add(usage);
        }

        // 보정: 비례 배분으로 합계 일치
        Map<String, BigDecimal> adjusted = new HashMap<>();
        if (rawTotal.compareTo(BigDecimal.ZERO) > 0 && totalUsageKwh.compareTo(BigDecimal.ZERO) > 0) {
            for (String lc : rawUsage.keySet()) {
                BigDecimal ratio = rawUsage.get(lc).divide(rawTotal, 10, RoundingMode.HALF_UP);
                adjusted.put(lc, totalUsageKwh.multiply(ratio).setScale(4, RoundingMode.HALF_UP));
            }
        } else {
            adjusted.putAll(rawUsage);
        }
        return adjusted;
    }

    // ─────────────────────────────────────────────
    // 4) 요금 계산
    // ─────────────────────────────────────────────
    /**
     * 에너지요금 + 기본요금 + 역률요금 + 전력기금
     */
    @Transactional
    public PwMonthlySummary calculate(String ym, String division,
                                      Map<String, BigDecimal> runHoursOverride,
                                      Map<String, BigDecimal> stbyHoursOverride) {
        int year = Integer.parseInt(ym.substring(0, 4));
        int month = Integer.parseInt(ym.substring(4, 6));
        String season = determineSeason(month);

        // STEP 1: 총 전력사용량
        BigDecimal totalUsageKwh = calcTotalUsageKwh(ym, division, runHoursOverride, stbyHoursOverride);

        // STEP 2+3: 부하별 사용량 (보정 포함)
        Map<String, BigDecimal> loadUsage = calcLoadUsage(ym, division, totalUsageKwh);

        // STEP 4: 에너지요금 = Σ(부하별 사용량 × 단가)
        BigDecimal energyCost = BigDecimal.ZERO;
        for (String lc : List.of("peak", "mid", "off")) {
            BigDecimal usage = loadUsage.getOrDefault(lc, BigDecimal.ZERO);
            BigDecimal tariff = getTariffRate(year, season, lc, division);
            energyCost = energyCost.add(usage.multiply(tariff));
        }

        // 기본요금 = 최대수요전력(kW) × 8,190원
        BigDecimal effectiveKw = getEffectivePeakDemand(ym, division);
        BigDecimal demandCost = effectiveKw.multiply(DEMAND_CHARGE_PER_KW);

        // 역률요금 (고정값, POWER_FIXED 항목)
        BigDecimal powerFactorKrw = getFixedAmount(ym, division, "POWER_FIXED");

        // 전력기금 = (에너지요금 + 기본요금 + 역률요금) × 0.027
        BigDecimal subtotal = energyCost.add(demandCost).add(powerFactorKrw);
        BigDecimal powerFund = subtotal.multiply(POWER_FUND_RATE).setScale(2, RoundingMode.HALF_UP);

        BigDecimal variableTotal = subtotal.add(powerFund);

        // 고정층
        BigDecimal drRefund = getFixedAmount(ym, division, "DR_REFUND");
        BigDecimal loadCut = getFixedAmount(ym, division, "LOAD_CUT");
        BigDecimal boilerDeduct = getFixedAmount(ym, division, "BOILER_DEDUCT");
        BigDecimal essPayment = getFixedAmount(ym, division, "ESS_PAYMENT");
        BigDecimal fixedTotal = essPayment.add(drRefund).add(loadCut).add(boilerDeduct);

        // 월 총 전력비
        BigDecimal monthlyTotal = variableTotal.add(fixedTotal);

        // 저장
        PwMonthlySummary summary = monthlySummaryRepository.findByYmAndDivision(ym, division)
                .orElse(PwMonthlySummary.builder().ym(ym).division(division).build());
        summary.updateCalculation(
                totalUsageKwh,
                loadUsage.getOrDefault("peak", BigDecimal.ZERO),
                loadUsage.getOrDefault("mid", BigDecimal.ZERO),
                loadUsage.getOrDefault("off", BigDecimal.ZERO),
                energyCost.setScale(2, RoundingMode.HALF_UP),
                demandCost.setScale(2, RoundingMode.HALF_UP),
                powerFactorKrw, powerFund, variableTotal.setScale(2, RoundingMode.HALF_UP),
                drRefund, loadCut, boilerDeduct, essPayment,
                fixedTotal.setScale(2, RoundingMode.HALF_UP),
                monthlyTotal.setScale(2, RoundingMode.HALF_UP),
                null, // costPerTonKrw — 생산량 확정 후 별도 세팅
                "CALCULATED"
        );
        return auditSupport.upsert(monthlySummaryRepository, summary, "ym", "division");
    }

    // ─────────────────────────────────────────────
    // 5) 설비별 배분
    // ─────────────────────────────────────────────
    /**
     * 총 전기요금 × 설비별 비율 → PwResult에 저장
     */
    @Transactional
    public void distributeToMachines(String ym, String division) {
        PwMonthlySummary summary = monthlySummaryRepository.findByYmAndDivision(ym, division)
                .orElseThrow(() -> new IllegalStateException("월 전력비 계산 결과가 없습니다: " + ym));

        List<PwMachineUsageRatio> ratios = machineUsageRatioRepository.findByYmAndDivision(ym, division);
        if (ratios.isEmpty()) {
            log.warn("[PowerCost] 설비별 배분 비율 없음: ym={}, division={}", ym, division);
            return;
        }

        BigDecimal totalCost = summary.getMonthlyTotalKrw();
        for (PwMachineUsageRatio ratio : ratios) {
            BigDecimal machineCost = totalCost.multiply(ratio.getUsageRatio()).setScale(2, RoundingMode.HALF_UP);
            // PwResult에 저장/업데이트
            PwResult result = PwResult.builder()
                    .ym(ym).lineCode(ratio.getLineCode()).division(division)
                    .totalCostKrw(machineCost)
                    .build();
            auditSupport.upsert(pwResultRepository, result, "ym", "lineCode", "division");
        }
    }

    // ─────────────────────────────────────────────
    // 조회 API용
    // ─────────────────────────────────────────────
    public Optional<PwMonthlySummary> getSummary(String ym, String division) {
        return monthlySummaryRepository.findByYmAndDivision(ym, division);
    }

    // ── Helper Methods ──

    private String determineSeason(int month) {
        if (month >= 7 && month <= 8) return "summer";
        if (month >= 11 || month <= 2) return "winter";
        return "spring_fall";
    }

    private BigDecimal getTariffRate(int year, String season, String loadClass, String division) {
        return pwTariffRepository.findByYearAndSeasonAndTimeZoneAndDivision(year, season, loadClass, division)
                .map(PwTariff::getEnergyKrw)
                .orElse(BigDecimal.ZERO);
    }

    private BigDecimal getEffectivePeakDemand(String ym, String division) {
        return peakDemandRepository.findByYmAndDivision(ym, division)
                .map(PwPeakDemand::getEffectiveKw)
                .orElse(peakDemandRepository.findTopByDivisionOrderByYmDesc(division)
                        .map(PwPeakDemand::getEffectiveKw)
                        .orElse(BigDecimal.ZERO));
    }

    private BigDecimal getFixedAmount(String ym, String division, String itemCode) {
        return fixedItemRepository.findByYmAndDivisionAndItemCode(ym, division, itemCode)
                .map(PwFixedItem::getAmountKrw)
                .orElse(BigDecimal.ZERO);
    }

    private BigDecimal getRunHoursFromOptime(String ym, String division, String machineCode) {
        // OperatingTime에서 가동시간 계산: 정상가동(분) ÷ 60 = 시간(h)
        return operatingTimeRepository.findAll().stream()
                .filter(o -> ym.equals(o.getYm()) && machineCode.equals(o.getMachineCode())
                        && "N".equals(o.getDeletedYn()))
                .findFirst()
                .map(o -> o.getOperationNormalDays().divide(BigDecimal.valueOf(60), 2, java.math.RoundingMode.HALF_UP))
                .orElse(BigDecimal.ZERO);
    }

    private BigDecimal getStbyHoursFromOptime(String ym, String division, String machineCode) {
        // 운휴시간(h) = (총계 - 정상가동)(분) ÷ 60
        return operatingTimeRepository.findAll().stream()
                .filter(o -> ym.equals(o.getYm()) && machineCode.equals(o.getMachineCode())
                        && "N".equals(o.getDeletedYn()))
                .findFirst()
                .map(o -> o.getTotalDays().subtract(o.getOperationNormalDays())
                        .divide(BigDecimal.valueOf(60), 2, java.math.RoundingMode.HALF_UP))
                .orElse(BigDecimal.ZERO);
    }
}
