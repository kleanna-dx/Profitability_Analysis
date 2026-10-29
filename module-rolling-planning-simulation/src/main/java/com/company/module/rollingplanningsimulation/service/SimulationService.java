package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.response.CostUnitRateResponse;
import com.company.module.rollingplanningsimulation.dto.response.DataReadinessResponse;
import com.company.module.rollingplanningsimulation.repository.LogiRateRepository;
import com.company.module.rollingplanningsimulation.repository.OperatingTimeRepository;
import com.company.module.rollingplanningsimulation.repository.PwResultRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

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

    private final JdbcTemplate jdbcTemplate;
    private final OperatingTimeRepository operatingTimeRepository;
    private final PwResultRepository pwResultRepository;
    private final LogiRateRepository logiRateRepository;

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

        // 당월 집계 (rpsim_raw_material: 생산량은 제품별 1회, 원재료비=DATA_TYPE 100, 부재료비=DATA_TYPE 101)
        Map<String, Object> curTotals = findMonthlyTotals(ym, machine);
        BigDecimal curProdKg = toBD(curTotals.get("prod_kg"));
        BigDecimal curMatCost = toBD(curTotals.get("mat_cost"));
        BigDecimal curSubCost = toBD(curTotals.get("sub_cost"));
        long curProdTon = curProdKg.divide(BigDecimal.valueOf(1000), 0, RoundingMode.HALF_UP).longValue();

        // 전월 집계
        Map<String, Object> prevTotals = findMonthlyTotals(prevYm, machine);
        BigDecimal prevProdKg = toBD(prevTotals.get("prod_kg"));
        BigDecimal prevMatCost = toBD(prevTotals.get("mat_cost"));
        BigDecimal prevSubCost = toBD(prevTotals.get("sub_cost"));
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
        // 부재료비 원단위 (천원/톤) — 원재료비와 별도 표시
        BigDecimal subPerTon = perTon1000(curSubCost, curProdTon);
        BigDecimal prevSubPerTon = perTon1000(prevSubCost, prevProdTon);

        // 지종별 원재료비
        List<Object[]> curByProd = findMaterialByProduct(ym, machine);
        List<Object[]> prevByProd = findMaterialByProduct(prevYm, machine);

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
                        .subMaterialPerTon(subPerTon)
                        .energyPerTon(BigDecimal.ZERO)
                        .logisticsPerTon(BigDecimal.ZERO)
                        .build())
                .prevRates(CostUnitRateResponse.Rates.builder()
                        .materialPerTon(prevMatPerTon)
                        .subMaterialPerTon(prevSubPerTon)
                        .energyPerTon(BigDecimal.ZERO)
                        .logisticsPerTon(BigDecimal.ZERO)
                        .build())
                .totals(CostUnitRateResponse.Totals.builder()
                        .materialCost(curMatCost)
                        .subMaterialCost(curSubCost)
                        .energyCost(BigDecimal.ZERO)
                        .logisticsCost(BigDecimal.ZERO)
                        .productionKg(curProdKg)
                        .productionTon(curProdTon)
                        .build())
                .prevTotals(CostUnitRateResponse.Totals.builder()
                        .materialCost(prevMatCost)
                        .subMaterialCost(prevSubCost)
                        .energyCost(BigDecimal.ZERO)
                        .logisticsCost(BigDecimal.ZERO)
                        .productionKg(prevProdKg)
                        .productionTon(prevProdTon)
                        .build())
                .costBehavior(CostUnitRateResponse.CostBehavior.builder()
                        .material("variable")
                        .subMaterial("variable")
                        .energy("semi_variable")
                        .logistics("semi_variable")
                        .labor("fixed")
                        .depreciation("fixed")
                        .sga("fixed")
                        .build())
                .fromDB(CostUnitRateResponse.FromDB.builder()
                        .material(curMatCost.compareTo(BigDecimal.ZERO) > 0)
                        .subMaterial(curSubCost.compareTo(BigDecimal.ZERO) > 0)
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
        // 실제 DB에서 각 모듈별 건수 조회
        Long rawCountObj = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM rpsim_raw_material WHERE CALMONTH = ?", Long.class, ym);
        long rawCount = rawCountObj != null ? rawCountObj : 0L;
        long pwCount = pwResultRepository.countByYmAndDivision(ym, division);
        long logiCount = logiRateRepository.findByDeletedYnOrderByYearQuarterDescSortOrderAsc("N").size();
        long optimeCount = operatingTimeRepository.countByDivisionAndYmAndDeletedYn(division, ym, "N");

        List<DataReadinessResponse.ModuleStatus> modules = new ArrayList<>();
        modules.add(DataReadinessResponse.ModuleStatus.builder()
                .moduleCode("MATERIAL")
                .moduleName("원부재료비")
                .status(rawCount > 0 ? "READY" : "EMPTY")
                .recordCount(rawCount)
                .description("SAP BW 원부재료 사용현황 (ITF_001)")
                .build());
        modules.add(DataReadinessResponse.ModuleStatus.builder()
                .moduleCode("POWER")
                .moduleName("전력비")
                .status(pwCount > 0 ? "READY" : "EMPTY")
                .recordCount(pwCount)
                .description("한전 전력비 계산 결과")
                .build());
        modules.add(DataReadinessResponse.ModuleStatus.builder()
                .moduleCode("LOGISTICS")
                .moduleName("물류비")
                .status(logiCount > 0 ? "READY" : "EMPTY")
                .recordCount(logiCount)
                .description("해상 물류비 + 국내 운임")
                .build());
        modules.add(DataReadinessResponse.ModuleStatus.builder()
                .moduleCode("OPTIME")
                .moduleName("가동시간")
                .status(optimeCount > 0 ? "READY" : "EMPTY")
                .recordCount(optimeCount)
                .description("월별 호기별 가동일수")
                .build());

        return DataReadinessResponse.builder()
                .ym(ym)
                .division(division)
                .modules(modules)
                .build();
    }

    // ================================================================
    // 원부재료 집계 (rpsim_raw_material)
    //  - 생산수량(BIC_ZPRD_QTY)은 자재 행마다 반복 → 제품(호기+PRODH1~4)별 MAX로 1회만 집계
    //  - 원재료비 = DATA_TYPE '100' 출고금액, 부재료비 = DATA_TYPE '101' 출고금액
    // ================================================================
    private static final String MACHINE_COND = " AND (? = 'ALL' OR BIC_ZMACHINE = ?)";

    private Map<String, Object> findMonthlyTotals(String ym, String machine) {
        String sql =
            "SELECT " +
            " (SELECT COALESCE(SUM(p.q),0) FROM (" +
            "    SELECT MAX(BIC_ZPRD_QTY) AS q FROM rpsim_raw_material" +
            "     WHERE CALMONTH = ? AND DATA_TYPE = '100'" + MACHINE_COND +
            "     GROUP BY BIC_ZMACHINE, PRODH1, PRODH2, PRODH3, PRODH4) p) AS prod_kg," +
            " (SELECT COALESCE(SUM(BIC_ZRAMT_060),0) FROM rpsim_raw_material" +
            "   WHERE CALMONTH = ? AND DATA_TYPE = '100'" + MACHINE_COND + ") AS mat_cost," +
            " (SELECT COALESCE(SUM(BIC_ZRAMT_060),0) FROM rpsim_raw_material" +
            "   WHERE CALMONTH = ? AND DATA_TYPE = '101'" + MACHINE_COND + ") AS sub_cost";
        return jdbcTemplate.queryForMap(sql, ym, machine, machine, ym, machine, machine, ym, machine, machine);
    }

    /** 지종별 원재료비 (P/L 시뮬레이터) — PRODH2_NM 기준, SC는 PRODH4_NM(평량) 300 이상/미만 분리 */
    private List<Object[]> findMaterialByProduct(String ym, String machine) {
        String sql =
            "SELECT product, SUM(prod_kg) / 1000 AS production_ton, SUM(mat_cost) AS material_cost FROM (" +
            "  SELECT CASE WHEN PRODH2_NM LIKE 'SC%' AND CAST(PRODH4_NM AS UNSIGNED) >= 300 THEN 'SC고평량'" +
            "              WHEN PRODH2_NM LIKE 'SC%' THEN 'SC저평량'" +
            "              ELSE PRODH2_NM END AS product," +
            "         MAX(BIC_ZPRD_QTY) AS prod_kg," +
            "         SUM(CASE WHEN DATA_TYPE = '100' THEN BIC_ZRAMT_060 ELSE 0 END) AS mat_cost" +
            "    FROM rpsim_raw_material" +
            "   WHERE CALMONTH = ?" + MACHINE_COND +
            "   GROUP BY BIC_ZMACHINE, PRODH1, PRODH2, PRODH3, PRODH4, PRODH2_NM, PRODH4_NM" +
            ") t WHERE product IS NOT NULL GROUP BY product HAVING SUM(prod_kg) > 0 ORDER BY material_cost DESC";
        return jdbcTemplate.query(sql, (rs, i) -> new Object[]{
                rs.getString("product"), rs.getBigDecimal("production_ton"), rs.getBigDecimal("material_cost")},
                ym, machine, machine);
    }

    private BigDecimal perTon1000(BigDecimal cost, long ton) {
        return ton > 0
                ? cost.divide(BigDecimal.valueOf(ton), 1, RoundingMode.HALF_UP)
                      .divide(BigDecimal.valueOf(1000), 1, RoundingMode.HALF_UP)
                : BigDecimal.ZERO;
    }

    private BigDecimal toBD(Object v) {
        if (v == null) return BigDecimal.ZERO;
        if (v instanceof BigDecimal bd) return bd;
        return new BigDecimal(v.toString());
    }

    // 유틸
    private BigDecimal toBD(Object[] row, int idx) {
        if (row == null || row.length <= idx || row[idx] == null) return BigDecimal.ZERO;
        if (row[idx] instanceof BigDecimal bd) return bd;
        return new BigDecimal(row[idx].toString());
    }
}
