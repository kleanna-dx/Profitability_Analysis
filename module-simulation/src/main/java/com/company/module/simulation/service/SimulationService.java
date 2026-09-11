package com.company.module.simulation.service;

import com.company.module.simulation.dto.response.CostUnitRateResponse;
import com.company.module.simulation.dto.response.DataReadinessResponse;
import com.company.module.simulation.repository.OperatingTimeRepository;
import com.company.module.simulation.repository.RawRecordRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * P/L 시뮬레이터 핵심 서비스
 * - 비용 원단위 계산 (DB에서 자동 로드)
 * - 지종별 원재료비 분리
 * - 데이터 준비 현황 대시보드
 */
@Service
@RequiredArgsConstructor
@Transactional(readOnly = true)
public class SimulationService {

    private final RawRecordRepository rawRecordRepository;
    private final OperatingTimeRepository operatingTimeRepository;

    /**
     * 비용 원단위 조회 (P/L 시뮬레이터 초기화용)
     */
    public CostUnitRateResponse getCostUnitRates(String ym, String machine, String division) {
        // 전월 계산
        int year = Integer.parseInt(ym.substring(0, 4));
        int month = Integer.parseInt(ym.substring(4, 6));
        String prevYm;
        if (month == 1) {
            prevYm = (year - 1) + "12";
        } else {
            prevYm = year + String.format("%02d", month - 1);
        }

        // 당월 집계
        Object[] curTotals = rawRecordRepository.findMonthlyTotals(ym, machine);
        BigDecimal curProdKg = toBD(curTotals, 0);
        BigDecimal curMatCost = toBD(curTotals, 1);
        long curProdTon = curProdKg.divide(BigDecimal.valueOf(1000), 0, RoundingMode.HALF_UP).longValue();

        // 전월 집계
        Object[] prevTotals = rawRecordRepository.findMonthlyTotals(prevYm, machine);
        BigDecimal prevProdKg = toBD(prevTotals, 0);
        BigDecimal prevMatCost = toBD(prevTotals, 1);
        long prevProdTon = prevProdKg.divide(BigDecimal.valueOf(1000), 0, RoundingMode.HALF_UP).longValue();

        // 원단위 계산 (천원/톤)
        BigDecimal matPerTon = curProdTon > 0
                ? curMatCost.divide(BigDecimal.valueOf(curProdTon), 1, RoundingMode.HALF_UP)
                        .divide(BigDecimal.valueOf(1000), 1, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;
        BigDecimal prevMatPerTon = prevProdTon > 0
                ? prevMatCost.divide(BigDecimal.valueOf(prevProdTon), 1, RoundingMode.HALF_UP)
                        .divide(BigDecimal.valueOf(1000), 1, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;

        // 지종별 원재료비
        List<Object[]> curByProd = rawRecordRepository.findMaterialByProduct(ym, machine);
        List<Object[]> prevByProd = rawRecordRepository.findMaterialByProduct(prevYm, machine);

        List<CostUnitRateResponse.MaterialByProduct> materialByProduct = new ArrayList<>();
        for (Object[] row : curByProd) {
            String product = (String) row[0];
            BigDecimal prodTon = toBD(row, 1);
            BigDecimal matCost = toBD(row, 2);
            BigDecimal unitCost = prodTon.compareTo(BigDecimal.ZERO) > 0
                    ? matCost.divide(prodTon, 1, RoundingMode.HALF_UP)
                            .divide(BigDecimal.valueOf(1000), 1, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;

            // 전월 동일 지종 찾기
            BigDecimal prevProdTonProd = BigDecimal.ZERO;
            BigDecimal prevMatCostProd = BigDecimal.ZERO;
            BigDecimal prevUnitCost = BigDecimal.ZERO;
            for (Object[] prevRow : prevByProd) {
                if (product.equals(prevRow[0])) {
                    prevProdTonProd = toBD(prevRow, 1);
                    prevMatCostProd = toBD(prevRow, 2);
                    prevUnitCost = prevProdTonProd.compareTo(BigDecimal.ZERO) > 0
                            ? prevMatCostProd.divide(prevProdTonProd, 1, RoundingMode.HALF_UP)
                                    .divide(BigDecimal.valueOf(1000), 1, RoundingMode.HALF_UP)
                            : BigDecimal.ZERO;
                    break;
                }
            }

            BigDecimal sharePct = curMatCost.compareTo(BigDecimal.ZERO) > 0
                    ? matCost.multiply(BigDecimal.valueOf(100))
                            .divide(curMatCost, 1, RoundingMode.HALF_UP)
                    : BigDecimal.ZERO;

            materialByProduct.add(CostUnitRateResponse.MaterialByProduct.builder()
                    .product(product)
                    .productionTon(prodTon.longValue())
                    .materialCost(matCost)
                    .unitCost1000(unitCost)
                    .prevProductionTon(prevProdTonProd.longValue())
                    .prevMaterialCost(prevMatCostProd)
                    .prevUnitCost1000(prevUnitCost)
                    .sharePct(sharePct)
                    .build());
        }

        return CostUnitRateResponse.builder()
                .ym(ym)
                .prevYm(prevYm)
                .machine(machine)
                .division(division)
                .baseProdTon(curProdTon)
                .rates(CostUnitRateResponse.Rates.builder()
                        .revenuePerTon(BigDecimal.ZERO)
                        .materialPerTon(matPerTon)
                        .energyPerTon(BigDecimal.ZERO)
                        .logisticsPerTon(BigDecimal.ZERO)
                        .build())
                .prevRates(CostUnitRateResponse.Rates.builder()
                        .materialPerTon(prevMatPerTon)
                        .energyPerTon(BigDecimal.ZERO)
                        .logisticsPerTon(BigDecimal.ZERO)
                        .build())
                .totals(CostUnitRateResponse.Totals.builder()
                        .materialCost(curMatCost)
                        .energyCost(BigDecimal.ZERO)
                        .logisticsCost(BigDecimal.ZERO)
                        .productionKg(curProdKg)
                        .productionTon(curProdTon)
                        .build())
                .prevTotals(CostUnitRateResponse.Totals.builder()
                        .materialCost(prevMatCost)
                        .energyCost(BigDecimal.ZERO)
                        .logisticsCost(BigDecimal.ZERO)
                        .productionKg(prevProdKg)
                        .productionTon(prevProdTon)
                        .build())
                .costBehavior(CostUnitRateResponse.CostBehavior.builder()
                        .material("variable")
                        .energy("semi_variable")
                        .logistics("semi_variable")
                        .labor("fixed")
                        .depreciation("fixed")
                        .sga("fixed")
                        .build())
                .fromDB(CostUnitRateResponse.FromDB.builder()
                        .material(curMatCost.compareTo(BigDecimal.ZERO) > 0)
                        .energy(false)
                        .logistics(false)
                        .revenue(false)
                        .build())
                .materialByProduct(materialByProduct)
                .build();
    }

    /**
     * 데이터 준비 현황 대시보드
     */
    public DataReadinessResponse getDataReadiness(String ym, String division) {
        long rawCount = rawRecordRepository.countByCalendarYm(ym);
        // TODO: 전력비, 물류비, 가동시간 모듈별 건수 체크

        List<DataReadinessResponse.ModuleStatus> modules = new ArrayList<>();
        modules.add(DataReadinessResponse.ModuleStatus.builder()
                .moduleCode("MATERIAL")
                .moduleName("원부재료비")
                .status(rawCount > 0 ? "READY" : "EMPTY")
                .recordCount(rawCount)
                .description("SAP BW 원부재료비 실적 데이터")
                .build());
        modules.add(DataReadinessResponse.ModuleStatus.builder()
                .moduleCode("POWER")
                .moduleName("전력비")
                .status("PARTIAL")
                .recordCount(0)
                .description("한전 전력비 계산 결과")
                .build());
        modules.add(DataReadinessResponse.ModuleStatus.builder()
                .moduleCode("LOGISTICS")
                .moduleName("물류비")
                .status("PARTIAL")
                .recordCount(0)
                .description("해상 물류비 + 국내 운임")
                .build());

        return DataReadinessResponse.builder()
                .ym(ym)
                .division(division)
                .modules(modules)
                .build();
    }

    // 유틸
    private BigDecimal toBD(Object[] row, int idx) {
        if (row == null || row.length <= idx || row[idx] == null) return BigDecimal.ZERO;
        if (row[idx] instanceof BigDecimal bd) return bd;
        return new BigDecimal(row[idx].toString());
    }
}
