package com.company.module.rollingplanningsimulation.service;

import com.company.module.rollingplanningsimulation.dto.response.CostUnitRateResponse;
import com.company.module.rollingplanningsimulation.dto.response.DataReadinessResponse;
import com.company.module.rollingplanningsimulation.repository.LogiRateRepository;
import com.company.module.rollingplanningsimulation.repository.OperatingTimeRepository;
import com.company.module.rollingplanningsimulation.repository.PwResultRepository;
import com.company.module.rollingplanningsimulation.support.RawMaterialSql;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
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
     *
     * <p>기준월 = 예상월. 원부재료 실적은 결산이 끝난 전월까지만 있으므로
     * 기준월 원·부재료비 = Σ(전월 지종별 원단위 × 기준월 지종 생산량)으로 구한다.</p>
     * <ul>
     *   <li>기준월 생산량: STEP3 생산계획 총생산량(양품 ÷ (1 − 손지율)) → 없으면 기준월 실적 → 없으면 0</li>
     *   <li>전월 원단위: 지종별 (재료비 ÷ 총생산량). 전월 실적에 없는 지종은 0 (경고 표시)</li>
     *   <li>지종명: 생산계획의 SC·백판지 기타는 평량(BASIS_WEIGHT) 300 미만=SC저평량 / 이상=SC고평량 — SAP 실적과 같은 규칙</li>
     * </ul>
     */
    public CostUnitRateResponse getCostUnitRates(String ym, String machine, String division) {
        RawMaterialSql.validateYm(ym);
        String prevYm = RawMaterialSql.prevYm(ym);
        int year = Integer.parseInt(ym.substring(0, 4));
        int month = Integer.parseInt(ym.substring(4, 6));

        // ── 전월 실적 (원단위 기준) ──
        Map<String, Object> prevTotals = findMonthlyTotals(prevYm, machine, division);
        BigDecimal prevProdKg = toBD(prevTotals.get("prod_kg"));
        BigDecimal prevMatCost = toBD(prevTotals.get("mat_cost"));
        BigDecimal prevSubCost = toBD(prevTotals.get("sub_cost"));
        long prevProdTon = prevProdKg.divide(THOUSAND, 0, RoundingMode.HALF_UP).longValue();
        BigDecimal prevTonExact = prevProdKg.divide(THOUSAND, 6, RoundingMode.HALF_UP);

        Map<String, Object[]> prevMap = new LinkedHashMap<>();
        for (Object[] r : findMaterialByProduct(prevYm, machine, division)) prevMap.put((String) r[0], r);

        // ── 기준월 생산량 (지종별 톤) ──
        Map<String, BigDecimal> baseByProd = findPlanProdByProduct(year, month, machine, division);
        String baseSource = "PLAN";
        if (baseByProd.isEmpty()) {
            for (Object[] r : findMaterialByProduct(ym, machine, division)) baseByProd.put((String) r[0], toBD(r, 1));
            baseSource = baseByProd.isEmpty() ? "NONE" : "ACTUAL";
        }
        boolean planLocked = "PLAN".equals(baseSource) && isPlanLocked(year, month, machine, division);

        // ── 지종별: 전월 원단위 × 기준월 생산량 ──
        BigDecimal baseTon = BigDecimal.ZERO, estMat = BigDecimal.ZERO, estSub = BigDecimal.ZERO;
        List<String> unmatched = new ArrayList<>();
        List<Object[]> rows = new ArrayList<>(); // [지종, 톤, 원재료비, 원재료 원단위(원/톤), 전월톤, 전월원재료비, 부재료 원단위(원/톤)]
        for (Map.Entry<String, BigDecimal> e : baseByProd.entrySet()) {
            String product = e.getKey();
            BigDecimal ton = e.getValue();
            Object[] pr = prevMap.get(product);
            BigDecimal pTon = pr != null ? toBD(pr, 1) : BigDecimal.ZERO;
            BigDecimal pCost = pr != null ? toBD(pr, 2) : BigDecimal.ZERO;
            BigDecimal matRate, subRate;
            if (pTon.signum() > 0) {
                matRate = div6(pCost, pTon);
                subRate = div6(toBD(pr, 3), pTon);
            } else {
                // 전월 실적에 없는 지종 — 추정하지 않고 0
                matRate = BigDecimal.ZERO;
                subRate = BigDecimal.ZERO;
                unmatched.add(product);
            }
            BigDecimal mat = matRate.multiply(ton);
            baseTon = baseTon.add(ton);
            estMat = estMat.add(mat);
            estSub = estSub.add(subRate.multiply(ton));
            rows.add(new Object[]{product, ton, mat, matRate, pTon, pCost, subRate});
        }
        // 전월에만 있는 지종 — 기준월 생산량 0으로 추가 (P/L 지종별 생산량 what-if 에서 입력할 수 있게)
        for (Map.Entry<String, Object[]> e : prevMap.entrySet()) {
            if (baseByProd.containsKey(e.getKey())) continue;
            Object[] pr = e.getValue();
            BigDecimal pTon = toBD(pr, 1);
            if (pTon.signum() <= 0) continue;
            rows.add(new Object[]{e.getKey(), BigDecimal.ZERO, BigDecimal.ZERO, div6(toBD(pr, 2), pTon), pTon, toBD(pr, 2), div6(toBD(pr, 3), pTon)});
        }

        List<CostUnitRateResponse.MaterialByProduct> materialByProduct = new ArrayList<>();
        for (Object[] r : rows) {
            BigDecimal ton = (BigDecimal) r[1], mat = (BigDecimal) r[2], rate = (BigDecimal) r[3];
            BigDecimal pTon = (BigDecimal) r[4], pCost = (BigDecimal) r[5], subRate = (BigDecimal) r[6];
            materialByProduct.add(CostUnitRateResponse.MaterialByProduct.builder()
                    .product((String) r[0])
                    .productionTonExact(ton.setScale(3, RoundingMode.HALF_UP))
                    .prevProductionTonExact(pTon.setScale(3, RoundingMode.HALF_UP))
                    .matRateWon(rate.setScale(2, RoundingMode.HALF_UP))
                    .subRateWon(subRate.setScale(2, RoundingMode.HALF_UP))
                    .prevMatched(pTon.signum() > 0)
                    .productionTon(ton.setScale(0, RoundingMode.HALF_UP).longValue())
                    .materialCost(mat.setScale(0, RoundingMode.HALF_UP))
                    .unitCost1000(rate.divide(THOUSAND, 1, RoundingMode.HALF_UP))
                    .prevProductionTon(pTon.setScale(0, RoundingMode.HALF_UP).longValue())
                    .prevMaterialCost(pCost)
                    .prevUnitCost1000(div6(pCost, pTon).divide(THOUSAND, 1, RoundingMode.HALF_UP))
                    .sharePct(estMat.signum() > 0
                            ? mat.multiply(BigDecimal.valueOf(100)).divide(estMat, 1, RoundingMode.HALF_UP)
                            : BigDecimal.ZERO)
                    .build());
        }
        materialByProduct.sort((a, b) -> b.getMaterialCost().compareTo(a.getMaterialCost()));

        long baseProdTon = baseTon.setScale(0, RoundingMode.HALF_UP).longValue();
        BigDecimal matPerTon = div6(estMat, baseTon).divide(THOUSAND, 1, RoundingMode.HALF_UP);
        BigDecimal subPerTon = div6(estSub, baseTon).divide(THOUSAND, 1, RoundingMode.HALF_UP);
        BigDecimal prevMatPerTon = div6(prevMatCost, prevTonExact).divide(THOUSAND, 1, RoundingMode.HALF_UP);
        BigDecimal prevSubPerTon = div6(prevSubCost, prevTonExact).divide(THOUSAND, 1, RoundingMode.HALF_UP);

        List<String> warnings = new ArrayList<>();
        if (prevProdTon <= 0)
            warnings.add("전월(" + prevYm + ") 원부재료 실적이 없어 원·부재료비를 0으로 계산했습니다.");
        if ("NONE".equals(baseSource))
            warnings.add("기준월(" + ym + ") 생산계획(STEP3)과 실적이 모두 없어 기준 생산량을 0으로 두었습니다.");
        if (!unmatched.isEmpty() && prevProdTon > 0)
            warnings.add("전월 실적에 없는 지종은 원·부재료비 0으로 계산했습니다: " + String.join(", ", unmatched));

        return CostUnitRateResponse.builder()
                .ym(ym)
                .prevYm(prevYm)
                .machine(machine)
                .division(division)
                .baseProdTon(baseProdTon)
                .baseProdSource(baseSource)
                .planLocked(planLocked)
                .unmatchedProducts(unmatched)
                .warnings(warnings)
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
                        .materialCost(estMat.setScale(0, RoundingMode.HALF_UP))
                        .subMaterialCost(estSub.setScale(0, RoundingMode.HALF_UP))
                        .energyCost(BigDecimal.ZERO)
                        .logisticsCost(BigDecimal.ZERO)
                        .productionKg(baseTon.multiply(THOUSAND))
                        .productionTon(baseProdTon)
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
                        .material(estMat.signum() > 0)
                        .subMaterial(estSub.signum() > 0)
                        .energy(false)
                        .logistics(false)
                        .revenue(false)
                        .build())
                .materialByProduct(materialByProduct)
                .machines(findMachines(ym, prevYm, division))
                .divisionMachines(jdbcTemplate.queryForList(
                        "SELECT UNIT_CODE FROM rpsim_unit WHERE DIVISION = ? AND DELETED_YN = 'N' ORDER BY UNIT_CODE", String.class, division))
                .build();
    }

    private static final BigDecimal THOUSAND = BigDecimal.valueOf(1000);

    private static BigDecimal div6(BigDecimal a, BigDecimal b) {
        return (b == null || b.signum() == 0) ? BigDecimal.ZERO : a.divide(b, 6, RoundingMode.HALF_UP);
    }

    /**
     * 생산계획 지종명 → SAP 실적 지종명(RawMaterialSql.PRODUCT_EXPR)과 같은 규칙.
     * SC·백판지 기타는 평량 300 미만=SC저평량 / 이상=SC고평량. 평량이 없으면 분류 불가로 남겨 0 처리(경고)
     */
    private static final String PLAN_PRODUCT_EXPR =
            "CASE WHEN TRIM(PRODUCT) IN ('SC','백판지 기타') THEN " +
            "  CASE WHEN COALESCE(BASIS_WEIGHT,0) <= 0 THEN CONCAT(TRIM(PRODUCT),'(평량 없음)')" +
            "       WHEN BASIS_WEIGHT < 300 THEN 'SC저평량' ELSE 'SC고평량' END " +
            "ELSE TRIM(PRODUCT) END";

    /** 기준월 생산계획(STEP3) 지종별 총생산량(톤) = 양품 ÷ (1 − 손지율) — 전월 원단위 분모(총생산량)와 같은 기준 */
    private Map<String, BigDecimal> findPlanProdByProduct(int year, int month, String machine, String division) {
        Map<String, BigDecimal> map = new LinkedHashMap<>();
        jdbcTemplate.query(
            "SELECT " + PLAN_PRODUCT_EXPR + " AS product, SUM(GOOD_TON * 100 / (100 - COALESCE(WASTE_RATE_PCT,0))) AS ton" +
            "  FROM rpsim_production_plan" +
            " WHERE `YEAR` = ? AND `MONTH` = ? AND DIVISION = ? AND DELETED_YN = 'N'" +
            "   AND (? = 'ALL' OR MACHINE_CODE = ?)" +
            "   AND COALESCE(WASTE_RATE_PCT,0) < 100 AND COALESCE(GOOD_TON,0) > 0" +
            " GROUP BY " + PLAN_PRODUCT_EXPR,
            rs -> { map.put(rs.getString("product"), rs.getBigDecimal("ton")); },
            year, month, division, machine, machine);
        return map;
    }

    /** 생산계획 확정(잠금) 여부 — 양품이 있는 계획 행이 모두 잠겨 있으면 true */
    private boolean isPlanLocked(int year, int month, String machine, String division) {
        Long n = jdbcTemplate.queryForObject(
            "SELECT COUNT(*) FROM rpsim_production_plan" +
            " WHERE `YEAR` = ? AND `MONTH` = ? AND DIVISION = ? AND DELETED_YN = 'N'" +
            "   AND (? = 'ALL' OR MACHINE_CODE = ?) AND COALESCE(GOOD_TON,0) > 0 AND COALESCE(IS_LOCKED,0) = 0",
            Long.class, year, month, division, machine, machine);
        return n != null && n == 0;
    }

    /**
     * 데이터 준비 현황 대시보드
     */
    public DataReadinessResponse getDataReadiness(String ym, String division) {
        // 실제 DB에서 각 모듈별 건수 조회
        Long rawCountObj = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM rpsim_raw_material WHERE CALMONTH = ?" + RawMaterialSql.DIV_SCOPE, Long.class, ym, division);
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
    //  - 생산량·재료비·지종 규칙은 RawMaterialSql (원부재료비 탭과 동일 기준)
    //    생산량 = 총생산량 (호기, 제품레벨4)별 MAX 후 합계 / 재료비 = 실적배부수량 × 실적단가
    // ================================================================
    /** 사업부(호기 마스터) + 호기 조건 — 파라미터 3개: division, machine, machine */
    private static final String SCOPE = RawMaterialSql.DIV_SCOPE + RawMaterialSql.MACHINE_COND;

    private Map<String, Object> findMonthlyTotals(String ym, String machine, String division) {
        String sql =
            "SELECT " +
            " (SELECT COALESCE(SUM(p.q),0) FROM (" +
            "    SELECT MAX(" + RawMaterialSql.PROD_QTY_COL + ") AS q FROM rpsim_raw_material" +
            "     WHERE CALMONTH = ?" + SCOPE +
            "     GROUP BY BIC_ZMACHINE, PRODH4) p) AS prod_kg," +
            " (SELECT COALESCE(SUM(" + RawMaterialSql.COST_EXPR + "),0) FROM rpsim_raw_material" +
            "   WHERE CALMONTH = ? AND DATA_TYPE = '100'" + SCOPE + ") AS mat_cost," +
            " (SELECT COALESCE(SUM(" + RawMaterialSql.COST_EXPR + "),0) FROM rpsim_raw_material" +
            "   WHERE CALMONTH = ? AND DATA_TYPE = '101'" + SCOPE + ") AS sub_cost";
        return jdbcTemplate.queryForMap(sql, ym, division, machine, machine, ym, division, machine, machine, ym, division, machine, machine);
    }

    /** 지종별 [지종, 생산량(톤), 원재료비, 부재료비] — SC는 PRODH4 끝 3자리(평량) 300 기준 */
    private List<Object[]> findMaterialByProduct(String ym, String machine, String division) {
        String sql =
            "SELECT product, SUM(prod_kg) / 1000 AS production_ton, SUM(mat_cost) AS material_cost, SUM(sub_cost) AS sub_cost FROM (" +
            "  SELECT " + RawMaterialSql.PRODUCT_EXPR + " AS product," +
            "         MAX(" + RawMaterialSql.PROD_QTY_COL + ") AS prod_kg," +
            "         SUM(CASE WHEN DATA_TYPE = '100' THEN " + RawMaterialSql.COST_EXPR + " ELSE 0 END) AS mat_cost," +
            "         SUM(CASE WHEN DATA_TYPE = '101' THEN " + RawMaterialSql.COST_EXPR + " ELSE 0 END) AS sub_cost" +
            "    FROM rpsim_raw_material" +
            "   WHERE CALMONTH = ?" + SCOPE +
            "   GROUP BY BIC_ZMACHINE, PRODH4, PRODH2_NM" +
            ") t WHERE product IS NOT NULL GROUP BY product HAVING SUM(prod_kg) > 0 ORDER BY material_cost DESC";
        return jdbcTemplate.query(sql, (rs, i) -> new Object[]{
                rs.getString("product"), rs.getBigDecimal("production_ton"), rs.getBigDecimal("material_cost"), rs.getBigDecimal("sub_cost")},
                ym, division, machine, machine);
    }

    /** P/L 탭 호기 선택 목록 — 해당 사업부 호기 중 당월·전월 실적이 있는 호기 */
    private List<Map<String, Object>> findMachines(String ym, String prevYm, String division) {
        return jdbcTemplate.queryForList(
            "SELECT BIC_ZMACHINE AS code, MAX(BIC_ZMACHINE_NM) AS name FROM rpsim_raw_material" +
            " WHERE CALMONTH IN (?, ?)" + RawMaterialSql.DIV_SCOPE +
            " GROUP BY BIC_ZMACHINE ORDER BY BIC_ZMACHINE", ym, prevYm, division);
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
